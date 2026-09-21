import { describe, expect, test } from "vitest";

import {
  decrypt,
  encrypt,
} from "../src/commerce-extensibility-1/crypto-helper.js";

const KEY = "1".repeat(64); // 32 bytes hex, test-only

describe("crypto-helper (commerce-extensibility-1)", () => {
  test("decrypts what it encrypted", () => {
    const encrypted = encrypt("my-secret-value", KEY);
    expect(decrypt(encrypted, KEY)).toBe("my-secret-value");
  });

  test("encrypting the same value twice gives different output (random iv)", () => {
    expect(encrypt("same-value", KEY)).not.toBe(encrypt("same-value", KEY));
  });

  test("decrypting with the wrong key throws", () => {
    const encrypted = encrypt("my-secret-value", KEY);
    expect(() => decrypt(encrypted, "2".repeat(64))).toThrow();
  });
});
