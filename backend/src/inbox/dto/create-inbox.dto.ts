import { IsString, IsOptional, IsInt, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInboxDto {
  @ApiProperty({
    description: 'Base64URL-encoded ML-KEM-768 public key for key encapsulation.',
    example: 'base64url-encoded-public-key',
  })
  @IsString()
  clientKemPk: string; // Base64URL-encoded ML-KEM-768 public key

  @ApiProperty({
    description: 'Time-to-live for the inbox in seconds. Defaults to 1 hour.',
    minimum: 60,
    maximum: 604800, // 7 days
    required: false,
  })
  @IsOptional()
  @IsInt()
  ttl?: number; // Time-to-live in seconds

  @ApiProperty({
    description: 'Optional desired email address or domain. If not provided, a random address will be generated.',
    example: 'user@example.com',
    required: false,
    maxLength: 254,
  })
  @IsOptional()
  @IsString()
  @MaxLength(254) // RFC 5321 maximum email address length
  emailAddress?: string; // Optional full email or domain only
}
