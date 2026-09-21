import {
  exceptionOperation,
  isWebhookSuccessful,
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";
import {
  getInstrumentationHelpers,
  instrumentEntrypoint,
} from "@adobe/aio-lib-telemetry";

import {
  getOrderStatus,
  JUSPAY_SUCCESS_STATUSES,
} from "../../juspay-client.js";
import { PAYMENT_METHODS } from "../../payment-methods.js";
import {
  JuspayNotConfiguredError,
  resolveJuspayConfig,
} from "../../resolve-juspay-config.js";
import { checkoutMetrics } from "../checkout-metrics.js";
import { telemetryConfig } from "../telemetry.js";

const SUPPORTED_PAYMENT_METHOD_CODES = PAYMENT_METHODS.map(
  (paymentMethod) => paymentMethod.payment_method.code,
);

/**
 * This action validates the payment information before the order is placed.
 * It has to be configured as Commerce Webhook in the Adobe Commerce Admin.
 *
 * @param {object} params input parameters
 * @returns {Promise<{type: string, statusCode: number, body: {op: string}}>} the response object
 * @see https://developer.adobe.com/commerce/extensibility/webhooks
 */
async function validatePayment(params) {
  const { logger, currentSpan } = getInstrumentationHelpers();

  logger.debug("Starting payment validation process");

  try {
    const {
      payment_method: paymentMethod,
      payment_additional_information: paymentInfo,
    } = params;

    logger.info(
      `Payment method ${paymentMethod} with additional info.`,
      paymentInfo,
    );
    currentSpan.setAttribute("payment.method", paymentMethod);

    if (!SUPPORTED_PAYMENT_METHOD_CODES.includes(paymentMethod)) {
      // The validation of this payment method is not implemented by this action, ideally the webhook subscription
      // has to be constrained to the payment method code implemented by this app so this should never happen.
      logger.debug(`Payment method ${paymentMethod} not handled by this app.`);
      checkoutMetrics.validatePaymentCounter.add(1, {
        result: "not_supported",
        status: "success",
      });
      return ok(successOperation());
    }

    if (!paymentInfo) {
      // payment_additional_information is set using the graphql mutation setPaymentMethodOnCart
      // see https://developer.adobe.com/commerce/webapi/graphql/schema/cart/mutations/set-payment-method/#paymentmethodinput-attributes
      logger.warn(
        "payment_additional_information not found in the request",
        paymentMethod,
      );
      checkoutMetrics.validatePaymentCounter.add(1, {
        errorCode: "missing_info",
        status: "error",
      });
      return ok(
        exceptionOperation(
          "payment_additional_information not found in the request",
        ),
      );
    }

    // payment_additional_information.juspay_order_id is set on the cart by the frontend via
    // setPaymentMethodOnCart, using the orderId returned from the create-session action.
    const juspayOrderId = paymentInfo.juspay_order_id;
    if (!juspayOrderId) {
      logger.warn(
        "juspay_order_id missing from payment_additional_information",
        paymentInfo,
      );
      checkoutMetrics.validatePaymentCounter.add(1, {
        errorCode: "missing_order_id",
        status: "error",
      });
      return ok(
        exceptionOperation(
          "juspay_order_id not found in payment_additional_information",
        ),
      );
    }

    // Never trust the browser's word that payment succeeded — ask JusPay's server directly.
    const { apiKey, baseUrl, merchantId } = await resolveJuspayConfig(params);
    const order = await getOrderStatus(
      { apiKey, baseUrl, merchantId },
      juspayOrderId,
    );

    if (!JUSPAY_SUCCESS_STATUSES.has(order.status)) {
      logger.info(
        `JusPay order ${juspayOrderId} not successful, status=${order.status}`,
      );
      checkoutMetrics.validatePaymentCounter.add(1, {
        errorCode: "payment_not_successful",
        status: "error",
      });
      return ok(
        exceptionOperation(
          `JusPay payment not successful (status: ${order.status})`,
        ),
      );
    }

    logger.debug(
      "Validated payment information successfully.",
      paymentMethod,
      juspayOrderId,
    );

    checkoutMetrics.validatePaymentCounter.add(1, { status: "success" });

    return ok(successOperation());
  } catch (error) {
    logger.error("Error in payment validation:", error);
    checkoutMetrics.validatePaymentCounter.add(1, {
      errorCode:
        error instanceof JuspayNotConfiguredError
          ? "not_configured"
          : "exception",
      status: "error",
    });
    if (error instanceof JuspayNotConfiguredError) {
      return ok(exceptionOperation(error.message));
    }
    return ok(exceptionOperation(`Server error: ${error.message}`));
  }
}

// Export the instrumented function as main
export const main = instrumentEntrypoint(validatePayment, {
  ...telemetryConfig,
  isSuccessful: isWebhookSuccessful,
});
