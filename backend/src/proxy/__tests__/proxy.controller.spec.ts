import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ProxyController } from '../proxy.controller';
import { ProxyService } from '../proxy.service';
import { ApiKeyGuard } from '../../inbox/guards/api-key.guard';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';

describe('ProxyController', () => {
  let controller: ProxyController;
  let proxyService: jest.Mocked<ProxyService>;

  const restoreLogger = silenceNestLogger();
  afterAll(() => restoreLogger());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProxyController],
      providers: [
        {
          provide: ProxyService,
          useValue: {
            fetchImage: jest.fn(),
            checkLink: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
        ApiKeyGuard,
      ],
    }).compile();

    controller = module.get<ProxyController>(ProxyController);
    proxyService = module.get(ProxyService);
  });

  describe('proxyImage', () => {
    let mockResponse: Partial<Response>;

    beforeEach(() => {
      mockResponse = {
        setHeader: jest.fn().mockReturnThis(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
    });

    it('should proxy image successfully', async () => {
      const imageBuffer = Buffer.from('image-data');
      proxyService.fetchImage.mockResolvedValue({
        buffer: imageBuffer,
        contentType: 'image/png',
      });

      await controller.proxyImage('https://example.com/image.png', mockResponse as Response);

      expect(proxyService.fetchImage).toHaveBeenCalledWith('https://example.com/image.png');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Length', imageBuffer.length);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockResponse.send).toHaveBeenCalledWith(imageBuffer);
    });

    it('should throw BadRequestException when URL is missing', async () => {
      await expect(controller.proxyImage('', mockResponse as Response)).rejects.toThrow(BadRequestException);
      await expect(controller.proxyImage('', mockResponse as Response)).rejects.toThrow(
        'URL query parameter is required',
      );
    });

    it('should throw BadRequestException when URL is undefined', async () => {
      await expect(controller.proxyImage(undefined as unknown as string, mockResponse as Response)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should propagate BadRequestException from service', async () => {
      const badRequestError = new BadRequestException('Invalid URL format');
      proxyService.fetchImage.mockRejectedValue(badRequestError);

      await expect(controller.proxyImage('https://example.com/image.png', mockResponse as Response)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return 502 Bad Gateway for network errors', async () => {
      const networkError = new Error('Connection refused');
      networkError.name = 'Error';
      proxyService.fetchImage.mockRejectedValue(networkError);

      await controller.proxyImage('https://example.com/image.png', mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_GATEWAY,
        message: 'Failed to fetch image from external source',
        error: 'Bad Gateway',
      });
    });

    it('should return 502 for timeout errors', async () => {
      const timeoutError = new Error('timeout');
      timeoutError.name = 'TimeoutError';
      proxyService.fetchImage.mockRejectedValue(timeoutError);

      await controller.proxyImage('https://example.com/image.png', mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    });
  });

  describe('checkLink', () => {
    it('should return link check result', async () => {
      proxyService.checkLink.mockResolvedValue({
        valid: true,
        status: 200,
        contentType: 'text/html',
      });

      const result = await controller.checkLink('https://example.com');

      expect(result).toEqual({
        valid: true,
        status: 200,
        contentType: 'text/html',
      });
      expect(proxyService.checkLink).toHaveBeenCalledWith('https://example.com');
    });

    it('should throw BadRequestException when URL is missing', async () => {
      await expect(controller.checkLink('')).rejects.toThrow(BadRequestException);
      await expect(controller.checkLink('')).rejects.toThrow('URL query parameter is required');
    });

    it('should throw BadRequestException when URL is undefined', async () => {
      await expect(controller.checkLink(undefined as unknown as string)).rejects.toThrow(BadRequestException);
    });

    it('should return invalid result from service', async () => {
      proxyService.checkLink.mockResolvedValue({
        valid: false,
        status: 404,
      });

      const result = await controller.checkLink('https://example.com/notfound');

      expect(result).toEqual({
        valid: false,
        status: 404,
      });
    });

    it('should propagate BadRequestException from service', async () => {
      proxyService.checkLink.mockRejectedValue(new BadRequestException('Internal URLs are not allowed'));

      await expect(controller.checkLink('https://localhost/test')).rejects.toThrow(BadRequestException);
    });
  });
});
