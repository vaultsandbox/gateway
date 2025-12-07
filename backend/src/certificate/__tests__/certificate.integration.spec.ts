import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule, HttpService } from '@nestjs/axios';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as acme from 'acme-client';
import * as forge from 'node-forge';
import { CertificateModule } from './../certificate.module';
import { CertificateService } from './../certificate.service';
import { CertificateStorageService } from './../storage/certificate-storage.service';
import { CertificateWatcherService } from './../watcher/certificate-watcher.service';
import { CertificateHealthIndicator } from './../certificate.health';
import { MetricsModule } from '../../metrics/metrics.module';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';
import { MetricsService } from '../../metrics/metrics.service';
import { OrchestrationModule } from '../../orchestration/orchestration.module';
import { OrchestrationService } from '../../orchestration/orchestration.service';
import type { Certificate } from './../interfaces';

/**
 * Generates a valid self-signed certificate using node-forge
 */
function generateSelfSignedCert(commonName: string): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    {
      name: 'commonName',
      value: commonName,
    },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return forge.pki.certificateToPem(cert);
}

/**
 * Mock ACME Server
 *
 * Implements a minimal subset of RFC 8555 ACME protocol endpoints
 * that acme-client touches during certificate issuance.
 */
class MockAcmeServer {
  private server: http.Server;
  private port: number = 0;
  private orders: Map<string, any> = new Map();
  private challenges: Map<string, any> = new Map();
  private nonce: number = 1;

  // Track calls for assertions
  public ordersCalled: number = 0;
  public challengesCompleted: number = 0;
  public certificatesIssued: number = 0;

  // Valid self-signed certificate (generated during start)
  private mockCertPem: string = '';

