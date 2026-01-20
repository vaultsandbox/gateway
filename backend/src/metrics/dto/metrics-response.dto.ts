import { ApiProperty } from '@nestjs/swagger';

/**
 * Connection-related metrics
 */
export class ConnectionMetricsDto {
  @ApiProperty({
    description: 'Total number of connections established',
    example: 150,
  })
  total: number;

  @ApiProperty({
    description: 'Number of currently active connections',
    example: 5,
  })
  active: number;

  @ApiProperty({
    description: 'Total number of connections that were rejected',
    example: 2,
  })
  rejected: number;
}

/**
 * Inbox-related metrics
 */
export class InboxMetricsDto {
  @ApiProperty({
    description: 'Total number of inboxes created',
    example: 42,
  })
  created_total: number;

  @ApiProperty({
    description: 'Total number of inboxes deleted',
    example: 12,
  })
  deleted_total: number;

  @ApiProperty({
    description: 'Number of currently active inboxes',
    example: 30,
  })
  active_total: number;
}

/**
 * Email processing metrics
 */
export class EmailMetricsDto {
  @ApiProperty({
    description: 'Total number of emails received',
    example: 1024,
  })
  received_total: number;

  @ApiProperty({
    description: 'Total number of email recipients processed',
    example: 1256,
  })
  recipients_total: number;

  @ApiProperty({
    description: 'Average processing time in milliseconds for email handling',
    example: 150,
  })
  processing_time_ms: number;
}

/**
 * Rejection metrics
 */
export class RejectionMetricsDto {
  @ApiProperty({
    description: 'Number of invalid SMTP commands received',
    example: 3,
  })
  invalid_commands: number;

  @ApiProperty({
    description: 'Total number of senders that were rejected',
    example: 5,
  })
  sender_rejected_total: number;

  @ApiProperty({
    description: 'Total number of recipients that were rejected',
    example: 8,
  })
  recipient_rejected_total: number;

  @ApiProperty({
    description: 'Total number of emails rejected due to size limits',
    example: 2,
  })
  data_rejected_size_total: number;

  @ApiProperty({
    description: 'Total number of rejections due to hard mode enforcement',
    example: 0,
  })
  hard_mode_total: number;

  @ApiProperty({
    description: 'Total number of rejections due to rate limiting',
    example: 1,
  })
  rate_limit_total: number;
}

/**
 * Authentication metrics
 */
export class AuthMetricsDto {
  @ApiProperty({
    description: 'Number of emails passing SPF verification',
    example: 980,
  })
  spf_pass: number;

  @ApiProperty({
    description: 'Number of emails failing SPF verification',
    example: 44,
  })
  spf_fail: number;

  @ApiProperty({
    description: 'Number of emails passing DKIM verification',
    example: 950,
  })
  dkim_pass: number;

  @ApiProperty({
    description: 'Number of emails failing DKIM verification',
    example: 74,
  })
  dkim_fail: number;

  @ApiProperty({
    description: 'Number of emails passing DMARC verification',
    example: 920,
  })
  dmarc_pass: number;

  @ApiProperty({
    description: 'Number of emails failing DMARC verification',
    example: 104,
  })
  dmarc_fail: number;
}

/**
 * Certificate metrics
 */
export class CertificateMetricsDto {
  @ApiProperty({
    description: 'Number of days until the certificate expires',
    example: 45,
  })
  days_until_expiry: number;

  @ApiProperty({
    description: 'Number of certificate renewal attempts made',
    example: 3,
  })
  renewal_attempts: number;

  @ApiProperty({
    description: 'Number of successful certificate renewals',
    example: 3,
  })
  renewal_success: number;

  @ApiProperty({
    description: 'Number of failed certificate renewal attempts',
    example: 0,
  })
  renewal_failures: number;
}

/**
 * Server metrics
 */
export class ServerMetricsDto {
  @ApiProperty({
    description: 'Server uptime in seconds since last restart',
    example: 86400,
  })
  uptime_seconds: number;
}

/**
 * Spam analysis metrics
 */
export class SpamMetricsDto {
  @ApiProperty({
    description: 'Total number of emails successfully analyzed for spam',
    example: 980,
  })
  analyzed_total: number;

  @ApiProperty({
    description: 'Total number of emails where spam analysis was skipped',
    example: 44,
  })
  skipped_total: number;

  @ApiProperty({
    description: 'Total number of spam analysis errors',
    example: 2,
  })
  errors_total: number;

  @ApiProperty({
    description: 'Total number of emails classified as spam',
    example: 15,
  })
  spam_detected_total: number;

  @ApiProperty({
    description: 'Total processing time for spam analysis in milliseconds',
    example: 4500,
  })
  processing_time_ms: number;
}

/**
 * Response for GET /api/metrics endpoint
 * Contains all system metrics tracked by the application
 */
export class MetricsResponseDto {
  @ApiProperty({
    description: 'Connection-related metrics',
    type: ConnectionMetricsDto,
  })
  connections: ConnectionMetricsDto;

  @ApiProperty({
    description: 'Inbox-related metrics',
    type: InboxMetricsDto,
  })
  inbox: InboxMetricsDto;

  @ApiProperty({
    description: 'Email processing metrics',
    type: EmailMetricsDto,
  })
  email: EmailMetricsDto;

  @ApiProperty({
    description: 'Rejection metrics',
    type: RejectionMetricsDto,
  })
  rejections: RejectionMetricsDto;

  @ApiProperty({
    description: 'Authentication metrics for SPF, DKIM, and DMARC',
    type: AuthMetricsDto,
  })
  auth: AuthMetricsDto;

  @ApiProperty({
    description: 'Certificate status and renewal metrics',
    type: CertificateMetricsDto,
  })
  certificate: CertificateMetricsDto;

  @ApiProperty({
    description: 'Server uptime and availability metrics',
    type: ServerMetricsDto,
  })
  server: ServerMetricsDto;

  @ApiProperty({
    description: 'Spam analysis metrics',
    type: SpamMetricsDto,
  })
  spam: SpamMetricsDto;
}
