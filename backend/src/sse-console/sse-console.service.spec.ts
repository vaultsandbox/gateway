import { ConfigService } from '@nestjs/config';
import { SseConsoleService } from './sse-console.service';

describe('SseConsoleService', () => {
  const getMock = jest.fn();
  const configService = { get: getMock } as unknown as ConfigService;

  beforeEach(() => {
    getMock.mockReset();
    getMock.mockReturnValue(true);
  });

  it('exposes enabled flag from configuration', () => {
    getMock.mockReturnValue(false);
    const service = new SseConsoleService(configService);

    expect(service.isEnabled()).toBe(false);
  });

  it('escapes HTML content before emitting messages', (done) => {
    const service = new SseConsoleService(configService);
    const subscription = service.getStream().subscribe((message) => {
      expect(message.text).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect((message as Record<string, unknown>).html).toBeUndefined();
      subscription.unsubscribe();
      done();
    });

    service.log('warning', '<script>alert("xss")</script>');
  });
});
