import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { AddressInfo, Socket } from 'net';
import type { TLSSocket } from 'tls';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { SMTPServer, SMTPServerOptions } from 'smtp-server';
import type { SMTPServerSession } from 'smtp-server';
import { SmtpHandlerService } from './smtp-handler.service';
import type { SmtpConfig } from './interfaces/smtp-config.interface';
import { CertificateService } from '../certificate/certificate.service';
import type { CertificateConfig } from '../certificate/interfaces';
import { MetricsService } from '../metrics/metrics.service';
import { METRIC_PATHS } from '../metrics/metrics.constants';
import { SmtpRateLimiterService, RateLimitExceededError } from './smtp-rate-limiter.service';
import { normalizeIp } from './utils/email.utils';
import { SseConsoleService } from '../sse-console/sse-console.service';

/**
 * Extended SMTP Server Options
 *
 * The smtp-server library supports maxConnections, closeTimeout, and maxHeaderSize options,
 * but they're not included in the @types/smtp-server type definitions.
 * This interface extends SMTPServerOptions to include these security options.
 */
interface ExtendedSMTPServerOptions extends SMTPServerOptions {
  maxConnections?: number;
  closeTimeout?: number;
  maxHeaderSize?: number;
}

@Injectable()
export class SmtpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SmtpService.name);
  private server?: SMTPServer;
  private readonly config: SmtpConfig;
  private listeningPort?: number;
  private readonly activeSessions = new WeakSet<SMTPServerSession>();

  /**
   * Constructor
   */
  constructor(
    private readonly handler: SmtpHandlerService,
    private readonly configService: ConfigService,
    private readonly certificateService: CertificateService,
    private readonly metricsService: MetricsService,
    private readonly sseConsoleService: SseConsoleService,
    @Optional() private readonly rateLimiterService?: SmtpRateLimiterService,
  ) {
    this.config = this.configService.get<SmtpConfig>('vsb.smtp')!;
  }

  /**
   *  On Module Init
   */
  async onModuleInit(): Promise<void> {
    await this.start();
  }

  /**
   *  On Module Destroy
   */
  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * Starts the SMTP server and begins listening for incoming connections.
   *
   * Creates and configures a receive-only SMTP server instance with handlers for
   * sender/recipient validation and data processing. Recipient validation ensures
   * only allowed domains are accepted, preventing the server from being an open relay.
   * If a server is already running, this method returns without action.
   *
   * @throws {Error} If TLS is required but credentials are missing
   * @throws {Error} If server fails to bind to the configured host/port
   */
  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    await this.applyManagedCertificate();

    // Validate TLS security configuration
    if (this.config.secure && this.config.tls && !this.config.tls.minVersion) {
      this.logger.warn(
        'TLS enabled without minVersion - defaulting to TLSv1.2 for security. ' +
          'Configure VSB_SMTP_TLS_MIN_VERSION to override.',
      );
    }

    const options = this.buildServerOptions();
    const server = new SMTPServer(options);

    // Add error listener
    server.on('error', (error) => {
      this.metricsService.increment(METRIC_PATHS.CONNECTIONS_REJECTED);
      this.logger.error(`SMTP server error: ${error.message}`, error.stack);
    });

    await this.listen(server);
    this.server = server;
    this.listeningPort = this.resolveListeningPort(server.server.address());

    this.logger.log(
      `SMTP receive-only server listening on ${this.config.host}:${this.listeningPort ?? this.config.port} (secure=${this.config.secure}, domains=${this.config.allowedRecipientDomains.join(', ')}).`,
    );
  }

  /**
   * Handles certificate reload events triggered by the certificate module.
   */
  @OnEvent('certificate.reloaded')
  async handleCertificateReload(): Promise<void> {
    const enabled = this.configService.get<boolean>('vsb.certificate.enabled');

    if (!enabled) {
      return;
    }

    this.logger.log('Certificate reload event received, restarting SMTP server');
    await this.gracefulRestart();
  }

  /**
   * Checks if the SMTP server is currently listening for connections.
   *
   * @returns True if server is listening, false otherwise
   */
  isListening(): boolean {
    return !!this.server;
  }

  /**
   * Gracefully shuts down the SMTP server.
   *
   * Stops accepting new connections and waits for existing connections
   * to close. If no server is running, this method returns without action.
   *
   * @throws {Error} If an error occurs during shutdown
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    this.listeningPort = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }).catch((error) => {
      const err = error as Error;
      this.logger.error(`Error shutting down SMTP server: ${err.message}`, err.stack);
      throw error;
    });

    this.logger.log('SMTP server shut down cleanly.');
  }

  /**
   * Gracefully Restart.
   */
  private async gracefulRestart(): Promise<void> {
    try {
      if (this.server) {
        await this.stop();
      }
      await this.start();
      this.logger.log('SMTP server restarted successfully');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to restart SMTP server: ${err.message}`, err.stack);
    }
  }

  /**
   * Apply Managed Certificate.
   */
  private async applyManagedCertificate(): Promise<void> {
    const certConfig = this.configService.get<CertificateConfig>('vsb.certificate');

    if (!certConfig?.enabled) {
      return;
    }

    // Store existing TLS security options before overriding
    const existingTlsSecurityOptions = this.config.tls
      ? {
          minVersion: this.config.tls.minVersion,
          ciphers: this.config.tls.ciphers,
          honorCipherOrder: this.config.tls.honorCipherOrder,
          ecdhCurve: this.config.tls.ecdhCurve,
        }
      : undefined;

    // Warn if manual TLS paths are configured but will be ignored
    if (this.config.tls) {
      this.logger.warn(
        'Manual TLS certificate paths (VSB_SMTP_TLS_CERT_PATH/VSB_SMTP_TLS_KEY_PATH) are configured ' +
          'but will be IGNORED because certificate management is enabled (VSB_CERT_ENABLED=true). ' +
          'The app will use automatically managed certificates from the certificate service instead.',
      );
    }

    const cert = await this.certificateService.getCurrentCertificate();

    if (!cert) {
      this.logger.warn('Certificate management enabled but no certificate found yet');
      return;
    }

    this.config.tls = {
      cert: cert.certificate,
      key: cert.privateKey,
      // Preserve TLS security options from buildTlsConfig
      ...existingTlsSecurityOptions,
    };

    this.logger.log('Loaded TLS certificate from certificate service');
  }

  /**
   * Builds the configuration options for the SMTP server.
   *
   * Maps application configuration to smtp-server library options and
   * wires up event handlers for validation and data processing.
   * Validates that TLS credentials are provided when secure mode is enabled.
   *
   * For a receive-only server, authentication is always optional since
   * external mail servers don't authenticate when delivering mail.
   * Security is enforced through recipient domain validation instead.
   *
   * @returns Configured SMTP server options
   * @throws {Error} If secure mode is enabled but TLS credentials are missing
   */
  private buildServerOptions(): ExtendedSMTPServerOptions {
    if (this.config.secure && !this.config.tls) {
      throw new Error('TLS credentials are required when SMTP secure mode is enabled.');
    }

    return {
      // TLS Configuration
      secure: this.config.secure,
      key: this.config.tls?.key,
      cert: this.config.tls?.cert,
      minVersion: this.config.tls?.minVersion,
      ciphers: this.config.tls?.ciphers,
      honorCipherOrder: this.config.tls?.honorCipherOrder,
      ecdhCurve: this.config.tls?.ecdhCurve,

      // Basic SMTP Options
      size: this.config.maxMessageSize,
      socketTimeout: this.config.sessionTimeout,
      authOptional: true,

      // Security Controls
      maxConnections: this.config.maxConnections,
      closeTimeout: this.config.closeTimeout,
      maxHeaderSize: this.config.maxHeaderSize,
      disabledCommands: this.config.disabledCommands,
      hidePIPELINING: this.config.disablePipelining,
      banner: this.config.banner,
      disableReverseLookup: true,

      // Logger Integration
      // Note: smtp-server is very verbose at debug level, so we only log warnings and errors
      logger: {
        level: (level: string) => level,
        info: () => {}, // Suppress info logs (too verbose)
        debug: () => {}, // Suppress debug logs (very verbose - logs every SMTP command)
        error: (msg: string) => this.logger.error(msg),
        warn: (msg: string) => this.logger.warn(msg),
        trace: () => {}, // Suppress trace logs
        fatal: (msg: string) => this.logger.error(msg),
      },

      // Capture TLS connection details when TLS is established
      onSecure: (socket: Socket | TLSSocket, session, callback) => {
        // Extract TLS info from the socket if it's a TLS connection
        if ('getCipher' in socket && 'getProtocol' in socket) {
          const tlsSocket = socket;
          const cipher = tlsSocket.getCipher();
          const protocol = tlsSocket.getProtocol();

          if (cipher && protocol) {
            // Note: 'bits' is available at runtime but not in TypeScript types
            const cipherWithBits = cipher as typeof cipher & { bits?: number };
            this.handler.setTlsInfo(session.id, {
              version: protocol,
              cipher: cipher.name,
              bits: cipherWithBits.bits,
            });
          }
        }
        callback();
      },

      // Early Talker Detection via onConnect
      onConnect: (session, callback) => {
        // Track connection metrics
        this.metricsService.increment(METRIC_PATHS.CONNECTIONS_TOTAL);

        const markActiveConnection = () => {
          this.metricsService.increment(METRIC_PATHS.CONNECTIONS_ACTIVE);
          this.activeSessions.add(session);
        };

        const completeConnection = () => {
          if (this.config.earlyTalkerDelay > 0) {
            setTimeout(() => callback(), this.config.earlyTalkerDelay);
          } else {
            callback();
          }
        };

        // Check rate limit for this IP
        const ip = normalizeIp(session.remoteAddress);
        if (this.rateLimiterService && ip) {
          this.rateLimiterService
            .consumeIp(ip)
            .then(() => {
              // Rate limit check passed, apply early talker delay
              markActiveConnection();
              completeConnection();
            })
            .catch((error) => {
              // Rate limit exceeded
              if (error instanceof RateLimitExceededError) {
                this.sseConsoleService.logRateLimitExceeded(ip);
                callback(error as Error);
              } else {
                // Unexpected error - log and allow connection
                this.logger.error(`Rate limiter error: ${error instanceof Error ? error.message : String(error)}`);
                markActiveConnection();
                completeConnection();
              }
            });
        } else {
          // No rate limiter configured, apply early talker delay
          markActiveConnection();
          completeConnection();
        }
      },

      // Sender Validation
      onMailFrom: (address, session, callback) => {
        // Re-check rate limit for multi-email abuse from same connection
        const ip = normalizeIp(session.remoteAddress);
        const rateLimitCheck =
          this.rateLimiterService && ip ? this.rateLimiterService.consumeIp(ip) : Promise.resolve();

        rateLimitCheck
          .then(() => {
            // Rate limit check passed, proceed to sender validation
            return this.handler.validateSender(address, session);
          })
          .then(() => callback())
          .catch((error) => {
            if (error instanceof RateLimitExceededError) {
              // Rate limit exceeded during MAIL FROM
              this.sseConsoleService.logRateLimitExceeded(ip);
              callback(error as Error);
            } else {
              // Sender validation failed
              this.metricsService.increment(METRIC_PATHS.REJECTIONS_SENDER_REJECTED);
              callback(error as Error);
            }
          });
      },

      // Recipient Validation
      onRcptTo: (address, _session, callback) => {
        try {
          this.handler.validateRecipient(address);
          callback();
        } catch (error) {
          this.metricsService.increment(METRIC_PATHS.REJECTIONS_RECIPIENT_REJECTED);
          callback(error as Error);
        }
      },

      // Data Processing
      onData: (stream, session, callback) => {
        this.handler
          .handleData(stream, session)
          .then(() => callback())
          .catch((error) => callback(error as Error));
      },

      // Connection Close
      onClose: (session) => {
        // Clean up session caches to prevent memory leaks
        if (session?.id) {
          this.handler.cleanupSession(session.id);
        }

        // Only decrement if session has a valid remoteAddress (connection was established)
        if (session?.remoteAddress && this.activeSessions.has(session)) {
          this.metricsService.decrement(METRIC_PATHS.CONNECTIONS_ACTIVE);
          this.activeSessions.delete(session);
        }
      },
    } satisfies ExtendedSMTPServerOptions;
  }

  /**
   * Starts listening for SMTP connections on the configured host and port.
   *
   * Wraps the smtp-server listen() method in a Promise to enable async/await usage.
   * Properly handles both error and close events during the startup phase.
   *
   * @param server - The SMTP server instance to start listening
   * @throws {Error} If the server fails to bind to the host/port
   */
  private listen(server: SMTPServer): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener('close', onClose);
        reject(error);
      };

      const onClose = () => {
        server.removeListener('error', onError);
      };

      server.once('error', onError);
      server.once('close', onClose);

      try {
        server.listen(this.config.port, this.config.host, () => {
          server.removeListener('error', onError);
          server.removeListener('close', onClose);
          resolve();
        });
      } catch (error) {
        server.removeListener('error', onError);
        server.removeListener('close', onClose);
        reject(error as Error);
      }
    });
  }

  /**
   * Returns the actual port the SMTP listener bound to (helpful when using ephemeral ports).
   */
  getListeningPort(): number | undefined {
    return this.listeningPort ?? this.config.port;
  }

  private resolveListeningPort(address: AddressInfo | string | null): number | undefined {
    if (!address) {
      return undefined;
    }

    if (typeof address === 'string') {
      // Unix socket path (not used in tests)
      return undefined;
    }

    return address.port;
  }
}
