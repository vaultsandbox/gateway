# Crypto Module

Quantum-safe encryption for email payloads using post-quantum algorithms.

## How It Works

```
Client                              Server
  |                                   |
  |  1. Client sends ML-KEM-768       |
  |     public key (base64url)        |
  |  -------------------------------->|
  |                                   |
  |                                   |  2. Server encapsulates shared secret
  |                                   |     using client's public key
  |                                   |
  |                                   |  3. Derives AES-256 key via HKDF-SHA-512
  |                                   |     (salt = SHA-256 of KEM ciphertext)
  |                                   |
  |                                   |  4. Encrypts payload with AES-256-GCM
  |                                   |
  |                                   |  5. Signs transcript with ML-DSA-65
  |                                   |
  |  6. Server returns encrypted      |
  |     payload + signature           |
  |  <--------------------------------|
  |                                   |
  |  7. Client decapsulates shared    |
  |     secret, derives key, decrypts |
```

## Algorithm Suite

| Purpose | Algorithm | Notes |
|---------|-----------|-------|
| Key Encapsulation | ML-KEM-768 | Post-quantum secure, NIST standardized |
| Digital Signature | ML-DSA-65 | Post-quantum secure, NIST standardized |
| Symmetric Encryption | AES-256-GCM | 128-bit auth tag, 96-bit nonce |
| Key Derivation | HKDF-SHA-512 | Context-bound with domain string |

## Payload Structure

```typescript
{
  v: 1,                    // Protocol version
  algs: { kem, sig, aead, kdf },
  ct_kem: Uint8Array,      // KEM ciphertext (client decapsulates this)
  nonce: Uint8Array,       // 12-byte random nonce
  aad: Uint8Array,         // Additional authenticated data
  ciphertext: Uint8Array,  // AES-GCM encrypted data + tag
  sig: Uint8Array,         // ML-DSA-65 signature
  server_sig_pk: Uint8Array // Server's signing public key
}
```

Binary in memory, base64url when serialized for API responses.

## Key Derivation

```
ikm = KEM shared secret
salt = SHA-256(ct_kem)           // Unique per encryption
info = context || aad_length || aad
key = HKDF-SHA-512(ikm, salt, info, 32 bytes)
```

Context string: `vaultsandbox:email:v1`

## Signature Transcript

The signature covers everything to prevent tampering:

```
transcript = version || algs || context || ct_kem || nonce || aad || ciphertext || server_sig_pk
signature = ML-DSA-65.sign(transcript, server_secret_key)
```

## Server Signature Keys

The server maintains ML-DSA-65 signing keys (persistent from files or ephemeral).

**Current use:** None within the same server instance.

**Future use:** When data leaves the server (forwarded to external services), the signature allows recipients to verify the payload originated from this specific server. Without it, encrypted data could be tampered with or forged by intermediaries.

For production, use persistent keys loaded from files to maintain signature verification across server restarts.
