import { promises as dns } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spf } from 'mailauth/lib/spf';
import { dmarc } from 'mailauth/lib/dmarc';
import { dkimVerify } from 'mailauth/lib/dkim/verify';

import type { SpfResult, DkimResult, DmarcResult, ReverseDnsResult } from './interfaces/email-session.interface';
import type {
  MailauthStatusObject,
  MailauthSpfResult,
  MailauthDkimResult,
  MailauthDmarcResult,
} from './interfaces/mailauth-types.interface';
import { DNS_TIMEOUTS } from './constants/validation.constants';
import type { Inbox } from '../inbox/interfaces';

interface EmailAuthConfig {
  enabled: boolean;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  reverseDns: boolean;
}

/**
 * Service responsible for email authentication and validation
 *
 * Handles SPF (Sender Policy Framework), DKIM (DomainKeys Identified Mail),
 * DMARC (Domain-based Message Authentication), and reverse DNS validation
 * for incoming SMTP messages.
 *
 * @class EmailValidationService
 */
@Injectable()
export class EmailValidationService {
  private readonly logger = new Logger(EmailValidationService.name);
  private readonly emailAuthConfig: EmailAuthConfig;

  /* v8 ignore next - false positive on constructor parameter property */
  constructor(private readonly configService: ConfigService) {
    this.emailAuthConfig = {
      enabled: this.configService.get<boolean>('vsb.emailAuth.enabled', true),
      spf: this.configService.get<boolean>('vsb.emailAuth.spf', true),
      dkim: this.configService.get<boolean>('vsb.emailAuth.dkim', true),
      dmarc: this.configService.get<boolean>('vsb.emailAuth.dmarc', true),
      reverseDns: this.configService.get<boolean>('vsb.emailAuth.reverseDns', true),
    };
  }

  /**
   * Check if SPF validation is enabled based on global config and inbox settings
   */
  private isSpfEnabled(inbox?: Inbox): boolean {
    /* v8 ignore next - global config toggle, tested via integration */
    if (!this.emailAuthConfig.enabled) return false;
    if (inbox && !inbox.emailAuth) return false;
    return this.emailAuthConfig.spf;
  }

  /**
   * Check if DKIM validation is enabled based on global config and inbox settings
   */
  private isDkimEnabled(inbox?: Inbox): boolean {
    /* v8 ignore next - global config toggle, tested via integration */
    if (!this.emailAuthConfig.enabled) return false;
    if (inbox && !inbox.emailAuth) return false;
    return this.emailAuthConfig.dkim;
  }

  /**
   * Check if DMARC validation is enabled based on global config and inbox settings
   */
  private isDmarcEnabled(inbox?: Inbox): boolean {
    /* v8 ignore next - global config toggle, tested via integration */
    if (!this.emailAuthConfig.enabled) return false;
    if (inbox && !inbox.emailAuth) return false;
    return this.emailAuthConfig.dmarc;
  }

  /**
   * Check if Reverse DNS validation is enabled based on global config and inbox settings
   */
  private isReverseDnsEnabled(inbox?: Inbox): boolean {
    /* v8 ignore next - global config toggle, tested via integration */
    if (!this.emailAuthConfig.enabled) return false;
    if (inbox && !inbox.emailAuth) return false;
    return this.emailAuthConfig.reverseDns;
  }

