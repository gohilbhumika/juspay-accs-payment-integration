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
 * @param {object} params action input parameters
 * @param {string} params.orderId cart/order identifier to associate with the JusPay order
 * @param {string} params.amount decimal amount as a string, e.g. "10.00"
 * @param {string} params.customerId customer id (guest or logged-in)
 * @param {string} [params.currency] ISO currency code, defaults to INR
 * @param {string} [params.returnUrl] URL JusPay redirects to after payment
 * @param {string} [params.stateRegion] Adobe I/O State region
 * @returns {Promise<object>} the response object
 */
export async function main(params) {
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
