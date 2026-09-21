import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";

import {
  getOrderStatus,
  JUSPAY_SUCCESS_STATUSES,
} from "../../juspay-client.js";
import {
  JuspayNotConfiguredError,
  resolveJuspayConfig,
} from "../../resolve-juspay-config.js";

/**
 * Called directly by the storefront after JusPay redirects back to `return_url` (see
 * create-session). Re-checks the real status server-to-server — the redirect's own query
 * params (status, status_id, signature) are not trusted here, only orderId is used as a lookup
 * key, since a browser URL can always be hand-edited.
 *
 * @param {object} params action input parameters
 * @param {string} params.orderId JusPay order id (from the return_url's order_id query param)
 * @param {string} [params.stateRegion] Adobe I/O State region
 * @returns {Promise<object>} the response object
 */
export async function main(params) {
  const { orderId } = params;

  if (!orderId) {
    return badRequest("orderId is required");
  }

  try {
    const { apiKey, baseUrl, merchantId } = await resolveJuspayConfig(params);
    const order = await getOrderStatus(
      { apiKey, baseUrl, merchantId },
      orderId,
    );

    return ok({
      body: {
        orderId,
        status: order.status,
        success: JUSPAY_SUCCESS_STATUSES.has(order.status),
      },
    });
  } catch (error) {
    if (error instanceof JuspayNotConfiguredError) {
      return badRequest(error.message);
    }
    return internalServerError(
      `Failed to fetch payment status: ${error.message}`,
    );
  }
}
