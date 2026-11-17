// The pure SHA-256 against the FIPS 180-4 examples (NIST CSRC, "Example Values", SHA-256) and
// against node:crypto on random byte strings. Only the test may use node:crypto.
import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { digest, sha256, sha256Hex } from "../../src/contracts/index.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("sha256Hex", () => {
  it.each([
    ["the empty string", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ['"abc"', "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "the 448-bit message",
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "the 896-bit message",
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
  ])("gives the NIST digest of %s", (_name, text, expected) => {
    expect(sha256Hex(bytes(text))).toBe(expected);
  });

  it('gives the NIST digest of a million "a"', () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("matches node:crypto on 1,000 random byte strings, every padding boundary among them", () => {
    for (let i = 0; i < 1000; i++) {
      // Lengths 0 to 199 cover the boundaries at 55, 56, 63, 64, 119 and 120 bytes; the rest are
      // longer, up to several blocks.
      const length = i < 200 ? i : Math.floor(Math.random() * 4096);
      const data = randomBytes(length);
      expect(sha256Hex(data), `length ${length}`).toBe(
        createHash("sha256").update(data).digest("hex"),
      );
    }
  });
});

describe("the canonical digests", () => {
  it("are synchronous", () => {
    expect(sha256("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(digest({ b: 1, a: [true, null] })).toBe(
      `sha256:${createHash("sha256").update('{"a":[true,null],"b":1}').digest("hex")}`,
    );
  });

  it("hash the UTF-8 bytes of text outside ASCII", () => {
    const text = "Größe ✓ 😀";
    expect(sha256(text)).toBe(`sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`);
  });
});
