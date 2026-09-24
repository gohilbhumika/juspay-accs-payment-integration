import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: vi.fn() },
}));

vi.mock("../../src/commerce-extensibility-1/ims-token.js", () => ({
  getImsAccessToken: vi.fn().mockResolvedValue("tkn_test"),
}));

import stateLib from "@adobe/aio-lib-state";

import { main } from "../../src/commerce-extensibility-1/actions/payment-status/index.js";
import { encrypt } from "../../src/commerce-extensibility-1/crypto-helper.js";
import { getImsAccessToken } from "../../src/commerce-extensibility-1/ims-token.js";

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

function buildWarmupParams(overrides = {}) {
  return buildParams({
    AIO_COMMERCE_AUTH_IMS_CLIENT_ID: "client-1",
    AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS: JSON.stringify(["secret-1"]),
    AIO_COMMERCE_AUTH_IMS_ORG_ID: "org-1@AdobeOrg",
    AIO_COMMERCE_AUTH_IMS_SCOPES: JSON.stringify(["openid"]),
    VALIDATE_PAYMENT_URL:
      "https://example.test/api/v1/web/payment-method/validate-payment",
    ...overrides,
  });
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

  test("warmup requests return immediately without calling JusPay or resolving config", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await main({ warmup: true });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ warm: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stateLib.init).not.toHaveBeenCalled();
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

  test("warms up validate-payment when the payment is charged", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "CHARGED" });

    await main(buildWarmupParams());

    const warmupCall = fetch.mock.calls.find(
      ([url]) =>
        url ===
        "https://example.test/api/v1/web/payment-method/validate-payment",
    );
    expect(warmupCall).toBeDefined();
    const [, requestInit] = warmupCall;
    expect(requestInit.method).toBe("POST");
    expect(requestInit.headers.Authorization).toBe("Bearer tkn_test");
    expect(requestInit.headers["x-gw-ims-org-id"]).toBe("org-1@AdobeOrg");
    expect(JSON.parse(requestInit.body)).toEqual({ warmup: true });
  });

  test("does not warm up validate-payment for a non-charged status", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "PENDING" });

    await main(buildWarmupParams());

    expect(getImsAccessToken).not.toHaveBeenCalled();
  });

  test("does not warm up validate-payment when VALIDATE_PAYMENT_URL isn't configured", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "CHARGED" });

    await main(buildParams());

    expect(getImsAccessToken).not.toHaveBeenCalled();
  });

  test("a warm-up failure does not affect the real payment-status response", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "CHARGED" });
    getImsAccessToken.mockRejectedValueOnce(new Error("token request failed"));

    const result = await main(buildWarmupParams());

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      orderId: "cart-123",
      status: "CHARGED",
      success: true,
    });
  });
});
