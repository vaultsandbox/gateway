import { Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard to check if chaos engineering features are enabled globally.
 *
 * When VSB_CHAOS_ENABLED=false:
 * - All chaos API endpoints return 403 Forbidden
 * - Chaos configuration in inbox creation is ignored
 */
@Injectable()
export class ChaosEnabledGuard implements CanActivate {
  /* v8 ignore next - false positive on constructor parameter */
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const chaosEnabled = this.configService.get<boolean>('vsb.chaos.enabled', false);

    if (!chaosEnabled) {
      throw new ForbiddenException('Chaos engineering features are disabled. Set VSB_CHAOS_ENABLED=true to enable.');
    }

    return true;
  }
}
