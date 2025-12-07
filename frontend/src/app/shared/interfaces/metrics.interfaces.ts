export interface Metrics {
  connections: {
    total: number;
    active: number;
    rejected: number;
  };
  inbox: {
    created_total: number;
    deleted_total: number;
    active_total: number;
  };
  email: {
    received_total: number;
    recipients_total: number;
    processing_time_ms: number;
  };
  rejections: {
    invalid_commands: number;
    sender_rejected_total: number;
    recipient_rejected_total: number;
    data_rejected_size_total: number;
    hard_mode_total: number;
    rate_limit_total: number;
  };
  auth: {
    spf_pass: number;
    spf_fail: number;
    dkim_pass: number;
    dkim_fail: number;
    dmarc_pass: number;
    dmarc_fail: number;
  };
  certificate: {
    days_until_expiry: number;
    renewal_attempts: number;
    renewal_success: number;
    renewal_failures: number;
  };
  server: {
    uptime_seconds: number;
  };
}

export interface AuthPassRate {
  spf: number;
  dkim: number;
  dmarc: number;
}

export type CertificateStatus = 'healthy' | 'warning' | 'critical' | 'expired' | 'disabled';

export interface StorageMetrics {
  storage: {
    maxMemoryBytes: number;
    maxMemoryMB: string;
    usedMemoryBytes: number;
    usedMemoryMB: string;
    availableMemoryBytes: number;
    availableMemoryMB: string;
    utilizationPercent: string;
  };
  emails: {
    totalStored: number;
    totalEvicted: number;
    tombstones: number;
    oldestEmailAge: number | null;
    newestEmailAge: number | null;
  };
  eviction: {
    maxAgeSeconds: number | null;
    maxAgeEnabled: boolean;
  };
  error?: string;
  reason?: string;
}

export type StorageHealthStatus = 'healthy' | 'warning' | 'critical';
