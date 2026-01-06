import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as process from 'process';
import { BOOLEAN_TRUE_VALUES } from './config.constants';
import { isValidDomain } from './config.validators';

export function parseOptionalBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.includes(normalized)) {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return defaultValue;
}

export function parseNumberWithDefault(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric value: "${value}" (must be a non-negative finite number)`);
  }

  // Ensure integer for configuration values (ports, timeouts, sizes)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid numeric value: "${value}" (must be an integer)`);
  }

  return parsed;
}

/**
 * Parses a string environment variable with a default value.
 *
 * Returns the provided value if present, otherwise returns the default.
 * Used for optional string configuration values.
 *
 * @param value - The string value to parse
 * @param defaultValue - The default value to return if not provided
 * @returns The value or default
 */
export function parseStringWithDefault(value: string | undefined, defaultValue: string): string {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value;
}

/**
 * Reads a TLS certificate or key file from disk.
 *
 * Resolves the provided path and reads the file contents as a Buffer.
 * Used for loading SSL/TLS certificates and private keys.
 * If the file doesn't exist yet, returns undefined to allow the app to start
 * before certificates are generated.
 * Validates that the file contains PEM-formatted data.
 *
 * @param path - Path to the certificate or key file
 * @returns Buffer containing the file contents, or undefined if path not provided or file doesn't exist
 * @throws {Error} If file exists but is not in valid PEM format
 */
export function readTlsBuffer(path: string | undefined): Buffer | undefined {
  if (!path) {
    return undefined;
  }
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) {
    return undefined;
  }

  const buffer = readFileSync(fullPath);

  // Validate PEM format (certificates and keys should have BEGIN/END markers)
  const content = buffer.toString();
  if (!content.includes('-----BEGIN') || !content.includes('-----END')) {
    throw new Error(`Invalid certificate/key format in ${path}: File must be in PEM format`);
  }

  return buffer;
}

/**
 * Parses allowed recipient domains from environment variable.
 *
 * Domains should be comma-separated in the environment variable.
 * This is critical for security - only emails to these domains will be accepted,
 * preventing the server from being used as an open relay.
 *
 * @returns Array of allowed domain names (lowercased for case-insensitive matching)
 * @throws {Error} If no domains are configured (required for receive-only server)
 * @example
 * ```
 * VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS=example.com,example.org
 * // Returns: ['example.com', 'example.org']
 * ```
 */
export function parseAllowedDomains(): string[] {
  const domainsEnv = process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS;

  if (!domainsEnv || !domainsEnv.trim()) {
    throw new Error(
      'VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is required. Specify comma-separated domains (e.g., "example.com,example.org")',
    );
  }

  const domains = domainsEnv
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);

  if (domains.length === 0) {
    throw new Error('VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS must contain at least one valid domain');
  }

  // Validate domain formats
  const invalidDomains = domains.filter((d) => !isValidDomain(d));
  if (invalidDomains.length > 0) {
    throw new Error(`Invalid domain format in VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS: ${invalidDomains.join(', ')}`);
  }

  return domains;
}

/**
 * Parses disabled SMTP commands from environment variable.
 *
 * Commands should be comma-separated in the environment variable.
 * Common commands to disable: VRFY, EXPN, ETRN, TURN, AUTH
 *
 * @param defaultCommands - Default commands to disable if env var not set
 * @returns Array of disabled command names (uppercased)
 * @example
 * ```
 * VSB_SMTP_DISABLED_COMMANDS=VRFY,EXPN,ETRN,TURN,AUTH
 * // Returns: ['VRFY', 'EXPN', 'ETRN', 'TURN', 'AUTH']
 * ```
 */
export function parseDisabledCommands(defaultCommands: string[] = []): string[] {
  const commandsEnv = process.env.VSB_SMTP_DISABLED_COMMANDS;

  if (!commandsEnv || !commandsEnv.trim()) {
    return defaultCommands;
  }

  return commandsEnv
    .split(',')
    .map((cmd) => cmd.trim().toUpperCase())
    .filter((cmd) => cmd.length > 0);
}
