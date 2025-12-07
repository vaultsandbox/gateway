import type { Response } from 'supertest';
import type { ApiClient } from './api-client';

/**
 * Validates encrypted payload structure
 */
export function expectEncryptedPayload(payload: any) {
  expect(payload).toEqual(
    expect.objectContaining({
      v: 1,
      algs: expect.objectContaining({
        kem: 'ML-KEM-768',
        sig: 'ML-DSA-65',
        aead: 'AES-256-GCM',
      }),
      ct_kem: expect.any(String),
      nonce: expect.any(String),
      aad: expect.any(String),
      ciphertext: expect.any(String),
      sig: expect.any(String),
      server_sig_pk: expect.any(String),
    }),
  );
}

/**
 * Validates inbox creation response structure
 */
export function expectInboxResponse(response: any) {
  expect(response).toEqual(
    expect.objectContaining({
      emailAddress: expect.stringMatching(/@/),
      expiresAt: expect.any(String),
      serverSigPk: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    }),
  );
}

/**
 * Validates email metadata structure (encrypted)
 */
export function expectEmailMetadata(email: any) {
  expect(email).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      isRead: expect.any(Boolean),
      encryptedMetadata: expect.any(Object),
    }),
  );
  expectEncryptedPayload(email.encryptedMetadata);
}

/**
 * Validates full email structure (encrypted metadata + parsed)
 */
export function expectFullEmail(email: any) {
  expect(email).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      isRead: expect.any(Boolean),
      encryptedMetadata: expect.any(Object),
      encryptedParsed: expect.any(Object),
    }),
  );
  expectEncryptedPayload(email.encryptedMetadata);
  expectEncryptedPayload(email.encryptedParsed);
}

/**
 * Validates server info response structure
 */
export function expectServerInfo(serverInfo: any) {
  expect(serverInfo).toEqual(
    expect.objectContaining({
      serverSigPk: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      algs: expect.objectContaining({
        kem: 'ML-KEM-768',
        sig: 'ML-DSA-65',
        aead: 'AES-256-GCM',
        kdf: 'HKDF-SHA-512',
      }),
      context: 'vaultsandbox:email:v1',
    }),
  );
}

/**
 * Validates inbox sync status response structure
 */
export function expectInboxSyncStatus(syncStatus: any) {
  expect(syncStatus).toEqual(
    expect.objectContaining({
      emailsHash: expect.any(String),
      emailCount: expect.any(Number),
    }),
  );
}

/**
 * Validates decrypted email metadata structure
 */
export interface DecryptedMetadata {
  id: string;
  from: string;
  to: string; // Single recipient address (not an array)
  subject: string;
  receivedAt: string;
}

export function expectDecryptedMetadata(metadata: DecryptedMetadata) {
  expect(metadata).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      from: expect.any(String),
      to: expect.stringMatching(/@/),
      subject: expect.any(String),
      receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }),
  );
}

/**
 * Validates decrypted parsed email structure
 */
export interface DecryptedParsed {
  text?: string;
  html?: string;
  textAsHtml?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

export function expectDecryptedParsed(parsed: DecryptedParsed) {
  expect(parsed).toEqual(
    expect.objectContaining({
      text: expect.any(String),
    }),
  );
}

/**
 * Polls for emails until at least one appears or timeout
 * @param client API client instance
 * @param emailAddress Inbox email address
 * @param timeoutMs Maximum time to wait in milliseconds
 * @param expectedCount Expected number of emails (default: 1)
 * @returns Array of emails
 */
export async function pollForEmails(
  client: ApiClient,
  emailAddress: string,
  timeoutMs = 10_000,
  expectedCount = 1,
): Promise<any[]> {
  const startedAt = Date.now();
  let delay = 200;

  while (Date.now() - startedAt < timeoutMs) {
    const response: Response = await client.listInboxEmails(emailAddress).expect(200);
    if (Array.isArray(response.body) && response.body.length >= expectedCount) {
      return response.body;
    }
    await wait(delay);
    delay = Math.min(delay * 2, 1000);
  }

  throw new Error(`Timed out waiting for ${expectedCount} email(s) in inbox ${emailAddress}`);
}

/**
 * Waits for a specified duration
 * @param durationMs Duration in milliseconds
 */
export function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Validates that an inbox is empty
 * @param client API client instance
 * @param emailAddress Inbox email address
 */
export async function expectEmptyInbox(client: ApiClient, emailAddress: string): Promise<void> {
  const response = await client.listInboxEmails(emailAddress).expect(200);
  expect(response.body).toEqual([]);
}

/**
 * Creates an inbox with a generated client keypair
 * @param client API client instance
 * @param clientKemPk Client KEM public key (Base64URL)
 * @param ttl Optional TTL in seconds
 * @returns Inbox response
 */
export async function createTestInbox(client: ApiClient, clientKemPk: string, ttl = 3600, emailAddress: string = '') {
  const response = await client.createInbox({ clientKemPk, ttl, emailAddress }).expect(201);
  expectInboxResponse(response.body);
  return response.body;
}
