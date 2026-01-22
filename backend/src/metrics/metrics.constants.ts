export const METRIC_PATHS = {
  // Connections
  CONNECTIONS_TOTAL: 'connections.total',
  CONNECTIONS_ACTIVE: 'connections.active',
  CONNECTIONS_REJECTED: 'connections.rejected',

  // Email
  EMAIL_RECEIVED_TOTAL: 'email.received_total',
  EMAIL_RECIPIENTS_TOTAL: 'email.recipients_total',
  EMAIL_PROCESSING_TIME_MS: 'email.processing_time_ms',

  // Inbox
  INBOX_CREATED_TOTAL: 'inbox.created_total',
  INBOX_DELETED_TOTAL: 'inbox.deleted_total',
  INBOX_ACTIVE_TOTAL: 'inbox.active_total',

  // Rejections
  REJECTIONS_INVALID_COMMANDS: 'rejections.invalid_commands',
  REJECTIONS_SENDER_REJECTED: 'rejections.sender_rejected_total',
  REJECTIONS_RECIPIENT_REJECTED: 'rejections.recipient_rejected_total',
  REJECTIONS_DATA_SIZE: 'rejections.data_rejected_size_total',
  REJECTIONS_HARD_MODE: 'rejections.hard_mode_total',
  REJECTIONS_RATE_LIMIT: 'rejections.rate_limit_total',

  // Authentication
  AUTH_SPF_PASS: 'auth.spf_pass',
  AUTH_SPF_FAIL: 'auth.spf_fail',
  AUTH_DKIM_PASS: 'auth.dkim_pass',
  AUTH_DKIM_FAIL: 'auth.dkim_fail',
  AUTH_DMARC_PASS: 'auth.dmarc_pass',
  AUTH_DMARC_FAIL: 'auth.dmarc_fail',

  // Certificate
  CERT_DAYS_UNTIL_EXPIRY: 'certificate.days_until_expiry',
  CERT_RENEWAL_ATTEMPTS: 'certificate.renewal_attempts',
  CERT_RENEWAL_SUCCESS: 'certificate.renewal_success',
  CERT_RENEWAL_FAILURES: 'certificate.renewal_failures',

  // Server
  SERVER_UPTIME_SECONDS: 'server.uptime_seconds',

  // Spam Analysis
  SPAM_ANALYZED_TOTAL: 'spam.analyzed_total',
  SPAM_SKIPPED_TOTAL: 'spam.skipped_total',
  SPAM_ERRORS_TOTAL: 'spam.errors_total',
  SPAM_DETECTED_TOTAL: 'spam.spam_detected_total',
  SPAM_PROCESSING_TIME_MS: 'spam.processing_time_ms',

  // Chaos Engineering
  CHAOS_EVENTS_TOTAL: 'chaos.events_total',
  CHAOS_LATENCY_INJECTED_MS: 'chaos.latency_injected_ms',
  CHAOS_ERRORS_RETURNED_TOTAL: 'chaos.errors_returned_total',
  CHAOS_CONNECTIONS_DROPPED_TOTAL: 'chaos.connections_dropped_total',
  CHAOS_GREYLIST_REJECTIONS_TOTAL: 'chaos.greylist_rejections_total',
  CHAOS_BLACKHOLE_TOTAL: 'chaos.blackhole_total',
} as const;

export type MetricPath = (typeof METRIC_PATHS)[keyof typeof METRIC_PATHS];