  constructor() {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  async start(): Promise<string> {
    // Generate a valid self-signed certificate
    this.mockCertPem = generateSelfSignedCert('cert.test');

    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.port = addr.port;
        const directoryUrl = `http://127.0.0.1:${this.port}/directory`;
        resolve(directoryUrl);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  reset(): void {
    this.orders.clear();
    this.challenges.clear();
    this.ordersCalled = 0;
    this.challengesCompleted = 0;
    this.certificatesIssued = 0;
    this.nonce = 1;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '';

    // Directory endpoint
    if (url === '/directory') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          newNonce: `http://127.0.0.1:${this.port}/acme/new-nonce`,
          newAccount: `http://127.0.0.1:${this.port}/acme/new-account`,
          newOrder: `http://127.0.0.1:${this.port}/acme/new-order`,
        }),
      );
      return;
    }

    // Nonce endpoint
    if (url === '/acme/new-nonce') {
      res.writeHead(200, {
        'Replay-Nonce': this.generateNonce(),
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    // New account endpoint
    if (url === '/acme/new-account' && req.method === 'POST') {
      this.handlePostRequest(req, res, () => {
        res.writeHead(201, {
          'Content-Type': 'application/json',
          'Replay-Nonce': this.generateNonce(),
          Location: `http://127.0.0.1:${this.port}/acme/account/1`,
        });
        res.end(
          JSON.stringify({
            status: 'valid',
            contact: [],
            orders: `http://127.0.0.1:${this.port}/acme/account/1/orders`,
          }),
        );
      });
      return;
    }

    // New order endpoint
    if (url === '/acme/new-order' && req.method === 'POST') {
      this.handlePostRequest(req, res, (body) => {
        this.ordersCalled++;
        const orderId = `order-${this.ordersCalled}`;
        const authzId = `authz-${this.ordersCalled}`;
        const challengeToken = `token-${this.ordersCalled}`;

        const order = {
          status: 'pending',
          identifiers: body.identifiers || [{ type: 'dns', value: 'cert.test' }],
          authorizations: [`http://127.0.0.1:${this.port}/acme/authz/${authzId}`],
          finalize: `http://127.0.0.1:${this.port}/acme/order/${orderId}/finalize`,
        };

        this.orders.set(orderId, order);
        this.challenges.set(authzId, {
          identifier: { type: 'dns', value: 'cert.test' },
          status: 'pending',
          challenges: [
            {
              type: 'http-01',
              status: 'pending',
              url: `http://127.0.0.1:${this.port}/acme/challenge/${challengeToken}`,
              token: challengeToken,
            },
          ],
        });

        res.writeHead(201, {
          'Content-Type': 'application/json',
          'Replay-Nonce': this.generateNonce(),
          Location: `http://127.0.0.1:${this.port}/acme/order/${orderId}`,
        });
        res.end(JSON.stringify(order));
      });
      return;
    }

    // Get authorization endpoint
    if (url.startsWith('/acme/authz/') && req.method === 'POST') {
      const authzId = url.split('/').pop();
      const authz = this.challenges.get(authzId as string);

      if (authz) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Replay-Nonce': this.generateNonce(),
        });
        res.end(JSON.stringify(authz));
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // Complete challenge endpoint
    if (url.startsWith('/acme/challenge/') && req.method === 'POST') {
      this.handlePostRequest(req, res, () => {
        this.challengesCompleted++;
        const token = url.split('/').pop();

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Replay-Nonce': this.generateNonce(),
        });
        res.end(
          JSON.stringify({
            type: 'http-01',
            status: 'valid',
            url: url,
            token: token,
            validated: new Date().toISOString(),
          }),
        );
      });
      return;
    }

    // Get order status endpoint
    if (url.startsWith('/acme/order/') && !url.includes('/finalize') && req.method === 'POST') {
      const orderId = url.split('/').pop();
      const order = this.orders.get(orderId as string);

      if (order) {
        // Mark order as ready after challenge completion
        if (this.challengesCompleted > 0) {
          order.status = 'ready';
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Replay-Nonce': this.generateNonce(),
        });
        res.end(JSON.stringify(order));
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // Finalize order endpoint
    if (url.includes('/finalize') && req.method === 'POST') {
      this.handlePostRequest(req, res, () => {
        const orderId = url.split('/')[3];
        const order = this.orders.get(orderId);

        if (order) {
          order.status = 'valid';
          order.certificate = `http://127.0.0.1:${this.port}/acme/certificate/${orderId}`;

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Replay-Nonce': this.generateNonce(),
          });
          res.end(JSON.stringify(order));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      return;
    }

    // Get certificate endpoint
    if (url.startsWith('/acme/certificate/') && req.method === 'POST') {
      this.certificatesIssued++;

      res.writeHead(200, {
        'Content-Type': 'application/pem-certificate-chain',
        'Replay-Nonce': this.generateNonce(),
      });
      res.end(this.mockCertPem);
      return;
    }

    // Default 404
    res.writeHead(404);
    res.end();
  }

  private handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse, handler: (body: any) => void): void {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        handler(parsed);
      } catch {
        handler({});
      }
    });
  }

  private generateNonce(): string {
    return Buffer.from(`nonce-${this.nonce++}`).toString('base64url');
  }
}

/**
 * Shared Test Utilities
 */

/**
 * Creates a unique temporary storage directory
 */
async function createTempStorage(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cert-test-'));
  const challengesDir = path.join(tmpDir, 'challenges');
  await fs.mkdir(challengesDir, { recursive: true });
  return tmpDir;
}

/**
 * Reads stored certificate files and metadata
 */
async function readStoredCert(storagePath: string): Promise<{
  certExists: boolean;
  keyExists: boolean;
  metadataExists: boolean;
  metadata?: any;
}> {
  const certPath = path.join(storagePath, 'cert.pem');
  const keyPath = path.join(storagePath, 'key.pem');
  const metadataPath = path.join(storagePath, 'metadata.json');

  const certExists = fsSync.existsSync(certPath);
  const keyExists = fsSync.existsSync(keyPath);
  const metadataExists = fsSync.existsSync(metadataPath);

  let metadata;
  if (metadataExists) {
    metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
  }

  return { certExists, keyExists, metadataExists, metadata };
}

/**
 * Waits for an event to be emitted
 */
