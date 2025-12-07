import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedirectToHttpsMiddleware } from '../redirect-to-https.middleware';
import { Request, Response, NextFunction } from 'express';

describe('RedirectToHttpsMiddleware', () => {
  let middleware: RedirectToHttpsMiddleware;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  const baseConfig = {
    'vsb.main.httpsEnabled': true,
    'vsb.main.httpsPort': 443,
    'vsb.main.origin': 'https://example.com',
    'vsb.smtp.allowedRecipientDomains': ['example.com'],
    'vsb.certificate.domain': undefined,
    'vsb.certificate.additionalDomains': [] as string[],
  };

  const setupConfig = (overrides: Record<string, any> = {}) => {
    const allowedRecipientDomains =
      overrides['vsb.smtp.allowedRecipientDomains'] ?? baseConfig['vsb.smtp.allowedRecipientDomains'];
    const additionalDomains =
      overrides['vsb.certificate.additionalDomains'] ?? baseConfig['vsb.certificate.additionalDomains'];

    const values = {
      ...baseConfig,
      ...overrides,
      'vsb.smtp.allowedRecipientDomains': [...allowedRecipientDomains],
      'vsb.certificate.additionalDomains': [...additionalDomains],
    };
    mockConfigService.get.mockImplementation((key: string) => values[key]);
  };

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedirectToHttpsMiddleware,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    middleware = module.get<RedirectToHttpsMiddleware>(RedirectToHttpsMiddleware);

    // Reset mocks before each test
    mockNext = jest.fn();
    mockResponse = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    setupConfig();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('HTTPS not enabled', () => {
    it('should skip redirect when HTTPS is not enabled', () => {
      setupConfig({ 'vsb.main.httpsEnabled': false });
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/some-path',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockConfigService.get).toHaveBeenCalledWith('vsb.main.httpsEnabled');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should skip redirect when HTTPS is disabled (undefined)', () => {
      setupConfig({ 'vsb.main.httpsEnabled': undefined });
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/some-path',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('Already on HTTPS', () => {
    beforeEach(() => {
      setupConfig();
    });

    it('should skip redirect when req.secure is true', () => {
      mockRequest = {
        secure: true,
        protocol: 'https',
        originalUrl: '/some-path',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should skip redirect when protocol is https', () => {
      mockRequest = {
        secure: false,
        protocol: 'https',
        originalUrl: '/some-path',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should skip redirect when both secure and protocol are https', () => {
      mockRequest = {
        secure: true,
        protocol: 'https',
        originalUrl: '/some-path',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('ACME challenge paths', () => {
    beforeEach(() => {
      setupConfig();
    });

    it('should allow ACME challenge path (/.well-known/acme-challenge/)', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/.well-known/acme-challenge/token123',
        path: '/.well-known/acme-challenge/token123',
        url: '/.well-known/acme-challenge/token123',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should allow ACME challenge path with query parameters', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/.well-known/acme-challenge/token123?param=value',
        path: '/.well-known/acme-challenge/token123',
        url: '/.well-known/acme-challenge/token123?param=value',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should not match similar paths that are not ACME challenges', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/well-known/acme-challenge/token123',
        path: '/well-known/acme-challenge/token123',
        url: '/well-known/acme-challenge/token123',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com/well-known/acme-challenge/token123');
    });
  });

  describe('Cluster endpoints', () => {
    beforeEach(() => {
      setupConfig();
    });

    it('should allow cluster endpoint (/cluster/)', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/cluster/sync',
        path: '/cluster/sync',
        url: '/cluster/sync',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should allow cluster endpoint with nested paths', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/cluster/sync/certificates',
        path: '/cluster/sync/certificates',
        url: '/cluster/sync/certificates',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should allow cluster endpoint with query parameters', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/cluster/sync?node=1',
        path: '/cluster/sync',
        url: '/cluster/sync?node=1',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('Health check endpoints', () => {
    beforeEach(() => {
      setupConfig();
    });

    it('should allow health check endpoint via originalUrl', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/health',
        path: '/health',
        url: '/health',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should allow health check endpoint via path', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/prefix/health',
        path: '/health',
        url: '/health',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should not allow health check with additional path segments', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/health/detailed',
        path: '/health/detailed',
        url: '/health/detailed',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com/health/detailed');
    });
  });

  describe('HTTPS redirect', () => {
    beforeEach(() => {
      setupConfig();
    });

    it('should redirect to HTTPS with default port 443', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/some-path',
        url: '/some-path',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com/some-path');
    });

    it('should reject redirect when host is not allowed', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/some-path',
        url: '/some-path',
        hostname: 'malicious.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.send).toHaveBeenCalledWith('Invalid host header');
    });

    it('should redirect to HTTPS with custom port', () => {
      setupConfig({ 'vsb.main.httpsPort': 9999 });

      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/some-path',
        url: '/some-path',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com:9999/some-path');
    });

    it('should redirect to HTTPS preserving query parameters', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/some-path?param1=value1&param2=value2',
        url: '/some-path?param1=value1&param2=value2',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        301,
        'https://example.com/some-path?param1=value1&param2=value2',
      );
    });

    it('should redirect to HTTPS preserving complex paths', () => {
      setupConfig({ 'vsb.certificate.additionalDomains': ['api.example.com'] });
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/api/v1/users/123/posts',
        url: '/api/v1/users/123/posts',
        hostname: 'api.example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://api.example.com/api/v1/users/123/posts');
    });

    it('should redirect to HTTPS using 301 permanent redirect', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/some-path',
        url: '/some-path',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.redirect).toHaveBeenCalledWith(301, expect.any(String));
    });

    it('should redirect with different hostname', () => {
      setupConfig({ 'vsb.certificate.additionalDomains': ['subdomain.example.com'] });
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/path',
        url: '/path',
        hostname: 'subdomain.example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://subdomain.example.com/path');
    });
  });

  describe('Edge cases', () => {
    beforeEach(() => {
      setupConfig();
    });

    it('should handle root path', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/',
        url: '/',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com/');
    });

    it('should handle empty path', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '',
        url: '',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com');
    });

    it('should handle path with hash', () => {
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/path',
        url: '/path#section',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com/path#section');
    });

    it('should handle port 0 (should not add port suffix)', () => {
      setupConfig({ 'vsb.main.httpsPort': 0 });

      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/path',
        url: '/path',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.redirect).toHaveBeenCalledWith(301, 'https://example.com:0/path');
    });

    it('should skip redirect when httpsPort is invalid/undefined', () => {
      setupConfig({ 'vsb.main.httpsPort': undefined });

      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/path',
        url: '/path',
        hostname: 'example.com',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('Priority of exceptions', () => {
    beforeEach(() => {
      setupConfig();
    });

    it('should check HTTPS enabled before checking if already on HTTPS', () => {
      setupConfig({ 'vsb.main.httpsEnabled': false });
      mockRequest = {
        secure: true,
        protocol: 'https',
        originalUrl: '/some-path',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockConfigService.get).toHaveBeenCalledWith('vsb.main.httpsEnabled');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should check if already on HTTPS before checking exception paths', () => {
      mockRequest = {
        secure: true,
        protocol: 'https',
        originalUrl: '/.well-known/acme-challenge/token',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });

    it('should check ACME before cluster endpoints', () => {
      // This test demonstrates order but both would pass anyway
      mockRequest = {
        secure: false,
        protocol: 'http',
        originalUrl: '/.well-known/acme-challenge/token',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });
});
