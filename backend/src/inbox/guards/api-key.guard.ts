import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { getErrorMessage } from '../../shared/error.utils';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly apiKey: string | undefined;

  /* v8 ignore next - false positive on constructor parameter property */
  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('vsb.local.apiKey');

    if (!this.apiKey) {
      this.logger.error('VSB_LOCAL_API_KEY not configured - API authentication disabled!');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Allow OPTIONS requests for CORS preflight
    if (request.method === 'OPTIONS') {
      return true;
    }

    const providedKey = this.extractApiKey(request);

    if (!providedKey) {
      this.logger.warn(`API request without credentials path=${request.path}`);
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    if (!this.apiKey) {
      this.logger.error('API key not configured but request received');
      throw new UnauthorizedException('API authentication not configured');
    }

    // Constant-time comparison to prevent timing attacks
    if (!this.constantTimeCompare(providedKey, this.apiKey)) {
      this.logger.warn(`API request with invalid API key path=${request.path}`);
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   * Pads both inputs to a consistent length to avoid leaking length information.
   */
  private constantTimeCompare(a: string, b: string): boolean {
    try {
      // Pad to consistent length to avoid leaking key length via timing
      const maxLen = Math.max(a.length, b.length, 32);
      const bufA = Buffer.alloc(maxLen);
      const bufB = Buffer.alloc(maxLen);
      Buffer.from(a, 'utf8').copy(bufA);
      Buffer.from(b, 'utf8').copy(bufB);

      // Must also check lengths match, but do so after constant-time comparison
      const contentsEqual = timingSafeEqual(bufA, bufB);
      return contentsEqual && a.length === b.length;
      /* v8 ignore next 5 - defensive catch for unexpected errors in crypto operations */
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Error in constant-time comparison: ${errorMessage}`);
      return false;
    }
  }

  private extractApiKey(request: Request): string | undefined {
    return request.headers['x-api-key'] as string | undefined;
  }
}
