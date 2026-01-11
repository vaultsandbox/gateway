/**
 * Computes the emailsHash for an inbox using the same algorithm as the server.
 * Algorithm: base64url(sha256(sortedIds.join(",")))
 */
export async function computeEmailsHash(emailIds: string[]): Promise<string> {
  const sortedIds = [...emailIds].sort();
  const joined = sortedIds.join(',');

  const encoder = new TextEncoder();
  const data = encoder.encode(joined);

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  return bufferToBase64Url(hashBuffer);
}

/**
 * Converts an ArrayBuffer to a Base64URL string (RFC 4648 §5, no padding).
 */
function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
