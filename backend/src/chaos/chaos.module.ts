import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChaosService } from './chaos.service';
import { ChaosEnabledGuard } from './chaos.guard';
import { SseConsoleModule } from '../sse-console/sse-console.module';
import { MetricsModule } from '../metrics/metrics.module';
import { GreylistStateService } from './state/greylist-state.service';

/**
 * Chaos Engineering Module
 *
 * Provides chaos engineering capabilities for testing application resilience
 * to email delivery failure scenarios.
 *
 * Components:
 * - ChaosService: Core orchestration service
 * - ChaosEnabledGuard: Guard for checking global chaos enable flag
 * - GreylistStateService: State tracking for greylisting simulation
 *
 * Supported chaos types: latency injection, connection dropping,
 * random errors, greylisting, and blackhole mode.
 */
@Module({
  imports: [ConfigModule, SseConsoleModule, MetricsModule],
  providers: [ChaosService, ChaosEnabledGuard, GreylistStateService],
  exports: [ChaosService, ChaosEnabledGuard, GreylistStateService],
})
export class ChaosModule {}
