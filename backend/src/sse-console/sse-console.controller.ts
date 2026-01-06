import { Controller, Logger, Sse, UseGuards, MessageEvent, ServiceUnavailableException } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiTags, ApiSecurity, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SseConsoleService } from './sse-console.service';
import { ApiKeyGuard } from '../inbox/guards/api-key.guard';
import { ConsoleMessage } from './interfaces';

@ApiTags('SSE Console')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('api/sse-console')
export class SseConsoleController {
  private readonly logger = new Logger(SseConsoleController.name);
  private readonly heartbeatIntervalMs = 30000; // 30 seconds

  /* v8 ignore next - constructor branch coverage false positive, tested in sse-console.controller.spec.ts */
  constructor(private readonly sseConsoleService: SseConsoleService) {}

  @Sse('stream')
  @ApiOperation({
    summary: 'Subscribe to server console logs',
    description: 'Establishes an SSE connection to receive real-time console-style log messages.',
  })
  @ApiResponse({
    status: 200,
    description:
      'SSE connection established. The stream will send log messages as they occur. Messages have the structure: { type: string, text: string, timestamp: string } and are HTML-escaped on the server.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  /* v8 ignore next - decorator branch coverage false positive, tested in sse-console.controller.spec.ts */
  stream(): Observable<MessageEvent> {
    if (!this.sseConsoleService.isEnabled()) {
      throw new ServiceUnavailableException('SSE Console is disabled');
    }

    const stream$ = this.sseConsoleService.getStream();
    const message$ = this.sseConsoleService.toMessageEvents(stream$);

    // Heartbeat to keep connection alive through proxies
    const heartbeat$ = interval(this.heartbeatIntervalMs).pipe(map(() => ({ type: 'heartbeat' as const, data: '' })));

    return new Observable((subscriber) => {
      this.logger.log('SSE Console client connected');

      // Send initial connection message
      subscriber.next({
        data: {
          type: 'info',
          text: 'SSE Console connected',
          timestamp: new Date().toISOString(),
        } as ConsoleMessage,
      });

      const subscription = merge(message$, heartbeat$).subscribe({
        next: (value) => subscriber.next(value),
        error: (error) => {
          this.logger.error(`SSE Console stream error: ${error instanceof Error ? error.message : error}`);
          subscriber.error(error);
        },
        complete: () => subscriber.complete(),
      });

      return () => {
        this.logger.log('SSE Console client disconnected');
        subscription.unsubscribe();
      };
    });
  }
}
