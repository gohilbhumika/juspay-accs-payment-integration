import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: vi.fn() },
}));

import stateLib from "@adobe/aio-lib-state";

import { main } from "../../src/commerce-extensibility-1/actions/create-session/index.js";
import { encrypt } from "../../src/commerce-extensibility-1/crypto-helper.js";

const NOT_CONFIGURED_MESSAGE = /not configured/i;
const TEST_KEY = "0".repeat(64); // 32 bytes hex, test-only

function buildParams(overrides = {}) {
  return {
    amount: "10.00",
    CONFIG_ENCRYPTION_KEY: TEST_KEY,
    customerId: "guest_user_1",
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

describe("create-session", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns the JusPay order payload on success", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({
      juspay: { client_auth_token: "tkn_abc" },
      order_id: "cart-123",
      payment_links: {
        iframe: "https://sandbox.assets.juspay.in/payment-page/order/ordeu_abc",
        web: "https://sandbox.juspay.in/merchant/pay/ordeu_abc",
      },
      status: "NEW",
    });

    const result = await main(buildParams());

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      clientAuthToken: "tkn_abc",
      iframeLink:
        "https://sandbox.assets.juspay.in/payment-page/order/ordeu_abc",
      orderId: "cart-123",
      paymentLink: "https://sandbox.juspay.in/merchant/pay/ordeu_abc",
      status: "NEW",
    });
  });

  test("posts a form-urlencoded body with the expected auth headers", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "NEW" });

    await main(buildParams());

    expect(fetch).toHaveBeenCalledWith(
      "https://sandbox.juspay.in/orders",
      expect.objectContaining({
        headers: {
          Authorization: `Basic ${Buffer.from("test-api-key:").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "x-merchantid": "test-merchant",
        },
        method: "POST",
      }),
    );
    const [, requestInit] = fetch.mock.calls[0];
    expect(requestInit.body.toString()).toBe(
      "amount=10.00&currency=INR&customer_id=guest_user_1&order_id=cart-123",
    );
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

  test("returns a bad request when orderId, amount or customerId is missing", async () => {
    const result = await main(buildParams({ customerId: undefined }));

    expect(result.error.statusCode).toBe(400);
  });

  test("returns a bad request when returnUrl has a query string", async () => {
    mockSavedConfig();

    const result = await main(
      buildParams({ returnUrl: "https://shop.test/return?orderId=1" }),
    );

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
    mockJuspayOrderResponse({ error_message: "invalid api key" }, false);

    const result = await main(buildParams());

    expect(result.error.statusCode).toBe(500);
  });

  test("warms up payment-status after successfully creating a real session", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "NEW" });

    await main(
      buildParams({
        PAYMENT_STATUS_URL:
          "https://example.test/api/v1/web/payment-method/payment-status",
      }),
    );

    const warmupCall = fetch.mock.calls.find(
      ([url]) =>
        url === "https://example.test/api/v1/web/payment-method/payment-status",
    );
    expect(warmupCall).toBeDefined();
    const [, requestInit] = warmupCall;
    expect(requestInit.method).toBe("POST");
    expect(JSON.parse(requestInit.body)).toEqual({ warmup: true });
  });

  test("does not warm up payment-status when PAYMENT_STATUS_URL isn't configured", async () => {
    mockSavedConfig();
    mockJuspayOrderResponse({ order_id: "cart-123", status: "NEW" });

    await main(buildParams());

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("a payment-status warm-up failure does not affect the real create-session response", async () => {
    mockSavedConfig();
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            json: () =>
              Promise.resolve({ order_id: "cart-123", status: "NEW" }),
            ok: true,
          });
        }
        throw new Error("network down");
      }),
    );

    const result = await main(
      buildParams({
        PAYMENT_STATUS_URL:
          "https://example.test/api/v1/web/payment-method/payment-status",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.orderId).toBe("cart-123");
  });
});
