import { IsString, IsOptional, IsIn, ValidateNested, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const SPF_RESULTS = ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror'] as const;
const DKIM_RESULTS = ['pass', 'fail', 'none'] as const;
const DMARC_RESULTS = ['pass', 'fail', 'none'] as const;
const REVERSE_DNS_RESULTS = ['pass', 'fail', 'none'] as const;

export type SpfResult = (typeof SPF_RESULTS)[number];
export type DkimResult = (typeof DKIM_RESULTS)[number];
export type DmarcResult = (typeof DMARC_RESULTS)[number];
export type ReverseDnsResult = (typeof REVERSE_DNS_RESULTS)[number];

export class AuthOptionsDto {
  @ApiPropertyOptional({
    description: 'SPF authentication result',
    enum: SPF_RESULTS,
    default: 'pass',
  })
  @IsOptional()
  @IsIn(SPF_RESULTS)
  spf?: SpfResult;

  @ApiPropertyOptional({
    description: 'DKIM authentication result',
    enum: DKIM_RESULTS,
    default: 'pass',
  })
  @IsOptional()
  @IsIn(DKIM_RESULTS)
  dkim?: DkimResult;

  @ApiPropertyOptional({
    description: 'DMARC authentication result',
    enum: DMARC_RESULTS,
    default: 'pass',
  })
  @IsOptional()
  @IsIn(DMARC_RESULTS)
  dmarc?: DmarcResult;

  @ApiPropertyOptional({
    description: 'Reverse DNS verification result',
    enum: REVERSE_DNS_RESULTS,
    default: 'pass',
  })
  @IsOptional()
  @IsIn(REVERSE_DNS_RESULTS)
  reverseDns?: ReverseDnsResult;
}

export class CreateTestEmailDto {
  @ApiProperty({
    description: 'Inbox email address to deliver the test email to',
    example: 'inbox@vaultsandbox.test',
  })
  @IsString()
  @MaxLength(254)
  to: string;

  @ApiPropertyOptional({
    description: 'Sender email address',
    example: 'sender@example.com',
    default: 'test@vaultsandbox.test',
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  from?: string;

  @ApiPropertyOptional({
    description: 'Email subject line',
    example: 'Test Email Subject',
    default: 'Test Email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(998) // RFC 5322 maximum line length
  subject?: string;

  @ApiPropertyOptional({
    description: 'Plain text email body',
    example: 'This is the plain text body of the test email.',
    default: 'Test email body',
  })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    description: 'HTML email body',
    example: '<p>This is the HTML body of the test email.</p>',
  })
  @IsOptional()
  @IsString()
  html?: string;

  @ApiPropertyOptional({
    description: 'Controlled authentication results for the test email',
    type: AuthOptionsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AuthOptionsDto)
  auth?: AuthOptionsDto;
}
