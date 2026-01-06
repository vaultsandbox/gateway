import { Test, TestingModule } from '@nestjs/testing';
import { HttpServerService } from './../http-server.service';
import { ConfigService } from '@nestjs/config';
import { CertificateService } from '../../certificate/certificate.service';
import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';

jest.mock('http');
jest.mock('https');

describe('HttpServerService', () => {
  let service: HttpServerService;
  let configService: ConfigService;
  let certificateService: CertificateService;
  let app: INestApplication;
  const restoreLogger = silenceNestLogger();

  const mockHttpServer = {
    listen: jest.fn((port, host, cb) => {
      if (cb) cb();
    }),
    once: jest.fn(),
    close: jest.fn((cb) => {
      if (cb) cb();
    }),
  };

  const mockHttpsServer = {
    listen: jest.fn((port, host, cb) => {
      if (cb) cb();
    }),
    once: jest.fn(),
    close: jest.fn((cb) => {
      if (cb) cb();
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (http.createServer as jest.Mock).mockReturnValue(mockHttpServer);
    (https.createServer as jest.Mock).mockReturnValue(mockHttpsServer);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpServerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: CertificateService,
          useValue: {
            getCurrentCertificate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<HttpServerService>(HttpServerService);
    configService = module.get<ConfigService>(ConfigService);
    certificateService = module.get<CertificateService>(CertificateService);

    app = {
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({}),
      }),
    } as unknown as INestApplication;
  });

  afterAll(() => restoreLogger());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initializeServers', () => {
    it('should throw error if http port is not configured', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(null);
      await expect(service.initializeServers(app)).rejects.toThrow('HTTP port not configured');
    });

    it('should reject when HTTP server fails to start', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        return null;
      });

      const errorMockHttpServer = {
        listen: jest.fn(),
        once: jest.fn((event, cb) => {
          if (event === 'error') {
            setTimeout(() => cb(new Error('EADDRINUSE')), 0);
          }
        }),
        close: jest.fn((cb) => cb?.()),
      };
      (http.createServer as jest.Mock).mockReturnValue(errorMockHttpServer);

      await expect(service.initializeServers(app)).rejects.toThrow('EADDRINUSE');
    });

    it('should throw error when HTTPS port is not configured', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return null;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      await expect(service.initializeServers(app)).rejects.toThrow('HTTPS port not configured');
    });

    it('should reject when HTTPS server fails to start', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      const errorMockHttpsServer = {
        listen: jest.fn(),
        once: jest.fn((event, cb) => {
          if (event === 'error') {
            setTimeout(() => cb(new Error('EADDRINUSE')), 0);
          }
        }),
        close: jest.fn((cb) => cb?.()),
      };
      (https.createServer as jest.Mock).mockReturnValue(errorMockHttpsServer);

      await expect(service.initializeServers(app)).rejects.toThrow('EADDRINUSE');
    });

    it('should start HTTP server', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        return null;
      });

      await service.initializeServers(app);
      expect(http.createServer).toHaveBeenCalled();
      expect(mockHttpServer.listen).toHaveBeenCalledWith(80, '0.0.0.0', expect.any(Function));
    });

    it('should start HTTPS server when enabled and certificate exists', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      await service.initializeServers(app);
      expect(https.createServer).toHaveBeenCalled();
      expect(mockHttpsServer.listen).toHaveBeenCalledWith(443, '0.0.0.0', expect.any(Function));
    });

    it('should skip HTTPS server when enabled but no certificate', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue(null);

      await service.initializeServers(app);
      expect(https.createServer).not.toHaveBeenCalled();
    });
  });

  describe('handleCertificateReload', () => {
    it('should skip if HTTPS is disabled', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(false);
      await service.handleCertificateReload();
      expect(https.createServer).not.toHaveBeenCalled();
    });

    it('should restart HTTPS server if it was running', async () => {
      // Setup initial state
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      await service.initializeServers(app);

      // Trigger reload
      await service.handleCertificateReload();

      expect(mockHttpsServer.close).toHaveBeenCalled();
      expect(https.createServer).toHaveBeenCalledTimes(2); // Initial + Reload
    });

    it('should start HTTPS server if it was not running', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });
      // Initially no cert
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue(null);
      await service.initializeServers(app);

      // Now cert available
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      // Trigger reload
      await service.handleCertificateReload();

      expect(https.createServer).toHaveBeenCalledTimes(1);
    });

    it('should log error when startHttpsServer fails during reload', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });

      // First call succeeds with cert
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      await service.initializeServers(app);

      // Now make HTTPS server fail on reload
      const errorMockHttpsServer = {
        listen: jest.fn(),
        once: jest.fn((event, cb) => {
          if (event === 'error') {
            setTimeout(() => cb(new Error('EADDRINUSE')), 0);
          }
        }),
        close: jest.fn((cb) => cb?.()),
      };
      (https.createServer as jest.Mock).mockReturnValue(errorMockHttpsServer);

      // Should not throw - error is caught and logged
      await expect(service.handleCertificateReload()).resolves.not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('should close servers', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      await service.initializeServers(app);
      await service.onModuleDestroy();

      expect(mockHttpServer.close).toHaveBeenCalled();
      expect(mockHttpsServer.close).toHaveBeenCalled();
    });

    it('should handle case when no servers are running', async () => {
      // Don't initialize any servers, just call onModuleDestroy
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should reject when HTTP server close fails', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        return null;
      });

      const errorMockHttpServer = {
        listen: jest.fn((port, host, cb) => cb?.()),
        once: jest.fn(),
        close: jest.fn((cb) => cb?.(new Error('Close error'))),
      };
      (http.createServer as jest.Mock).mockReturnValue(errorMockHttpServer);

      await service.initializeServers(app);

      await expect(service.onModuleDestroy()).rejects.toThrow('Close error');
    });

    it('should reject when HTTPS server close fails', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      const errorMockHttpsServer = {
        listen: jest.fn((port, host, cb) => cb?.()),
        once: jest.fn(),
        close: jest.fn((cb) => cb?.(new Error('HTTPS close error'))),
      };
      (https.createServer as jest.Mock).mockReturnValue(errorMockHttpsServer);

      await service.initializeServers(app);

      await expect(service.onModuleDestroy()).rejects.toThrow('HTTPS close error');
    });

    it('should force close connections on timeout', async () => {
      jest.useFakeTimers();

      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        return null;
      });

      const closeAllConnectionsMock = jest.fn();
      const timeoutMockHttpServer = {
        listen: jest.fn((port, host, cb) => cb?.()),
        once: jest.fn(),
        close: jest.fn(), // Never calls the callback
        closeAllConnections: closeAllConnectionsMock,
      };
      (http.createServer as jest.Mock).mockReturnValue(timeoutMockHttpServer);

      await service.initializeServers(app);

      const destroyPromise = service.onModuleDestroy();

      // Fast-forward past the timeout
      jest.advanceTimersByTime(30001);

      await destroyPromise;

      expect(closeAllConnectionsMock).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should force close HTTPS connections on timeout', async () => {
      jest.useFakeTimers();

      jest.spyOn(configService, 'get').mockImplementation((key) => {
        if (key === 'vsb.main.port') return 80;
        if (key === 'vsb.main.httpsEnabled') return true;
        if (key === 'vsb.main.httpsPort') return 443;
        return null;
      });
      jest.spyOn(certificateService, 'getCurrentCertificate').mockResolvedValue({
        certificate: 'cert',
        privateKey: 'key',
      } as any);

      const closeAllConnectionsMock = jest.fn();
      const timeoutMockHttpsServer = {
        listen: jest.fn((port, host, cb) => cb?.()),
        once: jest.fn(),
        close: jest.fn(), // Never calls the callback
        closeAllConnections: closeAllConnectionsMock,
      };
      (https.createServer as jest.Mock).mockReturnValue(timeoutMockHttpsServer);

      await service.initializeServers(app);

      const destroyPromise = service.onModuleDestroy();

      // Fast-forward past the timeout
      jest.advanceTimersByTime(30001);

      await destroyPromise;

      expect(closeAllConnectionsMock).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
