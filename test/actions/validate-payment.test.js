import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: vi.fn() },
}));

import stateLib from "@adobe/aio-lib-state";

import { main } from "../../src/commerce-extensibility-1/actions/validate-payment/index.js";
import { encrypt } from "../../src/commerce-extensibility-1/crypto-helper.js";

const NOT_CONFIGURED_MESSAGE = /not configured/i;
const TEST_KEY = "0".repeat(64); // 32 bytes hex, test-only

// @adobe/aio-lib-telemetry's getInstrumentationHelpers() requires ENABLE_TELEMETRY on the params
// passed to the instrumented entrypoint — mirroring the ENABLE_TELEMETRY action input configured
// in ext.config.yaml, which Adobe I/O Runtime merges into `params` at invocation time. With
// require-adobe-auth: true, Commerce's webhook fields arrive directly as top-level params, already
// parsed — no raw-http/signature verification here. Supported payment method codes come from the
// shared PAYMENT_METHODS array (../../src/commerce-extensibility-1/payment-methods.js), which only
// defines "juspay" — that's why "not-configured" below is treated as unsupported.
function buildParams(overrides = {}) {
  return {
    CONFIG_ENCRYPTION_KEY: TEST_KEY,
    ENABLE_TELEMETRY: true,
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

function mockJuspayOrderStatus(status) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({ order_id: "order-1", status }),
      ok: true,
    })),
  );
}

describe("validate-payment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns a success operation when JusPay confirms the order was charged", async () => {
    mockSavedConfig();
    mockJuspayOrderStatus("CHARGED");

    const result = await main(
      buildParams({
        payment_additional_information: { juspay_order_id: "order-1" },
        payment_method: "juspay",
      }),
    );

    expect(result.body).toEqual({ op: "success" });
  });

  test("calls JusPay's order status endpoint with the expected auth headers", async () => {
    mockSavedConfig();
    mockJuspayOrderStatus("CHARGED");

    await main(
      buildParams({
        payment_additional_information: { juspay_order_id: "order-1" },
        payment_method: "juspay",
      }),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://sandbox.juspay.in/orders/order-1",
      expect.objectContaining({
        headers: {
          Authorization: `Basic ${Buffer.from("test-api-key:").toString("base64")}`,
          "x-merchantid": "test-merchant",
        },
        method: "GET",
      }),
    );
  });

  test("returns an exception operation when JusPay reports the payment did not succeed", async () => {
    mockSavedConfig();
    mockJuspayOrderStatus("AUTHORIZATION_FAILED");

    const result = await main(
      buildParams({
        payment_additional_information: { juspay_order_id: "order-1" },
        payment_method: "juspay",
      }),
    );

    expect(result.body).toEqual({
      message: "JusPay payment not successful (status: AUTHORIZATION_FAILED)",
      op: "exception",
    });
  });

  test("returns a success operation when the payment method isn't handled by this app", async () => {
    const result = await main(
      buildParams({
        payment_additional_information: { juspay_order_id: "order-1" },
        payment_method: "not-configured",
      }),
    );

    expect(result.body).toEqual({ op: "success" });
  });

  test("returns an exception operation when payment_additional_information is missing", async () => {
    const result = await main(
      buildParams({
        payment_method: "juspay",
      }),
    );

    expect(result.body).toEqual({
      message: "payment_additional_information not found in the request",
      op: "exception",
    });
  });

  test("returns an exception operation when juspay_order_id is missing", async () => {
    const result = await main(
      buildParams({
        payment_additional_information: { token: "abc" },
        payment_method: "juspay",
      }),
    );

    expect(result.body).toEqual({
      message: "juspay_order_id not found in payment_additional_information",
      op: "exception",
    });
  });

  test("returns a clear exception operation when no config has been saved", async () => {
    mockNoSavedConfig();

    const result = await main(
      buildParams({
        payment_additional_information: { juspay_order_id: "order-1" },
        payment_method: "juspay",
      }),
    );

    expect(result.body.op).toBe("exception");
    expect(result.body.message).toMatch(NOT_CONFIGURED_MESSAGE);
  });
});
