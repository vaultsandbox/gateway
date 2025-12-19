import { SecurityHeadersMiddleware } from '../security-headers.middleware';
import { Request, Response, NextFunction } from 'express';

describe('SecurityHeadersMiddleware', () => {
  let middleware: SecurityHeadersMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let headers: Record<string, string>;

  beforeEach(() => {
    middleware = new SecurityHeadersMiddleware();
    headers = {};

    mockRequest = {};
    mockResponse = {
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
        return mockResponse as Response;
      }),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next()', () => {
    middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  describe('X-Frame-Options', () => {
    it('should set X-Frame-Options to DENY', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(headers['X-Frame-Options']).toBe('DENY');
    });
  });

  describe('X-Content-Type-Options', () => {
    it('should set X-Content-Type-Options to nosniff', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });
  });

  describe('Referrer-Policy', () => {
    it('should set Referrer-Policy to strict-origin-when-cross-origin', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('Permissions-Policy', () => {
    it('should set Permissions-Policy to disable sensitive features', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(headers['Permissions-Policy']).toContain('geolocation=()');
      expect(headers['Permissions-Policy']).toContain('microphone=()');
      expect(headers['Permissions-Policy']).toContain('camera=()');
      expect(headers['Permissions-Policy']).toContain('payment=()');
    });
  });

  describe('Content-Security-Policy', () => {
    it('should set Content-Security-Policy with appropriate directives', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      const csp = headers['Content-Security-Policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("img-src 'self' data:");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain('upgrade-insecure-requests');
    });
  });

  describe('Cross-Origin policies', () => {
    it('should set Cross-Origin-Opener-Policy to same-origin', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    });

    it('should set Cross-Origin-Resource-Policy to same-origin', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    });
  });

  describe('Header count', () => {
    it('should set all 7 security headers', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledTimes(7);
    });
  });
});
