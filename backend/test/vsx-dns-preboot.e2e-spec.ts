/**
 * VSX DNS Pre-Boot E2E Tests
 *
 * These tests spin up real HTTP servers to test the full VSX DNS pre-boot flow:
 * - Mock VSX DNS API server (simulating api.vsx.email)
 * - The actual probe server started by vsxDnsPreBoot
 * - Real HTTP connections and environment variable population
 */

import * as http from 'http';
import * as net from 'net';

// Store original env and process.exit
const originalEnv = { ...process.env };
const originalExit = process.exit;
const originalFetch = global.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Mock process.exit to prevent test process from exiting
let exitCode: number | undefined;
let exitCalled = false;

// Capture console output for banner verification
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];

// Helper to find an available port
function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address() as net.AddressInfo;
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Mock VSX DNS API Server
 * Simulates api.vsx.email/check-in endpoint with configurable responses
 */
class MockVsxDnsServer {
  private server: http.Server;
  private port: number = 0;
  private responseOverride: any = null;
  private shouldProbeBack = false;
  private probePort: number = 0;
  private probeSucceeded = false;

  public checkInCalled = false;

  constructor() {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as net.AddressInfo;
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  reset(): void {
    this.responseOverride = null;
    this.shouldProbeBack = false;
    this.probePort = 0;
    this.probeSucceeded = false;
    this.checkInCalled = false;
    this.nonProbeStatusCode = null;
  }

  setResponse(response: any): void {
    this.responseOverride = response;
  }

  setProbeBack(port: number): void {
    this.shouldProbeBack = true;
    this.probePort = port;
  }

  didProbeSucceed(): boolean {
    return this.probeSucceeded;
  }

  public nonProbeStatusCode: number | null = null;

  private async probeNonExistentEndpoint(port: number): Promise<number> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/some-other-endpoint',
          method: 'GET',
          timeout: 2000,
        },
        (res) => {
          resolve(res.statusCode || 0);
        },
      );
      req.on('error', () => resolve(0));
      req.on('timeout', () => {
        req.destroy();
        resolve(0);
      });
      req.end();
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.url === '/check-in') {
      this.checkInCalled = true;

      // If configured to probe back, attempt to verify the probe endpoint
      if (this.shouldProbeBack && this.probePort > 0) {
        try {
          const probeResult = await this.probeEndpoint(this.probePort);
          this.probeSucceeded = probeResult;
          // Also probe a non-existent endpoint to test 404 response
          this.nonProbeStatusCode = await this.probeNonExistentEndpoint(this.probePort);
        } catch {
          this.probeSucceeded = false;
        }
      }

      // Return configured response or default success
      const response = this.responseOverride || {
        status: 'ready',
        ip: '203.0.113.42',
        domain: 'test.vsx.email',
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  private probeEndpoint(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/.well-known/vaultsandbox',
          method: 'GET',
          timeout: 2000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            resolve(res.statusCode === 200 && body === 'ok');
          });
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }
}

