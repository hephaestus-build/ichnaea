/**
 * SHA-256 (FIPS 180-4) in plain TypeScript, synchronous and with no imports, so every canonical
 * digest is a pure function that runs the same in Node and in a browser. WebCrypto's digest is
 * asynchronous only, and `node:crypto` does not exist in a browser.
 */
/** Returns the SHA-256 digest of a byte string as 64 lowercase hexadecimal digits. */
export declare function sha256Hex(message: Uint8Array): string;
//# sourceMappingURL=sha256.d.ts.map