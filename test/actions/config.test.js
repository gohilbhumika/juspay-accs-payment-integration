import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: vi.fn(), MAX_TTL: 31_536_000 },
}));

import stateLib from "@adobe/aio-lib-state";

import { main } from "../../src/commerce-backend-ui-2/actions/config/index.js";
import { decrypt } from "../../src/commerce-backend-ui-2/actions/crypto-helper.js";

const TEST_KEY = "0".repeat(64); // 32 bytes hex, test-only
const ORG_ID = "test-org@AdobeOrg";

function makeToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

// Real Adobe IMS access tokens carry created_at/expires_in (ms), not the standard exp claim.
function authHeaders(
  claims = { created_at: String(Date.now()), expires_in: "3600000" },
) {
  return {
    authorization: `Bearer ${makeToken(claims)}`,
    "x-gw-ims-org-id": ORG_ID,
  };
}

function buildParams(overrides = {}) {
  return {
    AIO_COMMERCE_AUTH_IMS_ORG_ID: ORG_ID,
    CONFIG_ENCRYPTION_KEY: TEST_KEY,
    ...overrides,
  };
}

function mockState() {
  const store = new Map();
  stateLib.init.mockResolvedValue({
    delete: vi.fn(async (key) => store.delete(key)),
    get: vi.fn(async (key) =>
      store.has(key) ? { value: store.get(key) } : null,
    ),
    put: vi.fn(async (key, value) => store.set(key, value)),
  });
  return store;
}

describe("config action", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("op=get returns configured: false when nothing is saved", async () => {
    mockState();

    const result = await main(buildParams({ op: "get" }));

    expect(result.body).toEqual({ configured: false });
  });

  test("op=save rejects a request without a Commerce Admin session", async () => {
    mockState();

    const result = await main(
      buildParams({ apiKey: "abcd1234", merchantId: "merchant-1", op: "save" }),
    );

    expect(result.error.statusCode).toBe(401);
  });

  test("op=save then op=get round-trips a masked key, never the real one", async () => {
    mockState();

    const saveResult = await main(
      buildParams({
        __ow_headers: authHeaders(),
        apiKey: "abcd1234",
        environment: "sandbox",
        merchantId: "merchant-1",
        op: "save",
      }),
    );
    expect(saveResult.body.apiKeyMasked).toBe("****1234");
    expect(saveResult.body).not.toHaveProperty("apiKey");

    const getResult = await main(buildParams({ op: "get" }));
    expect(getResult.body).toEqual({
      apiKeyMasked: "****1234",
      configured: true,
      environment: "sandbox",
      merchantId: "merchant-1",
    });
  });

  test("op=save encrypts the API key before writing to State", async () => {
    const store = mockState();

    await main(
      buildParams({
        __ow_headers: authHeaders(),
        apiKey: "abcd1234",
        merchantId: "merchant-1",
        op: "save",
      }),
    );

    const raw = JSON.parse(store.get("juspay-config"));
    expect(raw.apiKeyEncrypted).toBeDefined();
    expect(raw.apiKeyEncrypted).not.toContain("abcd1234");
    expect(decrypt(raw.apiKeyEncrypted, TEST_KEY)).toBe("abcd1234");
  });

  test("op=save accepts a token using the standard exp claim too", async () => {
    mockState();

    const headers = {
      authorization: `Bearer ${makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 })}`,
      "x-gw-ims-org-id": ORG_ID,
    };

    const result = await main(
      buildParams({
        __ow_headers: headers,
        apiKey: "abcd1234",
        merchantId: "merchant-1",
        op: "save",
      }),
    );

    expect(result.body.configured).toBe(true);
  });

  test("op=save rejects an expired token", async () => {
    mockState();

    const headers = authHeaders({
      created_at: String(Date.now() - 7_200_000),
      expires_in: "3600000",
    });

    const result = await main(
      buildParams({
        __ow_headers: headers,
        apiKey: "abcd1234",
        merchantId: "merchant-1",
        op: "save",
      }),
    );

    expect(result.error.statusCode).toBe(401);
  });

  test("op=reset rejects a request without a Commerce Admin session", async () => {
    mockState();

    const result = await main(buildParams({ op: "reset" }));

    expect(result.error.statusCode).toBe(401);
  });

  test("op=reset clears the saved config", async () => {
    mockState();
    await main(
      buildParams({
        __ow_headers: authHeaders(),
        apiKey: "abcd1234",
        merchantId: "merchant-1",
        op: "save",
      }),
    );

    const resetResult = await main(
      buildParams({ __ow_headers: authHeaders(), op: "reset" }),
    );
    expect(resetResult.body).toEqual({ configured: false });

    const getResult = await main(buildParams({ op: "get" }));
    expect(getResult.body).toEqual({ configured: false });
  });
});
