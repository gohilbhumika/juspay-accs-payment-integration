import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: vi.fn() },
}));

import stateLib from "@adobe/aio-lib-state";

import { main } from "../../src/commerce-extensibility-1/actions/payment-status/index.js";
import { encrypt } from "../../src/commerce-extensibility-1/crypto-helper.js";

const NOT_CONFIGURED_MESSAGE = /not configured/i;
const TEST_KEY = "0".repeat(64); // 32 bytes hex, test-only

function buildParams(overrides = {}) {
  return {
    CONFIG_ENCRYPTION_KEY: TEST_KEY,
    orderId: "cart-123",
    stateRegion: "apac",
    ...overrides,
  };
}

function mockSavedConfig() {
  stateLib.init.mockResolvedValue({
    get: vi.fn().mockResolvedValue({
      value: JSON.stringify({
        apiKeyEncrypted: encrypt("test-api-key", TEST_KEY),
        environment: "sandbox",
        merchantId: "test-merchant",
      }),
    }),
  });
}

function mockNoSavedConfig() {
  stateLib.init.mockResolvedValue({ get: vi.fn().mockResolvedValue(null) });
}

function mockJuspayOrderResponse(body, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => body,
      ok,
      status: ok ? 200 : 500,
    })),
  );
}

describe("payment-status", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns success: true when JusPay reports CHARGED", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "CHARGED" });

    const result = await main(buildParams());

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      orderId: "cart-123",
      status: "CHARGED",
      success: true,
    });
  });

  test("returns success: false for any non-CHARGED status", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "PENDING" });

    const result = await main(buildParams());

    expect(result.body).toEqual({
      orderId: "cart-123",
      status: "PENDING",
      success: false,
    });
  });

  test("returns a bad request when orderId is missing", async () => {
    const result = await main(buildParams({ orderId: undefined }));

    expect(result.error.statusCode).toBe(400);
  });

  test("returns a bad request with a clear message when no config has been saved", async () => {
    mockNoSavedConfig();

    const result = await main(buildParams());

    expect(result.error.statusCode).toBe(400);
    expect(result.error.body.message).toMatch(NOT_CONFIGURED_MESSAGE);
  });

  test("returns an internal server error when the JusPay call fails", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ error_message: "order not found" }, false);

    const result = await main(buildParams());

    expect(result.error.statusCode).toBe(500);
  });
});
