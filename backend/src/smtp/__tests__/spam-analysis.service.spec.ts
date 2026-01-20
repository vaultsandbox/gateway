import { SpamAnalysisService } from '../spam-analysis.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';
import type { RspamdCheckResponse } from '../interfaces/rspamd.interface';

describe('SpamAnalysisService', () => {
  let service: SpamAnalysisService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockHttpService: jest.Mocked<HttpService>;

  const createMockConfigService = (enabled: boolean = true) => {
    return {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          'vsb.spamAnalysis.enabled': enabled,
          'vsb.spamAnalysis.rspamd.url': 'http://localhost:11333',
          'vsb.spamAnalysis.rspamd.timeoutMs': 5000,
          'vsb.spamAnalysis.rspamd.password': undefined,
          'vsb.spamAnalysis.inboxDefault': true,
        };
        return values[key] ?? defaultValue;
      }),
    } as unknown as jest.Mocked<ConfigService>;
  };

  const createMockHttpService = () => {
    return {
      post: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService = createMockConfigService(true);
    mockHttpService = createMockHttpService();
    service = new SpamAnalysisService(mockConfigService, mockHttpService);
    logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('analyzeEmail - disabled paths', () => {
    it('returns skipped when spam analysis is disabled globally', async () => {
      mockConfigService = createMockConfigService(false);
      service = new SpamAnalysisService(mockConfigService, mockHttpService);
      logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-1');

      expect(result).toEqual({
        status: 'skipped',
        info: 'Spam analysis disabled',
      });
      expect(logSpy).toHaveBeenCalledWith('Spam analysis (session=session-1): SKIPPED - disabled');
      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('returns skipped when inbox has spamAnalysis disabled', async () => {
      const inbox = { spamAnalysis: false } as { spamAnalysis: boolean };

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-2', inbox);

      expect(result).toEqual({
        status: 'skipped',
        info: 'Spam analysis disabled',
      });
      expect(logSpy).toHaveBeenCalledWith('Spam analysis (session=session-2): SKIPPED - disabled');
      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('proceeds when inbox has spamAnalysis enabled', async () => {
      const inbox = { spamAnalysis: true } as { spamAnalysis: boolean };
      const rspamdResponse: RspamdCheckResponse = {
        score: 1.5,
        required_score: 5.0,
        action: 'no action',
        symbols: {},
      };
      mockHttpService.post.mockReturnValue(of({ data: rspamdResponse } as AxiosResponse<RspamdCheckResponse>));

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-3', inbox);

      expect(result.status).toBe('analyzed');
      expect(mockHttpService.post).toHaveBeenCalled();
    });

    it('proceeds when inbox is undefined', async () => {
      const rspamdResponse: RspamdCheckResponse = {
        score: 1.5,
        required_score: 5.0,
        action: 'no action',
        symbols: {},
      };
      mockHttpService.post.mockReturnValue(of({ data: rspamdResponse } as AxiosResponse<RspamdCheckResponse>));

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-4');

      expect(result.status).toBe('analyzed');
      expect(mockHttpService.post).toHaveBeenCalled();
    });
  });

  describe('analyzeEmail - success paths', () => {
    it('analyzes email and returns result with all fields', async () => {
      const rspamdResponse: RspamdCheckResponse = {
        score: 7.5,
        required_score: 5.0,
        action: 'add header',
        is_spam: true,
        symbols: {
          SPAM_RULE: {
            name: 'SPAM_RULE',
            score: 5.0,
            description: 'Spam indicator',
            options: ['opt1'],
          },
          OTHER_RULE: {
            name: 'OTHER_RULE',
            score: 2.5,
            description: 'Another rule',
          },
        },
      };
      mockHttpService.post.mockReturnValue(of({ data: rspamdResponse } as AxiosResponse<RspamdCheckResponse>));

      const result = await service.analyzeEmail(Buffer.from('email content'), 'session-5');

      expect(result).toMatchObject({
        status: 'analyzed',
        score: 7.5,
        requiredScore: 5.0,
        action: 'add header',
        isSpam: true,
      });
      expect(result.symbols).toHaveLength(2);
      expect(result.symbols).toContainEqual({
        name: 'SPAM_RULE',
        score: 5.0,
        description: 'Spam indicator',
        options: ['opt1'],
      });
      expect(result.processingTimeMs).toBeDefined();
      expect(mockHttpService.post).toHaveBeenCalledWith('http://localhost:11333/checkv2', expect.any(Buffer), {
        headers: { 'Content-Type': 'message/rfc822' },
      });
    });

    it('calculates isSpam from score when is_spam not provided', async () => {
      const rspamdResponse: RspamdCheckResponse = {
        score: 6.0,
        required_score: 5.0,
        action: 'add header',
        symbols: {},
      };
      mockHttpService.post.mockReturnValue(of({ data: rspamdResponse } as AxiosResponse<RspamdCheckResponse>));

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-6');

      expect(result.isSpam).toBe(true);
    });

    it('calculates isSpam as false when score below threshold', async () => {
      const rspamdResponse: RspamdCheckResponse = {
        score: 2.0,
        required_score: 5.0,
        action: 'no action',
        symbols: {},
      };
      mockHttpService.post.mockReturnValue(of({ data: rspamdResponse } as AxiosResponse<RspamdCheckResponse>));

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-7');

      expect(result.isSpam).toBe(false);
    });

    it('includes password header when configured', async () => {
      mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const values: Record<string, unknown> = {
            'vsb.spamAnalysis.enabled': true,
            'vsb.spamAnalysis.rspamd.url': 'http://localhost:11333',
            'vsb.spamAnalysis.rspamd.timeoutMs': 5000,
            'vsb.spamAnalysis.rspamd.password': 'secret-password',
            'vsb.spamAnalysis.inboxDefault': true,
          };
          return values[key];
        }),
      } as unknown as jest.Mocked<ConfigService>;
      service = new SpamAnalysisService(mockConfigService, mockHttpService);
      logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

      const rspamdResponse: RspamdCheckResponse = {
        score: 1.0,
        required_score: 5.0,
        action: 'no action',
        symbols: {},
      };
      mockHttpService.post.mockReturnValue(of({ data: rspamdResponse } as AxiosResponse<RspamdCheckResponse>));

      await service.analyzeEmail(Buffer.from('test'), 'session-8');

      expect(mockHttpService.post).toHaveBeenCalledWith('http://localhost:11333/checkv2', expect.any(Buffer), {
        headers: {
          'Content-Type': 'message/rfc822',
          Password: 'secret-password',
        },
      });
    });

    it('logs analysis result with formatted values', async () => {
      const rspamdResponse: RspamdCheckResponse = {
        score: 3.5,
        required_score: 5.0,
        action: 'no action',
        symbols: { RULE1: { name: 'RULE1', score: 1.0 }, RULE2: { name: 'RULE2', score: 2.5 } },
      };
      mockHttpService.post.mockReturnValue(of({ data: rspamdResponse } as AxiosResponse<RspamdCheckResponse>));

      await service.analyzeEmail(Buffer.from('test'), 'session-9');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /Spam analysis \(session=session-9\): score=3\.50 required=5\.00 action=no action symbols=2 time=\d+ms/,
        ),
      );
    });
  });

  describe('analyzeEmail - error paths', () => {
    it('returns error result when HTTP request fails', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => new Error('Connection refused')));

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-10');

      expect(result).toMatchObject({
        status: 'error',
        info: 'Rspamd analysis failed: Connection refused',
      });
      expect(result.processingTimeMs).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Spam analysis error \(session=session-10\): Connection refused/),
      );
    });

    it('returns timeout-specific message when request times out', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => new Error('timeout exceeded')));

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-11');

      expect(result).toMatchObject({
        status: 'error',
        info: 'Rspamd request timed out after 5000ms',
      });
    });

    it('handles non-Error exceptions', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => 'string error'));

      const result = await service.analyzeEmail(Buffer.from('test'), 'session-12');

      expect(result).toMatchObject({
        status: 'error',
        info: 'Rspamd analysis failed: string error',
      });
    });
  });

  describe('extractSymbols', () => {
    it('returns empty array when symbols is undefined', () => {
      const extractSymbols = (
        service as unknown as { extractSymbols: (symbols?: unknown) => unknown[] }
      ).extractSymbols.bind(service);

      expect(extractSymbols(undefined)).toEqual([]);
    });

    it('converts symbols object to array format', () => {
      const extractSymbols = (
        service as unknown as {
          extractSymbols: (
            symbols: Record<string, { score: number; description?: string; options?: string[] }>,
          ) => unknown[];
        }
      ).extractSymbols.bind(service);

      const symbols = {
        RULE_A: { name: 'RULE_A', score: 1.5, description: 'Rule A desc', options: ['a', 'b'] },
        RULE_B: { name: 'RULE_B', score: -0.5 },
      };

      const result = extractSymbols(symbols);

      expect(result).toEqual([
        { name: 'RULE_A', score: 1.5, description: 'Rule A desc', options: ['a', 'b'] },
        { name: 'RULE_B', score: -0.5, description: undefined, options: undefined },
      ]);
    });
  });

  describe('normalizeAction', () => {
    it('normalizes valid actions', () => {
      const normalizeAction = (
        service as unknown as { normalizeAction: (action: string) => string }
      ).normalizeAction.bind(service);

      expect(normalizeAction('no action')).toBe('no action');
      expect(normalizeAction('greylist')).toBe('greylist');
      expect(normalizeAction('add header')).toBe('add header');
      expect(normalizeAction('rewrite subject')).toBe('rewrite subject');
      expect(normalizeAction('soft reject')).toBe('soft reject');
      expect(normalizeAction('reject')).toBe('reject');
    });

    it('normalizes actions with different casing and whitespace', () => {
      const normalizeAction = (
        service as unknown as { normalizeAction: (action: string) => string }
      ).normalizeAction.bind(service);

      expect(normalizeAction('NO ACTION')).toBe('no action');
      expect(normalizeAction('Add Header')).toBe('add header');
      expect(normalizeAction('  soft  reject  ')).toBe('soft reject');
      expect(normalizeAction('REJECT')).toBe('reject');
    });

    it('returns "no action" for unknown actions', () => {
      const normalizeAction = (
        service as unknown as { normalizeAction: (action: string) => string }
      ).normalizeAction.bind(service);

      expect(normalizeAction('unknown')).toBe('no action');
      expect(normalizeAction('')).toBe('no action');
      expect(normalizeAction('invalid action')).toBe('no action');
    });
  });
});
