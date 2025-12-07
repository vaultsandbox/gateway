import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  const mockApiKey = 'test-api-key';
  const restoreLogger = silenceNestLogger();

  afterAll(() => restoreLogger());

  const createMockContext = (
    method: string = 'GET',
    headers: Record<string, string | string[] | undefined> = {},
    query: Record<string, string | string[] | undefined> = {},
  ) => {
    const mockRequest = {
      method,
      headers,
      query,
      path: '/test',
    };

    const mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as unknown as ExecutionContext;

    return mockContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'vsb.local.apiKey') {
                return mockApiKey;
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should allow OPTIONS requests', () => {
      const context = createMockContext('OPTIONS');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw UnauthorizedException if no API key is provided', () => {
      const context = createMockContext('GET');
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing X-API-Key header');
    });

    it('should throw UnauthorizedException if API key is not configured in env', () => {
      const mockConfigServiceEmpty = {
        get: jest.fn().mockReturnValue(undefined),
      };
      const guardEmpty = new ApiKeyGuard(mockConfigServiceEmpty as any);

      // We need to provide a key in request to pass the first check
      const context = createMockContext('GET', { 'x-api-key': 'some-key' });

      expect(() => guardEmpty.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guardEmpty.canActivate(context)).toThrow('API authentication not configured');
    });

    it('should throw UnauthorizedException if provided API key is invalid', () => {
      const context = createMockContext('GET', { 'x-api-key': 'invalid-key' });
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid API key');
    });

    it('should return true if valid API key is provided in header', () => {
      const context = createMockContext('GET', { 'x-api-key': mockApiKey });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should reject request when API key only provided in query (apiKey)', () => {
      const context = createMockContext('GET', {}, { apiKey: mockApiKey });
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing X-API-Key header');
    });

    it('should reject request when API key only provided in query (x-api-key)', () => {
      const context = createMockContext('GET', {}, { 'x-api-key': mockApiKey });
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing X-API-Key header');
    });

    it('should reject request when API key array provided in query params', () => {
      const context = createMockContext('GET', {}, { apiKey: [mockApiKey, 'other'] });
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Missing X-API-Key header');
    });
    it('should handle constant-time comparison error (e.g. different byte lengths) by denying access', () => {
      // This test covers the catch block in constantTimeCompare
      // mockApiKey is 'test-api-key' (12 chars, 12 bytes)
      // We provide a key with same character length (12) but different byte length
      // 'test-api-ke' (11 bytes) + '€' (3 bytes) = 14 bytes total
      const keyWithDifferentBytes = 'test-api-ke€';

      const context = createMockContext('GET', { 'x-api-key': keyWithDifferentBytes });

      // Should throw UnauthorizedException because constantTimeCompare returns false on error
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow('Invalid API key');
    });
  });
});
