import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { SpamSymbol, SpamAnalysisResult } from '../../smtp/interfaces/email-session.interface';
import type { InboxChaosConfig } from '../../chaos/interfaces/chaos-config.interface';

/**
 * DTO for encrypted payload structure used in email encryption
 */
export class EncryptedPayloadDto {
  @ApiProperty({
    description: 'Protocol version',
    example: 1,
  })
  v: number;

  @ApiProperty({
    description: 'Cryptographic algorithms used',
    example: {
      kem: 'ML-KEM-768',
      sig: 'ML-DSA-65',
      aead: 'AES-256-GCM',
      kdf: 'HKDF-SHA-512',
    },
  })
  algs: {
    kem: string;
    sig: string;
    aead: string;
    kdf: string;
  };

  @ApiProperty({
    description: 'Base64URL-encoded KEM ciphertext',
    example: 'base64url-encoded-kem-ciphertext',
  })
  ct_kem: string;

  @ApiProperty({
    description: 'Base64URL-encoded 12-byte nonce',
    example: 'base64url-encoded-nonce',
  })
  nonce: string;

  @ApiProperty({
    description: 'Base64URL-encoded additional authenticated data',
    example: 'base64url-encoded-aad',
  })
  aad: string;

  @ApiProperty({
    description: 'Base64URL-encoded AES-GCM ciphertext (includes authentication tag)',
    example: 'base64url-encoded-ciphertext',
  })
  ciphertext: string;

  @ApiProperty({
    description: 'Base64URL-encoded ML-DSA digital signature',
    example: 'base64url-encoded-signature',
  })
  sig: string;

  @ApiProperty({
    description: 'Base64URL-encoded server signing public key',
    example: 'base64url-encoded-server-public-key',
  })
  server_sig_pk: string;
}

/**
 * Response for check-key endpoint
 */
export class CheckKeyResponseDto {
  @ApiProperty({
    description: 'Indicates if the API key is valid',
    example: true,
  })
  ok: boolean;
}

/**
 * Algorithms configuration for server info
 */
export class AlgorithmsDto {
  @ApiProperty({
    description: 'Key encapsulation mechanism algorithm',
    example: 'ML-KEM-768',
  })
  kem: string;

  @ApiProperty({
    description: 'Digital signature algorithm',
    example: 'ML-DSA-65',
  })
  sig: string;

  @ApiProperty({
    description: 'Authenticated encryption algorithm',
    example: 'AES-256-GCM',
  })
  aead: string;

  @ApiProperty({
    description: 'Key derivation function',
    example: 'HKDF-SHA-512',
  })
  kdf: string;
}

/**
 * Response for server-info endpoint
 */
export class ServerInfoResponseDto {
  @ApiProperty({
    description: 'Base64URL-encoded server signing public key for ML-DSA-65',
    example: 'base64url-encoded-public-key',
  })
  serverSigPk: string;

  @ApiProperty({
    description: 'Cryptographic algorithms supported by the server',
    type: AlgorithmsDto,
  })
  algs: AlgorithmsDto;

  @ApiProperty({
    description: 'Context string for the encryption scheme',
    example: 'vaultsandbox:email:v1',
  })
  context: string;

  @ApiProperty({
    description: 'Maximum time-to-live for inboxes in seconds',
    example: 86400,
  })
  maxTtl: number;

  @ApiProperty({
    description: 'Default time-to-live for inboxes in seconds',
    example: 3600,
  })
  defaultTtl: number;

  @ApiProperty({
    description: 'If server sse console is enabled',
    example: false,
  })
  sseConsole: boolean;

  @ApiProperty({
    description: 'If the clear all inboxes endpoint is enabled',
    example: true,
  })
  allowClearAllInboxes: boolean;

  @ApiProperty({
    description: 'List of domains allowed for inbox creation',
    example: ['vaultsandbox.test', 'example.com'],
    type: [String],
  })
  allowedDomains: string[];

  @ApiProperty({
    description:
      'Server encryption policy. "always"/"never" are locked (per-inbox override ignored). "enabled"/"disabled" allow per-inbox override.',
    enum: ['always', 'enabled', 'disabled', 'never'],
    example: 'always',
  })
  encryptionPolicy: 'always' | 'enabled' | 'disabled' | 'never';

  @ApiProperty({
    description: 'Whether the webhook system is enabled on this server',
    example: true,
  })
  webhookEnabled: boolean;

  @ApiProperty({
    description: 'Default value for webhook requireAuth filter when not specified',
    example: true,
  })
  webhookRequireAuthDefault: boolean;

  @ApiProperty({
    description: 'Whether spam analysis (Rspamd) is enabled on this server',
    example: false,
  })
  spamAnalysisEnabled: boolean;

  @ApiProperty({
    description: 'Whether chaos engineering is enabled on this server',
    example: false,
  })
  chaosEnabled: boolean;
}

/**
 * Response for create inbox endpoint
 */