  /**
   * Verifies SPF (Sender Policy Framework) record for a sender domain
   *
   * SPF validates whether the sending server's IP address is authorized
   * to send email for the sender's domain by checking the domain's SPF
   * DNS record.
   *
   * @param domain - The sender's domain to validate
   * @param remoteIp - The IP address of the sending server
   * @param senderAddress - The complete sender email address
   * @param sessionId - SMTP session ID for logging purposes
   * @param inbox - Optional inbox for per-inbox email auth settings
   * @returns Promise resolving to SPF validation result
   *
   * @example
   * ```typescript
   * const result = await emailValidationService.verifySpf(
   *   'example.com',
   *   '192.0.2.1',
   *   'sender@example.com',
   *   'session-123'
   * );
   * console.log(result.status); // 'pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'skipped'
   * ```
   */
  async verifySpf(
    domain: string | undefined,
    remoteIp: string | undefined,
    senderAddress: string,
    sessionId: string,
    inbox?: Inbox,
  ): Promise<SpfResult> {
    // Check if SPF validation is enabled
    if (!this.isSpfEnabled(inbox)) {
      this.logger.log(`SPF check (session=${sessionId}): SKIPPED - SPF validation disabled`);
      return {
        status: 'skipped',
        domain,
        ip: remoteIp,
        info: 'SPF check disabled',
      };
    }
    const timeoutMs = DNS_TIMEOUTS.SPF_TIMEOUT_MS;
    const defaultResult: SpfResult = {
      status: 'none',
      domain,
      ip: remoteIp,
      info: 'SPF check skipped',
    };

    if (!domain || !remoteIp) {
      return defaultResult;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const spfPromise = spf({ ip: remoteIp, sender: senderAddress }) as Promise<unknown>;
      const rawResult: unknown = await this.resolveWithTimeout(
        spfPromise,
        timeoutMs,
        `SPF lookup timed out after ${timeoutMs}ms`,
      );
      const result = rawResult as MailauthSpfResult;

      // mailauth returns status as an object: { result: 'pass'|'fail'|'softfail'|'neutral'|'none'|'temperror'|'permerror' }
      const statusObj = typeof result.status === 'object' ? result.status : undefined;
      const statusValue = (statusObj?.result || 'none') as SpfResult['status'];

      const spfResult: SpfResult = {
        status: statusValue,
        domain,
        ip: remoteIp,
        info: result.info || statusObj?.comment || this.statusToString(result.status),
      };

      this.logger.log(
        `SPF check (session=${sessionId}): ${spfResult.status.toUpperCase()} for domain '${domain}' from IP '${remoteIp}' - ${spfResult.info}`,
      );

      return spfResult;
    } catch (error) {
      /* v8 ignore next - defensive for non-Error exceptions */
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SPF check failed (session=${sessionId}): ${message}`);

      return {
        status: 'temperror',
        domain,
        ip: remoteIp,
        info: message.includes('timed out') ? `DNS lookup timed out after ${timeoutMs}ms` : message,
      };
    }
  }

  /**
   * Verifies DKIM signatures in an email message
   *
   * Parses DKIM-Signature headers and validates each signature against
   * the public key published in DNS. Multiple signatures are supported
   * as emails can be signed by multiple domains.
   *
   * @param rawData - The complete raw email message including headers
   * @param sessionId - Session ID for logging purposes
   * @param inbox - Optional inbox for per-inbox email auth settings
   * @returns Promise resolving to array of DKIM validation results (one per signature)
   *
   * @example
   * ```typescript
   * const results = await emailValidationService.verifyDkim(emailBuffer, 'session-123');
   * results.forEach(result => {
   *   console.log(`${result.domain}: ${result.status}`);
   * });
   * ```
   */
  async verifyDkim(rawData: Buffer, sessionId: string, inbox?: Inbox): Promise<DkimResult[]> {
    // Check if DKIM validation is enabled
    if (!this.isDkimEnabled(inbox)) {
      this.logger.log(`DKIM check (session=${sessionId}): SKIPPED - DKIM validation disabled`);
      return [
        {
          status: 'skipped',
          info: 'DKIM check disabled',
        },
      ];
    }

    const results: DkimResult[] = [];
    const timeoutMs = DNS_TIMEOUTS.DKIM_TIMEOUT_MS;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const dkimPromise = dkimVerify(rawData) as Promise<unknown>;
      const rawDkimResult: unknown = await this.resolveWithTimeout(
        dkimPromise,
        timeoutMs,
        `DKIM verification timed out after ${timeoutMs}ms`,
      );
      const dkimResult = rawDkimResult as MailauthDkimResult | undefined;

      if (!dkimResult || !dkimResult.results || dkimResult.results.length === 0) {
        this.logger.log(`DKIM check (session=${sessionId}): No DKIM signatures found`);
        return [
          {
            status: 'none',
            info: 'No DKIM signatures found in email',
          },
        ];
      }

      for (const result of dkimResult.results) {
        // mailauth returns status as an object: { result: 'pass'|'fail'|'neutral', comment: '...' }
        const statusObj = typeof result.status === 'object' ? result.status : undefined;
        const statusValue = (statusObj?.result || 'none').toLowerCase();

        const dkimInfo: DkimResult = {
          status: statusValue === 'pass' ? 'pass' : statusValue === 'fail' ? 'fail' : 'none',
          domain: result.signingDomain || result.domain,
          selector: result.selector,
          info: result.info || statusObj?.comment || this.statusToString(result.status),
        };

        results.push(dkimInfo);

        const statusText = dkimInfo.status.toUpperCase();
        this.logger.log(
          `DKIM check (session=${sessionId}): ${statusText} for domain '${dkimInfo.domain}' selector '${dkimInfo.selector}' - ${dkimInfo.info}`,
        );
      }
    } catch (error) {
      /* v8 ignore next - defensive for non-Error exceptions */
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DKIM verification error (session=${sessionId}): ${message}`);
      results.push({
        status: 'none',
        info: message.includes('timed out') ? `DNS lookup timed out after ${timeoutMs}ms` : message,
      });
    }

