import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";

import { getImsAccessToken } from "../../ims-token.js";
import {
  getOrderStatus,
  JUSPAY_SUCCESS_STATUSES,
} from "../../juspay-client.js";
import {
  JuspayNotConfiguredError,
  resolveJuspayConfig,
} from "../../resolve-juspay-config.js";

/**
 * Warms up validate-payment right after a charge is confirmed — Commerce will call it for real
 * within seconds, once the storefront places the order. Best-effort only: awaited so the call
 * actually completes before this action's container may be frozen/reused, but any failure here
 * must never affect the real payment-status response.
 * @param {object} params action input parameters
 * @returns {Promise<void>} resolves once the warm-up attempt finishes, success or not
 */
async function warmupValidatePayment(params) {
  if (!params.VALIDATE_PAYMENT_URL) {
    return;
  }

  try {
    const token = await getImsAccessToken({
      clientId: params.AIO_COMMERCE_AUTH_IMS_CLIENT_ID,
      clientSecrets: params.AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS,
      scopes: params.AIO_COMMERCE_AUTH_IMS_SCOPES,
    });

    await fetch(params.VALIDATE_PAYMENT_URL, {
      body: JSON.stringify({ warmup: true }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-gw-ims-org-id": params.AIO_COMMERCE_AUTH_IMS_ORG_ID,
      },
      method: "POST",
    });
    console.log("Warmed up validate-payment");
  } catch (error) {
    // best-effort only — logged so a broken warm-up is visible without ever affecting the
    // real payment-status response below
    console.error(
      "validate-payment warm-up failed:",
      error.message,
      error.cause?.message ?? "",
    );
  }
}

/**
 * Called directly by the storefront after JusPay redirects back to `return_url` (see
 * create-session). Re-checks the real status server-to-server — the redirect's own query
 * params (status, status_id, signature) are not trusted here, only orderId is used as a lookup
 * key, since a browser URL can always be hand-edited.
 *
 * @param {object} params action input parameters
 * @param {string} params.orderId JusPay order id (from the return_url's order_id query param)
 * @param {string} [params.stateRegion] Adobe I/O State region
 * @param {string} [params.VALIDATE_PAYMENT_URL] deployed validate-payment URL, for the warm-up call
 * @param {boolean} [params.warmup] if true, returns immediately without calling JusPay — used to
 *   pre-warm this action's container right after create-session redirects the customer to
 *   JusPay's hosted page, since the customer will be gone for at least a little while
 * @returns {Promise<object>} the response object
 */
export async function main(params) {
  if (params.warmup === true) {
    return ok({ body: { warm: true } });
  }

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
    const success = JUSPAY_SUCCESS_STATUSES.has(order.status);

    if (success) {
      await warmupValidatePayment(params);
    }

    return ok({
      body: {
        orderId,
        status: order.status,
        success,
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
