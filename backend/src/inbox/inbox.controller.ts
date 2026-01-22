import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  ParseBoolPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
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
import { ChaosService } from '../chaos/chaos.service';
import { ChaosEnabledGuard } from '../chaos/chaos.guard';
import { CreateChaosConfigDto } from '../chaos/dto/chaos-config.dto';
import { ChaosConfigResponseDto } from '../chaos/dto/chaos-response.dto';

@ApiTags('Inbox')
@ApiSecurity('api-key')
@Controller('api')
export class InboxController {
  private readonly logger = new Logger(InboxController.name);

  /* v8 ignore next 4 - false positive on constructor parameter properties */
  constructor(
    private readonly inboxService: InboxService,
    @Optional() private readonly chaosService?: ChaosService,
  ) {}

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
  /* v8 ignore next - decorator metadata evaluation */
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
  /* v8 ignore next - decorator metadata evaluation */
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
  /* v8 ignore next - decorator metadata evaluation */
  createInbox(@Body() createInboxDto: CreateInboxDto): CreateInboxResponseDto {
    this.logger.debug(
      `POST /api/inboxes (encryption=${createInboxDto.encryption || 'default'}, emailAuth=${createInboxDto.emailAuth ?? 'default'}, spamAnalysis=${createInboxDto.spamAnalysis ?? 'default'}, chaos=${createInboxDto.chaos?.enabled ?? 'default'})`,
    );

    const { inbox, serverSigPk } = this.inboxService.createInbox(
      createInboxDto.clientKemPk,
      createInboxDto.ttl,
      createInboxDto.emailAddress,
      createInboxDto.encryption,
      createInboxDto.emailAuth,
      createInboxDto.spamAnalysis,
      createInboxDto.chaos,
    );

    return {
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt.toISOString(),
      inboxHash: inbox.inboxHash,
      encrypted: inbox.encrypted,
      emailAuth: inbox.emailAuth,
      spamAnalysis: inbox.spamAnalysis,
      chaos: inbox.chaos,
      ...(serverSigPk && { serverSigPk }),
    };
  }

