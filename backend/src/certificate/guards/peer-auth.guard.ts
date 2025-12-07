import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * A guard that protects endpoints by validating a signature sent by a peer node.
 * This ensures that only authorized nodes within the cluster can access certain endpoints.
 * It uses a shared secret, a timestamp, and an HMAC-SHA256 signature.
 */
@Injectable()
export class PeerAuthGuard implements CanActivate {
  private readonly logger = new Logger(PeerAuthGuard.name);
  private readonly sharedSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.sharedSecret = this.configService.get<string>('vsb.certificate.peerSharedSecret', '') ?? '';
  }

  /**
   * Determines if the current request is authorized.
   * @param context - The execution context of the current request.
   * @returns A boolean indicating whether the request is authorized.
   * @throws {UnauthorizedException} If authentication fails.
   */
  canActivate(context: ExecutionContext): boolean {
    if (!this.sharedSecret) {
      this.logger.warn('Peer shared secret is not configured; rejecting request');
      throw new UnauthorizedException('Peer authentication not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const peerToken = this.getHeaderValue(request.headers['x-peer-token']);
    const timestamp = this.getHeaderValue(request.headers['x-peer-timestamp']);
    const signature = this.getHeaderValue(request.headers['x-peer-signature']);

    if (!peerToken || !timestamp || !signature) {
      this.logger.warn('Missing peer authentication headers');
      throw new UnauthorizedException('Missing peer authentication');
    }

    const requestTime = Number.parseInt(timestamp, 10);
    if (Number.isNaN(requestTime)) {
      this.logger.warn('Invalid peer timestamp provided', { timestamp });
      throw new UnauthorizedException('Invalid timestamp');
    }

    const now = Date.now();
    const diff = Math.abs(now - requestTime);
    if (diff > 60_000) {
      this.logger.warn('Peer request timestamp outside tolerance window', {
        timestamp,
        now,
        diff,
      });
      throw new UnauthorizedException('Invalid timestamp');
    }

    const expectedSignature = this.generateSignature(peerToken, timestamp);

    try {
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const providedBuffer = Buffer.from(signature, 'hex');

      if (expectedBuffer.length !== providedBuffer.length) {
        this.logger.warn('Peer signature length mismatch');
        throw new UnauthorizedException('Invalid signature');
      }

      if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
        this.logger.warn('Peer signature validation failed');
        throw new UnauthorizedException('Invalid signature');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.warn('Peer signature validation error', (error as Error).message);
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }

  /**
   * Generates the expected HMAC signature for a given token and timestamp.
   * @param peerToken - The peer's unique identifier.
   * @param timestamp - The timestamp of the request.
   * @returns The expected signature as a hex string.
   * @private
   */
  private generateSignature(peerToken: string, timestamp: string): string {
    return createHmac('sha256', this.sharedSecret).update(`${peerToken}:${timestamp}`).digest('hex');
  }

  /**
   * Safely retrieves a header value, returning the first element if it's an array.
   * @param value - The header value.
   * @returns The header value as a string, or undefined.
   * @private
   */
  private getHeaderValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
