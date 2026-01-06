import { Body, Controller, Get, Inject, Logger, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { CertificateService } from './certificate.service';
import { CertificateStorageService } from './storage/certificate-storage.service';
import { PeerAuthGuard } from './guards/peer-auth.guard';
import { CERTIFICATE_CONFIG } from './certificate.tokens';
import type { CertificateConfig, CertificateStatus, CertificateSyncRequest, ChallengeSyncRequest } from './interfaces';

/**
 * Controller for handling certificate-related HTTP requests.
 * This includes the ACME HTTP-01 challenge endpoint and cluster synchronization endpoints.
 */
@ApiExcludeController()
@Controller()
export class CertificateController {
  private readonly logger = new Logger(CertificateController.name);

  /**
   * Constructor
   */
  /* v8 ignore next 6 - false positive on constructor parameter properties */
  constructor(
    @Inject(CERTIFICATE_CONFIG) private readonly config: CertificateConfig,
    private readonly storageService: CertificateStorageService,
    private readonly certificateService: CertificateService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Handles the ACME HTTP-01 challenge.
   * The ACME server will hit this endpoint to verify domain ownership.
   * @param token - The ACME challenge token.
   * @returns The key authorization string for the given token.
   * @throws {NotFoundException} If the challenge for the token is not found.
   */
  @Get('.well-known/acme-challenge/:token')
  acmeChallenge(@Param('token') token: string): string {
    const domain = this.config.domain;
    const httpPort = this.configService.get<number>('vsb.main.port');
    const portSuffix = httpPort === 80 ? '' : `:${httpPort}`;
    const challengeUrl = `http://${domain}${portSuffix}/.well-known/acme-challenge/${token}`;

    this.logger.log(`ACME challenge requested for token: ${token}`);

    const keyAuth = this.storageService.getChallengeResponse(token);

    if (!keyAuth) {
      this.logger.warn(`Challenge NOT FOUND for token: ${token}`);
      this.logger.warn(`Ensure this URL is accessible: ${challengeUrl}`);
      throw new NotFoundException('Challenge not found');
    }

    this.logger.log(`Challenge FOUND for token: ${token}, length: ${keyAuth.length}`);
    this.logger.log(`Returning key authorization for: ${challengeUrl}`);
    return keyAuth;
  }

  /**
   * VaultSandbox verification endpoint.
   * Returns HTTP 200 for service verification
   */
  @Get('.well-known/vaultsandbox')
  getVaultSandboxVerification(): string {
    return 'ok';
  }

  /**
   * Endpoint for a leader node to push a new certificate to a follower node.
   * Protected by the PeerAuthGuard.
   * @param syncRequest - The certificate data to be synced.
   */
  @Post('cluster/certificates/sync')
  @UseGuards(PeerAuthGuard)
  syncCertificate(@Body() syncRequest: CertificateSyncRequest): void {
    this.certificateService.receiveCertificateSync(syncRequest);
  }

  /**
   * Endpoint for a leader node to push an ACME challenge to a follower node.
   * Protected by the PeerAuthGuard.
   * @param syncRequest - The challenge data to be synced.
   */
  @Post('cluster/challenges/sync')
  @UseGuards(PeerAuthGuard)
  syncChallenge(@Body() syncRequest: ChallengeSyncRequest): void {
    this.storageService.saveChallengeResponse(syncRequest.token, syncRequest.keyAuth);
  }

  /**
   * Retrieves the status of the current certificate.
   * Protected by the PeerAuthGuard.
   * @returns A promise that resolves to the certificate's status.
   */
  /* v8 ignore next 4 - decorator branch coverage false positive */
  @Get('cluster/certificates/status')
  @UseGuards(PeerAuthGuard)
  async getCertificateStatus(): Promise<CertificateStatus> {
    return this.certificateService.getStatus();
  }

  /**
   * Manually triggers a certificate renewal check.
   * This is useful for forcing a renewal via an API call.
   * Protected by the PeerAuthGuard.
   */
  /* v8 ignore next 5 - decorator branch coverage false positive */
  @Post('cluster/certificates/renew')
  @UseGuards(PeerAuthGuard)
  async renewCertificate(): Promise<{ message: string }> {
    await this.certificateService.manualRenewal();
    return { message: 'Certificate renewal initiated' };
  }
}
