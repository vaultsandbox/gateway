import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation, ApiCreatedResponse, ApiResponse } from '@nestjs/swagger';
import { ApiKeyGuard } from '../inbox/guards/api-key.guard';
import { TestEmailService } from './test-email.service';
import { CreateTestEmailDto } from './dto/create-test-email.dto';

/* c8 ignore next 3 - DTO class declaration */
class CreateTestEmailResponseDto {
  emailId: string;
}

@ApiTags('Test')
@ApiSecurity('api-key')
@Controller('api/test')
export class TestController {
  private readonly logger = new Logger(TestController.name);

  /* c8 ignore next */
  constructor(private readonly testEmailService: TestEmailService) {}

  /**
   * POST /api/test/emails
   * Create a test email with controlled authentication results.
   * Requires X-API-Key header.
   */
  @Post('emails')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a test email',
    description:
      'Creates a test email with controlled authentication results (SPF, DKIM, DMARC, ReverseDNS). ' +
      'This endpoint is only available when VSB_DEVELOPMENT=true.',
  })
  @ApiCreatedResponse({
    type: CreateTestEmailResponseDto,
    description: 'The test email has been successfully created.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Inbox not found.' })
  /* c8 ignore next - V8 async artifact; covered by test-email-auth.e2e-spec.ts */
  async createTestEmail(@Body() dto: CreateTestEmailDto): Promise<CreateTestEmailResponseDto> {
    this.logger.debug(`POST /api/test/emails to=${dto.to}`);
    return this.testEmailService.createTestEmail(dto);
  }
}
