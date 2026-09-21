/**
 * Thin client for the JusPay Create Order (Session) / Order Status APIs, shared by the
 * create-session and validate-payment actions.
 * @see https://juspay.io/in/docs/api-reference/docs/express-checkout/create-order-api
 * @see https://juspay.io/in/docs/ec-api/docs/resources/transaction-status
 */

function basicAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function authHeaders(config) {
  return {
    Authorization: basicAuthHeader(config.apiKey),
    "x-merchantid": config.merchantId,
  };
}

/**
 * Creates a JusPay order for the given cart (POST /orders). JusPay expects a
 * form-urlencoded body, not JSON.
 * @param {object} config client config
 * @param {string} config.baseUrl JusPay API base URL, e.g. https://sandbox.juspay.in
 * @param {string} config.apiKey JusPay API key
 * @param {string} config.merchantId JusPay Merchant ID
 * @param {object} order order details
 * @param {string} order.orderId unique order id (e.g. Commerce masked cart id)
 * @param {string} order.amount decimal amount as a string, e.g. "10.00"
 * @param {string} order.customerId customer id (guest or logged-in)
 * @param {string} [order.currency] ISO currency code, defaults to INR
 * @param {string} [order.returnUrl] URL JusPay redirects to after payment
 * @returns {Promise<object>} JusPay order payload (id, status, payment_links, juspay.client_auth_token, ...)
 */
export async function createSession(config, order) {
  const body = new URLSearchParams({
    amount: order.amount,
    currency: order.currency || "INR",
    customer_id: order.customerId,
    order_id: order.orderId,
    ...(order.returnUrl && { return_url: order.returnUrl }),
  });

  const response = await fetch(`${config.baseUrl}/orders`, {
    body,
    headers: {
      ...authHeaders(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `JusPay createSession failed with status ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

/**
 * Fetches the current status of a JusPay order (GET /orders/:orderId) — the source of truth
 * used to validate a payment before Commerce places the order (never trust the browser's word
 * for this).
 * @param {object} config client config
 * @param {string} config.baseUrl JusPay API base URL
 * @param {string} config.apiKey JusPay API key
 * @param {string} config.merchantId JusPay Merchant ID
 * @param {string} orderId JusPay order id
 * @returns {Promise<object>} JusPay order status payload
 */
export async function getOrderStatus(config, orderId) {
  const response = await fetch(`${config.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
    headers: authHeaders(config),
    method: "GET",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `JusPay getOrderStatus failed with status ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

/**
 * JusPay order statuses that mean the payment actually succeeded.
 * @see https://juspay.io/in/docs/ec-api/docs/resources/transaction-status — "successful only if
 * you receive CHARGED as the value in status".
 */
export const JUSPAY_SUCCESS_STATUSES = new Set(["CHARGED"]);
