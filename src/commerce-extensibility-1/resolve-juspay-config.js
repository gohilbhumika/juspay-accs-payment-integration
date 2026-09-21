import stateLib from "@adobe/aio-lib-state";

import { decrypt } from "./crypto-helper.js";

const STATE_KEY = "juspay-config";
const BASE_URLS = {
  production: "https://api.juspay.in",
  sandbox: "https://sandbox.juspay.in",
};

/** Thrown when no JusPay credentials have been saved via the JusPay Config admin page yet. */
export class JuspayNotConfiguredError extends Error {
  // biome-ignore lint/style/useConsistentMemberAccessibility: TS-only concept, this is plain JS
  constructor() {
    super(
      "JusPay credentials are not configured. Set them in the JusPay Config page (Commerce Admin) first.",
    );
    this.name = "JuspayNotConfiguredError";
  }
}

/**
 * Reads the JusPay credentials saved via the JusPay Config admin page (Adobe I/O State).
 * No .env fallback — throws JuspayNotConfiguredError if nothing has been saved yet.
 */
export async function resolveJuspayConfig(params) {
  const state = await stateLib.init({ region: params.stateRegion });
  const entry = await state.get(STATE_KEY);
  if (!entry) {
    throw new JuspayNotConfiguredError();
  }

  const saved = JSON.parse(entry.value);
  return {
    apiKey: decrypt(saved.apiKeyEncrypted, params.CONFIG_ENCRYPTION_KEY),
    baseUrl: BASE_URLS[saved.environment] || BASE_URLS.sandbox,
    merchantId: saved.merchantId,
  };
}
