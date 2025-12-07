import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { InboxService } from './inbox.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CreateInboxDto } from './dto/create-inbox.dto';
import {
  CheckKeyResponseDto,
  ServerInfoResponseDto,
  CreateInboxResponseDto,
  EmailListItemDto,
  SyncStatusResponseDto,
  EmailResponseDto,
  RawEmailResponseDto,
  ClearAllInboxesResponseDto,
} from './dto/response.dto';

@ApiTags('Inbox')
@ApiSecurity('api-key')
@Controller('api')
export class InboxController {
  private readonly logger = new Logger(InboxController.name);

  constructor(private readonly inboxService: InboxService) {}

  /**
   * GET /api/check-key
   * API key validation endpoint
   * Requires X-API-Key header
   */
  @Get('check-key')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate API Key',
    description: 'A simple endpoint to check if the provided X-API-Key header is valid.',
  })
  @ApiOkResponse({ type: CheckKeyResponseDto, description: 'API key is valid.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  getCheckKey(): CheckKeyResponseDto {
    return { ok: true };
  }

  /**
   * GET /api/server-info
   * Returns server cryptographic information
   * Requires X-API-Key header
   */
  @Get('server-info')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get Server Cryptographic Info',
    description: 'Returns the server public signature key for verifying server-sent data.',
  })
  @ApiOkResponse({ type: ServerInfoResponseDto, description: 'Server information retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  getServerInfo(): ServerInfoResponseDto {
    return this.inboxService.getServerInfo();
  }

  /**
   * POST /api/inboxes
   * Create a new inbox with random or specified email address
   * Requires X-API-Key header
   */
  @Post('inboxes')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new inbox' })
  @ApiCreatedResponse({ type: CreateInboxResponseDto, description: 'The inbox has been successfully created.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  createInbox(@Body() createInboxDto: CreateInboxDto): CreateInboxResponseDto {
    this.logger.debug(`POST /api/inboxes`);

    const { inbox, serverSigPk } = this.inboxService.createInbox(
      createInboxDto.clientKemPk,
      createInboxDto.ttl,
      createInboxDto.emailAddress,
    );

    return {
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt.toISOString(),
      inboxHash: inbox.inboxHash,
      serverSigPk,
    };
  }

  /**
   * GET /api/inboxes/:emailAddress/emails
   * List all emails for an inbox (encrypted metadata only)
   * Requires X-API-Key header
   */
  @Get('inboxes/:emailAddress/emails')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List emails in an inbox' })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiOkResponse({ type: [EmailListItemDto], description: 'A list of emails in the inbox.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Inbox not found.' })
  listEmails(@Param('emailAddress') emailAddress: string): EmailListItemDto[] {
    this.logger.debug(`GET /api/inboxes/.../emails`);

    // Check if inbox exists
    const inbox = this.inboxService.getInboxByEmail(emailAddress);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${emailAddress}`);
    }

    return this.inboxService.getEmails(emailAddress);
  }

  /**
   * GET /api/inboxes/:emailAddress/sync
   * Get a hash of the email list for quick synchronization checks
   * Requires X-API-Key header
   */
  @Get('inboxes/:emailAddress/sync')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get inbox synchronization status' })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiOkResponse({ type: SyncStatusResponseDto, description: 'The synchronization status of the inbox.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Inbox not found.' })
  getInboxSyncStatus(@Param('emailAddress') emailAddress: string): SyncStatusResponseDto {
    this.logger.debug(`GET /api/inboxes/.../sync`);

    const inbox = this.inboxService.getInboxByEmail(emailAddress);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${emailAddress}`);
    }

    return {
      emailsHash: inbox.emailsHash,
      emailCount: inbox.emails.size,
    };
  }

  /**
   * GET /api/inboxes/:emailAddress/emails/:emailId
   * Get encrypted email (metadata + parsed content, without raw)
   * Requires X-API-Key header
   */
  @Get('inboxes/:emailAddress/emails/:emailId')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a specific email' })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiParam({ name: 'emailId', description: 'The ID of the email to retrieve.' })
  @ApiOkResponse({ type: EmailResponseDto, description: 'The requested email.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Email or inbox not found.' })
  getEmail(@Param('emailAddress') emailAddress: string, @Param('emailId') emailId: string): EmailResponseDto {
    this.logger.debug(`GET /api/inboxes/.../emails/${emailId}`);

    return this.inboxService.getEmail(emailAddress, emailId);
  }

  /**
   * GET /api/inboxes/:emailAddress/emails/:emailId/raw
   * Get raw encrypted email content only
   * Requires X-API-Key header
   */
  @Get('inboxes/:emailAddress/emails/:emailId/raw')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the raw content of an email' })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiParam({ name: 'emailId', description: 'The ID of the email to retrieve.' })
  @ApiOkResponse({ type: RawEmailResponseDto, description: 'The raw content of the requested email.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Email or inbox not found.' })
  getRawEmail(@Param('emailAddress') emailAddress: string, @Param('emailId') emailId: string): RawEmailResponseDto {
    this.logger.debug(`GET /api/inboxes/.../emails/${emailId}/raw`);

    return this.inboxService.getRawEmail(emailAddress, emailId);
  }

  /**
   * PATCH /api/inboxes/:emailAddress/emails/:emailId/read
   * Mark an email as read
   * Requires X-API-Key header
   */
  @Patch('inboxes/:emailAddress/emails/:emailId/read')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark an email as read' })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiParam({ name: 'emailId', description: 'The ID of the email to mark as read.' })
  @ApiNoContentResponse({ description: 'Email marked as read successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Email or inbox not found.' })
  markEmailAsRead(@Param('emailAddress') emailAddress: string, @Param('emailId') emailId: string): void {
    this.logger.debug(`PATCH /api/inboxes/.../emails/${emailId}/read`);

    this.inboxService.markEmailAsRead(emailAddress, emailId);
    return;
  }

  /**
   * DELETE /api/inboxes/:emailAddress
   * Delete an inbox and all associated emails
   * Requires X-API-Key header
   *
   * Note: This endpoint implements idempotent delete behavior and will always
   * return 204 No Content, even if the inbox does not exist. This follows REST
   * semantics where DELETE operations should be idempotent - deleting a resource
   * that doesn't exist results in the same state as successfully deleting it.
   * Clients cannot distinguish between "inbox was deleted" and "inbox already gone".
   */
  @Delete('inboxes/:emailAddress')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an inbox',
    description:
      'Deletes an inbox and all associated emails. Returns 204 No Content regardless of whether the inbox exists (idempotent delete).',
  })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox to delete.' })
  @ApiNoContentResponse({ description: 'Inbox deleted successfully, or inbox did not exist (idempotent delete).' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  deleteInbox(@Param('emailAddress') emailAddress: string): void {
    this.inboxService.deleteInbox(emailAddress);
    return;
  }

  /**
   * DELETE /api/inboxes/:emailAddress/emails/:emailId
   * Delete a single email from an inbox
   * Requires X-API-Key header
   */
  @Delete('inboxes/:emailAddress/emails/:emailId')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a single email' })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiParam({ name: 'emailId', description: 'The ID of the email to delete.' })
  @ApiNoContentResponse({ description: 'Email deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Email or inbox not found.' })
  deleteEmail(@Param('emailAddress') emailAddress: string, @Param('emailId') emailId: string): void {
    this.logger.debug(`DELETE /api/inboxes/.../emails/${emailId}`);
    this.inboxService.deleteEmail(emailAddress, emailId);
    return;
  }

  /**
   * DELETE /api/inboxes
   * Clear all inboxes (testing/maintenance)
   * Requires X-API-Key header
   */
  @Delete('inboxes')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear all inboxes',
    description: 'Deletes all inboxes and their emails. Use with caution.',
  })
  @ApiOkResponse({ type: ClearAllInboxesResponseDto, description: 'All inboxes have been cleared.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  clearAllInboxes(): ClearAllInboxesResponseDto {
    this.logger.debug('DELETE /api/inboxes');
    const removed = this.inboxService.clearAllInboxes();

    return { deleted: removed };
  }
}