describe('VSX DNS Pre-Boot E2E Tests', () => {
  let mockDnsServer: MockVsxDnsServer;
  let mockDnsUrl: string;

  beforeAll(async () => {
    mockDnsServer = new MockVsxDnsServer();
    mockDnsUrl = await mockDnsServer.start();
  });

  afterAll(async () => {
    await mockDnsServer.stop();
  });

  beforeEach(() => {
    mockDnsServer.reset();

    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS;
    delete process.env.VSB_CERT_ENABLED;
    delete process.env.VSB_CERT_DOMAIN;

    // Reset exit tracking
    exitCode = undefined;
    exitCalled = false;

    // Reset console capture
    consoleOutput = [];
    consoleErrors = [];

    // Mock process.exit
    process.exit = ((code?: number) => {
      exitCode = code;
      exitCalled = true;
      throw new Error(`process.exit(${code})`);
    }) as never;

    // Capture console output
    console.log = (...args: any[]) => {
      consoleOutput.push(args.map(String).join(' '));
    };
    console.error = (...args: any[]) => {
      consoleErrors.push(args.map(String).join(' '));
    };

    // Clear module cache
    jest.resetModules();
  });

  afterEach(() => {
    process.exit = originalExit;
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('should skip check-in when VSX DNS is disabled', async () => {
    process.env.VSB_VSX_DNS_ENABLED = 'false';

    const { vsxDnsPreBoot } = await import('../src/vsx-dns-preboot');
    await vsxDnsPreBoot();

    expect(mockDnsServer.checkInCalled).toBe(false);
    expect(exitCalled).toBe(false);
  });

  it('should complete full check-in flow with probe server and populate env vars', async () => {
    const probePort = await findAvailablePort();
    process.env.VSB_VSX_DNS_ENABLED = 'true';
    process.env.VSB_SERVER_PORT = String(probePort);

    mockDnsServer.setProbeBack(probePort);
    mockDnsServer.setResponse({
      status: 'ready',
      ip: '203.0.113.100',
      domain: 'mybox.vsx.email',
    });

    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      const redirectedUrl = url.replace('https://api.vsx.email', mockDnsUrl);
      return originalFetch(redirectedUrl, options);
    });

    const { vsxDnsPreBoot } = await import('../src/vsx-dns-preboot');
    await vsxDnsPreBoot();

    // Verify probe server responded to probe-back
    expect(mockDnsServer.didProbeSucceed()).toBe(true);

    // Verify env vars populated
    expect(process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS).toBe('mybox.vsx.email');
    expect(process.env.VSB_CERT_ENABLED).toBe('true');
    expect(process.env.VSB_CERT_DOMAIN).toBe('mybox.vsx.email');

    // Verify success banner
    const output = consoleOutput.join('\n');
    expect(output).toContain('VSX DNS Check-In Successful');
    expect(output).toContain('mybox.vsx.email');

    // Verify probe server returned 404 for non-probe endpoint
    expect(mockDnsServer.nonProbeStatusCode).toBe(404);
  });

  it('should exit with code 1 when check-in fails', async () => {
    const probePort = await findAvailablePort();
    process.env.VSB_VSX_DNS_ENABLED = 'true';
    process.env.VSB_SERVER_PORT = String(probePort);

    mockDnsServer.setResponse({
      status: 'error',
      ip: '203.0.113.100',
      error: 'IP not registered',
      action: 'Register your IP at vsx.email',
    });

    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      const redirectedUrl = url.replace('https://api.vsx.email', mockDnsUrl);
      return originalFetch(redirectedUrl, options);
    });

    const { vsxDnsPreBoot } = await import('../src/vsx-dns-preboot');

    await expect(vsxDnsPreBoot()).rejects.toThrow('process.exit(1)');
    expect(exitCalled).toBe(true);
    expect(exitCode).toBe(1);

    // Verify error banner
    const errors = consoleErrors.join('\n');
    expect(errors).toContain('VSX DNS Check-In Failed');
    expect(errors).toContain('IP not registered');
  });

  it('should exit with code 1 on network/timeout errors', async () => {
    const probePort = await findAvailablePort();
    process.env.VSB_VSX_DNS_ENABLED = 'true';
    process.env.VSB_SERVER_PORT = String(probePort);

    // Mock fetch to throw an AbortError (timeout)
    global.fetch = jest.fn().mockImplementation(() => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const { vsxDnsPreBoot } = await import('../src/vsx-dns-preboot');

    await expect(vsxDnsPreBoot()).rejects.toThrow('process.exit(1)');
    expect(exitCalled).toBe(true);

    const errors = consoleErrors.join('\n');
    expect(errors).toContain('Request timed out');
  });

  it('should clean up probe server and release port after check-in', async () => {
    const probePort = await findAvailablePort();
    process.env.VSB_VSX_DNS_ENABLED = 'true';
    process.env.VSB_SERVER_PORT = String(probePort);

    mockDnsServer.setProbeBack(probePort);
    mockDnsServer.setResponse({
      status: 'ready',
      ip: '203.0.113.100',
      domain: 'cleanup-test.vsx.email',
    });

    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      const redirectedUrl = url.replace('https://api.vsx.email', mockDnsUrl);
      return originalFetch(redirectedUrl, options);
    });

    const { vsxDnsPreBoot } = await import('../src/vsx-dns-preboot');
    await vsxDnsPreBoot();

    // Wait for OS to release port
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Verify port is released by binding to it
    const canBind = await new Promise<boolean>((resolve) => {
      const testServer = net.createServer();
      testServer.on('error', () => resolve(false));
      testServer.listen(probePort, () => {
        testServer.close(() => resolve(true));
      });
    });

    expect(canBind).toBe(true);
  });

  it('should continue when probe server fails to start (port in use)', async () => {
    const probePort = await findAvailablePort();
    process.env.VSB_VSX_DNS_ENABLED = 'true';
    process.env.VSB_SERVER_PORT = String(probePort);

    // Occupy the port
    const blockingServer = net.createServer();
    await new Promise<void>((resolve) => {
      blockingServer.listen(probePort, () => resolve());
    });

    mockDnsServer.setResponse({
      status: 'ready',
      ip: '203.0.113.100',
      domain: 'port-blocked.vsx.email',
    });

    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      const redirectedUrl = url.replace('https://api.vsx.email', mockDnsUrl);
      return originalFetch(redirectedUrl, options);
    });

    try {
      const { vsxDnsPreBoot } = await import('../src/vsx-dns-preboot');
      await vsxDnsPreBoot();

      // Should complete successfully despite probe server failure
      expect(process.env.VSB_CERT_DOMAIN).toBe('port-blocked.vsx.email');
      expect(exitCalled).toBe(false);

      const output = consoleErrors.join('\n');
      expect(output).toContain('Failed to start probe server');
    } finally {
      await new Promise<void>((resolve) => {
        blockingServer.close(() => resolve());
      });
    }
  });

  it('should handle case-insensitive VSB_VSX_DNS_ENABLED', async () => {
    const probePort = await findAvailablePort();
    process.env.VSB_VSX_DNS_ENABLED = 'TRUE'; // uppercase
    process.env.VSB_SERVER_PORT = String(probePort);

    mockDnsServer.setResponse({
      status: 'ready',
      ip: '203.0.113.100',
      domain: 'uppercase.vsx.email',
    });

    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      const redirectedUrl = url.replace('https://api.vsx.email', mockDnsUrl);
      return originalFetch(redirectedUrl, options);
    });

    const { vsxDnsPreBoot } = await import('../src/vsx-dns-preboot');
    await vsxDnsPreBoot();

    expect(mockDnsServer.checkInCalled).toBe(true);
    expect(process.env.VSB_CERT_DOMAIN).toBe('uppercase.vsx.email');
  });
});
