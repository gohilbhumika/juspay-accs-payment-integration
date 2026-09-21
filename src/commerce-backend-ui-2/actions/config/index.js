import stateLib from "@adobe/aio-lib-state";

import { encrypt } from "../crypto-helper.js";
import { errorResponse, maskSecret } from "../utils.js";

const STATE_KEY = "juspay-config";

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Not full Adobe IMS signature verification (that needs a network call to Adobe's public keys) —
// this just checks the caller sent a well-formed, unexpired token for our own org, so random
// requests without a real Commerce Admin session can't overwrite or wipe the saved credentials.
// Returns a short reason string instead of true/false, purely so failures show up clearly in
// the logs (never logs the token itself) — remove this once the check is confirmed working live.
function checkAdminRequest(params) {
  const headers = params.__ow_headers || {};
  const authHeader = headers.authorization || "";
  const orgId = headers["x-gw-ims-org-id"];

  if (!authHeader.startsWith("Bearer ")) {
    return "no bearer token in Authorization header";
  }
  if (!orgId) {
    return "no x-gw-ims-org-id header";
  }
  if (orgId !== params.AIO_COMMERCE_AUTH_IMS_ORG_ID) {
    return `org id mismatch: got "${orgId}", expected "${params.AIO_COMMERCE_AUTH_IMS_ORG_ID}"`;
  }

  const payload = decodeJwtPayload(authHeader.slice("Bearer ".length));
  if (!payload) {
    return "token isn't a decodable JWT";
  }

  // Adobe IMS access tokens carry created_at/expires_in (both ms), not the standard exp claim.
  // Support both shapes so this doesn't silently break if a differently-shaped token shows up.
  const expiresAtMs = payload.exp
    ? payload.exp * 1000
    : Number(payload.created_at) + Number(payload.expires_in);
  if (!expiresAtMs) {
    return "token has no exp or created_at/expires_in claims";
  }
  if (Date.now() >= expiresAtMs) {
    return "token expired";
  }

  return null;
}

/**
 * op=get: reads the saved JusPay config, if any. The API key is never returned in full —
 * only a masked preview (e.g. "****ab12"), same as Stripe's dashboard.
 */
async function handleGet(state) {
  const entry = await state.get(STATE_KEY);
  if (!entry) {
    return { body: { configured: false }, statusCode: 200 };
  }

  const config = JSON.parse(entry.value);
  return {
    body: {
      apiKeyMasked: config.apiKeyLast4 ? `****${config.apiKeyLast4}` : "****",
      configured: true,
      environment: config.environment,
      merchantId: config.merchantId,
    },
    statusCode: 200,
  };
}

/**
 * op=save: validates and persists the JusPay config. Overwrites whatever was there before —
 * there is only ever one config record for this app. The API key is encrypted before it's
 * written to State; only its last 4 characters are kept in plain text, for masking on read.
 */
async function handleSave(params, state, logger) {
  const { apiKey, environment, merchantId } = params;

  if (!(apiKey && merchantId)) {
    return errorResponse(400, "apiKey and merchantId are required", logger);
  }

  const config = {
    apiKeyEncrypted: encrypt(apiKey, params.CONFIG_ENCRYPTION_KEY),
    apiKeyLast4: apiKey.length > 4 ? apiKey.slice(-4) : "",
    environment: environment || "sandbox",
    merchantId,
  };
  await state.put(STATE_KEY, JSON.stringify(config), { ttl: stateLib.MAX_TTL });

  logger.info(`Saved JusPay config (environment: ${config.environment})`);
  return {
    body: {
      apiKeyMasked: maskSecret(apiKey),
      configured: true,
      environment: config.environment,
      merchantId,
    },
    statusCode: 200,
  };
}

/**
 * op=reset: deletes the saved config entirely. create-session/validate-payment/payment-status
 * have no .env fallback by design — they'll return a "credentials not configured" message
 * until this is saved again.
 */
async function handleReset(state, logger) {
  await state.delete(STATE_KEY);
  logger.info(
    "Reset JusPay config — actions will report not-configured until re-saved",
  );
  return { body: { configured: false }, statusCode: 200 };
}

/**
 * Backend action for the JusPay Config admin page. Stores API key / Merchant ID / environment
 * in Adobe I/O State — note this has a hard 1-year TTL ceiling (Adobe's own limit), so the
 * config needs re-saving at most yearly. If this ever needs to be truly permanent, move it to
 * @adobe/aio-lib-db instead (same as the reference project's job records).
 *
 * @param {object} params action input parameters
 * @param {string} [params.op] "get", "save", or "reset"
 * @param {string} [params.apiKey] JusPay API key (op=save only)
 * @param {string} [params.merchantId] JusPay Merchant ID (op=save only)
 * @param {string} [params.environment] "sandbox" or "production" (op=save only)
 * @returns {Promise<object>} the response object
 */
export async function main(params) {
  const logger = { error: console.error, info: console.log };

  try {
    const { op } = params;
    if (!op) {
      return errorResponse(400, "missing 'op' parameter", logger);
    }

    if (op === "save" || op === "reset") {
      const failReason = checkAdminRequest(params);
      if (failReason) {
        logger.info(`Rejected ${op}: ${failReason}`);
        return errorResponse(
          401,
          "missing or invalid Commerce Admin session",
          logger,
        );
      }
    }

    const state = await stateLib.init({ region: params.stateRegion });

    if (op === "get") {
      return await handleGet(state);
    }
    if (op === "save") {
      return await handleSave(params, state, logger);
    }
    if (op === "reset") {
      return await handleReset(state, logger);
    }
    return errorResponse(400, `unknown op '${op}'`, logger);
  } catch (error) {
    logger.error(error);
    return errorResponse(500, "server error", logger);
  }
}
