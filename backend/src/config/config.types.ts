import type { SecureVersion } from 'tls';

/**
 * Configuration type definition for type-safe access
 */
export interface VsbConfiguration {
  environment: string;
  main: {
    port: number;
    httpsEnabled: boolean;
    httpsPort: number;
    origin: string;
    backend: {
      url?: string;
      apiKey?: string;
      timeout: number;
    };
    gatewayMode: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    maxMessageSize: number;
    maxHeaderSize: number;
    sessionTimeout: number;
    allowedRecipientDomains: string[];
    tls?: {
      cert: Buffer;
      key: Buffer;
      minVersion: SecureVersion;
      ciphers: string;
      honorCipherOrder: boolean;
      ecdhCurve: string;
    };
    maxConnections: number;
    closeTimeout: number;
    disabledCommands: string[];
    disablePipelining: boolean;
    earlyTalkerDelay: number;
    banner: string;
    maxMemoryMB: number;
    maxEmailAgeSeconds: number;
  };
  orchestration: {
    enabled: boolean;
    clusterName: string;
    nodeId: string;
    peers: string[];
    backend: {
      url: string;
      apiKey: string;
      timeout: number;
    };
    leadership: {
      ttl: number;
    };
  };
  certificate: {
    enabled: boolean;
    email: string;
    domain: string;
    additionalDomains: string[];
    storagePath: string;
    checkInterval: number;
    renewDaysBeforeExpiry: number;
    acmeDirectoryUrl: string;
    staging: boolean;
    peerSharedSecret: string;
  };
  local?: {
    apiKey: string;
    inboxDefaultTtl: number;
    inboxMaxTtl: number;
    cleanupInterval: number;
    inboxAliasRandomBytes: number;
    hardModeRejectCode: number;
  };
  crypto: {
    sigSkPath?: string;
    sigPkPath?: string;
  };
  throttle: {
    ttl: number;
    limit: number;
  };
  smtpRateLimit: {
    enabled: boolean;
    points: number;
    duration: number;
  };
  sseConsole: {
    enabled: boolean;
  };
}
