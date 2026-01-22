/**
 * @interface Metrics
 * @description Contains all system metrics tracked by the application for monitoring and observability.
 * These metrics provide insights into system performance, usage patterns, and health status.
 */
export interface Metrics {
  /**
   * @property {object} connections - Connection-related metrics
   * @description Tracks SMTP connection statistics including total connections, active connections, and rejected connections.
   */
  connections: {
    /** Total number of connections established */
    total: number;
    /** Number of currently active connections */
    active: number;
    /** Total number of connections that were rejected */
    rejected: number;
  };

  /**
   * @property {object} inbox - Inbox-related metrics
   * @description Tracks inbox lifecycle metrics including creation, deletion, and active inbox counts.
   */
  inbox: {
    /** Total number of inboxes created */
    created_total: number;
    /** Total number of inboxes deleted */
    deleted_total: number;
    /** Number of currently active inboxes */
    active_total: number;
  };

  /**
   * @property {object} email - Email processing metrics
   * @description Tracks email processing statistics including volume and performance metrics.
   */
  email: {
    /** Total number of emails received */
    received_total: number;
    /** Total number of email recipients processed */
    recipients_total: number;
    /** Average processing time in milliseconds for email handling */
    processing_time_ms: number;
  };

  /**
   * @property {object} rejections - Rejection metrics
   * @description Tracks various reasons for email rejection to help identify issues and patterns.
   */
  rejections: {
    /** Number of invalid SMTP commands received */
    invalid_commands: number;
    /** Total number of senders that were rejected */
    sender_rejected_total: number;
    /** Total number of recipients that were rejected */
    recipient_rejected_total: number;
    /** Total number of emails rejected due to size limits */
    data_rejected_size_total: number;
    /** Total number of rejections due to hard mode enforcement */
    hard_mode_total: number;
    /** Total number of rejections due to rate limiting */
    rate_limit_total: number;
  };

  /**
   * @property {object} auth - Authentication metrics
   * @description Tracks email authentication results for security monitoring.
   */
  auth: {
    /** Number of emails passing SPF verification */
    spf_pass: number;
    /** Number of emails failing SPF verification */
    spf_fail: number;
    /** Number of emails passing DKIM verification */
    dkim_pass: number;
    /** Number of emails failing DKIM verification */
    dkim_fail: number;
    /** Number of emails passing DMARC verification */
    dmarc_pass: number;
    /** Number of emails failing DMARC verification */
    dmarc_fail: number;
  };

  /**
   * @property {object} certificate - Certificate metrics
   * @description Tracks SSL/TLS certificate status and renewal metrics.
   */
  certificate: {
    /** Number of days until the certificate expires */
    days_until_expiry: number;
    /** Number of certificate renewal attempts made */
    renewal_attempts: number;
    /** Number of successful certificate renewals */
    renewal_success: number;
    /** Number of failed certificate renewal attempts */
    renewal_failures: number;
  };

  /**
   * @property {object} server - Server metrics
   * @description Tracks server uptime and availability metrics.
   */
  server: {
    /** Server uptime in seconds since last restart */
    uptime_seconds: number;
  };

  /**
   * @property {object} spam - Spam analysis metrics
   * @description Tracks spam analysis results and performance.
   */
  spam: {
    /** Total number of emails successfully analyzed for spam */
    analyzed_total: number;
    /** Total number of emails where spam analysis was skipped */
    skipped_total: number;
    /** Total number of spam analysis errors */
    errors_total: number;
    /** Total number of emails classified as spam */
    spam_detected_total: number;
    /** Total processing time for spam analysis in milliseconds */
    processing_time_ms: number;
  };

  /**
   * @property {object} chaos - Chaos engineering metrics
   * @description Tracks chaos engineering events and their effects.
   */
  chaos: {
    /** Total number of chaos events applied */
    events_total: number;
    /** Total latency injected in milliseconds */
    latency_injected_ms: number;
    /** Total number of chaos errors returned */
    errors_returned_total: number;
    /** Total number of connections dropped by chaos */
    connections_dropped_total: number;
    /** Total number of greylist rejections by chaos */
    greylist_rejections_total: number;
    /** Total number of emails blackholed by chaos */
    blackhole_total: number;
  };
}
