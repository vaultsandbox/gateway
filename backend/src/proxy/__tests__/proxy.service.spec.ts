import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { ProxyService } from '../proxy.service';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';

describe('ProxyService', () => {
  let service: ProxyService;
  let httpService: jest.Mocked<HttpService>;

  const restoreLogger = silenceNestLogger();
  afterAll(() => restoreLogger());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            head: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProxyService>(ProxyService);
    httpService = module.get(HttpService);
  });

  describe('fetchImage', () => {
    it('should fetch image and return buffer with content type', async () => {
      const imageData = new ArrayBuffer(8);
      const mockResponse: AxiosResponse<ArrayBuffer> = {
        data: imageData,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'image/png' },
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.fetchImage('https://example.com/image.png');

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('image/png');
      expect(httpService.get).toHaveBeenCalledWith(
        'https://example.com/image.png',
        expect.objectContaining({
          responseType: 'arraybuffer',
          timeout: 10000,
        }),
      );
    });

    it('should use default content type when header is missing', async () => {
      const imageData = new ArrayBuffer(8);
      const mockResponse: AxiosResponse<ArrayBuffer> = {
        data: imageData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.fetchImage('https://example.com/file');

      expect(result.contentType).toBe('application/octet-stream');
    });

    it('should throw BadRequestException for empty URL', async () => {
      await expect(service.fetchImage('')).rejects.toThrow(BadRequestException);
      await expect(service.fetchImage('')).rejects.toThrow('URL is required');
    });

    it('should throw BadRequestException for invalid URL format', async () => {
      await expect(service.fetchImage('not-a-url')).rejects.toThrow(BadRequestException);
      await expect(service.fetchImage('not-a-url')).rejects.toThrow('Invalid URL format');
    });

    it('should throw BadRequestException for non-HTTP/HTTPS URLs', async () => {
      await expect(service.fetchImage('ftp://example.com/file')).rejects.toThrow(BadRequestException);
      await expect(service.fetchImage('ftp://example.com/file')).rejects.toThrow('Only HTTP/HTTPS URLs are allowed');
    });

    it('should throw BadRequestException for localhost', async () => {
      await expect(service.fetchImage('https://localhost/image.png')).rejects.toThrow(BadRequestException);
      await expect(service.fetchImage('https://localhost/image.png')).rejects.toThrow('Internal URLs are not allowed');
    });

    it('should throw BadRequestException for 127.0.0.1', async () => {
      await expect(service.fetchImage('https://127.0.0.1/image.png')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for IPv6 localhost [::1]', async () => {
      // Note: URL parser keeps brackets for IPv6, so hostname is '[::1]'
      await expect(service.fetchImage('http://[::1]/image.png')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for 192.168.x.x addresses', async () => {
      await expect(service.fetchImage('https://192.168.1.1/image.png')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for 10.x.x.x addresses', async () => {
      await expect(service.fetchImage('https://10.0.0.1/image.png')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for 172.x.x.x addresses', async () => {
      await expect(service.fetchImage('https://172.16.0.1/image.png')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for .local domains', async () => {
      await expect(service.fetchImage('https://myhost.local/image.png')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for .internal domains', async () => {
      await expect(service.fetchImage('https://server.internal/image.png')).rejects.toThrow(BadRequestException);
    });

    it('should rethrow network errors', async () => {
      const axiosError = new Error('Network Error') as AxiosError;
      axiosError.name = 'AxiosError';
      axiosError.message = 'Network Error';
      httpService.get.mockReturnValue(throwError(() => axiosError));

      await expect(service.fetchImage('https://example.com/image.png')).rejects.toThrow('Network Error');
    });
  });

  describe('checkLink', () => {
    it('should return valid result for successful HEAD request', async () => {
      const mockResponse: AxiosResponse = {
        data: null,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html' },
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.head.mockReturnValue(of(mockResponse));

      const result = await service.checkLink('https://example.com');

      expect(result).toEqual({
        valid: true,
        status: 200,
        contentType: 'text/html',
      });
    });

    it('should return invalid for 4xx status codes', async () => {
      const mockResponse: AxiosResponse = {
        data: null,
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.head.mockReturnValue(of(mockResponse));

      const result = await service.checkLink('https://example.com/notfound');

      expect(result.valid).toBe(false);
      expect(result.status).toBe(404);
    });

    it('should return invalid for 5xx status codes', async () => {
      const mockResponse: AxiosResponse = {
        data: null,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.head.mockReturnValue(of(mockResponse));

      const result = await service.checkLink('https://example.com/error');

      expect(result.valid).toBe(false);
      expect(result.status).toBe(500);
    });

    it('should fall back to GET when HEAD returns 405', async () => {
      const headResponse: AxiosResponse = {
        data: null,
        status: 405,
        statusText: 'Method Not Allowed',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };
      const getResponse: AxiosResponse = {
        data: null,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html' },
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.head.mockReturnValue(of(headResponse));
      httpService.get.mockReturnValue(of(getResponse));

      const result = await service.checkLink('https://example.com');

      expect(result).toEqual({
        valid: true,
        status: 200,
        contentType: 'text/html',
      });
      expect(httpService.get).toHaveBeenCalled();
    });

    it('should handle HEAD request error with response', async () => {
      const axiosError = {
        response: {
          status: 403,
          headers: { 'content-type': 'text/html' },
        },
      } as AxiosError;
      httpService.head.mockReturnValue(throwError(() => axiosError));

      const result = await service.checkLink('https://example.com');

      expect(result.valid).toBe(false);
      expect(result.status).toBe(403);
    });

    it('should return invalid when HEAD request fails without response', async () => {
      const axiosError = new Error('Connection refused') as AxiosError;
      axiosError.name = 'AxiosError';
      httpService.head.mockReturnValue(throwError(() => axiosError));

      const result = await service.checkLink('https://example.com');

      expect(result).toEqual({ valid: false });
    });

    it('should return invalid when GET fallback fails', async () => {
      const headResponse: AxiosResponse = {
        data: null,
        status: 405,
        statusText: 'Method Not Allowed',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.head.mockReturnValue(of(headResponse));

      const getError = new Error('Timeout') as AxiosError;
      getError.name = 'AxiosError';
      httpService.get.mockReturnValue(throwError(() => getError));

      const result = await service.checkLink('https://example.com');

      expect(result).toEqual({ valid: false });
    });

    it('should throw BadRequestException for invalid URL', async () => {
      await expect(service.checkLink('not-a-url')).rejects.toThrow(BadRequestException);
    });

    it('should return valid for 3xx redirect status codes', async () => {
      const mockResponse: AxiosResponse = {
        data: null,
        status: 301,
        statusText: 'Moved Permanently',
        headers: { 'content-type': 'text/html' },
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.head.mockReturnValue(of(mockResponse));

      const result = await service.checkLink('https://example.com/redirect');

      expect(result.valid).toBe(true);
      expect(result.status).toBe(301);
    });
  });

  describe('validateUrl edge cases', () => {
    it('should accept HTTP URLs', async () => {
      const mockResponse: AxiosResponse<ArrayBuffer> = {
        data: new ArrayBuffer(8),
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'image/png' },
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.fetchImage('http://example.com/image.png');

      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle URLs with ports', async () => {
      const mockResponse: AxiosResponse<ArrayBuffer> = {
        data: new ArrayBuffer(8),
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'image/png' },
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.fetchImage('https://example.com:8080/image.png');

      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle URLs with query parameters', async () => {
      const mockResponse: AxiosResponse<ArrayBuffer> = {
        data: new ArrayBuffer(8),
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'image/png' },
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.fetchImage('https://example.com/image.png?size=large');

      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });
});
