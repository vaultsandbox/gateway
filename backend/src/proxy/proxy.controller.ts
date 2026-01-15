import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
  Res,
  HttpStatus,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation, ApiResponse, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ProxyService, CheckLinkResult } from './proxy.service';
import { ApiKeyGuard } from '../inbox/guards/api-key.guard';

@ApiTags('Proxy')
@ApiSecurity('api-key')
@Controller('api')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  /* v8 ignore next */
  constructor(private readonly proxyService: ProxyService) {}

  /**
   * GET /api/proxy
   * Proxies an external image request to bypass CORS restrictions.
   * Requires X-API-Key header.
   */
  /* v8 ignore start - decorators */
  @Get('proxy')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Proxy external image',
    description:
      'Fetches an external image and returns it with the correct Content-Type. Used for screenshot functionality to bypass CORS restrictions.',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    type: String,
    description: 'The URL of the image to fetch (must be HTTP/HTTPS).',
  })
  @ApiResponse({
    status: 200,
    description: 'The image data with appropriate Content-Type header.',
  })
  @ApiResponse({ status: 400, description: 'Invalid URL or request.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 502, description: 'Failed to fetch the image from the external source.' })
  /* v8 ignore stop */
  /* v8 ignore next */
  async proxyImage(@Query('url') url: string, @Res() res: Response): Promise<void> {
    if (!url) {
      throw new BadRequestException('URL query parameter is required');
    }

    this.logger.debug(`Proxy request for URL: ${url.substring(0, 100)}...`);

    try {
      const { buffer, contentType } = await this.proxyService.fetchImage(url);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, max-age=300'); // 5 minute cache
      res.status(HttpStatus.OK).send(buffer);
    } catch (error) {
      const err = error as Error;

      // BadRequestException from service validation - let it propagate
      if (err.name === 'BadRequestException') {
        throw error;
      }

      // External fetch failures return 502 Bad Gateway
      this.logger.warn(`Proxy fetch failed: ${err.message}`);
      res.status(HttpStatus.BAD_GATEWAY).json({
        statusCode: HttpStatus.BAD_GATEWAY,
        message: 'Failed to fetch image from external source',
        error: 'Bad Gateway',
      });
    }
  }

  /**
   * GET /api/proxy/check
   * Checks if an external URL is valid and reachable.
   * Requires X-API-Key header.
   */
  /* v8 ignore start - decorators */
  @Get('proxy/check')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check external link validity',
    description:
      'Performs a HEAD request to check if an external URL is valid and reachable. Used for link validation to bypass CORS restrictions.',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    type: String,
    description: 'The URL to check (must be HTTP/HTTPS).',
  })
  @ApiOkResponse({
    description: 'Link check result.',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', description: 'Whether the link is valid and reachable' },
        status: { type: 'number', description: 'HTTP status code (if available)' },
        contentType: { type: 'string', description: 'Content-Type header (if available)' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid URL format.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  /* v8 ignore stop */
  /* v8 ignore next */
  async checkLink(@Query('url') url: string): Promise<CheckLinkResult> {
    if (!url) {
      throw new BadRequestException('URL query parameter is required');
    }

    this.logger.debug(`Check link request for URL: ${url.substring(0, 100)}...`);

    return this.proxyService.checkLink(url);
  }
}
