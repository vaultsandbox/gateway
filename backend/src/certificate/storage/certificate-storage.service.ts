import { Injectable, Logger, Inject } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as acme from 'acme-client';
import type { CertificateInfo } from 'acme-client';
import { Certificate } from '../interfaces';
import type { CertificateConfig } from '../interfaces';
import { CERTIFICATE_CONFIG } from '../certificate.tokens';

/**
 * Service responsible for storing and retrieving ACME account keys, certificates,
 * and challenge responses from the filesystem.
 */
@Injectable()
export class CertificateStorageService {
  private readonly logger = new Logger(CertificateStorageService.name);

  /**
   * Constructor
   */
  constructor(@Inject(CERTIFICATE_CONFIG) private readonly config: CertificateConfig) {
    this.ensureStorageDirectory();
  }

  /**
   * Loads the ACME account private key from storage, or generates and saves a new one if not found.
   * @returns A promise that resolves to the account key buffer.
   */
  async loadOrGenerateAccountKey(): Promise<Buffer> {
    const accountKeyPath = path.join(this.config.storagePath, 'account.key');

    if (fs.existsSync(accountKeyPath)) {
      this.logger.log('Loading existing ACME account key');
      return fs.readFileSync(accountKeyPath);
    }

    this.logger.log('Generating new ACME account key');
    const accountKeyBuffer = await acme.forge.createPrivateKey();
    fs.writeFileSync(accountKeyPath, accountKeyBuffer, { mode: 0o600 });
    return accountKeyBuffer;
  }

  /**
   * Saves a certificate, private key, and metadata to the storage directory.
   * Backs up any existing certificate files before writing new ones.
   * @param cert - The certificate object to save.
   */
  saveCertificate(cert: Certificate): void {
    this.backupExisting();

    const certPath = path.join(this.config.storagePath, 'cert.pem');
    const keyPath = path.join(this.config.storagePath, 'key.pem');
    const fullchainPath = path.join(this.config.storagePath, 'fullchain.pem');
    const metadataPath = path.join(this.config.storagePath, 'metadata.json');

    this.atomicWriteFile(certPath, cert.certificate, { mode: 0o644 });
    this.atomicWriteFile(keyPath, cert.privateKey, { mode: 0o600 });

    if (cert.fullchain) {
      this.atomicWriteFile(fullchainPath, cert.fullchain, { mode: 0o644 });
    }

    const metadata = {
      domains: cert.domains,
      issuedAt: cert.issuedAt.toISOString(),
      expiresAt: cert.expiresAt.toISOString(),
    };

    this.atomicWriteFile(metadataPath, JSON.stringify(metadata, null, 2), {
      mode: 0o644,
    });

    this.logger.log('Certificate saved successfully', {
      domains: cert.domains,
      expiresAt: cert.expiresAt.toISOString(),
    });
  }

  /**
   * Loads a certificate, private key, and metadata from the storage directory.
   * If metadata is not found, it reads it directly from the certificate file.
   * @returns A promise that resolves to the certificate object, or null if not found.
   */
  async loadCertificate(): Promise<Certificate | null> {
    const certPath = path.join(this.config.storagePath, 'cert.pem');
    const keyPath = path.join(this.config.storagePath, 'key.pem');
    const fullchainPath = path.join(this.config.storagePath, 'fullchain.pem');
    const chainPath = path.join(this.config.storagePath, 'chain.pem');
    const metadataPath = path.join(this.config.storagePath, 'metadata.json');

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      return null;
    }

    const certificate = fs.readFileSync(certPath);
    const privateKey = fs.readFileSync(keyPath);
    const fullchain = fs.existsSync(fullchainPath) ? fs.readFileSync(fullchainPath) : undefined;
    const chain = fs.existsSync(chainPath) ? fs.readFileSync(chainPath) : undefined;

