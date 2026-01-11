import { computeEmailsHash } from '../emails-hash.helper';

describe('computeEmailsHash', () => {
  it('should compute correct hash for empty array', async () => {
    const hash = await computeEmailsHash([]);
    // SHA-256 of empty string "" = 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU
    expect(hash).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
  });

  it('should sort IDs before hashing', async () => {
    // Unsorted input should produce same hash as sorted
    const hashUnsorted = await computeEmailsHash(['c', 'a', 'b']);
    const hashSorted = await computeEmailsHash(['a', 'b', 'c']);
    expect(hashUnsorted).toBe(hashSorted);
  });

  it('should not modify original array', async () => {
    const original = ['c', 'b', 'a'];
    await computeEmailsHash(original);
    expect(original).toEqual(['c', 'b', 'a']);
  });

  it('should produce consistent hash for same input', async () => {
    const hash1 = await computeEmailsHash(['id1', 'id2', 'id3']);
    const hash2 = await computeEmailsHash(['id1', 'id2', 'id3']);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different ID sets', async () => {
    const hash1 = await computeEmailsHash(['a', 'b']);
    const hash2 = await computeEmailsHash(['a', 'c']);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce base64url encoded hash without padding', async () => {
    const hash = await computeEmailsHash(['test']);
    // Base64url should not contain + / or = characters
    expect(hash).not.toMatch(/[+/=]/);
    // Should be 43 characters (256 bits / 6 bits per char, no padding)
    expect(hash.length).toBe(43);
  });
});