  /**
   * GET /api/inboxes/:emailAddress/emails
   * List all emails for an inbox (encrypted metadata only, or with content if includeContent=true)
   * Requires X-API-Key header
   */
  @Get('inboxes/:emailAddress/emails')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List emails in an inbox' })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiQuery({
    name: 'includeContent',
    required: false,
    type: Boolean,
    description: 'When true, includes encryptedParsed content in each email item.',
  })
  @ApiOkResponse({ type: [EmailListItemDto], description: 'A list of emails in the inbox.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Inbox not found.' })
  listEmails(
    @Param('emailAddress') emailAddress: string,
    @Query('includeContent', new ParseBoolPipe({ optional: true })) includeContent?: boolean,
  ) {
    this.logger.debug(`GET /api/inboxes/.../emails${includeContent ? '?includeContent=true' : ''}`);

    // Check if inbox exists
    const inbox = this.inboxService.getInboxByEmail(emailAddress);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${emailAddress}`);
    }

    return this.inboxService.getEmails(emailAddress, includeContent);
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
  /* v8 ignore next - decorator metadata evaluation */
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
  /* v8 ignore next - decorator metadata evaluation */
  getEmail(@Param('emailAddress') emailAddress: string, @Param('emailId') emailId: string) {
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
  /* v8 ignore next - decorator metadata evaluation */
  getRawEmail(@Param('emailAddress') emailAddress: string, @Param('emailId') emailId: string) {
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
  @ApiResponse({
    status: 403,
    description: 'Forbidden, clear all inboxes is disabled via VSB_LOCAL_ALLOW_CLEAR_ALL_INBOXES.',
  })
  /* v8 ignore next - decorator metadata evaluation */
  clearAllInboxes(): ClearAllInboxesResponseDto {
    this.logger.debug('DELETE /api/inboxes');
    const removed = this.inboxService.clearAllInboxes();

    return { deleted: removed };
  }

  /**
   * GET /api/inboxes/:emailAddress/chaos
   * Get chaos configuration for an inbox
   * Requires X-API-Key header and VSB_CHAOS_ENABLED=true
   */
  @Get('inboxes/:emailAddress/chaos')
  @UseGuards(ApiKeyGuard, ChaosEnabledGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get chaos configuration',
    description: 'Returns the chaos engineering configuration for an inbox. Requires VSB_CHAOS_ENABLED=true.',
  })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiOkResponse({ type: ChaosConfigResponseDto, description: 'The chaos configuration for the inbox.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 403, description: 'Forbidden, chaos engineering is disabled globally.' })
  @ApiResponse({ status: 404, description: 'Inbox not found.' })
  /* v8 ignore next - decorator metadata evaluation */
  getChaosConfig(@Param('emailAddress') emailAddress: string): ChaosConfigResponseDto {
    this.logger.debug(`GET /api/inboxes/${emailAddress}/chaos`);

    const inbox = this.inboxService.getInboxByEmail(emailAddress);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${emailAddress}`);
    }

    // Return chaos config or default disabled config
    return inbox.chaos ?? { enabled: false };
  }

  /**
   * POST /api/inboxes/:emailAddress/chaos
   * Set chaos configuration for an inbox
   * Requires X-API-Key header and VSB_CHAOS_ENABLED=true
   */
  @Post('inboxes/:emailAddress/chaos')
  @UseGuards(ApiKeyGuard, ChaosEnabledGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set chaos configuration',
    description: 'Updates the chaos engineering configuration for an inbox. Requires VSB_CHAOS_ENABLED=true.',
  })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiOkResponse({ type: ChaosConfigResponseDto, description: 'The updated chaos configuration.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 403, description: 'Forbidden, chaos engineering is disabled globally.' })
  @ApiResponse({ status: 404, description: 'Inbox not found.' })
  /* v8 ignore next 4 - decorator metadata evaluation */
  setChaosConfig(
    @Param('emailAddress') emailAddress: string,
    @Body() chaosConfig: CreateChaosConfigDto,
  ): ChaosConfigResponseDto {
    this.logger.debug(`POST /api/inboxes/${emailAddress}/chaos (enabled=${chaosConfig.enabled})`);

    const inbox = this.inboxService.getInboxByEmail(emailAddress);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${emailAddress}`);
    }

    // Normalize and update chaos config
    const normalizedConfig = this.chaosService!.normalizeConfig(chaosConfig);
    this.inboxService['storageService'].updateChaosConfig(emailAddress, normalizedConfig);

    return normalizedConfig;
  }

  /**
   * DELETE /api/inboxes/:emailAddress/chaos
   * Disable all chaos for an inbox
   * Requires X-API-Key header and VSB_CHAOS_ENABLED=true
   */
  @Delete('inboxes/:emailAddress/chaos')
  @UseGuards(ApiKeyGuard, ChaosEnabledGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disable chaos',
    description: 'Disables all chaos engineering features for an inbox. Requires VSB_CHAOS_ENABLED=true.',
  })
  @ApiParam({ name: 'emailAddress', description: 'The email address of the inbox.' })
  @ApiNoContentResponse({ description: 'Chaos disabled successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  @ApiResponse({ status: 403, description: 'Forbidden, chaos engineering is disabled globally.' })
  @ApiResponse({ status: 404, description: 'Inbox not found.' })
  disableChaos(@Param('emailAddress') emailAddress: string): void {
    this.logger.debug(`DELETE /api/inboxes/${emailAddress}/chaos`);

    const inbox = this.inboxService.getInboxByEmail(emailAddress);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${emailAddress}`);
    }

    // Set chaos.enabled = false
    this.inboxService['storageService'].updateChaosConfig(emailAddress, { enabled: false });
    return;
  }
}
