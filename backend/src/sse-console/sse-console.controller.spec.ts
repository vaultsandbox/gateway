import { ServiceUnavailableException } from '@nestjs/common';
import { of, EMPTY } from 'rxjs';
import { SseConsoleController } from './sse-console.controller';
import { SseConsoleService } from './sse-console.service';
import { ConsoleMessage } from './interfaces';

describe('SseConsoleController', () => {
  let controller: SseConsoleController;
  let sseConsoleService: {
    isEnabled: jest.Mock;
    getStream: jest.Mock;
    toMessageEvents: jest.Mock;
  };

  beforeEach(() => {
    sseConsoleService = {
      isEnabled: jest.fn(),
      getStream: jest.fn(),
      toMessageEvents: jest.fn(),
    };
    controller = new SseConsoleController(sseConsoleService as unknown as SseConsoleService);
  });

  it('rejects connections when SSE console is disabled', () => {
    sseConsoleService.isEnabled.mockReturnValue(false);

    expect(() => controller.stream()).toThrow(ServiceUnavailableException);
    expect(sseConsoleService.getStream).not.toHaveBeenCalled();
    expect(sseConsoleService.toMessageEvents).not.toHaveBeenCalled();
  });

  it('establishes stream when enabled', (done) => {
    jest.useFakeTimers();

    const consoleMessage: ConsoleMessage = {
      type: 'info',
      text: 'hello',
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    const stream$ = of(consoleMessage);
    const mapped$ = of({ data: consoleMessage });

    sseConsoleService.isEnabled.mockReturnValue(true);
    sseConsoleService.getStream.mockReturnValue(stream$);
    sseConsoleService.toMessageEvents.mockReturnValue(mapped$);

    const received: Array<{ data: ConsoleMessage }> = [];
    const subscription = controller.stream().subscribe({
      next: (value) => {
        received.push(value as { data: ConsoleMessage });
      },
      error: done.fail,
    });

    // Messages arrive synchronously from of()
    expect(sseConsoleService.getStream).toHaveBeenCalled();
    expect(sseConsoleService.toMessageEvents).toHaveBeenCalledWith(stream$);
    expect(received[0].data.text).toBe('SSE Console connected');
    expect(received[1]).toEqual({ data: consoleMessage });

    subscription.unsubscribe();
    jest.useRealTimers();
    done();
  });

  it('sends heartbeat events to keep connection alive', (done) => {
    jest.useFakeTimers();

    sseConsoleService.isEnabled.mockReturnValue(true);
    sseConsoleService.getStream.mockReturnValue(EMPTY);
    sseConsoleService.toMessageEvents.mockReturnValue(EMPTY);

    const received: Array<{ type?: string; data: unknown }> = [];
    const subscription = controller.stream().subscribe({
      next: (value) => received.push(value as { type?: string; data: unknown }),
      error: done.fail,
    });

    // Initial connection message
    expect(received.length).toBe(1);
    expect((received[0].data as ConsoleMessage).text).toBe('SSE Console connected');

    // Advance timer to trigger heartbeat
    jest.advanceTimersByTime(30000);
    expect(received.length).toBe(2);
    expect(received[1]).toEqual({ type: 'heartbeat', data: '' });

    // Another heartbeat
    jest.advanceTimersByTime(30000);
    expect(received.length).toBe(3);
    expect(received[2]).toEqual({ type: 'heartbeat', data: '' });

    subscription.unsubscribe();
    jest.useRealTimers();
    done();
  });
});
