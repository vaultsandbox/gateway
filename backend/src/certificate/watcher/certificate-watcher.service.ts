import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as chokidar from 'chokidar';
import * as path from 'path';
import { CertificateStorageService } from '../storage/certificate-storage.service';
import type { CertificateConfig } from '../interfaces';
import { CERTIFICATE_CONFIG } from '../certificate.tokens';

/**
 * Service that watches for changes to the certificate files on disk.
 * When a change is detected, it reloads the certificate and emits an event.
 */
@Injectable()
export class CertificateWatcherService {
  private readonly logger = new Logger(CertificateWatcherService.name);
  private watcher?: chokidar.FSWatcher;

  /**
   * Constructor
   */
  constructor(
    @Inject(CERTIFICATE_CONFIG) private readonly config: CertificateConfig,
    private readonly storageService: CertificateStorageService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Starts watching the certificate and key files for changes.
   */
  startWatching(): void {
    if (!this.config.enabled) {
      return;
    }

    const certPath = path.join(this.config.storagePath, 'cert.pem');
    const keyPath = path.join(this.config.storagePath, 'key.pem');

    this.watcher = chokidar.watch([certPath, keyPath], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath: string) => {
      this.logger.log('Certificate file changed, triggering reload', {
        filePath,
      });
      void this.reloadCertificate();
    });

    this.logger.log('Certificate watcher started');
  }

  /**
   * Stops watching for file changes.
   */
  async stopWatching(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    await this.watcher.close();
    this.watcher = undefined;
    this.logger.log('Certificate watcher stopped');
  }

  /**
   * Reloads the certificate from storage and emits a 'certificate.reloaded' event.
   * @private
   */
  private async reloadCertificate(): Promise<void> {
    try {
      const cert = await this.storageService.loadCertificate();

      if (!cert) {
        this.logger.warn('Certificate reload triggered but no certificate found');
        return;
      }

      this.eventEmitter.emit('certificate.reloaded', cert);

      this.logger.log('Certificate reloaded successfully', {
        domains: cert.domains,
        expiresAt: cert.expiresAt.toISOString(),
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Certificate reload failed: ${err.message}`, err.stack);
    }
  }
}
