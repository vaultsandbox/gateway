import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import * as http from 'http';
import * as https from 'https';
import { INestApplication } from '@nestjs/common';
import { CertificateService } from '../certificate/certificate.service';

/**
 * Service that manages both HTTP and HTTPS servers for dual-protocol operation.
 *
 * Responsibilities:
 * - Create and manage HTTP server (port 80) for ACME challenges, cluster endpoints, and redirects
 * - Create and manage HTTPS server (port 443) for secure public endpoints
 * - Hot-reload HTTPS server when certificates are renewed
 * - Graceful shutdown of both servers
 *
 * Architecture:
 * - HTTP server always runs (required for ACME HTTP-01 challenges)
 * - HTTPS server runs only when certificates are available
 * - Both servers share the same Express app instance (same routes)
 * - Middleware distinguishes between HTTP and HTTPS requests for conditional logic
 *
 * @see docs/plan-ports.md for architecture details
 */
@Injectable()
export class HttpServerService implements OnModuleDestroy {
  private readonly logger = new Logger(HttpServerService.name);
  private httpServer?: http.Server;
  private httpsServer?: https.Server;
  private app?: INestApplication;

  /* v8 ignore next 4 - false positive on constructor parameter properties */
  constructor(
    private readonly configService: ConfigService,
    private readonly certificateService: CertificateService,
  ) {}

  /**
   * Initializes and starts both HTTP and HTTPS servers.
   *
   * This method should be called from main.ts after the NestJS app is created
   * but before it calls listen(). It creates custom HTTP/HTTPS servers using
   * the Express instance from the NestJS app.
   *
   * @param app - The NestJS application instance
   */
  async initializeServers(app: INestApplication): Promise<void> {
    this.app = app;

    const httpPort = this.configService.get<number>('vsb.main.port');
    const httpsEnabled = this.configService.get<boolean>('vsb.main.httpsEnabled');

    if (!httpPort) {
      throw new Error('HTTP port not configured (VSB_SERVER_PORT)');
    }

    // Start HTTP server (always runs)
    await this.startHttpServer(httpPort);

    // Start HTTPS server if enabled and certificates available
    if (httpsEnabled) {
      await this.startHttpsServer();
    }
  }

