import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { useCallback, useEffect, useState } from "react";

import allActions from "../config.json";

import type { ChangeEvent } from "react";

const ACTION_URL = (allActions as Record<string, string>)[
  "juspay-config/config"
];

async function call(
  op: string,
  params: Record<string, unknown> = {},
  method: "GET" | "POST" = "GET",
  authHeaders: Record<string, string> = {},
) {
  if (!ACTION_URL) {
    throw new Error(
      "Runtime action URL is unavailable. Check the generated extension wiring.",
    );
  }

  let url = ACTION_URL;
  const fetchOptions: RequestInit = {
    headers: { "Content-Type": "application/json", ...authHeaders },
    method,
  };

  if (method === "GET") {
    const query = new URLSearchParams({ op, ...toStringRecord(params) });
    url = `${ACTION_URL}?${query.toString()}`;
  } else {
    fetchOptions.body = JSON.stringify({ op, ...params });
  }

  const res = await fetch(url, fetchOptions);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body;
}

function toStringRecord(
  params: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = String(value);
  }
  return out;
}

/** JusPay Config: view/edit the API key, Merchant ID, and sandbox/production toggle. */
export function JuspayConfig() {
  const { data: ims } = useIms();
  const [configured, setConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [environment, setEnvironment] = useState("sandbox");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await call("get");
      const body = data.body || data;
      setConfigured(Boolean(body.configured));
      setApiKeyMasked(body.apiKeyMasked || "");
      setMerchantId(body.merchantId || "");
      setEnvironment(body.environment || "sandbox");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!ACTION_URL) {
      return;
    }
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const handleSave = useCallback(async () => {
    if (!ims) {
      setError(
        "Can't verify your Commerce Admin session — try reloading this page.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Send apiKey only if the customer typed a new one — otherwise keep whatever is already
      // saved (the field only ever shows a masked preview, never the real value, so there is
      // nothing meaningful to resend once it's saved).
      const params: Record<string, unknown> = { environment, merchantId };
      if (apiKey) {
        params.apiKey = apiKey;
      }

      const authHeaders = {
        Authorization: `Bearer ${ims.imsToken}`,
        "x-gw-ims-org-id": ims.imsOrgId,
      };
      await call("save", params, "POST", authHeaders);
      setApiKey("");
      setSaved(true);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, environment, ims, merchantId, refresh]);

  // window.confirm() is silently ignored inside Commerce Admin's sandboxed iframe (no
  // allow-modals), so this needs its own inline confirmation UI instead of a native dialog.
  const handleResetClick = useCallback(() => setConfirmingReset(true), []);
  const handleResetCancel = useCallback(() => setConfirmingReset(false), []);

  const handleResetConfirm = useCallback(async () => {
    setConfirmingReset(false);
    if (!ims) {
      setError(
        "Can't verify your Commerce Admin session — try reloading this page.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const authHeaders = {
        Authorization: `Bearer ${ims.imsToken}`,
        "x-gw-ims-org-id": ims.imsOrgId,
      };
      await call("reset", {}, "POST", authHeaders);
      setApiKey("");
      setMerchantId("");
      setEnvironment("sandbox");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [ims, refresh]);

  const handleEnvironmentChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => setEnvironment(e.target.value),
    [],
  );
  const handleApiKeyChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value),
    [],
  );
  const handleMerchantIdChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setMerchantId(e.target.value),
    [],
  );

  return (
    <div className="jp-page">
      <div className="jp-wordmark">JusPay</div>

      <div className="jp-card">
        <div className="jp-card-header">
          <span aria-hidden="true" className="jp-card-icon">
            ⚙
          </span>
          <h2 className="jp-card-title">General Configuration</h2>
        </div>
        <div className="jp-divider" />

        <p className="jp-intro">
          Configure your JusPay integration settings for Adobe Commerce.
        </p>

        {error && <div className="jp-banner jp-banner-error">{error}</div>}
        {saved && !error && (
          <div className="jp-banner jp-banner-success">Saved.</div>
        )}
        {confirmingReset && (
          <div className="jp-banner jp-banner-confirm">
            <p>
              Clear the saved JusPay credentials? This starts fresh — you'll
              need to enter and save them again.
            </p>
            <div className="jp-confirm-actions">
              <button
                className="jp-reset-button"
                onClick={handleResetConfirm}
                type="button">
                Yes, clear
              </button>
              <button
                className="jp-cancel-button"
                onClick={handleResetCancel}
                type="button">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="jp-field">
          <label htmlFor="jp-environment">
            Environment <span className="jp-required">*</span>
          </label>
          <select
            id="jp-environment"
            onChange={handleEnvironmentChange}
            value={environment}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
        </div>

        <div className="jp-field">
          <label htmlFor="jp-api-key">
            API Key <span className="jp-required">*</span>
          </label>
          <input
            id="jp-api-key"
            onChange={handleApiKeyChange}
            placeholder={configured ? apiKeyMasked : "Not set yet"}
            type="password"
            value={apiKey}
          />
        </div>

        <div className="jp-field">
          <label htmlFor="jp-merchant-id">
            Merchant ID <span className="jp-required">*</span>
          </label>
          <input
            id="jp-merchant-id"
            onChange={handleMerchantIdChange}
            type="text"
            value={merchantId}
          />
          <p className="jp-help">Your JusPay Merchant ID.</p>
        </div>

        <div className="jp-divider" />

        <div className="jp-actions">
          {busy && (
            <span aria-label="Working" className="jp-spinner" role="status" />
          )}
          {configured && !confirmingReset && (
            <button
              className="jp-reset-button"
              disabled={busy}
              onClick={handleResetClick}
              type="button">
              Reset
            </button>
          )}
          <button
            className="jp-save-button"
            disabled={busy || !merchantId || !(configured || apiKey)}
            onClick={handleSave}
            type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
