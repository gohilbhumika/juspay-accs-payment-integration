import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";

import { createSession } from "../../juspay-client.js";
import {
  JuspayNotConfiguredError,
  resolveJuspayConfig,
} from "../../resolve-juspay-config.js";

/**
 * Warms up payment-status right when the customer is redirected to JusPay's hosted page —
 * they'll be gone for at least a little while entering payment details, so this gets ahead of
 * the real payment-status call they'll trigger on return. Best-effort only: a failure here must
 * never affect the real create-session response. payment-status is require-adobe-auth: false,
 * so no auth token is needed for this call.
 * @param {object} params action input parameters
 * @returns {Promise<void>} resolves once the warm-up attempt finishes, success or not
 */
async function warmupPaymentStatus(params) {
  if (!params.PAYMENT_STATUS_URL) {
    return;
  }

  try {
    await fetch(params.PAYMENT_STATUS_URL, {
      body: JSON.stringify({ warmup: true }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    console.log("Warmed up payment-status");
  } catch (error) {
    // best-effort only — logged so a broken warm-up is visible without ever affecting the
    // real create-session response below
    console.error(
      "payment-status warm-up failed:",
      error.message,
      error.cause?.message ?? "",
    );
  }
}

/**
 * @param {object} params action input parameters
 * @param {string} params.orderId cart/order identifier to associate with the JusPay order
 * @param {string} params.amount decimal amount as a string, e.g. "10.00"
 * @param {string} params.customerId customer id (guest or logged-in)
 * @param {string} [params.currency] ISO currency code, defaults to INR
 * @param {string} [params.returnUrl] URL JusPay redirects to after payment
 * @param {string} [params.stateRegion] Adobe I/O State region
 * @param {string} [params.PAYMENT_STATUS_URL] deployed payment-status URL, for the warm-up call
 * @param {boolean} [params.warmup] if true, returns immediately without calling JusPay —
 *   used to pre-warm this action's container right before a customer pays, instead of
 *   creating a real (and unused) JusPay order every time
 * @returns {Promise<object>} the response object
 */
export async function main(params) {
  if (params.warmup === true) {
    return ok({ body: { warm: true } });
  }

  const { orderId, amount, customerId, currency, returnUrl } = params;

  if (!(orderId && amount && customerId)) {
    return badRequest("orderId, amount and customerId are required");
  }
  if (returnUrl?.includes("?")) {
    return badRequest(
      "returnUrl must not contain a query string — JusPay rejects it otherwise",
    );
  }

  try {
    const { apiKey, baseUrl, merchantId } = await resolveJuspayConfig(params);
    const order = await createSession(
      { apiKey, baseUrl, merchantId },
      { amount, currency, customerId, orderId, returnUrl },
    );

    await warmupPaymentStatus(params);

    return ok({
      body: {
        clientAuthToken: order.juspay?.client_auth_token,
        iframeLink: order.payment_links?.iframe,
        orderId: order.order_id,
        paymentLink: order.payment_links?.web,
        status: order.status,
      },
    });
  } catch (error) {
    if (error instanceof JuspayNotConfiguredError) {
      return badRequest(error.message);
    }
    return internalServerError(
      `Failed to create JusPay session: ${error.message}`,
    );
  }
}