  /**
   * Handles certificate reload events by restarting the HTTPS server.
   *
   * When certificates are renewed, this method gracefully restarts the HTTPS
   * server with the new credentials. If the HTTPS server hasn't been started yet
   * (e.g., first-time certificate creation), it starts the server. The HTTP server
   * continues running without interruption, ensuring ACME challenges remain accessible.
   */
  /* v8 ignore next 2 - false positive on decorator and async function */
  @OnEvent('certificate.reloaded')
  async handleCertificateReload(): Promise<void> {
    this.logger.log('Certificate reload event received, restarting HTTPS server');

    const httpsEnabled = this.configService.get<boolean>('vsb.main.httpsEnabled');

    if (!httpsEnabled) {
      this.logger.debug('HTTPS is disabled, skipping certificate reload');
      return;
    }

    try {
      if (this.httpsServer) {
        // Close existing HTTPS server
        await this.stopHttpsServer();
      } else {
        this.logger.log('HTTPS server not yet started, starting for the first time');
      }

      // Start new HTTPS server with updated certificates
      await this.startHttpsServer();

      this.logger.log('HTTPS server restarted successfully with new certificates');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to restart HTTPS server: ${err.message}`, err.stack);
    }
  }

  /**
   * Gracefully shuts down both HTTP and HTTPS servers on module destruction.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down HTTP/HTTPS servers');

    const shutdownPromises: Promise<void>[] = [];

    if (this.httpServer) {
      shutdownPromises.push(this.stopHttpServer());
    }

    if (this.httpsServer) {
      shutdownPromises.push(this.stopHttpsServer());
    }

    await Promise.all(shutdownPromises);
    this.logger.log('All servers shut down successfully');
  }

  /**
   * Starts the HTTP server on the specified port.
   *
   * The HTTP server handles:
   * - ACME HTTP-01 challenges (/.well-known/acme-challenge/*)
   * - Internal cluster P2P endpoints (/cluster/*)
   * - Redirects to HTTPS (all other requests)
   */
  private async startHttpServer(port: number): Promise<void> {
    /* v8 ignore next 3 - defensive check: app always set by initializeServers before this method */
    if (!this.app) {
      throw new Error('NestJS app not initialized');
    }

    const expressApp = this.app.getHttpAdapter().getInstance() as http.RequestListener;
    this.httpServer = http.createServer(expressApp);

    return new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, '0.0.0.0', () => {
        this.logger.log(`HTTP server listening on port ${port}`);
        resolve();
      });

      this.httpServer!.once('error', (error) => {
        this.logger.error(`HTTP server failed to start: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Starts the HTTPS server with TLS certificates.
   *
   * Loads certificates from CertificateService and creates an HTTPS server.
   * If no certificates are available, logs a warning and skips HTTPS setup.
   */
  private async startHttpsServer(): Promise<void> {
    /* v8 ignore next 3 - defensive check: app always set by initializeServers before this method */
    if (!this.app) {
      throw new Error('NestJS app not initialized');
    }

    const cert = await this.certificateService.getCurrentCertificate();

    if (!cert) {
      this.logger.warn(
        'HTTPS enabled but no certificate found yet. HTTPS server will start after certificate is obtained.',
      );
      return;
    }

    const httpsPort = this.configService.get<number>('vsb.main.httpsPort');

    if (!httpsPort) {
      throw new Error('HTTPS port not configured (VSB_SERVER_HTTPS_PORT)');
    }

    const httpsOptions: https.ServerOptions = {
      cert: cert.certificate,
      key: cert.privateKey,
      // Use modern TLS settings
      minVersion: 'TLSv1.2',

      // Prefer secure cipher suites
      ciphers: [
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305',
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
      ].join(':'),
      honorCipherOrder: true,
    };

    const expressApp = this.app.getHttpAdapter().getInstance() as http.RequestListener;
    this.httpsServer = https.createServer(httpsOptions, expressApp);

    return new Promise<void>((resolve, reject) => {
      this.httpsServer!.listen(httpsPort, '0.0.0.0', () => {
        this.logger.log(`HTTPS server listening on port ${httpsPort}`);
        resolve();
      });

      this.httpsServer!.once('error', (error) => {
        this.logger.error(`HTTPS server failed to start: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Gracefully stops the HTTP server with timeout protection.
   */
  private async stopHttpServer(): Promise<void> {
    /* v8 ignore next 3 - defensive check: only called when server exists */
    if (!this.httpServer) {
      return;
    }

    const server = this.httpServer;
    this.httpServer = undefined;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.logger.warn('HTTP server close timeout, forcing shutdown');
        server.closeAllConnections?.();
        resolve();
      }, 30000);

      server.close((error) => {
        clearTimeout(timeout);
        if (error) {
          this.logger.error(`Error closing HTTP server: ${error.message}`);
          reject(error);
        } else {
          this.logger.log('HTTP server closed');
          resolve();
        }
      });
    });
  }

  /**
   * Gracefully stops the HTTPS server with timeout protection.
   *
   * Waits up to 30 seconds for active connections to close. If connections
   * remain open after timeout, forcefully closes them to prevent certificate
   * reload hangs caused by long-lived HTTP keep-alive connections.
   */
  private async stopHttpsServer(): Promise<void> {
    /* v8 ignore next 3 - defensive check: only called when server exists */
    if (!this.httpsServer) {
      return;
    }

    const server = this.httpsServer;
    this.httpsServer = undefined;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.logger.warn('HTTPS server close timeout, forcing shutdown');
        server.closeAllConnections?.(); // Node 18.2+
        resolve();
      }, 30000); // 30 second grace period

      server.close((error) => {
        clearTimeout(timeout);
        if (error) {
          this.logger.error(`Error closing HTTPS server: ${error.message}`);
          reject(error);
        } else {
          this.logger.log('HTTPS server closed');
          resolve();
        }
      });
    });
  }
}
