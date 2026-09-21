# JusPay Sandbox & API Integration

**Environment:** Sandbox · **Gateway:** JusPay · **Backend:** Adobe Commerce (ACCS) via App Builder

This integration lets a merchant on Adobe Commerce as a Cloud Service (ACCS) accept payments through JusPay's hosted checkout, with no server access needed on the Commerce side at all. All payment logic lives in a small Adobe App Builder app, deployed to Adobe I/O Runtime, and wired to Commerce through Adobe's out-of-process payment method (OOPE) framework plus Commerce Webhooks. This doc walks through the whole setup end to end — JusPay's sandbox account, the App Builder project, running and testing the app locally and once deployed, associating it with a real Commerce instance, and confirming JusPay actually shows up as a payable option on a cart.

**The most important piece of this whole setup is the Adobe Commerce Checkout Starter Kit** (`apps/payment-method` from `github.com/adobe/commerce-checkout-starter-kit`). The starter kit already provides the three actions this integration customizes (`create-session`, `validate-payment`, `filter-payment`), the App Builder → Commerce webhook wiring (`app.commerce.config.ts`), and the OOPE payment-method registration script that runs automatically on install.

```text
ACCS / EDS (Edge Delivery Services storefront )
   ↓
create-session
   ↓
JusPay Hosted Checkout
   ↓
returnUrl
   ↓
payment-status  (storefront re-verifies)
   ↓
placeOrder
   ↓
ACCS OOPE → validate-payment  (Commerce re-verifies, before the order is placed)
   ↓
JusPay Order Status
   ↓
CHARGED → Order
```

See section 12 for a troubleshooting quick reference.

