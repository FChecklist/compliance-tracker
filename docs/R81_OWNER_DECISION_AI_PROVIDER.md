# Owner decision required — the AI layer cannot lawfully serve end users as ruled

**Gap** `G-01` · **Faults** `R81_F05`, `R81_F21` · **Prepared by** R81, 2026-09-08
**Status:** needs an owner ruling. No amount of engineering closes it.

---

## The one-sentence version

Your standing ruling is that the end-user default for L1/L2/L3 is **Claude Code
Sonnet High**. The code says, in its own error text, that this specific
authentication method **may not be used to serve other people**. Both cannot be
true, and this is not a bug anyone can fix — it is a licensing constraint.

---

## What the code actually says

`ct/src/lib/ai/adapter.ts:78-82`:

> Anthropic's Claude Code policy permits OAuth/subscription auth for ordinary
> individual use only — never to serve a request on behalf of a different
> person. Set `AI_PROVIDER=openrouter` before this product serves anyone other
> than that one account.

That is not an assumption made by an auditor. It is the product's own guard,
written by whoever built the adapter, refusing to serve strangers on a personal
subscription.

**Why it must not be "fixed" in code.** The obvious-looking repair is to set
`AI_PROVIDER=claude-cli` so the AI starts answering. That is precisely the action
the guard exists to prevent. If this is filed as a configuration gap, that is
what someone will eventually do.

---

## Three mechanics worth knowing before you choose

1. **An unset variable selects the restricted provider.** `adapter.ts:87` reads
   `process.env.AI_PROVIDER ?? "claude-cli"`. Nothing checked in — no
   `.env.production`, no `vercel.json` — sets it. So the default is the one
   option that cannot serve customers.
2. **The gate currently refuses everyone, including you.** The `!allowed`
   refusal at `:68` throws *before* the identity comparison at `:78`. With
   `RAJAT_USER_ID` unset, it refuses for every caller — the owner included.
3. **One path bypasses the gate entirely, and it does so worst on environment 1.**
   `ct/src/lib/ai/batch/analyse.ts:185-191` never calls the guard at all. Its
   stated justification is that `claude-cli` "would still correctly fail on a
   serverless runtime with no `claude` binary". That reasoning holds for
   environment 2 only. **Environment 1 is your local machine, where the binary
   exists**, and `:180` loops over every org. So the tripwire is missing exactly
   where the product is currently declared live. (`G-01b` — a real code defect,
   assigned to the sibling session.)

---

## The deeper problem, which outlives whichever provider you pick

`AI_PROVIDER` is **one global environment variable**. Your ruling is that L1, L2
and L3 are each independently provider- and model-agnostic. **That cannot be
expressed by a single global switch at all.** So even a correct answer to
"OpenRouter or API key?" leaves the architecture unable to represent the policy
you set.

There is a second, related defect: `RAJAT_USER_ID` gates *end-user runtime
behaviour* on the *owner's developer identity*. That is the wrong axis
regardless of provider — a customer's request should not be evaluated against
who built the system.

**Recommendation: rule on the axis, not just the vendor.** Otherwise this
returns the next time the policy changes.

---

## Your options

| | Route | What it costs | What it gets you |
|---|---|---|---|
| **A** | **Anthropic API key** | Pay-per-token on an API account. No new vendor. | Keeps you on Claude models, which is what your ruling actually asked for. **API-key auth may serve other people** — it is the subscription auth that may not. Smallest change to the intent of your ruling. |
| **B** | **OpenRouter** | An OpenRouter account plus credits. A second vendor in the path. | The route the code itself recommends, and `adapter.ts:65` already skips the guard for it — so the provider plumbing exists today. Also the natural fit for per-level model switching. |
| **C** | **Ship with the AI disabled** | Nothing. | **This is genuinely viable and is worth serious thought.** PROJEXA's value to a construction firm is the ERP: BOQ, work progress, procurement, reports. Those do not need the AI layer. Choosing this takes three items off the release path immediately and costs you no money while you have no customers. |
| **D** | Do nothing | — | The AI refuses every caller, including you, and `G-01`, `G-02` and `G-07` stay open indefinitely. |

**My recommendation: C now, then A or B.** You have zero customers, so the AI
layer is not what is standing between you and a first user — and options A and B
both cost money that buys nothing until someone is actually using the product.
Shipping the ERP with the AI explicitly disabled is honest, cheap, and reversible.
Then choose A if you want to stay on Claude models, or B if per-level provider
switching matters more.

**Whichever you choose, the axis fix (per-level provider selection, and removing
the owner-identity gate from the end-user path) should be ruled on at the same
time** — otherwise it is re-litigated at the next change.

---

## If you pick C, one thing must be done properly

Disabling the AI must be **explicit and loud**, not the current accidental
default. Today an unset `AI_PROVIDER` silently selects the restricted provider
and the failure surfaces as a refusal deep in a request. If the answer is "off
for now", the product should say so at boot and the UI should not advertise AI
capabilities it will refuse to perform — which is the same argument as the
unwired-pill rule (`R-81`): a capability that is offered and does nothing is
worse than one that is absent.

---

## What this blocks, and what it does not

- **Blocks:** any claim that the AI layer is usable by a customer; `G-02`
  (AI attribution) and `G-07` (the AI audit row), which are only meaningful once
  a model is actually permitted to run.
- **Does not block:** the ERP. Under option C, environment 1 can be released
  with the AI off.
