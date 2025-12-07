/**
 * Configuration for the certificate management module.
 */
export interface CertificateConfig {
  /** Whether certificate management is enabled. */
  enabled: boolean;
  /** Email address for ACME account registration and notifications. */
  email: string;
  /** The primary domain for the certificate. */
  domain: string;
  /** Optional additional domains (Subject Alternative Names). */
  additionalDomains?: string[];
  /** Path to store certificates and ACME account keys. */
  storagePath: string;
  /** Interval in milliseconds to check for certificate renewal. */
  checkInterval: number;
  /** Number of days before expiry to trigger a renewal. */
  renewDaysBeforeExpiry: number;
  /** The ACME directory URL (e.g., Let's Encrypt's production or staging URL). */
  acmeDirectoryUrl: string;
  /** Whether to use the ACME staging environment. */
  staging: boolean;
  /** A shared secret for authenticating peer-to-peer communication in a cluster. */
  peerSharedSecret: string;
}

/**
 * Represents a loaded or newly issued SSL certificate.
 */
export interface Certificate {
  /** The private key for the certificate (PEM format). */
  privateKey: Buffer;
  /** The server certificate (PEM format). */
  certificate: Buffer;
  /** The certificate chain (PEM format, optional). */
  chain?: Buffer;
  /** The full certificate chain including the server certificate (PEM format, optional). */
  fullchain?: Buffer;
  /** The list of domains covered by this certificate. */
  domains: string[];
  /** The date when the certificate was issued. */
  issuedAt: Date;
  /** The date when the certificate expires. */
  expiresAt: Date;
}

/**
 * Represents the current status of the managed certificate.
 */
export interface CertificateStatus {
  /** Whether a certificate exists in storage. */
  exists: boolean;
  /** Whether the existing certificate is currently valid. */
  valid: boolean;
  /** The primary domain of the certificate. */
  domain?: string;
  /** The date the certificate was issued. */
  issuedAt?: Date;
  /** The date the certificate expires. */
  expiresAt?: Date;
  /** The number of days until the certificate expires. */
  daysUntilExpiry?: number;
}

/**
 * Payload for synchronizing a certificate across a cluster.
 * Data is Base64 encoded for safe JSON transport.
 */
export interface CertificateSyncRequest {
  /** The server certificate (Base64 encoded). */
  certificate: string;
  /** The private key for the certificate (Base64 encoded). */
  privateKey: string;
  /** The certificate chain (Base64 encoded, optional). */
  chain?: string;
  /** The full certificate chain (Base64 encoded, optional). */
  fullchain?: string;
  /** Metadata associated with the certificate. */
  metadata: {
    /** The list of domains covered by the certificate. */
    domains: string[];
    /** The ISO 8601 string of the issuance date. */
    issuedAt: string;
    /** The ISO 8601 string of the expiry date. */
    expiresAt: string;
  };
}

/**
 * Payload for synchronizing an ACME challenge response across a cluster.
 */
export interface ChallengeSyncRequest {
  /** The ACME challenge token. */
  token: string;
  /** The key authorization string for the challenge. */
  keyAuth: string;
}