## Contents
0. [Prerequisites](#0-prerequisites)
1. [JusPay sandbox setup](#1-juspay-sandbox-setup)
2. [App Builder project setup](#2-app-builder-project-setup)
3. [API integration](#3-api-integration)
4. [Run locally, then deploy](#4-run-locally-then-deploy)
5. [Technical account for testing (require-adobe-auth)](#5-technical-account-for-testing-require-adobe-auth)
6. [Associate with Commerce](#6-associate-with-commerce)
7. [Build the JusPay Config admin page](#7-build-the-juspay-config-admin-page)
8. [Set JusPay credentials (admin config page)](#8-set-juspay-credentials-admin-config-page)
9. [Where to check the webhook](#9-where-to-check-the-webhook)
10. [Curl requests to test the deployed app](#10-curl-requests-to-test-the-deployed-app)
11. [Confirming JusPay shows as a payment option](#11-confirming-juspay-shows-as-a-payment-option)
12. [Troubleshooting quick reference](#12-troubleshooting-quick-reference)

---

## 0. Prerequisites

- **Node.js 24.x exactly** — the starter kit's `package.json` pins `engines.node: "^24.0.0"`. Check with `node -v`; switch with `nvm use 24` if needed.
- **Git Bash** (Windows) — several build/deploy commands use POSIX-only shell syntax that PowerShell/cmd cannot parse. Run every `aio app ...` command from Git Bash, not PowerShell.
- Adobe I/O CLI (`aio`) installed and logged in (`aio auth login`), with access to the target org.
- **Adobe Developer Console access** to the target org — create/select projects, add services, generate credentials (sections 2, 5).
- **ACCS Commerce Admin access** with the App Management permission — needed to associate the app, manage webhooks, and use the JusPay Config page (sections 6, 8, 9).
- **JusPay sandbox account access** — see section 1.
- **Permission to associate/install an App Builder app** on the Commerce instance you're targeting — without this, section 6 will fail even with everything else in place.

---

## 1. JusPay sandbox setup

1. Sign up at `portal.juspay.in/selfSignUp`. Sandbox access does not require live gateway credentials.
2. Get the **Merchant ID** — shown on the dashboard homepage.
3. Generate the **API Key** — `Login → EC Operations → Settings → Security → Create API Key`. Shown once; copy immediately.

> **Auth format:** HTTP Basic — API key as username, empty password.
> `Authorization: Basic base64("<api_key>:")`

---

## 2. App Builder project setup

1. Create the Developer Console project:
   ```bash
   aio console project create -n <name> -t "<Display Name>" -o <org_id>
   aio console project select <name>
   aio console workspace select Stage
   ```

2. Scaffold the `payment-method` app from Adobe's Commerce checkout starter kit:
   ```bash
   aio app init --repo adobe/commerce-checkout-starter-kit/apps/payment-method
   ```
   If this fails with `Error: fetch failed` (some networks block `raw.githubusercontent.com` — see section 12), use this instead:
   ```bash
   git clone https://github.com/adobe/commerce-checkout-starter-kit.git
   cp -r commerce-checkout-starter-kit/apps/payment-method ./juspay-payment-method
   cd juspay-payment-method
   npm install
   ```

3. Bind the local app to the project:
   ```bash
   aio app use -g --no-input
   ```

---

## 3. API integration

1. JusPay credentials are **not** set via `.env` — they're entered on the **JusPay Config** page in Commerce Admin (`Stores → Sales → JusPay Config`): API Key, Merchant ID, and Sandbox/Production. The actions below read whatever is saved there; if nothing's saved yet, they return a "credentials not configured" message. `.env` only needs `CONFIG_ENCRYPTION_KEY` — a 32-byte hex key the API key is encrypted with before it's stored.

2. **`create-session`** — opens a JusPay order. Server-to-server; API key never reaches the browser.
   ```
   POST {JUSPAY_BASE_URL}/orders
   Authorization: Basic base64(apiKey:)
   x-merchantid: {JUSPAY_MERCHANT_ID}
   Content-Type: application/x-www-form-urlencoded

   order_id, amount, customer_id, return_url
   ```
   Returns `payment_links.web` — the hosted payment page URL.

3. **`validate-payment`** — confirms the payment actually happened. Runs on Commerce's `sales_order_place_before` webhook. Never trust the client — check JusPay's server directly.
   ```
   GET {JUSPAY_BASE_URL}/orders/{order_id}
   Authorization: Basic base64(apiKey:)
   x-merchantid: {JUSPAY_MERCHANT_ID}
   ```
   Order accepted only if `status === "CHARGED"`.

4. **`filter-payment`** — returns codes to **exclude** from checkout, not codes to include.

5. **`payment-status`** — Called directly by the storefront when the customer lands back on `return_url` after JusPay's hosted page. `create-session` accepts an optional `returnUrl` (must have **no query string** — rejected with a `400` by `create-session` itself before it even reaches JusPay) and passes it to JusPay as `return_url`. On completion, JusPay redirects the browser there with `order_id`, `status`, `status_id`, `signature`, and `signature_algorithm` appended as query params (confirmed empirically — JusPay's public docs don't document this). Those params are **not trusted directly** — only `order_id` is used, as a lookup key, to re-run the same server-to-server status check `validate-payment` does. No `require-adobe-auth` (same reasoning as `create-session` — the browser calls this directly, not Commerce).
   ```
   GET .../payment-method/payment-status?orderId={order_id from the redirect}
   → { "orderId": "...", "status": "CHARGED", "success": true }
   ```

---

## 4. Run locally, then deploy

**Run locally** first — no need to deploy just to test a change. This app now has two extensions (the payment actions, and the admin config page from section 7), so you must pick one with `-e`:
```bash
aio app run -e commerce/extensibility/1 --no-serve
```
Run from **Git Bash**. Starts a local dev server (self-signed TLS, port 9080) exposing the same action paths the deployed app will have:
```
https://localhost:9080/api/v1/web/payment-method/create-session
https://localhost:9080/api/v1/web/payment-method/validate-payment
https://localhost:9080/api/v1/web/payment-method/filter-payment
https://localhost:9080/api/v1/web/payment-method/payment-status
```

Test it with curl (`-k` skips certificate verification, needed for the self-signed cert):
```bash
curl -k --location 'https://localhost:9080/api/v1/web/payment-method/create-session' \
--header 'Content-Type: application/json' \
--data '{
  "orderId": "poc-order-local-test",
  "amount": "10.00",
  "customerId": "guest_local_test"
}'
```
In Postman, disable "SSL certificate verification" under Settings → General instead of `-k`.

**Deploy** once the local test looks right:
```bash
aio app deploy --force-build --force-deploy
```
Run from **Git Bash**.

---

## 5. Technical account for testing (require-adobe-auth)

`validate-payment` and `filter-payment` are marked `require-adobe-auth: true` — a personal `aio auth login` token will **not** pass this check (you'll get `unauthorized` or `missing authorization header`). You need an OAuth Server-to-Server credential's technical account instead, to test these manually.

1. In Developer Console, on this project's Stage workspace: add **"Adobe Commerce as a Cloud Service"** as an API/service.
2. Add an **OAuth Server-to-Server** credential. Note its **Client ID** and **Client Secret** (used below), and your **IMS Org ID** (shown on the same project overview page) — you'll need that separately as the `x-gw-ims-org-id` header in sections 10 and beyond.
3. Get a token:
   ```bash
   curl -X POST https://ims-na1.adobelogin.com/ims/token/v3 \
     -d "grant_type=client_credentials" \
     -d "client_id=<client_id>" \
     -d "client_secret=<client_secret>" \
     -d "scope=openid,AdobeID,additional_info.projectedProductContext,read_organizations,adobeio.abdata.read,additional_info.roles,adobeio.abdata.manage,adobeio.abdata.write,org.read,profile,email,commerce.accs"
   ```
4. Use the returned `access_token` as `Authorization: Bearer <token>` in any manual test call (section 9).

---

## 6. Associate with Commerce

1. In Commerce Admin: `Apps → App Management → Associate App`.
2. This should automatically register the `juspay` payment method (`POST /V1/oope_payment_method`) and create the webhook subscriptions. If you ever redo this after renaming `metadata.id` in `app.commerce.config.ts`, see section 9's warning first — re-associating then creates a second, parallel set of webhook subscriptions instead of replacing the old one.

**Verify the payment method directly** (it will not appear on the classic Payment Methods config page — see section 11):
```bash
curl "https://<commerce-base-url>/V1/oope_payment_method" \
  -H "Authorization: Bearer <token>"
```
Expect `code: "juspay"`, `active: true`. 
---

## 7. Build the JusPay Config admin page

This isn't part of the base starter kit — it's a second extension, built on top of it, so credentials can be set from Commerce Admin instead of `.env`. If you skip this, section 8 won't make sense — there's no config page without it.

1. Add a second extension in `app.config.yaml`, alongside the existing `commerce/extensibility/1`:
   ```yaml
   extensions:
     commerce/backend-ui/2:
       $include: src/commerce-backend-ui-2/ext.config.yaml
     commerce/extensibility/1:
       $include: src/commerce-extensibility-1/ext.config.yaml
   ```
2. Give it a menu entry in `app.commerce.config.ts` (`adminUi.menu`, using `MENU_SALES` from `@adobe/aio-commerce-lib-admin-ui/menu` to nest it under Commerce Admin's Sales menu):
   ```ts
   import { MENU_SALES } from "@adobe/aio-commerce-lib-admin-ui/menu";
   // ...
   adminUi: {
     menu: {
       id: "juspay_config",
       label: "JusPay Config",
       pageTitle: "JusPay Config",
       parentMenu: MENU_SALES,
       aclProtected: true,
     },
   },
   ```
3. Build the page itself: React + `@adobe/aio-commerce-lib-admin-ui/web`'s `createExtensionApp()`, plus one backend action (`config`, handling `op=get`/`save`/`reset`) that reads and writes Adobe I/O State. The actual files are in `src/commerce-backend-ui-2/` — `web-src/src/components/juspay-config.tsx` (the form), `actions/config/index.js` (backend), `actions/crypto-helper.js` (encrypts the API key before it's stored — see section 8).

**Two gotchas specific to this extension**, worth knowing if you're rebuilding it:
- **The Windows build hook bug is recurring, not fixed.** `commerce-backend-ui-2/ext.config.yaml`'s `pre-app-build`/`pre-app-dev`/`pre-app-run` hooks get auto-regenerated by `aio-commerce-lib-app`'s own tooling into a broken form — a duplicated command where only half is wrapped in `cross-env` — which fails on Windows `cmd.exe`. This happens **every time** `npm install`, `aio app build`, or `aio app dev` touches this extension, including just now while writing this doc — there's no one-time fix. Check the file after any of those commands and manually re-edit it back to one `cross-env`-wrapped line per hook, no `&&`, every time.
- **The build needs `scripts/react-jsx-dev-shim.js`**, aliased in `package.json`'s `"alias"` field. Without it, the built page throws `jsxDEV is not a function` at runtime — a Parcel/React interaction, not something obvious from the error itself.

**Testing it locally:**
```bash
aio app dev -e commerce/backend-ui/2
```
Use `aio app dev`, not `aio app run` — `aio app run` treats the hook bug above as fatal; `aio app dev` just logs it and carries on.

---

## 8. Set JusPay credentials (admin config page)

With section 7 deployed, the actual credential setup is quick:

1. In Commerce Admin: `Stores → Sales → JusPay Config`.
2. Enter the API key and Merchant ID (from section 1), pick Sandbox/Production, click Save.
3. The API key is encrypted before it's written to storage (Adobe I/O State, key `juspay-config`) — only a masked preview (e.g. `****1234`) is ever shown back, never the real value.
4. Save and Reset both require a real Commerce Admin session — the page attaches your logged-in Adobe IMS token automatically. Calling the underlying action directly without one returns `401`. This check is **not** full Adobe IMS signature verification (that would need a network call to Adobe's public keys) — it only checks the token is well-formed, unexpired, and for the right org. Enough to stop random unauthenticated calls, not a substitute for `require-adobe-auth: true`.
5. Until something is saved here, `create-session`/`validate-payment`/`payment-status` all return a clear *"JusPay credentials are not configured"* message — there's no fallback to `.env` or anything else.

`.env` still needs one value for this to work: `CONFIG_ENCRYPTION_KEY` (32 bytes, hex) — the key the API key is encrypted with. This isn't a JusPay credential; it's local to this app and must be set before deploying.

---

## 9. Where to check the webhook

Commerce Admin → **System → Webhooks → Subscriptions**. Look for two rows, prefixed with `app.commerce.config.ts`'s `metadata.id` (underscored):
- `..._oope_payment_methods_sales_order_place_before` — calls `validate-payment`
- `..._payment_method_filter` — calls `filter-payment`

Each row's **URL** field is directly editable and must point at the currently deployed action.


**To test a subscription without placing a real order:** open the row → **Test Webhook** → paste:
```json
{
  "order": {
    "payment": {
      "method": "juspay",
      "additional_information": {
        "juspay_order_id": "<real order id from section 10>"
      }
    }
  }
}
```
Click **Run Webhook**. "Ran successfully" confirms the webhook reaches your action — the actual accept/reject result still depends on whether that order was really paid.

Commerce Admin's error display often **truncates** long messages. For the full text, use:
```bash
aio app logs -a payment-method/validate-payment -l 5
```

---

## 10. Curl requests to test the deployed app

The Postman collections in `postman/` (`JusPay-PoC.postman_collection.json` for local, `JusPay-PoC-Deployed.postman_collection.json` for deployed) run these same requests in order, with auth tokens and IDs chained automatically — easier than copy-pasting curl by hand. `demo/integration-paths-demo.html` is a self-contained, real end-to-end demo of the whole redirect flow (create session → pay → redirect → payment-status) if you'd rather see it working in a browser than via curl.

**Create a session:**
```bash
curl --location 'https://<namespace>.adobeioruntime.net/api/v1/web/payment-method/create-session' \
--header 'Content-Type: application/json' \
--data '{
  "orderId": "poc-order-test",
  "amount": "10.00",
  "customerId": "guest_test"
}'
```
Returns `paymentLink` (and `iframeLink`, same URL, for embedding) — open it and pay with sandbox test card `4242 4242 4242 4242` (any future expiry, any CVV).

**Validate the payment** (needs the Bearer token from section 5):
```bash
curl --location 'https://<namespace>.adobeioruntime.net/api/v1/web/payment-method/validate-payment' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <token>' \
--header 'x-gw-ims-org-id: <ims_org_id>' \
--data '{
  "payment_method": "juspay",
  "payment_additional_information": {
    "juspay_order_id": "<order id from create-session>"
  }
}'
```
Expected after a real, successful payment: `{ "op": "success" }`. Before paying, or with an invalid order id: `{ "op": "exception", ... }` — correct behavior, not a failure.

**Check payment status** (no auth needed — this is the frontend-facing equivalent of the above):
```bash
curl --location 'https://<namespace>.adobeioruntime.net/api/v1/web/payment-method/payment-status?orderId=<order id from create-session>'
```
Returns `{ "orderId": "...", "status": "...", "success": true|false }`. `success` is only `true` once JusPay's own server reports `CHARGED` — this is what the storefront should call after landing back on `return_url`.

---

## 11. Confirming JusPay shows as a payment option

JusPay does not appear on Commerce Admin's `Stores → Configuration → Sales → Payment Methods` page — that page is for the older config.xml-based payment integrations only. Verify via the REST call in section 6, or the GraphQL query below.

Query the cart directly:
```graphql
query {
  cart(cart_id: "YOUR_CART_ID") {
    available_payment_methods { code title }
  }
}
```
```bash
curl --location 'https://<commerce-base-url>/graphql' \
--header 'Content-Type: application/json' \
--data '{"query":"query { cart(cart_id: \"YOUR_CART_ID\") { available_payment_methods { code title } } }"}'
```

If it returns `juspay`, along with a matching `code`/`title`, the payment method is correctly registered and selectable — the integration is wired far enough to reach checkout. That alone isn't proof the whole flow works: complete a real payment (section 10) and confirm `validate-payment` reports `{ "op": "success" }` to know the end-to-end flow — session creation through webhook validation — actually works.

---

## 12. Troubleshooting quick reference

| Symptom | Cause | Fix |
|---|---|---|
| `Error: fetch failed` on `aio app init --repo` | Network blocks `raw.githubusercontent.com` | `git clone` the starter kit repo manually, copy `apps/payment-method` |
| `'EXTENSION' is not recognized...` | Running from PowerShell/cmd | Use Git Bash |
| `The requested resource does not exist.` on a deployed action | Stale `dist/` folder | `rm -rf dist`, redeploy with `--force-build --force-deploy` |
| `spawnSync npm ENOENT` during `npm install` | Windows Node quirk in postinstall tooling | Run `npm install` again |
| `missing authorization header` / `unauthorized` calling `validate-payment`/`filter-payment` | Used a personal login token | Use an OAuth Server-to-Server technical account token instead (section 5) |
| `Invalid ImsAuthProvider configuration` | `AIO_COMMERCE_AUTH_IMS_*` env vars missing, or scopes not a JSON array string | Set all six vars; scopes as `["a","b"]`, not `"a,b"` |
| `401` calling the JusPay Config action (`op=save`/`op=reset`) | No Commerce Admin session — called the action directly instead of through the config page, or `AIO_COMMERCE_AUTH_IMS_ORG_ID` isn't set on the deployed app | Use the config page in Commerce Admin, not raw curl; confirm the org ID env var is deployed |
| `401` on save/reset even from the real config page, log says `token has no exp claim` | Real Adobe IMS tokens use `created_at`/`expires_in` (ms), not the standard JWT `exp` claim — check `aio app logs -a juspay-config/config -l 5` for the exact reason | Already handled in this repo's `config/index.js`; if rebuilding this check from scratch, support both claim shapes |
| `Error: Your app implements multiple extensions...` running `aio app run`/`aio app dev` | Two extensions now exist (section 7 added a second one) | Pass `-e commerce/extensibility/1` or `-e commerce/backend-ui/2` to pick one |
| More than 2 rows in Webhooks → Subscriptions for this app | `metadata.id` was renamed after an earlier association — old and new webhook pairs both stay active (see section 9) | Delete the pair with the stale id prefix, keep the current one |
| `JusPay credentials are not configured` from `create-session`/`validate-payment`/`payment-status` | Nothing saved yet on the JusPay Config page, or `CONFIG_ENCRYPTION_KEY` changed since the last save | Save credentials via section 8; if the key changed, re-save — old encrypted values can't be read with a new key |
| `Invalid ImsAuthProvider configuration` at install time | Same as above, blocking the install's webhook step | Same fix, then redeploy and retry install |
| "Already associated" + Unassociate says "no association record found" | Stuck association state | Don't loop retrying — consider a fresh project |
| `[ERR1200] Technical account mismatch` | App split across two Developer Console projects/credentials | Make namespace, credential, and association all consistent on one project |
| Bare 404 on `/rest/V1/oope_payment_method` | ACCS doesn't use the `/rest/` prefix | Use `/V1/oope_payment_method` |
| JusPay missing from `Stores → Configuration → Sales → Payment Methods` | Expected — OOPE methods don't appear there | Verify via REST API or GraphQL instead |
| `available_payment_methods` empty for *every* method | Cart has no shipping address/method, or `Allow Countries` (General config) is empty | Set shipping address + method; select at least the target country in `Allow Countries` |
| `available_payment_methods` empty for JusPay specifically (others show) | Store currency isn't `INR` | Set Base/Default Display/Allowed Currency to INR in Currency Setup, or scope JusPay's registration to the store's actual currency |