export class CreateInboxResponseDto {
  @ApiProperty({
    description: 'The email address assigned to the inbox',
    example: 'abc12345@vaultsandbox.test',
  })
  emailAddress: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the inbox will expire',
    example: '2025-01-21T12:00:00.000Z',
  })
  expiresAt: string;

  @ApiProperty({
    description:
      'Unique inbox identifier (Base64URL SHA-256 hash). Derived from clientKemPk when encrypted, or email address when plain.',
    example: 'base64url-encoded-inbox-hash',
  })
  inboxHash: string;

  @ApiProperty({
    description: 'Whether encryption is enabled for this inbox',
    example: true,
  })
  encrypted: boolean;

  @ApiProperty({
    description: 'Whether email authentication (SPF, DKIM, DMARC, PTR) is enabled for this inbox',
    example: true,
  })
  emailAuth: boolean;

  @ApiPropertyOptional({
    description: 'Whether spam analysis (Rspamd) is enabled for this inbox. Omitted means using server default.',
    example: true,
  })
  spamAnalysis?: boolean;

  @ApiPropertyOptional({
    description: 'Chaos engineering configuration. Only present when VSB_CHAOS_ENABLED=true and chaos was configured.',
  })
  chaos?: InboxChaosConfig;

  @ApiPropertyOptional({
    description:
      'Base64URL-encoded server signing public key for verifying server signatures. Only present when encrypted is true.',
    example: 'base64url-encoded-server-public-key',
  })
  serverSigPk?: string;
}

/**
 * Individual email item in list response
 */
export class EmailListItemDto {
  @ApiProperty({
    description: 'Unique identifier for the email (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Encrypted email metadata (contains id, from, subject, receivedAt)',
    type: EncryptedPayloadDto,
  })
  encryptedMetadata: EncryptedPayloadDto;

  @ApiProperty({
    description: 'Indicates if the email has been marked as read',
    example: false,
  })
  isRead: boolean;

  @ApiProperty({
    description: 'Encrypted parsed email content (only included when includeContent=true)',
    type: EncryptedPayloadDto,
    required: false,
  })
  encryptedParsed?: EncryptedPayloadDto;
}

/**
 * Response for list emails endpoint
 */
export class ListEmailsResponseDto {
  @ApiProperty({
    description: 'Array of emails in the inbox',
    type: [EmailListItemDto],
  })
  emails: EmailListItemDto[];
}

/**
 * Response for sync status endpoint
 */
export class SyncStatusResponseDto {
  @ApiProperty({
    description: 'SHA-256 hash of sorted email IDs for synchronization checks',
    example: 'base64url-encoded-emails-hash',
  })
  emailsHash: string;

  @ApiProperty({
    description: 'Total number of emails in the inbox',
    example: 5,
  })
  emailCount: number;
}

/**
 * Response for get email endpoint (without raw content)
 */
export class EmailResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the email (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Encrypted email metadata (contains id, from, subject, receivedAt)',
    type: EncryptedPayloadDto,
  })
  encryptedMetadata: EncryptedPayloadDto;

  @ApiProperty({
    description: 'Encrypted parsed email content (text, html, attachments)',
    type: EncryptedPayloadDto,
  })
  encryptedParsed: EncryptedPayloadDto;

  @ApiProperty({
    description: 'Indicates if the email has been marked as read',
    example: false,
  })
  isRead: boolean;
}

/**
 * Response for get raw email endpoint
 */
export class RawEmailResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the email (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Encrypted raw email source',
    type: EncryptedPayloadDto,
  })
  encryptedRaw: EncryptedPayloadDto;
}

/**
 * Spam symbol DTO for individual triggered rules
 */
export class SpamSymbolDto implements SpamSymbol {
  @ApiProperty({ description: 'Rule/symbol name', example: 'MISSING_HEADERS' })
  name: string;

  @ApiProperty({ description: 'Score contribution', example: 1.5 })
  score: number;

  @ApiPropertyOptional({ description: 'Description', example: 'Missing important headers' })
  description?: string;

  @ApiPropertyOptional({ description: 'Additional options', type: [String] })
  options?: string[];
}

/**
 * Spam analysis result DTO
 */
export class SpamAnalysisDto implements SpamAnalysisResult {
  @ApiProperty({
    description: 'Analysis status',
    enum: ['analyzed', 'skipped', 'error'],
    example: 'analyzed',
  })
  status: 'analyzed' | 'skipped' | 'error';

  @ApiPropertyOptional({ description: 'Overall spam score', example: 3.5 })
  score?: number;

  @ApiPropertyOptional({ description: 'Required score threshold', example: 6.0 })
  requiredScore?: number;

  @ApiPropertyOptional({
    description: 'Recommended action',
    enum: ['no action', 'greylist', 'add header', 'rewrite subject', 'soft reject', 'reject'],
    example: 'no action',
  })
  action?: 'no action' | 'greylist' | 'add header' | 'rewrite subject' | 'soft reject' | 'reject';

  @ApiPropertyOptional({ description: 'Whether classified as spam', example: false })
  isSpam?: boolean;

  @ApiPropertyOptional({ description: 'Triggered rules', type: [SpamSymbolDto] })
  symbols?: SpamSymbolDto[];

  @ApiPropertyOptional({ description: 'Processing time in ms', example: 45 })
  processingTimeMs?: number;

  @ApiPropertyOptional({ description: 'Error or skip reason' })
  info?: string;
}

/**
 * Response for clear all inboxes endpoint
 */
export class ClearAllInboxesResponseDto {
  @ApiProperty({
    description: 'Number of inboxes deleted',
    example: 10,
  })
  deleted: number;
}
