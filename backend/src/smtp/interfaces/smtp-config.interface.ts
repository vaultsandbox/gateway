export interface SmtpAuthConfig {
  username: string;
  password: string;
}

import type { SecureVersion } from 'tls';

export interface SmtpTlsConfig {
  cert?: Buffer;
  key?: Buffer;
  minVersion?: SecureVersion;
  ciphers?: string;
  honorCipherOrder?: boolean;
  ecdhCurve?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  maxMessageSize: number;
  maxHeaderSize: number;
  sessionTimeout: number;
  allowedRecipientDomains: string[];
  tls?: SmtpTlsConfig;

  // Security controls
  maxConnections: number;
  closeTimeout: number;
  disabledCommands: string[];
  disablePipelining: boolean;
  earlyTalkerDelay: number;
  banner: string;

  // Memory management for email storage
  maxMemoryMB: number;
  maxEmailAgeSeconds: number;
}
