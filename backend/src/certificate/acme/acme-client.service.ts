import { Injectable, Logger, Inject } from '@nestjs/common';
import * as acme from 'acme-client';
import type { Authorization, Client, Order } from 'acme-client';
import type { Challenge } from 'acme-client/types/rfc8555';
import { Certificate } from '../interfaces';
import type { CertificateConfig } from '../interfaces';
import { CertificateStorageService } from '../storage/certificate-storage.service';
import { CERTIFICATE_CONFIG } from '../certificate.tokens';

/**
 * A wrapper service for the 'acme-client' library to simplify ACME operations
 * like account creation, order placement, and certificate finalization.
 */
@Injectable()
export class AcmeClientService {
  private readonly logger = new Logger(AcmeClientService.name);
  private client?: Client;
  private accountKey?: Buffer;

  constructor(
    @Inject(CERTIFICATE_CONFIG) private readonly config: CertificateConfig,
    /* v8 ignore next - false positive on constructor parameter property */
    private readonly storageService: CertificateStorageService,
  ) {}

  /**
   * Initializes the ACME client. This includes loading or creating an account key
   * and registering the account with the ACME provider.
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.accountKey = await this.storageService.loadOrGenerateAccountKey();

    this.client = new acme.Client({
      directoryUrl: this.config.acmeDirectoryUrl,
      accountKey: this.accountKey,
    });

    try {
      await this.client.createAccount({
        termsOfServiceAgreed: true,
        contact: this.config.email ? [`mailto:${this.config.email}`] : [],
      });
      this.logger.log('ACME account created or loaded successfully');
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 409) {
        this.logger.log('ACME account already exists; continuing');
        return;
      }

      this.logger.error(`Failed to initialize ACME client: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Creates a new ACME order for the specified domains.
   * @param domain - The primary domain for the certificate.
   * @param additionalDomains - An array of additional domains (SANs).
   * @returns A promise that resolves to an object containing the order, authorizations, and a new private key for the certificate.
   */
  async createOrder(
    domain: string,
    additionalDomains: string[] = [],
  ): Promise<{
    order: Order;
    authorizations: Authorization[];
    certificateKey: Buffer;
  }> {
    const client = this.ensureClient();
    const identifiers = [domain, ...additionalDomains].filter(Boolean);

    if (identifiers.length === 0) {
      throw new Error('No domains specified for certificate order');
    }

    this.logger.log('Creating ACME order', { identifiers });

    const order = await client.createOrder({
      identifiers: identifiers.map((value) => ({ type: 'dns', value })),
    });

    const authorizations = await client.getAuthorizations(order);
    const certificateKey = await acme.forge.createPrivateKey();

    return { order, authorizations, certificateKey };
  }

  /**
   * Gets the key authorization for a given ACME challenge.
   * @param challenge - The ACME challenge object.
   * @returns A promise that resolves to the key authorization string.
   */
  async getChallengeKeyAuthorization(challenge: Challenge): Promise<string> {
    const client = this.ensureClient();
    return client.getChallengeKeyAuthorization(challenge);
  }

  /**
   * Notifies the ACME server that a challenge has been completed.
   * @param challenge - The ACME challenge object.
   */
  async completeChallenge(challenge: Challenge): Promise<void> {
    const client = this.ensureClient();
    await client.completeChallenge(challenge);
  }

  /**
   * Waits for an ACME order to reach a 'ready' or 'valid' state.
   * @param order - The ACME order object.
   */
  async waitForOrderReady(order: Order): Promise<void> {
    const client = this.ensureClient();
    await client.waitForValidStatus(order);
  }

  /**
   * Finalizes a certificate order by submitting a CSR and retrieving the certificate.
   * @param order - The completed ACME order.
   * @param certificateKey - The private key to be associated with the new certificate.
   * @returns A promise that resolves to the finalized certificate object.
   */
  async finalizeCertificate(order: Order, certificateKey: Buffer): Promise<Certificate> {
    const client = this.ensureClient();
    const domains = order.identifiers?.map((identifier) => identifier.value) ?? [];

    const [, csr] = await acme.forge.createCsr(
      {
        commonName: domains[0],
        altNames: domains.slice(1),
      },
      certificateKey,
    );

    await client.finalizeOrder(order, csr);
    const certificatePem = await client.getCertificate(order);
    const certificateBuffer = Buffer.isBuffer(certificatePem) ? certificatePem : Buffer.from(certificatePem);

    const info = await acme.forge.readCertificateInfo(certificateBuffer);

    return {
      privateKey: certificateKey,
      certificate: certificateBuffer,
      fullchain: certificateBuffer,
      domains,
      issuedAt: info.notBefore,
      expiresAt: info.notAfter,
    } satisfies Certificate;
  }

  /**
   * Ensures that the ACME client has been initialized.
   * @returns The initialized ACME client instance.
   * @throws If the client is not initialized.
   * @private
   */
  private ensureClient(): Client {
    if (!this.client) {
      throw new Error('ACME client not initialised');
    }
    return this.client;
  }
}
