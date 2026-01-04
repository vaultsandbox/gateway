import { ApiProperty } from '@nestjs/swagger';

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
    description: 'List of domains allowed for inbox creation',
    example: ['vaultsandbox.test', 'example.com'],
    type: [String],
  })
  allowedDomains: string[];
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
      'Base64URL-encoded SHA-256 hash of the client KEM public key, used for SSE subscriptions and API references',
    example: 'base64url-encoded-inbox-hash',
  })
  inboxHash: string;

  @ApiProperty({
    description: 'Base64URL-encoded server signing public key for verifying server signatures',
    example: 'base64url-encoded-server-public-key',
  })
  serverSigPk: string;
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
 * Response for clear all inboxes endpoint
 */
export class ClearAllInboxesResponseDto {
  @ApiProperty({
    description: 'Number of inboxes deleted',
    example: 10,
  })
  deleted: number;
}
