import { IsString, IsOptional, IsInt, MaxLength, IsIn, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInboxDto {
  @ApiPropertyOptional({
    description: 'Base64URL-encoded ML-KEM-768 public key for key encapsulation. Required when encryption is enabled.',
    example: 'base64url-encoded-public-key',
  })
  @IsOptional()
  @IsString()
  clientKemPk?: string; // Base64URL-encoded ML-KEM-768 public key (optional for plain inboxes)

  @ApiProperty({
    description: 'Time-to-live for the inbox in seconds. Defaults to 1 hour.',
    minimum: 60,
    maximum: 604800, // 7 days
    required: false,
  })
  @IsOptional()
  @IsInt()
  ttl?: number; // Time-to-live in seconds

  @ApiPropertyOptional({
    description: 'Optional desired email address or domain. If not provided, a random address will be generated.',
    example: 'user@example.com',
    maxLength: 254,
  })
  @IsOptional()
  @IsString()
  @MaxLength(254) // RFC 5321 maximum email address length
  emailAddress?: string; // Optional full email or domain only

  @ApiPropertyOptional({
    description:
      'Encryption preference. Omit to use server default. Ignored if server is locked to "always" or "never".',
    enum: ['encrypted', 'plain'],
    example: 'encrypted',
  })
  @IsOptional()
  @IsIn(['encrypted', 'plain'])
  encryption?: 'encrypted' | 'plain';

  @ApiPropertyOptional({
    description:
      'Email authentication (SPF, DKIM, DMARC, PTR) preference. Omit to use server default (VSB_EMAIL_AUTH_INBOX_DEFAULT).',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  emailAuth?: boolean;

  @ApiPropertyOptional({
    description: 'Spam analysis (Rspamd) preference. Omit to use server default (VSB_SPAM_ANALYSIS_INBOX_DEFAULT).',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  spamAnalysis?: boolean;
}
