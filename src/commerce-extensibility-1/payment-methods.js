/**
 * Out-of-process payment methods this app implements. Shared between the
 * create-payment-methods install step (creates these on the associated Commerce instance) and
 * the validate-payment webhook action (checks incoming payment method codes against this list).
 */
export const PAYMENT_METHODS = [
  {
    payment_method: {
      active: true,
      backend_integration_url:
        "https://108480-juspaycheckoutpoc-stage.adobeioruntime.net/api/v1/web/payment-method/validate-payment",
      code: "juspay",
      countries: ["IN"],
      currencies: ["INR"],
      // No refund action exists yet — keep this false until one is built, so Commerce doesn't
      // offer a refund button that has nothing behind it.
      custom_config: [{ key: "can_refund", value: false }],
      order_status: "processing",
      stores: ["default"],
      title: "JusPay",
    },
  },
];
