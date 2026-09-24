import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  getImsAccessToken,
  resetImsTokenCache,
} from "../src/commerce-extensibility-1/ims-token.js";

function buildConfig(overrides = {}) {
  return {
    clientId: "client-1",
    clientSecrets: JSON.stringify(["secret-1"]),
    scopes: JSON.stringify(["openid", "AdobeID"]),
    ...overrides,
  };
}

const IMS_TOKEN_FAILURE_MESSAGE = /IMS token request failed/;

function mockTokenResponse(body, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => body,
      ok,
    })),
  );
}

describe("getImsAccessToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetImsTokenCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("posts client_id, client_secret and a comma-joined scope string", async () => {
    mockTokenResponse({ access_token: "tkn_abc", expires_in: 3600 });

    await getImsAccessToken(buildConfig());

    expect(fetch).toHaveBeenCalledWith(
      "https://ims-na1.adobelogin.com/ims/token/v3",
      expect.objectContaining({ method: "POST" }),
    );
    const [, requestInit] = fetch.mock.calls[0];
    const body = new URLSearchParams(requestInit.body);
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("secret-1");
    expect(body.get("scope")).toBe("openid,AdobeID");
    expect(body.get("grant_type")).toBe("client_credentials");
  });

  test("returns the access token", async () => {
    mockTokenResponse({ access_token: "tkn_abc", expires_in: 3600 });

    const token = await getImsAccessToken(buildConfig());

    expect(token).toBe("tkn_abc");
  });

  test("reuses a cached token instead of fetching again", async () => {
    mockTokenResponse({ access_token: "tkn_abc", expires_in: 3600 });

    await getImsAccessToken(buildConfig());
    await getImsAccessToken(buildConfig());

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("throws when the token endpoint doesn't return an access_token", async () => {
    mockTokenResponse({ error: "invalid_client" }, false);

    await expect(getImsAccessToken(buildConfig())).rejects.toThrow(
      IMS_TOKEN_FAILURE_MESSAGE,
    );
  });
});
