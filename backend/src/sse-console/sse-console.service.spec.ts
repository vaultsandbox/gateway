import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { SseConsoleService } from './sse-console.service';
import { ConsoleMessage } from './interfaces';

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

  it('does not emit messages when disabled', () => {
    getMock.mockReturnValue(false);
    const service = new SseConsoleService(configService);
    const received: ConsoleMessage[] = [];

    service.getStream().subscribe((msg) => received.push(msg));
    service.log('info', 'should not appear');

    expect(received).toHaveLength(0);
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

  it('sanitizes empty values to empty string', (done) => {
    const service = new SseConsoleService(configService);
    const subscription = service.getStream().subscribe((message) => {
      expect(message.text).toBe('');
      subscription.unsubscribe();
      done();
    });

    service.log('info', '');
  });

  it('transforms messages to SSE MessageEvent format', () => {
    const service = new SseConsoleService(configService);
    const message: ConsoleMessage = { type: 'info', text: 'test', timestamp: '2024-01-01T00:00:00.000Z' };
    const source$ = of(message);

    const received: Array<{ data: ConsoleMessage }> = [];
    service.toMessageEvents(source$).subscribe((ev) => received.push(ev));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ data: message });
  });

  describe('logSenderValidation', () => {
    it('logs sender validation info', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.type).toBe('info');
        expect(message.text).toContain('MAIL FROM: sender@test.com');
        expect(message.text).toContain('IP: 1.2.3.4');
        expect(message.text).toContain('SPF: pass');
        expect(message.text).toContain('rDNS: valid');
        subscription.unsubscribe();
        done();
      });

      service.logSenderValidation('sender@test.com', '1.2.3.4', 'pass', 'valid');
    });

    it('uses unknown for missing values', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.text).toContain('MAIL FROM: unknown');
        expect(message.text).toContain('IP: unknown');
        expect(message.text).toContain('SPF: unknown');
        expect(message.text).toContain('rDNS: unknown');
        subscription.unsubscribe();
        done();
      });

      service.logSenderValidation('', undefined, undefined, undefined);
    });
  });

  describe('logRecipientAccepted', () => {
    it('logs accepted recipient', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.type).toBe('success');
        expect(message.text).toContain('RCPT TO: recipient@test.com accepted');
        subscription.unsubscribe();
        done();
      });

      service.logRecipientAccepted('recipient@test.com');
    });

    it('uses unknown for empty address', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.text).toContain('RCPT TO: unknown accepted');
        subscription.unsubscribe();
        done();
      });

      service.logRecipientAccepted('');
    });
  });

  describe('logRecipientRejected', () => {
    it('logs rejected recipient', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.type).toBe('error');
        expect(message.text).toContain('RCPT TO: bad@test.com rejected');
        subscription.unsubscribe();
        done();
      });

      service.logRecipientRejected('bad@test.com');
    });

    it('uses unknown for empty address', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.text).toContain('RCPT TO: unknown rejected');
        subscription.unsubscribe();
        done();
      });

      service.logRecipientRejected('');
    });
  });

  describe('logRateLimitExceeded', () => {
    it('logs rate limit with IP', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.type).toBe('warning');
        expect(message.text).toContain('Rate limit exceeded for IP 5.6.7.8');
        subscription.unsubscribe();
        done();
      });

      service.logRateLimitExceeded('5.6.7.8');
    });

    it('uses unknown for missing IP', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.text).toContain('Rate limit exceeded for IP unknown');
        subscription.unsubscribe();
        done();
      });

      service.logRateLimitExceeded();
    });
  });

  describe('logEmailReceived', () => {
    it('logs success when no validation failures', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.type).toBe('success');
        expect(message.text).toContain('Email received from sender@test.com');
        expect(message.text).toContain('SPF: pass');
        expect(message.text).toContain('DKIM: pass');
        expect(message.text).toContain('DMARC: pass');
        subscription.unsubscribe();
        done();
      });

      service.logEmailReceived('sender@test.com', ['rcpt@test.com'], 'pass', 'pass', 'pass');
    });

    it('logs warning when SPF fails', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.type).toBe('warning');
        subscription.unsubscribe();
        done();
      });

      service.logEmailReceived('sender@test.com', ['rcpt@test.com'], 'fail', 'pass', 'pass');
    });

    it('logs warning on softfail', (done) => {
      const service = new SseConsoleService(configService);
      const subscription = service.getStream().subscribe((message) => {
        expect(message.type).toBe('warning');
        subscription.unsubscribe();
        done();
      });

      service.logEmailReceived('sender@test.com', ['rcpt@test.com'], 'pass', 'softfail', 'pass');
    });
  });
});
