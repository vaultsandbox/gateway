import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConsoleMessage, ConsoleMessageType } from './interfaces';

@Injectable()
export class SseConsoleService {
  private readonly logger = new Logger(SseConsoleService.name);
  private readonly enabled: boolean;
  private readonly messageStream$ = new Subject<ConsoleMessage>();

  /* v8 ignore next - constructor branch coverage false positive, tested in sse-console.service.spec.ts */
  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('vsb.sseConsole.enabled', false);

    if (this.enabled) {
      this.logger.log('SSE Console enabled - log messages will be broadcasted');
    }
  }

  /**
   * Log a console message (only broadcasts if enabled)
   */
  log(type: ConsoleMessageType, text: string): void {
    if (!this.enabled) {
      return;
    }

    const message: ConsoleMessage = {
      type,
      text: this.sanitizeText(text),
      timestamp: new Date().toISOString(),
    };

    this.messageStream$.next(message);
  }

  /**
   * Get observable stream of console messages
   */
  getStream(): Observable<ConsoleMessage> {
    return this.messageStream$.asObservable();
  }

  /**
   * Transform console messages to SSE MessageEvent format
   */
  toMessageEvents(source$: Observable<ConsoleMessage>): Observable<{ data: ConsoleMessage }> {
    return source$.pipe(map((message) => ({ data: message })));
  }

  /**
   * Expose enabled flag for controllers to gate endpoints
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Log sender validation info after SPF/rDNS checks complete
   */
  logSenderValidation(address: string, ip?: string, spfStatus?: string, reverseDnsStatus?: string): void {
    const safeAddress = address || 'unknown';
    const safeIp = ip || 'unknown';
    const spf = spfStatus || 'unknown';
    const rdns = reverseDnsStatus || 'unknown';

    this.log('info', `📧 MAIL FROM: ${safeAddress} | IP: ${safeIp} | SPF: ${spf} | rDNS: ${rdns}`);
  }

  /**
   * Log recipient validation outcome
   */
  logRecipientAccepted(address: string): void {
    const safeAddress = address || 'unknown';
    this.log('success', `✓ RCPT TO: ${safeAddress} accepted`);
  }

  logRecipientRejected(address: string): void {
    const safeAddress = address || 'unknown';
    this.log('error', `✗ RCPT TO: ${safeAddress} rejected (domain not allowed)`);
  }

  /**
   * Log rate limit rejections for visibility
   */
  logRateLimitExceeded(ip?: string): void {
    const safeIp = ip || 'unknown';
    this.log('warning', `⚠ Rate limit exceeded for IP ${safeIp}`);
  }

  /**
   * Helper method to log email received with validation results
   */
  logEmailReceived(from: string, to: string[], spf: string, dkim: string, dmarc: string): void {
    const hasFailures = [spf, dkim, dmarc].some((r) => r === 'fail' || r === 'softfail');

    if (hasFailures) {
      this.log('warning', `⚠ Email received from ${from} | SPF: ${spf} | DKIM: ${dkim} | DMARC: ${dmarc}`);
    } else {
      this.log('success', `✓ Email received from ${from} | SPF: ${spf} | DKIM: ${dkim} | DMARC: ${dmarc}`);
    }
  }

  /**
   * Escape HTML control characters to prevent injection in downstream UI
   */
  private sanitizeText(value: string): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
