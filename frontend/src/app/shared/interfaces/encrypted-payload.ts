export interface EncryptedPayload {
  v: number;
  algs: {
    kem: string;
    sig: string;
    aead: string;
    kdf: string;
  };
  ct_kem: string;
  nonce: string;
  aad: string;
  ciphertext: string;
  sig: string;
  server_sig_pk: string;
}
