import { BadRequestException, Controller, Logger, MessageEvent, Query, Sse, UseGuards } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiTags, ApiSecurity, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { InboxService } from '../inbox/inbox.service';
import { ApiKeyGuard } from '../inbox/guards/api-key.guard';
import { NewEmailEventDto } from './dto/new-email-event.dto';

/**
 * @class EventsController
 * @description Controller for handling Server-Sent Events (SSE) to notify clients of new emails.
 * Requires an API key for access.
 */
@ApiTags('Events')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('api/events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  /**
   * Constructor
   */
  constructor(
    private readonly eventsService: EventsService,
    private readonly inboxService: InboxService,
  ) {}

  /**
   * @method stream
   * @description Establishes an SSE connection to stream new email events.
   * Clients can specify which inboxes to subscribe to via the 'inboxes' query parameter.
   * If no inboxes are specified, the stream will include events from all inboxes owned by the client.
   * @param {string | string[]} [inboxes] - A comma-separated string or an array of inbox IDs to subscribe to.
   * @returns {Observable<MessageEvent>} An observable stream of message events.
   */
  @Sse()
  @ApiOperation({
    summary: 'Subscribe to new email events',
    description:
      'Establishes a Server-Sent Events (SSE) connection to receive real-time notifications about new emails.',
  })
  @ApiQuery({
    name: 'inboxes',
    required: true,
    description: 'Comma-separated list of inbox hashes to subscribe to.',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'SSE connection established. The stream will send events as they occur.',
    type: NewEmailEventDto,
    headers: {
      'Content-Type': {
        schema: {
          type: 'string',
          example: 'text/event-stream',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  stream(@Query('inboxes') inboxes?: string | string[]): Observable<MessageEvent> {
    const requested = this.normalizeInboxIds(inboxes);
    if (requested.length === 0) {
      throw new BadRequestException('At least one inbox hash must be specified');
    }

    const owned = this.inboxService.listInboxHashes();
    const ownedSet = new Set(owned);
    const targetIds = requested.filter((id) => ownedSet.has(id));

    this.logger.log(
      `SSE request received requested=${requested.length} owned=${owned.length} matched=${targetIds.length}`,
    );

    if (targetIds.length === 0) {
      this.logger.warn('SSE subscription requested inboxes that are not owned');
      throw new BadRequestException('No matching inbox hashes found');
    }

    const filtered$ = this.eventsService.streamForInboxes(targetIds);
    const message$ = this.eventsService.toMessageEvents(filtered$);
    const heartbeat$ = interval(30000).pipe(
      map(
        () =>
          ({
            data: {
              type: 'heartbeat',
              timestamp: new Date().toISOString(),
            },
          }) as MessageEvent,
      ),
    );
    const combined$ = merge(message$, heartbeat$);

    return new Observable((subscriber) => {
      this.logger.log(`SSE client subscribed for inbox hashes: ${targetIds.join(',')}`);
      const subscription = combined$.subscribe({
        next: (value) => subscriber.next(value),
        error: (error) => {
          this.logger.error(`SSE stream error: ${error instanceof Error ? error.message : error}`);
          subscriber.error(error);
        },
        complete: () => subscriber.complete(),
      });

      return () => {
        this.logger.log('SSE client disconnected');
        subscription.unsubscribe();
      };
    });
  }

  /**
   * @method normalizeInboxIds
   * @private
   * @description Normalizes the 'inboxes' query parameter into a unique array of non-empty inbox IDs.
   * @param {string | string[]} [value] - The raw value from the query parameter.
   * @returns {string[]} A clean array of inbox IDs.
   */
  private normalizeInboxIds(value?: string | string[]): string[] {
    if (!value) {
      return [];
    }

    const raw = Array.isArray(value) ? value.join(',') : value;
    return Array.from(
      new Set(
        raw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );
  }
}
