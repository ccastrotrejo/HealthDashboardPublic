// Type shim for tweetnacl-sealedbox-js — the package ships as plain JS with
// no bundled .d.ts and no @types package exists. The whole public surface is
// the sealed-box primitive itself.
declare module 'tweetnacl-sealedbox-js' {
  /**
   * Encrypt a message for a recipient identified by their X25519 public key,
   * using the libsodium "sealed box" construction (ephemeral keypair +
   * crypto_box). Used here to send Actions Secrets via the GitHub REST API,
   * which mandates this exact format.
   */
  export function seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;
  const _default: { seal: typeof seal };
  export default _default;
}
