import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: vi.fn() },
}));

import stateLib from "@adobe/aio-lib-state";

import { encrypt } from "../src/commerce-extensibility-1/crypto-helper.js";
import {
  JuspayNotConfiguredError,
  resolveJuspayConfig,
} from "../src/commerce-extensibility-1/resolve-juspay-config.js";

const TEST_KEY = "0".repeat(64); // 32 bytes hex, test-only

function buildParams(overrides = {}) {
  return { CONFIG_ENCRYPTION_KEY: TEST_KEY, stateRegion: "apac", ...overrides };
}

function mockSavedConfig(config) {
  stateLib.init.mockResolvedValue({
    get: vi.fn().mockResolvedValue({
      value: JSON.stringify({
        apiKeyEncrypted: encrypt(config.apiKey, TEST_KEY),
        environment: config.environment,
        merchantId: config.merchantId,
      }),
    }),
  });
}

describe("resolveJuspayConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("throws JuspayNotConfiguredError when nothing is saved in State", async () => {
    stateLib.init.mockResolvedValue({ get: vi.fn().mockResolvedValue(null) });

    await expect(resolveJuspayConfig(buildParams())).rejects.toThrow(
      JuspayNotConfiguredError,
    );
  });

  test("decrypts the saved API key, mapping sandbox to JusPay's sandbox base URL", async () => {
    mockSavedConfig({
      apiKey: "saved-api-key",
      environment: "sandbox",
      merchantId: "saved-merchant",
    });

    const result = await resolveJuspayConfig(buildParams());

    expect(result).toEqual({
      apiKey: "saved-api-key",
      baseUrl: "https://sandbox.juspay.in",
      merchantId: "saved-merchant",
    });
  });

  test("maps a saved production environment to JusPay's production base URL", async () => {
    mockSavedConfig({
      apiKey: "saved-api-key",
      environment: "production",
      merchantId: "saved-merchant",
    });

    const result = await resolveJuspayConfig(buildParams());

    expect(result.baseUrl).toBe("https://api.juspay.in");
  });
});