    let metadata: { domains: string[]; issuedAt: string; expiresAt: string } | undefined;
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as {
        domains: string[];
        issuedAt: string;
        expiresAt: string;
      };
    } else {
      const info: CertificateInfo = await acme.forge.readCertificateInfo(certificate);
      metadata = {
        domains: [info.domains.commonName, ...(info.domains.altNames ?? [])].filter(Boolean),
        issuedAt: info.notBefore.toISOString(),
        expiresAt: info.notAfter.toISOString(),
      };
    }

    /* v8 ignore next 3 - defensive check, metadata is always set by preceding branches */
    if (!metadata) {
      throw new Error('Unable to load certificate metadata');
    }

    return {
      certificate,
      privateKey,
      chain,
      fullchain,
      domains: metadata.domains,
      issuedAt: new Date(metadata.issuedAt),
      expiresAt: new Date(metadata.expiresAt),
    } satisfies Certificate;
  }

  /**
   * Saves an ACME challenge response to a temporary file.
   * @param token - The challenge token.
   * @param keyAuth - The key authorization string.
   */
  saveChallengeResponse(token: string, keyAuth: string): void {
    const challengePath = this.getChallengePath(token);
    fs.writeFileSync(challengePath, keyAuth, { mode: 0o644 });
  }

  /**
   * Retrieves an ACME challenge response from a temporary file.
   * @param token - The challenge token.
   * @returns The key authorization string, or null if not found.
   */
  getChallengeResponse(token: string): string | null {
    let challengePath: string;

    try {
      challengePath = this.getChallengePath(token);
    } catch (error) {
      this.logger.warn('Rejected challenge lookup with invalid token', {
        token,
        error: (error as Error).message,
      });
      return null;
    }

    if (!fs.existsSync(challengePath)) {
      return null;
    }

    return fs.readFileSync(challengePath, 'utf-8');
  }

  /**
   * Deletes all temporary ACME challenge files.
   */
  cleanupChallenges(): void {
    const challengesDir = path.join(this.config.storagePath, 'challenges');

    if (!fs.existsSync(challengesDir)) {
      return;
    }

    const files = fs.readdirSync(challengesDir);
    for (const file of files) {
      fs.unlinkSync(path.join(challengesDir, file));
    }

    this.logger.log('Challenge files cleaned up');
  }

  /**
   * Ensures that the storage directories for certificates and challenges exist.
   * @private
   */
  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, { recursive: true, mode: 0o700 });
    }

    const challengesDir = path.join(this.config.storagePath, 'challenges');
    if (!fs.existsSync(challengesDir)) {
      fs.mkdirSync(challengesDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Creates a backup of the existing certificate and key files.
   * @private
   */
  private backupExisting(): void {
    const certPath = path.join(this.config.storagePath, 'cert.pem');
    const keyPath = path.join(this.config.storagePath, 'key.pem');

    if (fs.existsSync(certPath)) {
      fs.copyFileSync(certPath, `${certPath}.backup`);
    }

    if (fs.existsSync(keyPath)) {
      fs.copyFileSync(keyPath, `${keyPath}.backup`);
    }
  }

  /**
   * Validates and resolves the storage path for a challenge token, preventing path traversal.
   * @private
   */
  private getChallengePath(token: string): string {
    const sanitizedToken = token?.trim();
    const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

    if (!sanitizedToken || !base64UrlPattern.test(sanitizedToken)) {
      throw new Error('Invalid challenge token format');
    }

    const challengesDir = path.join(this.config.storagePath, 'challenges');
    return path.join(challengesDir, sanitizedToken);
  }

  /**
   * Writes data to a temporary file and atomically renames it into place.
   * @private
   */
  private atomicWriteFile(
    targetPath: string,
    data: string | NodeJS.ArrayBufferView,
    options?: fs.WriteFileOptions & { mode?: number },
  ): void {
    const directory = path.dirname(targetPath);
    const baseName = path.basename(targetPath);
    const tempPath = path.join(
      directory,
      `${baseName}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );

    try {
      fs.writeFileSync(tempPath, data, options);
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          this.logger.warn('Failed to clean up temporary certificate file', { tempPath });
        }
      }
      throw error;
    }
  }
}
