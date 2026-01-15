import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { createHmac } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import * as acme from 'acme-client';
import { OrchestrationService } from '../orchestration/orchestration.service';
import { AcmeClientService } from './acme/acme-client.service';
import { CertificateStorageService } from './storage/certificate-storage.service';
import { CertificateWatcherService } from './watcher/certificate-watcher.service';
import { CERTIFICATE_CONFIG } from './certificate.tokens';
import { Certificate, CertificateStatus, CertificateSyncRequest, ChallengeSyncRequest } from './interfaces';
import type { CertificateConfig } from './interfaces';
import { MetricsService } from '../metrics/metrics.service';
import { METRIC_PATHS } from '../metrics/metrics.constants';

/**
 * Main service for orchestrating certificate management.
 * This service handles the entire lifecycle of an SSL certificate, including:
 * - Initializing the ACME client.
 * - Checking certificate status on startup and on a schedule.
 * - Acquiring leadership in a cluster to perform renewals.
 * - Requesting, renewing, and finalizing certificates.
 * - Distributing challenges and certificates to follower nodes.
 * - Handling incoming certificate sync requests from the leader.
 */
@Injectable()
export class CertificateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CertificateService.name);
  private initializationTimer?: NodeJS.Timeout;
  private readonly manualCertProvided: boolean;

  /**
   * Constructor
   */
  /* v8 ignore next 11 - false positive on constructor parameter properties */
  constructor(
    @Inject(CERTIFICATE_CONFIG) private readonly config: CertificateConfig,
    private readonly configService: ConfigService,
    private readonly orchestrationService: OrchestrationService,
    private readonly acmeClient: AcmeClientService,
    private readonly storageService: CertificateStorageService,
    private readonly watcherService: CertificateWatcherService,
    private readonly httpService: HttpService,
    private readonly eventEmitter: EventEmitter2,
    private readonly metricsService: MetricsService,
  ) {
    // Check if manual TLS certificates are provided - if so, skip ACME operations
    this.manualCertProvided = !!(process.env.VSB_TLS_CERT_PATH && process.env.VSB_TLS_KEY_PATH);
  }

  /**
   * Initializes the certificate module when the application starts.
   */
  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log('Certificate management is disabled');
      return;
    }

    // Skip ACME initialization when manual certificates are provided
    if (this.manualCertProvided) {
      this.logger.log('Manual TLS certificates provided (VSB_TLS_CERT_PATH); ACME disabled');
      return;
    }

    try {
      await this.acmeClient.initialize();
      this.watcherService.startWatching();
      this.logger.log('Certificate module initialised');

      // Update certificate expiry metric
      try {
        const cert = await this.getCurrentCertificate();
        if (cert) {
          const daysUntilExpiry = this.getDaysUntilExpiry(cert);
          this.metricsService.set(METRIC_PATHS.CERT_DAYS_UNTIL_EXPIRY, daysUntilExpiry);
        }
      } catch {
        this.logger.warn('Failed to update certificate expiry metric');
      }

      // Start certificate check in background after a delay to ensure HTTP server is listening
      this.logger.log('Scheduling certificate check in 5 seconds...');
      this.initializationTimer = setTimeout(() => {
        this.checkAndRenewIfNeeded().catch((error) => {
          const err = error as Error;
          this.logger.error(`Background certificate check failed: ${err.message}`, err.stack);
        });
      }, 5000);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to initialise certificate module: ${err.message}`, err.stack);
      // Don't throw - allow app to start even if cert init fails
      this.logger.warn('Certificate module failed to initialize, but app will continue');
    }
  }

  /**
   * Cleanup when the module is being destroyed.
   */
  async onModuleDestroy(): Promise<void> {
    // Cancel pending initialization timer to prevent hanging connections
    if (this.initializationTimer) {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = undefined;
      this.logger.debug('Cleared initialization timer');
    }

    // Explicitly stop file watcher to prevent resource leaks
    await this.watcherService.stopWatching();

    // Note: ScheduleModule automatically stops cron jobs during shutdown
  }

  /**
   * Runs a scheduled daily check for certificate renewal.
   */
  /* v8 ignore next 2 - decorator branch coverage false positive */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledCertificateCheck(): Promise<void> {
    if (!this.config.enabled || this.manualCertProvided) {
      return;
    }

    this.logger.log('Running scheduled certificate check');
    await this.checkAndRenewIfNeeded();
  }

  /**
   * Checks the status of the current certificate and renews it if necessary.
   * This method acquires leadership before performing any actions.
   */
  async checkAndRenewIfNeeded(): Promise<void> {
    if (!this.config.enabled || this.manualCertProvided) {
      return;
    }

    if (!this.config.domain) {
      this.logger.warn('Primary certificate domain is not configured; skipping renewal check');
      return;
    }

    let isLeader = false;

    try {
      isLeader = await this.orchestrationService.acquireLeadership();

      if (!isLeader) {
        this.logger.debug('Another node is leader; skipping certificate check');
        return;
      }

      const currentCert = await this.storageService.loadCertificate();

      if (!currentCert) {
        this.logger.log('No certificate found locally; requesting new certificate');
        await this.requestNewCertificate();
        return;
      }

      // Check if certificate domains match current configuration
      const configuredDomains = [this.config.domain, ...(this.config.additionalDomains || [])].sort();
      const certDomains = [...currentCert.domains].sort();
      const domainsMatch =
        configuredDomains.length === certDomains.length && configuredDomains.every((d, i) => d === certDomains[i]);

      if (!domainsMatch) {
        this.logger.warn('Certificate domain mismatch detected; requesting new certificate', {
          configured: configuredDomains,
          current: certDomains,
        });
        await this.renewCertificate();
        return;
      }

      const daysUntilExpiry = this.getDaysUntilExpiry(currentCert);

      if (daysUntilExpiry <= this.config.renewDaysBeforeExpiry) {
        this.logger.log(`Certificate expires in ${daysUntilExpiry} days; renewing now`, {
          expiresAt: currentCert.expiresAt.toISOString(),
          domains: currentCert.domains,
        });
        await this.renewCertificate();
      } else {
        this.logger.log(`Certificate remains valid for ${daysUntilExpiry} days`, {
          expiresAt: currentCert.expiresAt.toISOString(),
          domains: currentCert.domains,
        });
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Certificate renewal check failed: ${err.message}`, err.stack);
      throw error;
    } finally {
      if (isLeader) {
        await this.orchestrationService.releaseLeadership();
      }
    }
  }

  /**
   * Requests a new certificate. Alias for `renewCertificate`.
   * @private
   */
  private async requestNewCertificate(): Promise<void> {
    await this.renewCertificate();
  }

  /**
   * The core logic for renewing a certificate. It creates an ACME order,
   * completes the challenges, finalizes the certificate, and distributes it.
   * @private
   */
  private async renewCertificate(): Promise<void> {
    const primaryDomain = this.config.domain;
    const additionalDomains = this.config.additionalDomains ?? [];

    /* v8 ignore next 3 - defensive check; domain validated in checkAndRenewIfNeeded before calling this method */
    if (!primaryDomain) {
      throw new Error('Primary domain is not configured');
    }

    this.metricsService.increment(METRIC_PATHS.CERT_RENEWAL_ATTEMPTS);

    try {
      const { order, authorizations, certificateKey } = await this.acmeClient.createOrder(
        primaryDomain,
        additionalDomains,
      );

      for (const authorization of authorizations) {
        this.logger.log(`Processing authorization for: ${authorization.identifier?.value}`);

        const challenge = authorization.challenges?.find((item) => item.type === 'http-01');

        if (!challenge) {
          this.logger.error('HTTP-01 challenge not available', {
            authorization,
          });
          throw new Error('HTTP-01 challenge not available from ACME server');
        }

        this.logger.log(`Found HTTP-01 challenge`, {
          token: challenge.token,
          url: challenge.url,
          status: challenge.status,
        });

        const keyAuth = await this.acmeClient.getChallengeKeyAuthorization(challenge);
        this.logger.log(`Generated key authorization`, {
          token: challenge.token,
          keyAuthLength: keyAuth.length,
        });

        this.storageService.saveChallengeResponse(challenge.token, keyAuth);

        const httpPort = this.configService.get<number>('vsb.main.port');
        const portSuffix = httpPort === 80 ? '' : `:${httpPort}`;
        const challengeUrl = `http://${this.config.domain}${portSuffix}/.well-known/acme-challenge/${challenge.token}`;

        this.logger.log(`Saved challenge response locally`, {
          token: challenge.token,
        });
        this.logger.log(`🔗 Test the challenge URL: ${challengeUrl}`);
        this.logger.log(`   Expected response length: ${keyAuth.length} chars`);

        await this.distributeChallengeToFollowers(challenge.token, keyAuth);
        this.logger.log(`Distributed challenge to followers`, {
          token: challenge.token,
        });

        // Wait a bit to ensure challenge is accessible
        this.logger.log(`Waiting 2 seconds before completing challenge...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        this.logger.log(`Completing challenge`, {
          token: challenge.token,
          url: challenge.url,
        });
        await this.acmeClient.completeChallenge(challenge);
        this.logger.log(`Challenge completed, waiting for validation...`);
      }

      await this.acmeClient.waitForOrderReady(order);

      const certificate = await this.acmeClient.finalizeCertificate(order, certificateKey);
      this.storageService.saveCertificate(certificate);
      await this.distributeCertificateToFollowers(certificate);
      this.storageService.cleanupChallenges();

      this.eventEmitter.emit('certificate.reloaded', certificate);

      // Track successful renewal
      this.metricsService.increment(METRIC_PATHS.CERT_RENEWAL_SUCCESS);

      // Update expiry metric
      const daysUntilExpiry = this.getDaysUntilExpiry(certificate);
      this.metricsService.set(METRIC_PATHS.CERT_DAYS_UNTIL_EXPIRY, daysUntilExpiry);

      this.logger.log('Certificate renewal completed successfully', {
        domains: certificate.domains,
        expiresAt: certificate.expiresAt.toISOString(),
      });
    } catch (error) {
      this.metricsService.increment(METRIC_PATHS.CERT_RENEWAL_FAILURES);
      const err = error as Error;
      this.logger.error(`Certificate renewal failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Distributes an ACME challenge response to all follower nodes in the cluster.
   * @param token - The challenge token.
   * @param keyAuth - The key authorization string.
   * @private
   */
  private async distributeChallengeToFollowers(token: string, keyAuth: string): Promise<void> {
    const peers = this.orchestrationService.getPeers();

    if (!this.orchestrationService.isClusteringEnabled() || peers.length === 0) {
      return;
    }

    const payload: ChallengeSyncRequest = { token, keyAuth };
    const headers = this.createPeerAuthHeaders();

    await Promise.allSettled(
      peers.map(async (peerUrl) => {
        try {
          await firstValueFrom(
            this.httpService.post(`${peerUrl}/cluster/challenges/sync`, payload, {
              headers,
              timeout: 10_000,
            }),
          );
          this.logger.log('Synced challenge to peer', { peerUrl, token });
        } catch (error) {
          const err = error as Error;
          this.logger.error(`Failed to sync challenge to peer ${peerUrl}: ${err.message}`);
        }
      }),
    );
  }

  /**
   * Distributes a newly obtained certificate to all follower nodes in the cluster.
   * @param cert - The certificate to distribute.
   * @private
   */
  private async distributeCertificateToFollowers(cert: Certificate): Promise<void> {
    const peers = this.orchestrationService.getPeers();

    if (!this.orchestrationService.isClusteringEnabled() || peers.length === 0) {
      return;
    }

    /**
     * 🚧 WARNING: PRIVATE KEY SYNC IS NOT PROTECTED YET.
     *
     * - Payload below contains the raw private key. Today this code path is effectively dormant
     *   because there is only a single server and clustering is off.
     * - If anyone enables clustering or adds HTTP peers, this will transmit private keys in
     *   cleartext over HTTP. That is a hard stop for production.
     * - Before allowing multiple nodes, enforce HTTPS and/or add an encryption envelope
     *   (e.g. mutual TLS between peers or an application-level encrypted blob) for this payload.
     * - Do NOT remove this warning until private key transport is encrypted and validated.
     */
    const payload: CertificateSyncRequest = {
      certificate: cert.certificate.toString('base64'),
      privateKey: cert.privateKey.toString('base64'),
      chain: cert.chain?.toString('base64'),
      fullchain: cert.fullchain?.toString('base64'),
      metadata: {
        domains: cert.domains,
        issuedAt: cert.issuedAt.toISOString(),
        expiresAt: cert.expiresAt.toISOString(),
      },
    };

    const headers = this.createPeerAuthHeaders();

    await Promise.allSettled(
      peers.map(async (peerUrl) => {
        try {
          await firstValueFrom(
            this.httpService.post(`${peerUrl}/cluster/certificates/sync`, payload, {
              headers,
              timeout: 30_000,
            }),
          );
          this.logger.log('Synced certificate to peer', {
            peerUrl,
            domains: cert.domains,
          });
        } catch (error) {
          const err = error as Error;
          this.logger.error(`Failed to sync certificate to peer ${peerUrl}: ${err.message}`);
        }
      }),
    );
  }

  /**
   * Handles an incoming certificate sync request from the leader node.
   * It decodes, saves, and reloads the certificate.
   * @param syncRequest - The certificate data from the leader.
   */
  receiveCertificateSync(syncRequest: CertificateSyncRequest): void {
    const certificate: Certificate = {
      certificate: Buffer.from(syncRequest.certificate, 'base64'),
      privateKey: Buffer.from(syncRequest.privateKey, 'base64'),
      chain: syncRequest.chain ? Buffer.from(syncRequest.chain, 'base64') : undefined,
      fullchain: syncRequest.fullchain ? Buffer.from(syncRequest.fullchain, 'base64') : undefined,
      domains: syncRequest.metadata.domains,
      issuedAt: new Date(syncRequest.metadata.issuedAt),
      expiresAt: new Date(syncRequest.metadata.expiresAt),
    };

    this.storageService.saveCertificate(certificate);
    this.eventEmitter.emit('certificate.reloaded', certificate);

    this.logger.log('Certificate sync completed successfully', {
      domains: certificate.domains,
      expiresAt: certificate.expiresAt.toISOString(),
    });
  }

  /**
   * Retrieves the status of the currently stored certificate.
   * @returns A promise that resolves to the certificate's status.
   */
  async getStatus(): Promise<CertificateStatus> {
    const cert = await this.storageService.loadCertificate();

    if (!cert) {
      return {
        exists: false,
        valid: false,
      };
    }

    const now = new Date();
    const valid = cert.expiresAt > now && cert.issuedAt <= now;
    const daysUntilExpiry = this.getDaysUntilExpiry(cert);

    return {
      exists: true,
      valid,
      domain: cert.domains[0],
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
      daysUntilExpiry,
    };
  }

  /**
   * Gets the current certificate from storage or manual TLS paths.
   * When manual certificates are provided via VSB_TLS_CERT_PATH/VSB_TLS_KEY_PATH,
   * they take precedence over ACME-managed certificates.
   * @returns A promise that resolves to the certificate object or null if not found.
   */
  async getCurrentCertificate(): Promise<Certificate | null> {
    // When manual certificates are provided, load them directly
    if (this.manualCertProvided) {
      return this.loadManualCertificate();
    }
    return this.storageService.loadCertificate();
  }

  /**
   * Loads manual TLS certificates from the paths specified in environment variables.
   * @private
   */
  private async loadManualCertificate(): Promise<Certificate | null> {
    const certPath = process.env.VSB_TLS_CERT_PATH;
    const keyPath = process.env.VSB_TLS_KEY_PATH;

    if (!certPath || !keyPath || !existsSync(certPath) || !existsSync(keyPath)) {
      return null;
    }

    const certificate = readFileSync(certPath);
    const privateKey = readFileSync(keyPath);

    // Read certificate metadata (domains, expiry) from the certificate itself
    try {
      const info = await acme.forge.readCertificateInfo(certificate);
      return {
        certificate,
        privateKey,
        domains: [info.domains.commonName, ...(info.domains.altNames ?? [])].filter(Boolean),
        issuedAt: info.notBefore,
        expiresAt: info.notAfter,
      };
    } catch {
      // For self-signed certs that may not have standard metadata, use defaults
      this.logger.warn('Could not read certificate metadata; using defaults for manual certificate');
      return {
        certificate,
        privateKey,
        domains: ['localhost'],
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
      };
    }
  }

  /**
   * Manually triggers a certificate renewal check.
   */
  async manualRenewal(): Promise<void> {
    this.logger.log('Manual certificate renewal triggered');
    await this.checkAndRenewIfNeeded();
  }

  /**
   * Calculates the number of full days until a certificate expires.
   * @param cert - The certificate to check.
   * @returns The number of days until expiry.
   * @private
   */
  private getDaysUntilExpiry(cert: Certificate): number {
    const diffMs = cert.expiresAt.getTime() - Date.now();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Creates the necessary authentication headers for peer-to-peer communication.
   * @returns A record of HTTP headers.
   * @private
   */
  private createPeerAuthHeaders(): Record<string, string> {
    const nodeId = this.orchestrationService.getNodeId();
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', this.config.peerSharedSecret).update(`${nodeId}:${timestamp}`).digest('hex');

    return {
      'X-Peer-Token': nodeId,
      'X-Peer-Timestamp': timestamp,
      'X-Peer-Signature': signature,
      'Content-Type': 'application/json',
    };
  }
}
