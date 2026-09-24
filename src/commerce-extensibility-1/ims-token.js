// Fetches and caches an Adobe IMS access token via OAuth Server-to-Server (client-credentials),
// for calling our own require-adobe-auth actions server-to-server — used to warm up
// validate-payment from payment-status right after a payment is confirmed.

let cachedToken = null;
let cachedExpiresAt = 0;

/**
 * @param {object} config
 * @param {string} config.clientId OAuth Server-to-Server client id
 * @param {string} config.clientSecrets AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS value — a JSON array string
 * @param {string} config.scopes AIO_COMMERCE_AUTH_IMS_SCOPES value — a JSON array string
 * @returns {Promise<string>} a valid access token, reused across calls until it's close to expiring
 */
export async function getImsAccessToken(config) {
  if (cachedToken && Date.now() < cachedExpiresAt) {
    return cachedToken;
  }

  const [clientSecret] = JSON.parse(config.clientSecrets);
  const scope = JSON.parse(config.scopes).join(",");

  const response = await fetch("https://ims-na1.adobelogin.com/ims/token/v3", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  const payload = await response.json();
  if (!(response.ok && payload.access_token)) {
    throw new Error(`IMS token request failed: ${JSON.stringify(payload)}`);
  }

  cachedToken = payload.access_token;
  cachedExpiresAt = Date.now() + (payload.expires_in - 60) * 1000; // refresh 60s early
  return cachedToken;
}

// Test-only: reset the module-scope cache between test cases.
export function resetImsTokenCache() {
  cachedToken = null;
  cachedExpiresAt = 0;
}