    return results;
  }

  /**
   * Verifies DMARC policy for an email message
   *
   * DMARC builds on SPF and DKIM to provide sender domain authentication.
   * It checks whether SPF/DKIM results align with the From header domain
   * and evaluates the domain's DMARC policy.
   *
   * @param headers - Parsed email headers (must include 'from' header)
   * @param spfResult - SPF validation result from verifySpf()
   * @param dkimResults - DKIM validation results from verifyDkim()
   * @param sessionId - Session ID for logging purposes
   * @param inbox - Optional inbox for per-inbox email auth settings
   * @returns Promise resolving to DMARC validation result
   *
   * @example
   * ```typescript
   * const dmarcResult = await emailValidationService.verifyDmarc(
   *   headers,
   *   spfResult,
   *   dkimResults,
   *   'session-123'
   * );
   * console.log(`DMARC: ${dmarcResult.status}, Policy: ${dmarcResult.policy}`);
   * ```
   */
  async verifyDmarc(
    headers: Record<string, string>,
    spfResult: SpfResult | undefined,
    dkimResults: DkimResult[] | undefined,
    sessionId: string,
    inbox?: Inbox,
  ): Promise<DmarcResult> {
    // Check if DMARC validation is enabled
    if (!this.isDmarcEnabled(inbox)) {
      this.logger.log(`DMARC check (session=${sessionId}): SKIPPED - DMARC validation disabled`);
      return {
        status: 'skipped',
        info: 'DMARC check disabled',
      };
    }

    let headerFrom = headers['from'];
    const timeoutMs = DNS_TIMEOUTS.DMARC_TIMEOUT_MS;

    if (!headerFrom) {
      this.logger.log(`DMARC check (session=${sessionId}): NONE - No From header present`);
      return {
        status: 'none',
        info: 'No From header present in message',
      };
    }

    // Clean up the From header - extract email from "Name <email@domain.com>" format
    const emailMatch = headerFrom.match(/<([^>]+)>/);
    if (emailMatch) {
      headerFrom = emailMatch[1];
    }
    headerFrom = headerFrom.trim();

    const spfDomains = spfResult && spfResult.status === 'pass' && spfResult.domain ? [spfResult.domain] : [];
    const dkimDomains = (dkimResults ?? [])
      .filter((result) => result.status === 'pass' && !!result.domain)
      .map((result) => ({ domain: result.domain!.toLowerCase() }));

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const dmarcPromise = dmarc({
        headerFrom,
        spfDomains,
        dkimDomains,
      }) as Promise<unknown>;
      const rawEvaluation: unknown = await this.resolveWithTimeout(
        dmarcPromise,
        timeoutMs,
        `DMARC lookup timed out after ${timeoutMs}ms`,
      );
      const evaluation = rawEvaluation as MailauthDmarcResult | undefined;

      if (!evaluation) {
        const info = 'Unable to evaluate DMARC policy';
        this.logger.warn(`DMARC validation failed (session=${sessionId}): ${info}`);
        return {
          status: 'fail',
          info,
        };
      }

      const statusObj = typeof evaluation.status === 'object' ? evaluation.status : undefined;
      const evaluationStatus = (statusObj?.result || 'none').toLowerCase();
      let status: DmarcResult['status'];
      switch (evaluationStatus) {
        case 'pass':
          status = 'pass';
          break;
        case 'fail':
          status = 'fail';
          break;
        default:
          status = 'none';
          break;
      }

      const policy = this.normalizeDmarcPolicy(evaluation.policy || evaluation.p);
      const aligned = Boolean(evaluation.alignment?.spf?.result || evaluation.alignment?.dkim?.result);
      const info = evaluation.info || statusObj?.comment || undefined;
      const domain = evaluation.domain?.toLowerCase();

      const dmarcResult: DmarcResult = {
        status,
        policy,
        aligned,
        domain,
        info,
      };

      if (status === 'pass') {
        this.logger.log(
          `DMARC check (session=${sessionId}): PASS for domain='${domain ?? 'unknown'}' policy=${policy ?? 'none'} aligned=${aligned}`,
        );
      } else if (status === 'fail') {
        this.logger.warn(
          `DMARC validation failed (session=${sessionId}): domain=${domain ?? 'unknown'} policy=${policy ?? 'none'} aligned=${aligned} - ${info ?? 'Alignment failure'}`,
        );
      } else {
        this.logger.log(
          `DMARC check (session=${sessionId}): NONE for domain='${domain ?? 'unknown'}' - ${info ?? 'No DMARC policy'}`,
        );
      }

      return dmarcResult;
    } catch (error) {
      /* v8 ignore next - defensive for non-Error exceptions */
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DMARC verification error (session=${sessionId}): ${message}`);
      return {
        status: 'none',
        info: message.includes('timed out') ? `DNS lookup timed out after ${timeoutMs}ms` : message,
      };
    }
  }

  /**
   * Verifies reverse DNS (PTR record) for a connecting IP address
   *
   * Performs reverse DNS lookup to find the hostname associated with the IP,
   * then validates that the hostname resolves back to the same IP address.
   * This helps detect IP address spoofing.
   *
   * @param remoteIp - The IP address to validate
   * @param sessionId - Session ID for logging purposes
   * @param inbox - Optional inbox for per-inbox email auth settings
   * @returns Promise resolving to reverse DNS validation result
   *
   * @example
   * ```typescript
   * const result = await emailValidationService.verifyReverseDns('192.0.2.1', 'session-123');
   * console.log(`PTR: ${result.status}, Hostname: ${result.hostname}`);
   * ```
   */
  async verifyReverseDns(remoteIp: string | undefined, sessionId: string, inbox?: Inbox): Promise<ReverseDnsResult> {
    // Check if Reverse DNS validation is enabled
    if (!this.isReverseDnsEnabled(inbox)) {
      this.logger.log(`Reverse DNS check (session=${sessionId}): SKIPPED - Reverse DNS validation disabled`);
      return {
        status: 'skipped',
        ip: remoteIp,
        info: 'Reverse DNS check disabled',
      };
    }

    if (!remoteIp) {
      return {
        status: 'none',
        info: 'No remote IP address available for reverse DNS lookup',
      };
    }

    const timeoutMs = DNS_TIMEOUTS.REVERSE_DNS_TIMEOUT_MS;

    try {
      const hostnames = await this.resolveWithTimeout<string[]>(
        dns.reverse(remoteIp),
        timeoutMs,
        'Reverse DNS lookup timed out',
      );

      if (!hostnames || hostnames.length === 0) {
        this.logger.warn(`Reverse DNS check (session=${sessionId}): FAIL ip='${remoteIp}' - No PTR record found`);
        return {
          status: 'fail',
          ip: remoteIp,
          info: 'No PTR record found for remote IP',
        };
      }

      for (const hostname of hostnames) {
        const normalizedHostname = hostname.toLowerCase();
        try {
          const forwardLookups = await this.resolveWithTimeout<LookupAddress[]>(
            dns.lookup(normalizedHostname, { all: true }),
            timeoutMs,
            'Forward DNS lookup timed out',
          );

          const matches = forwardLookups.some((address) => address.address === remoteIp);

          if (matches) {
            this.logger.log(
              `Reverse DNS check (session=${sessionId}): PASS ip='${remoteIp}' hostname='${normalizedHostname}'`,
            );
            return {
              status: 'pass',
              ip: remoteIp,
              hostname: normalizedHostname,
              info: 'PTR hostname resolves back to originating IP',
            };
          }
        } catch (error) {
          /* v8 ignore next 2 - defensive for non-Error exceptions */
          this.logger.debug(
            `Forward lookup error (session=${sessionId}) for hostname='${normalizedHostname}': ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.warn(
        `Reverse DNS check (session=${sessionId}): FAIL ip='${remoteIp}' - PTR hostname does not resolve to the same IP`,
      );
      return {
        status: 'fail',
        ip: remoteIp,
        hostname: hostnames[0]?.toLowerCase(),
        info: 'PTR hostname does not resolve back to originating IP',
      };
    } catch (error) {
      const errorObj = error as NodeJS.ErrnoException;
      const message = errorObj?.message ?? String(error);
      const code = errorObj?.code;

      if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
        this.logger.warn(`Reverse DNS check (session=${sessionId}): FAIL ip='${remoteIp}' - No PTR record (${code})`);
        return {
          status: 'fail',
          ip: remoteIp,
          info: 'No PTR record found for remote IP',
        };
      }

      this.logger.warn(`Reverse DNS check (session=${sessionId}): ERROR ip='${remoteIp}' - ${message}`);

      return {
        status: 'fail',
        ip: remoteIp,
        info: message,
      };
    }
  }

  /**
   * Logs comprehensive validation results for an email
   *
   * Outputs a summary of all validation checks (SPF, DKIM, DMARC, reverse DNS)
   * with appropriate log levels based on the results.
   *
   * @param sessionId - Session ID for log correlation
   * @param spfResult - SPF validation result
   * @param dkimResults - Array of DKIM validation results
   * @param dmarcResult - DMARC validation result
   * @param reverseDnsResult - Reverse DNS validation result
   *
   * @example
   * ```typescript
   * emailValidationService.logValidationResults(
   *   'session-123',
   *   spfResult,
   *   dkimResults,
   *   dmarcResult,
   *   reverseDnsResult
   * );
   * ```
   */
  logValidationResults(
    sessionId: string,
    spfResult?: SpfResult,
    dkimResults?: DkimResult[],
    dmarcResult?: DmarcResult,
    reverseDnsResult?: ReverseDnsResult,
  ): void {
    const spfStatus = spfResult ? `SPF=${spfResult.status.toUpperCase()}` : 'SPF=none';
    const dkimStatus =
      dkimResults && dkimResults.length > 0
        ? `DKIM=${dkimResults.map((r) => r.status.toUpperCase()).join(',')}`
        : 'DKIM=none';
    const dmarcStatus = dmarcResult
      ? `DMARC=${dmarcResult.status.toUpperCase()}${dmarcResult.policy ? `(policy=${dmarcResult.policy})` : ''}`
      : 'DMARC=none';
    const reverseDnsStatus = reverseDnsResult
      ? `PTR=${reverseDnsResult.status.toUpperCase()}${reverseDnsResult.hostname ? `(${reverseDnsResult.hostname})` : ''}`
      : 'PTR=none';

    this.logger.log(
      `Validation results (session=${sessionId}): [${spfStatus}, ${dkimStatus}, ${dmarcStatus}, ${reverseDnsStatus}]`,
    );

    if (spfResult && spfResult.status !== 'pass') {
      this.logger.warn(`SPF validation warning (session=${sessionId}): ${spfResult.status} - ${spfResult.info}`);
    }

    if (dkimResults) {
      for (const dkim of dkimResults) {
        if (dkim.status === 'fail') {
          this.logger.warn(
            `DKIM validation failed (session=${sessionId}): domain=${dkim.domain}, selector=${dkim.selector} - ${dkim.info}`,
          );
        } else if (dkim.status === 'pass') {
          this.logger.log(
            `DKIM validation passed (session=${sessionId}): domain=${dkim.domain}, selector=${dkim.selector}`,
          );
        }
      }
    }

    if (reverseDnsResult && reverseDnsResult.status === 'fail') {
      this.logger.warn(
        `Reverse DNS validation failed (session=${sessionId}): ip=${reverseDnsResult.ip} hostname=${reverseDnsResult.hostname ?? 'n/a'} - ${reverseDnsResult.info ?? 'No additional details'}`,
      );
    }
  }

  /**
   * Converts mailauth status objects to strings safely
   *
   * Mailauth library returns status as either a string or an object with result/comment.
   * This helper normalizes both formats to a simple string.
   *
   * @param status - The status object or string from mailauth
   * @returns Normalized status string
   * @private
   */
  private statusToString(status: MailauthStatusObject | string | undefined): string {
    if (typeof status === 'string') {
      return status;
    }
    if (status && typeof status === 'object') {
      return status.result || status.comment || 'unknown';
    }
    return 'unknown';
  }

  /**
   * Normalizes DMARC policy values
   *
   * Converts various DMARC policy formats to the standard set of values.
   *
   * @param policy - Raw policy string from DMARC record
   * @returns Normalized policy value ('none', 'quarantine', 'reject') or undefined
   * @private
   */
  private normalizeDmarcPolicy(policy?: string): DmarcResult['policy'] | undefined {
    if (!policy) {
      return undefined;
    }

    const normalized = policy.toLowerCase();
    return ['none', 'quarantine', 'reject'].includes(normalized) ? (normalized as DmarcResult['policy']) : undefined;
  }

  /**
   * Resolves a promise with a timeout
   *
   * Wraps a promise with a timeout to prevent indefinite waiting on DNS lookups.
   * If the promise doesn't resolve within the timeout period, it rejects with
   * the provided timeout message.
   *
   * @param promise - The promise to wrap
   * @param timeoutMs - Timeout in milliseconds
   * @param timeoutMessage - Error message to use when timeout occurs
   * @returns Promise that rejects if timeout is exceeded
   * @private
   */
  private async resolveWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
