import { ApiProperty } from '@nestjs/swagger';
import { EncryptedPayloadDto } from '../../inbox/dto/response.dto';

/**
 * Response for SSE new-email events
 * Emitted when a new email arrives in a subscribed inbox
 */
export class NewEmailEventDto {
  @ApiProperty({
    description: 'The inbox hash that received the email',
    example: 'base64url-encoded-inbox-hash',
  })
  inboxId: string;

  @ApiProperty({
    description: 'Unique identifier for the email (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  emailId: string;

  @ApiProperty({
    description:
      'End-to-end encrypted email metadata (id, from, to, subject, receivedAt). Uses AES-256-GCM with ML-KEM-768 key encapsulation and ML-DSA-65 signatures.',
    type: EncryptedPayloadDto,
  })
  encryptedMetadata: EncryptedPayloadDto;
}