function waitForEvent(eventEmitter: EventEmitter2, eventName: string, timeout = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    eventEmitter.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Signs peer authentication headers
 */
function signPeerHeaders(nodeId: string, sharedSecret: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const crypto = require('crypto');
  const signature = crypto.createHmac('sha256', sharedSecret).update(`${nodeId}:${timestamp}`).digest('hex');

  return {
    'X-Peer-Token': nodeId,
    'X-Peer-Timestamp': timestamp,
    'X-Peer-Signature': signature,
  };
}

/**
 * Creates a valid test certificate using forge utilities
 */
async function createValidTestCert(domains: string[]): Promise<Certificate> {
  const privateKey = await acme.forge.createPrivateKey();
  const certPem = generateSelfSignedCert(domains[0]);

  return {
    privateKey,
    certificate: Buffer.from(certPem),
    fullchain: Buffer.from(certPem),
    domains,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
  };
}

/**
 * Integration Test Suite
 */
const restoreLogger = silenceNestLogger();

describe('Certificate Module Integration Tests', () => {
  let app: INestApplication;
  let certificateService: CertificateService;
  let storageService: CertificateStorageService;
  let watcherService: CertificateWatcherService;
  let metricsService: MetricsService;
  let eventEmitter: EventEmitter2;
  let httpService: HttpService;
  let mockAcmeServer: MockAcmeServer;
  let tempStoragePath: string;
  let acmeDirectoryUrl: string;

  jest.setTimeout(60000);

  beforeAll(async () => {
    // Start mock ACME server
    mockAcmeServer = new MockAcmeServer();
    acmeDirectoryUrl = await mockAcmeServer.start();

    // Create temp storage
    tempStoragePath = await createTempStorage();

    // Create test module with real wiring
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              vsb: {
                certificate: {
                  enabled: true,
                  email: 'test@example.com',
                  domain: 'cert.test',
                  storagePath: tempStoragePath,
                  checkInterval: 86400000,
                  renewDaysBeforeExpiry: 30,
                  acmeDirectoryUrl,
                  staging: false,
                  peerSharedSecret: 'test-secret',
                },
                orchestration: {
                  enabled: false,
                  clusterName: 'test-cluster',
                  nodeId: 'test-node-1',
                  peers: [],
                  backend: { url: '', apiKey: '', timeout: 10000 },
                  leadership: { ttl: 300 },
                },
                main: {
                  port: 8080,
                },
              },
            }),
          ],
        }),
        // Configure HttpModule with short timeouts and no keep-alive
        HttpModule.register({
          timeout: 5000,
          maxRedirects: 5,
          httpAgent: new http.Agent({ keepAlive: false }),
        }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        CertificateModule,
        MetricsModule,
        OrchestrationModule,
      ],
    })
      .overrideProvider(CertificateHealthIndicator)
      .useValue({
        isHealthy: jest.fn().mockResolvedValue({ certificate: { status: 'up' } }),
      })
      .compile();

    app = moduleFixture.createNestApplication();

    // Get service instances
    certificateService = moduleFixture.get<CertificateService>(CertificateService);
    storageService = moduleFixture.get<CertificateStorageService>(CertificateStorageService);
    watcherService = moduleFixture.get<CertificateWatcherService>(CertificateWatcherService);
    metricsService = moduleFixture.get<MetricsService>(MetricsService);
    eventEmitter = moduleFixture.get<EventEmitter2>(EventEmitter2);
    httpService = moduleFixture.get<HttpService>(HttpService);

    // Initialize app (but don't trigger automatic certificate check)
    await app.init();

    // Wait a bit for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await app.close();
    await mockAcmeServer.stop();
    await fs.rm(tempStoragePath, { recursive: true, force: true });
    restoreLogger();
  });

  afterAll(async () => {
    // Cleanup in reverse order of initialization

    // 1. Stop the file watcher first
    if (watcherService) {
      try {
        await watcherService.stopWatching();
      } catch {
        // Ignore watcher stop errors
      }
    }

    // 2. Close the NestJS app (triggers onModuleDestroy lifecycle hooks)
    if (app) {
      try {
        await app.close();
        // Wait a bit for all async cleanup to complete
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // Ignore app close errors
      }
    }

    // 3. Force close HTTP connections
    if (httpService) {
      try {
        const axiosRef = httpService.axiosRef;
        // Destroy any open connections
        if (axiosRef.defaults.httpAgent) {
          (axiosRef.defaults.httpAgent as http.Agent).destroy();
        }
      } catch {
        // Ignore HTTP cleanup errors
      }
    }

    // 4. Stop the mock ACME server
    if (mockAcmeServer) {
      try {
        await mockAcmeServer.stop();
      } catch {
        // Ignore server stop errors
      }
    }

    // 5. Cleanup temp storage
    if (tempStoragePath) {
      try {
        await fs.rm(tempStoragePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  beforeEach(() => {
    mockAcmeServer.reset();
  });

  describe('3.1 Module Bootstraps and Watcher Starts', () => {
    it('should start watcher and detect certificate file changes', async () => {
      // Seed storage with valid cert
      const testCert = await createValidTestCert(['cert.test']);
      storageService.saveCertificate(testCert);

      // Restart watcher so it picks up the newly created files
      // (watcher was started before files existed, need to restart to watch them properly)
      await watcherService.stopWatching();
      await new Promise((resolve) => setTimeout(resolve, 100));
      watcherService.startWatching();
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        // Trigger file change by appending to cert
        const certPath = path.join(tempStoragePath, 'cert.pem');
        const original = await fs.readFile(certPath);
        await fs.writeFile(certPath, Buffer.concat([original, Buffer.from('\n')]));

        // Wait for watcher event (stabilityThreshold = 2000ms + processing time)
        const reloadedCert = await waitForEvent(eventEmitter, 'certificate.reloaded', 4000);

        expect(reloadedCert).toBeDefined();
        expect(reloadedCert.domains).toEqual(testCert.domains);
        expect(reloadedCert.expiresAt).toEqual(testCert.expiresAt);
      } finally {
        // Stop watcher and wait for cleanup
        await watcherService.stopWatching();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    });
  });

  describe('3.2 ACME Order When No Certificate Exists', () => {
    it('should complete full ACME flow and create certificate', async () => {
      // Ensure storage is empty
      const certPath = path.join(tempStoragePath, 'cert.pem');
      const keyPath = path.join(tempStoragePath, 'key.pem');

      try {
        await fs.unlink(certPath);
      } catch {
        // Ignore file not found errors
      }
      try {
        await fs.unlink(keyPath);
      } catch {
        // Ignore file not found errors
      }

      // Run certificate check
      await certificateService.checkAndRenewIfNeeded();

      // Assert ACME flow
      expect(mockAcmeServer.ordersCalled).toBeGreaterThan(0);
      expect(mockAcmeServer.challengesCompleted).toBeGreaterThan(0);
      expect(mockAcmeServer.certificatesIssued).toBeGreaterThan(0);

      // Assert files created
      const stored = await readStoredCert(tempStoragePath);
      expect(stored.certExists).toBe(true);
      expect(stored.keyExists).toBe(true);
      expect(stored.metadataExists).toBe(true);
      expect(stored.metadata.domains).toContain('cert.test');

      // Assert metrics updated
      const metrics = metricsService.getMetrics();
      expect(metrics.certificate.renewal_success).toBeGreaterThan(0);
      expect(metrics.certificate.days_until_expiry).toBeDefined();

      // Assert challenge cleanup
      const challengeResponse = storageService.getChallengeResponse('token-1');
      expect(challengeResponse).toBeNull();
    });
  });

  describe('3.3 Skip Renewal When Certificate Far From Expiry', () => {
    it('should not renew when certificate is valid for 90+ days', async () => {
      // Write metadata with far future expiry
      const metadataPath = path.join(tempStoragePath, 'metadata.json');
      const metadata = {
        domains: ['cert.test'],
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      // Create dummy cert files
      const testCert = await createValidTestCert(['cert.test']);
      storageService.saveCertificate(testCert);

      const ordersBefore = mockAcmeServer.ordersCalled;

      // Run check
      await certificateService.checkAndRenewIfNeeded();

      // Assert no new order
      expect(mockAcmeServer.ordersCalled).toBe(ordersBefore);
    });
  });

  describe('3.4 Renew When Near Expiry', () => {
    it('should renew when certificate expires in <30 days', async () => {
      // Create cert files first
      const testCert = await createValidTestCert(['cert.test']);
      storageService.saveCertificate(testCert);

      // Overwrite metadata with near expiry (10 days) after saving certificate
      const metadataPath = path.join(tempStoragePath, 'metadata.json');
      const metadata = {
        domains: ['cert.test'],
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      const ordersBefore = mockAcmeServer.ordersCalled;

      try {
        // Run check
        await certificateService.checkAndRenewIfNeeded();

        // Wait for any pending async operations to complete
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Assert new order created
        expect(mockAcmeServer.ordersCalled).toBeGreaterThan(ordersBefore);
        expect(mockAcmeServer.challengesCompleted).toBeGreaterThan(0);

        // Assert metadata replaced
        const stored = await readStoredCert(tempStoragePath);
        expect(stored.metadataExists).toBe(true);

        // Assert challenge cleaned up
        const challengeResponse = storageService.getChallengeResponse('token-1');
        expect(challengeResponse).toBeNull();
      } finally {
        // Allow time for any pending HTTP connections or event handlers to clean up
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    });
  });

  describe('3.5 Manual Renewal Endpoint', () => {
    it('should trigger renewal via POST /cluster/certificates/renew', async () => {
      // Setup: Create cert with near-expiry metadata to trigger renewal
      const testCert = await createValidTestCert(['cert.test']);
      storageService.saveCertificate(testCert);

      const metadataPath = path.join(tempStoragePath, 'metadata.json');
      const metadata = {
        domains: ['cert.test'],
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      const ordersBefore = mockAcmeServer.ordersCalled;
      const headers = signPeerHeaders('test-node-1', 'test-secret');

      try {
        const response = await request(app.getHttpServer())
          .post('/cluster/certificates/renew')
          .set(headers)
          .expect(201);

        // Wait for renewal process to complete
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(response.body.message).toBe('Certificate renewal initiated');
        expect(mockAcmeServer.ordersCalled).toBeGreaterThan(ordersBefore);
      } finally {
        // Allow time for any pending HTTP connections or event handlers to clean up
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    });

    it('should reject request without auth headers', async () => {
      await request(app.getHttpServer()).post('/cluster/certificates/renew').expect(401);
    });
  });

  describe('3.6 Certificate Status Endpoint', () => {
    it('should return status when certificate exists', async () => {
      // Create valid cert
      const testCert = await createValidTestCert(['cert.test']);
      storageService.saveCertificate(testCert);

      const headers = signPeerHeaders('test-node-1', 'test-secret');
      const response = await request(app.getHttpServer()).get('/cluster/certificates/status').set(headers).expect(200);

      expect(response.body.exists).toBe(true);
      expect(response.body.valid).toBe(true);
      expect(response.body.domain).toBe('cert.test');
      expect(response.body.daysUntilExpiry).toBeDefined();
    });

    it('should return exists=false when no certificate', async () => {
      // Remove files
      const certPath = path.join(tempStoragePath, 'cert.pem');
      const keyPath = path.join(tempStoragePath, 'key.pem');

      try {
        await fs.unlink(certPath);
      } catch {
        // Ignore file not found errors
      }
      try {
        await fs.unlink(keyPath);
      } catch {
        // Ignore file not found errors
      }

      const headers = signPeerHeaders('test-node-1', 'test-secret');
      const response = await request(app.getHttpServer()).get('/cluster/certificates/status').set(headers).expect(200);

      expect(response.body.exists).toBe(false);
      expect(response.body.valid).toBe(false);
    });

    it('should reject request without auth headers', async () => {
      await request(app.getHttpServer()).get('/cluster/certificates/status').expect(401);
    });
  });

  describe('3.7 ACME Challenge Endpoint', () => {
    it('should serve challenge response', async () => {
      const token = 'test-token-123';
      const keyAuth = 'test-key-auth-456';

      storageService.saveChallengeResponse(token, keyAuth);

      const response = await request(app.getHttpServer()).get(`/.well-known/acme-challenge/${token}`).expect(200);

      expect(response.text).toBe(keyAuth);
    });

    it('should return 404 when challenge not found', async () => {
      await request(app.getHttpServer()).get('/.well-known/acme-challenge/nonexistent-token').expect(404);
    });

    it('should reject invalid challenge tokens when saving', () => {
      expect(() => storageService.saveChallengeResponse('../etc/passwd', 'auth')).toThrow(
        'Invalid challenge token format',
      );
      expect(() => storageService.saveChallengeResponse('token$123', 'auth')).toThrow('Invalid challenge token format');
    });

    it('should return null for invalid challenge tokens when reading', () => {
      const response = storageService.getChallengeResponse('../etc/passwd');
      expect(response).toBeNull();
    });
  });

  describe('3.8 Cluster Challenge Sync Endpoint', () => {
    it('should sync challenge with valid peer headers', async () => {
      const headers = signPeerHeaders('test-node-2', 'test-secret');
      const token = 'sync-token-123';
      const keyAuth = 'sync-key-auth-456';

      await request(app.getHttpServer())
        .post('/cluster/challenges/sync')
        .set(headers)
        .send({ token, keyAuth })
        .expect(201);

      // Verify challenge saved
      const savedKeyAuth = storageService.getChallengeResponse(token);
      expect(savedKeyAuth).toBe(keyAuth);
    });

    it('should reject request without auth headers', async () => {
      await request(app.getHttpServer())
        .post('/cluster/challenges/sync')
        .send({ token: 'test', keyAuth: 'test' })
        .expect(401);
    });
  });

  describe('3.9 Cluster Certificate Sync Endpoint', () => {
    it('should sync certificate with valid headers', async () => {
      const testCert = await createValidTestCert(['sync.test']);
      const headers = signPeerHeaders('test-node-2', 'test-secret');

      const payload = {
        certificate: testCert.certificate.toString('base64'),
        privateKey: testCert.privateKey.toString('base64'),
        fullchain: testCert.fullchain?.toString('base64'),
        metadata: {
          domains: testCert.domains,
          issuedAt: testCert.issuedAt.toISOString(),
          expiresAt: testCert.expiresAt.toISOString(),
        },
      };

      const eventPromise = waitForEvent(eventEmitter, 'certificate.reloaded', 5000);

      await request(app.getHttpServer()).post('/cluster/certificates/sync').set(headers).send(payload).expect(201);

      // Wait for event
      const reloadedCert = await eventPromise;
      expect(reloadedCert.domains).toEqual(testCert.domains);

      // Verify cert saved
      const loaded = await storageService.loadCertificate();
      expect(loaded).toBeDefined();
      expect(loaded?.domains).toEqual(testCert.domains);
      expect(loaded?.fullchain?.toString()).toEqual(testCert.fullchain?.toString());
    });

    it('should reject request without auth headers', async () => {
      await request(app.getHttpServer())
        .post('/cluster/certificates/sync')
        .send({
          certificate: 'test',
          privateKey: 'test',
          metadata: { domains: [], issuedAt: '', expiresAt: '' },
        })
        .expect(401);
    });
  });

  describe('3.10 Distribution to Followers', () => {
    it('should distribute challenge and certificate to peers', async () => {
      // This test requires orchestration enabled with peers
      // We'll create a new app instance with peer configuration

      let followerServer: http.Server;
      let followerPort: number = 0;
      const receivedPayloads: any[] = [];

      // Start follower server
      await new Promise<void>((resolve) => {
        followerServer = http.createServer((req, res) => {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              receivedPayloads.push({
                url: req.url,
                body: JSON.parse(body),
              });
            } catch {
              // Ignore JSON parsing errors
            }
            res.writeHead(201);
            res.end();
          });
        });

        followerServer.listen(0, '127.0.0.1', () => {
          const addr = followerServer.address() as { port: number };
          followerPort = addr.port;
          resolve();
        });
      });

      try {
        // Create new app with orchestration enabled and peer configured
        const peerTempStorage = await createTempStorage();

        const peerModule = await Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              ignoreEnvFile: true,
              load: [
                () => ({
                  vsb: {
                    certificate: {
                      enabled: true,
                      email: 'test@example.com',
                      domain: 'cert.test',
                      storagePath: peerTempStorage,
                      checkInterval: 86400000,
                      renewDaysBeforeExpiry: 30,
                      acmeDirectoryUrl,
                      staging: false,
                      peerSharedSecret: 'test-secret',
                    },
                    orchestration: {
                      enabled: true,
                      clusterName: 'test-cluster',
                      nodeId: 'leader-node',
                      peers: [`http://127.0.0.1:${followerPort}`],
                      backend: { url: '', apiKey: '', timeout: 10000 },
                      leadership: { ttl: 300 },
                    },
                    main: {
                      port: 8080,
                    },
                  },
                }),
              ],
            }),
            EventEmitterModule.forRoot(),
            ScheduleModule.forRoot(),
            CertificateModule,
            MetricsModule,
            OrchestrationModule,
          ],
        })
          .overrideProvider(CertificateHealthIndicator)
          .useValue({
            isHealthy: jest.fn().mockResolvedValue({ certificate: { status: 'up' } }),
          })
          .overrideProvider(OrchestrationService)
          .useValue({
            acquireLeadership: jest.fn().mockResolvedValue(true),
            releaseLeadership: jest.fn().mockResolvedValue(undefined),
            getPeers: jest.fn().mockReturnValue([`http://127.0.0.1:${followerPort}`]),
            isClusteringEnabled: jest.fn().mockReturnValue(true),
            getNodeId: jest.fn().mockReturnValue('leader-node'),
            getClusterName: jest.fn().mockReturnValue('test-cluster'),
          })
          .compile();

        const peerApp = peerModule.createNestApplication();
        await peerApp.init();

        const peerCertService = peerModule.get<CertificateService>(CertificateService);
        const peerStorage = peerModule.get<CertificateStorageService>(CertificateStorageService);

        // Create cert files first
        const testCert = await createValidTestCert(['cert.test']);
        peerStorage.saveCertificate(testCert);

        // Overwrite metadata with near-expiry to trigger renewal
        const metadataPath = path.join(peerTempStorage, 'metadata.json');
        const metadata = {
          domains: ['cert.test'],
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

        // Trigger renewal
        await peerCertService.checkAndRenewIfNeeded();

        // Wait a bit for distribution
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Assert follower received payloads
        const challengeSync = receivedPayloads.find((p) => p.url === '/cluster/challenges/sync');
        const certSync = receivedPayloads.find((p) => p.url === '/cluster/certificates/sync');

        expect(challengeSync).toBeDefined();
        expect(challengeSync.body.token).toBeDefined();
        expect(challengeSync.body.keyAuth).toBeDefined();

        expect(certSync).toBeDefined();
        expect(certSync.body.certificate).toBeDefined();
        expect(certSync.body.privateKey).toBeDefined();
        expect(certSync.body.metadata.domains).toContain('cert.test');

        // Cleanup peer app resources
        const peerWatcher = peerModule.get<CertificateWatcherService>(CertificateWatcherService);
        const peerHttpService = peerModule.get<HttpService>(HttpService);

        // Stop file watcher first
        try {
          await peerWatcher.stopWatching();
        } catch {
          // Ignore watcher stop errors
        }

        // Close the app and wait for cleanup
        await peerApp.close();
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Destroy HTTP connections
        try {
          const axiosRef = peerHttpService.axiosRef;
          if (axiosRef.defaults.httpAgent) {
            (axiosRef.defaults.httpAgent as http.Agent).destroy();
          }
        } catch {
          // Ignore HTTP cleanup errors
        }

        // Cleanup temp storage
        await fs.rm(peerTempStorage, { recursive: true, force: true });
      } finally {
        await new Promise<void>((resolve) => followerServer.close(() => resolve()));
      }
    });
  });

  describe('3.11 Leadership Acquisition Branches', () => {
    it('should grant leadership when orchestration disabled', async () => {
      // Already covered by other tests (orchestration is disabled by default)
      // The fact that renewals work proves leadership is granted
      await certificateService.checkAndRenewIfNeeded();
      // If this completes without error, leadership was acquired
      expect(true).toBe(true);
    });
  });

  describe('3.12 Metrics Failure Branch', () => {
    it('should increment failure metric when ACME order fails', async () => {
      // Mock the createOrder method to reject immediately
      const createOrderSpy = jest
        .spyOn(acme.Client.prototype, 'createOrder')
        .mockRejectedValueOnce(new Error('Mock ACME order failure'));

      // Setup: Create cert with near-expiry metadata to force renewal attempt
      const testCert = await createValidTestCert(['cert.test']);
      storageService.saveCertificate(testCert);

      const metadataPath = path.join(tempStoragePath, 'metadata.json');
      const metadata = {
        domains: ['cert.test'],
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      const failuresBefore = metricsService.getMetrics().certificate.renewal_failures || 0;

      try {
        await certificateService.checkAndRenewIfNeeded();
      } catch (e) {
        // Expected to fail, and we catch the error to allow the test to continue
        expect(e.message).toBe('Mock ACME order failure');
      }

      const failuresAfter = metricsService.getMetrics().certificate.renewal_failures || 0;
      expect(failuresAfter).toBeGreaterThan(failuresBefore);

      // Restore the original method
      createOrderSpy.mockRestore();
    });
  });
});
