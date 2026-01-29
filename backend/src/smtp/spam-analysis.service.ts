import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';

import type { SpamAnalysisResult, SpamSymbol } from './interfaces/email-session.interface';
import type { RspamdCheckResponse, RspamdSymbol } from './interfaces/rspamd.interface';
import type { Inbox } from '../inbox/interfaces';
import { getErrorMessage } from '../shared/error.utils';

interface SpamAnalysisConfig {
  enabled: boolean;
  rspamd: {
    url: string;
    timeoutMs: number;
    password?: string;
  };
  inboxDefault: boolean;
}

@Injectable()
export class SpamAnalysisService {
  private readonly logger = new Logger(SpamAnalysisService.name);
  private readonly config: SpamAnalysisConfig;

  /* v8 ignore next 4 - false positive on constructor parameter properties */
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.config = {
      enabled: this.configService.get<boolean>('vsb.spamAnalysis.enabled', false),
      rspamd: {
        url: this.configService.get<string>('vsb.spamAnalysis.rspamd.url', 'http://localhost:11333'),
        timeoutMs: this.configService.get<number>('vsb.spamAnalysis.rspamd.timeoutMs', 5000),
        password: this.configService.get<string>('vsb.spamAnalysis.rspamd.password'),
      },
      inboxDefault: this.configService.get<boolean>('vsb.spamAnalysis.inboxDefault', true),
    };
  }

  /**
   * Check if spam analysis is enabled based on global config and inbox settings
   */
  private isEnabled(inbox?: Inbox): boolean {
    if (!this.config.enabled) return false;
    if (inbox && inbox.spamAnalysis === false) return false;
    return true;
  }

  /**
   * Analyze an email for spam using Rspamd
   *
   * @param rawData - Complete raw email message
   * @param sessionId - SMTP session ID for logging
   * @param inbox - Optional inbox for per-inbox settings
   * @returns Spam analysis result
   */
  async analyzeEmail(rawData: Buffer, sessionId: string, inbox?: Inbox): Promise<SpamAnalysisResult> {
    // Check if spam analysis is enabled
    if (!this.isEnabled(inbox)) {
      this.logger.log(`Spam analysis (session=${sessionId}): SKIPPED - disabled`);
      return {
        status: 'skipped',
        info: 'Spam analysis disabled',
      };
    }

    const startTime = Date.now();
    const checkUrl = `${this.config.rspamd.url}/checkv2`;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'message/rfc822',
      };

      // Add password header if configured
      if (this.config.rspamd.password) {
        headers['Password'] = this.config.rspamd.password;
      }

      const response = await firstValueFrom(
        this.httpService
          .post<RspamdCheckResponse>(checkUrl, rawData, { headers })
          .pipe(timeout(this.config.rspamd.timeoutMs)),
      );

      const data = response.data;
      const processingTimeMs = Date.now() - startTime;

      // Convert symbols object to array format
      const symbols = this.extractSymbols(data.symbols);

      const result: SpamAnalysisResult = {
        status: 'analyzed',
        score: data.score,
        requiredScore: data.required_score,
        action: this.normalizeAction(data.action),
        isSpam: data.is_spam ?? data.score >= data.required_score,
        symbols,
        processingTimeMs,
      };

      this.logger.log(
        `Spam analysis (session=${sessionId}): score=${result.score?.toFixed(2)} ` +
          `required=${result.requiredScore?.toFixed(2)} action=${result.action} ` +
          `symbols=${symbols.length} time=${processingTimeMs}ms`,
      );

      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      const processingTimeMs = Date.now() - startTime;

      this.logger.warn(`Spam analysis error (session=${sessionId}): ${message} (after ${processingTimeMs}ms)`);

      return {
        status: 'error',
        processingTimeMs,
        info: message.includes('timeout')
          ? `Rspamd request timed out after ${this.config.rspamd.timeoutMs}ms`
          : `Rspamd analysis failed: ${message}`,
      };
    }
  }

  /**
   * Extract and format symbols from Rspamd response
   */
  private extractSymbols(symbols: Record<string, RspamdSymbol> | undefined): SpamSymbol[] {
    if (!symbols) return [];

    return Object.entries(symbols).map(([name, symbol]) => ({
      name,
      score: symbol.score,
      description: symbol.description,
      options: symbol.options,
    }));
  }

  /**
   * Normalize Rspamd action string to our enum
   */
  private normalizeAction(action: string): SpamAnalysisResult['action'] {
    const normalized = action.toLowerCase().replace(/\s+/g, ' ').trim();
    const validActions: SpamAnalysisResult['action'][] = [
      'no action',
      'greylist',
      'add header',
      'rewrite subject',
      'soft reject',
      'reject',
    ];
    return validActions.includes(normalized as SpamAnalysisResult['action'])
      ? (normalized as SpamAnalysisResult['action'])
      : 'no action';
  }
}
