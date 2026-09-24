# App Builder Cold Start

**The issue:** Adobe I/O Runtime spins down idle action containers, so the first call after idle
time ("cold start") is slower than a warm one — a customer-facing latency risk on `validate-payment`,
the action Commerce calls to confirm a charge before placing the order.

**What we're solving:** keep the actions warm right before they're actually needed, without
building extra infrastructure or wasting Runtime usage quota.

## How it works

Adobe has no "keep warm" API — the only way to warm a container is a real invocation. Each
action is warmed based on who can realistically call it early:

- **`create-session`** — storefront calls it directly with `{ warmup: true }` right before the
  customer clicks Pay. Returns `{ warm: true }` immediately, no JusPay call.
- **`validate-payment`** — only ever called by Commerce's webhook, so the storefront can't warm
  it directly.
- **`payment-status`** — called by the storefront right after a payment, to confirm `CHARGED`.
  The moment it sees `CHARGED`, it fires a real, authenticated, server-to-server warm-up call to
  `validate-payment` — seconds before Commerce's webhook will call it for real. It also has its
  own `{ warmup: true }` short-circuit, since something else warms *it*:
- **`create-session`** also warms `payment-status` — right after opening a real JusPay session,
  it fires a fire-and-forget `{ warmup: true }` call to `payment-status` (no auth needed, it's
  public), since the customer is about to be away for a bit entering payment details before
  `payment-status` gets called for real on return.

### The real flow, end to end
```text
Customer reaches payment step
        │
        ▼
Storefront → create-session { warmup: true }   (silently warms create-session)
        │
        ▼
Customer clicks Pay
        │
        ▼
Storefront → create-session { real order }  →  JusPay hosted checkout
        │                                              │
        └── create-session warms payment-status ───────┘   (fire-and-forget, while
                (real, unauthenticated call)                 customer is away paying)
        ▼
Customer pays, redirected back to return_url
        │
        ▼
Storefront → payment-status?orderId=...   (now warm)
        │
        ├─ status !== CHARGED  →  done, nothing  warmed
        │
        └─ status === CHARGED
                │
                ▼
          payment-status → validate-payment { warmup: true }   (real, authenticated,
                │                                                server-to-server call)
                ▼
          Storefront proceeds to place the order in Commerce
                │
                ▼
          Commerce fires sales_order_place_before webhook
                │
                ▼
          validate-payment { real payment_method, payment_additional_information }
                │                     ↑
                └── now warm, seconds after the warm-up call above ──┘
```



## Key facts

- **Pre-warm pool eligibility**: default Node version + 256/512/1024MB memory only. All 4 actions
  already run on default 256MB. [Source](https://developer.adobe.com/app-builder/docs/get_started/runtime_getting_started/understanding-runtime#container-lifecycle)
- **Warm container idle window**: Adobe's own docs disagree — 2, 5, and 10 minutes across three
  different official pages. 

## Final verification (2026-09-24)

Tested via Commerce Admin's Test Webhook tool, fired at known intervals after a real
`payment-status`-triggered warm-up. Timing derived from the gap between the auth validator's
`"Calling the main action"` log and `validate-payment`'s own first log line (no `duration` field
was surfaced by the Console for these activations):

| Time since last warm-up | Gap |
|---|---|
| ~11 min (cold) | 875ms |
| ~8 min (cold) | 736ms |
| ~11 min (cold) | 713ms |
| **48 sec (warm)** | **684ms** |

Warm is consistently fastest, cold consistently slowest — a real but modest effect (~22%), not a
dramatic multi-second cold start. Likely because default-256MB actions already sit in Adobe's
pre-warm pool regardless of our own mechanism, so even "cold" here isn't a true cold boot.



*Caveat: this is a timestamp-derived proxy (Console never surfaced an official duration field),
from a small sample (n=4) — directionally solid, not a precise benchmark.*
