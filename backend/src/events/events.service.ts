import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { NewEmailEvent } from './interfaces';

/**
 * @class EventsService
 * @description Service responsible for handling real-time server-sent events (SSE),
 * particularly for notifying clients about new emails.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly eventStream$ = new Subject<NewEmailEvent>();

  /**
   * @method emitNewEmailEvent
   * @description Emits a new email event to the event stream.
   * @param {NewEmailEvent} event - The new email event to dispatch.
   * @returns {void}
   */
  emitNewEmailEvent(event: NewEmailEvent): void {
    /*
    this.logger.debug(
      `Dispatching new-email event inboxId=${event.inboxId} emailId=${event.emailId} subject='${event.subject}'`,
    );*/
    this.eventStream$.next(event);
  }

  /**
   * @method streamForInboxes
   * @description Creates an observable stream of new email events filtered for specific inbox IDs.
   * @param {string[]} inboxIds - An array of inbox IDs to subscribe to.
   * @returns {Observable<NewEmailEvent>} An observable that emits events for the specified inboxes.
   */
  streamForInboxes(inboxIds: string[]): Observable<NewEmailEvent> {
    if (inboxIds.length === 0) {
      this.logger.debug('SSE subscription requested with no inbox IDs; returning empty stream');
      return new Observable(() => () => undefined);
    }

    const allowed = new Set(inboxIds);
    return this.eventStream$.asObservable().pipe(filter((event) => allowed.has(event.inboxId)));
  }

  /**
   * @method toMessageEvents
   * @description Transforms a stream of NewEmailEvent objects into a stream of MessageEvent objects
   * suitable for SSE responses.
   * @param {Observable<NewEmailEvent>} source$ - The source observable of new email events.
   * @returns {Observable<MessageEvent>} An observable that emits MessageEvent objects.
   */
  toMessageEvents(source$: Observable<NewEmailEvent>): Observable<MessageEvent> {
    // Use default SSE event name so browsers receive it via onmessage
    return source$.pipe(map((event) => ({ data: event })));
  }
}
