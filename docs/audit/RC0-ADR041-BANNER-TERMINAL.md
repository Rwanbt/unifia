<!-- SPDX-License-Identifier: MIT -->
# The Workbench banner offered a Reconnect that could never succeed

Measured on `dev@c293142cfc` in the clean clone, Windows Chromium, workers 1,
retries 0. This is a **product** defect, and the four `design-mode` tests that
caught it were right.

## What the tests asserted, and what the product did

`design-mode.spec.ts:41` expected `data-design-connection="unsupported"` and
`[data-design-retry]` at count 0 — a terminal state with no retry. Measured on
the same surface, without a workbench mock:

```
data-design-connection = "failed"
text = "Native Workbench bridge connection failed. Chat remains available; reconnect to retry."
[data-design-retry]   = 1
```

So the banner was `failed` and offered a **Reconnect** button. The natural reading
is that the product is lying about its state. That reading is wrong, and the
second half of the investigation is the useful part.

## Why `unsupported` is unreachable in the web runtime

`context/workbench/provider.tsx:43-55`:

```ts
function resolveBridge(platform: Platform): Platform["workbench"] {
  if (platform.workbench) return platform.workbench
  if (platform.platform !== "web") return undefined
  …
  return createWebWorkbenchBridge(() => { … })
}
```

On `web` a bridge is **always** returned, so `unsupported()` — defined as
`bridgeUnavailable = !bridge` — is false by construction on web. The bridge then
calls `POST /workbench-web/token`, the harness server has no password, the route
answers 404, `web-bridge.ts:38` throws `WebWorkbenchBridgeUnavailableError`, and
`uiPhase()` falls through to `failed`.

## What ADR-041 requires

`docs/adr/ADR-041-web-workbench-bridge.md`, status **accepted (owner decision
2026-09-22)**, decision 2:

> The Workbench bridge, and therefore this route, exists only when
> `UNIFIA_SERVER_PASSWORD` is set. Without a password the middleware lets any
> local caller through, so minting leases would be unauthenticated; the route
> answers 404 instead and **the web runtime keeps its fail-closed banner**.

and the Consequences section:

> Running the web app now requires a password-protected sidecar to use the
> Workbench surfaces; **without one they keep showing the desktop-only banner.**

`failed` + Reconnect is therefore the state ADR-041 rules out — and it is worse
than cosmetic: it invites an unbounded retry loop for a failure no amount of
retrying can fix, because the fix is a server password the user must set.

## The fix

One place. `uiPhase()` now reports `unsupported` when the stored reason is a
`WebWorkbenchBridgeUnavailableError`, above `retrying` for the same reason
`unsupported` already sits there: terminal beats transient.

The consumer needed no change — `connection-banner.tsx:18` is
`canRetry = () => phase() === "failed"`, so the button disappears on its own.
`detail()` was reordered so the ADR-041 message survives in this state; without
that the fail-closed banner would go silent about the one thing the person in
front of it can act on.

The frozen-at-init `unsupported` boolean was left alone, as its own comment
requires; this is a separate signal read off the stored reason, which the connect
path keeps unwrapped.

## The other three tests were stale

`data-design-split-kind`, `data-design-surface-switcher`, and
`data-design-split-{chat,workspace,handle,assistant,atelier}` **exist nowhere in
`packages/app/src`**. `git log -S` finds them added by `b00ccd8186` and removed by
`1171ccd387` — *"unify Design mode's chat, delete the dead per-mode chat stack"* —
which justifies the removal:

> DesignSplit rendered its own "assistant" column (WorkbenchThread) alongside the
> workspace ("atelier"), plus its own mobile switcher between them — a second,
> nested implementation of the exact "which pane is visible" concern
> `session.tsx`'s outer shell already owns for every mode. … DesignSplit's own
> chat column was pure duplication.

So the specs asserted a deliberately deleted implementation. Their *intent* —
the workshop must be reachable on a phone, and chat and workshop must sit side by
side on a desktop — is still a real requirement, so they were re-pointed at the
outer shell's contract rather than deleted. Measured before writing:

| viewport | radios | panes |
|---|---|---|
| 375×812 | `Chat`, `Editor` (no `Split`) | Editor → studio 351, chat 0; Chat → chat 353, studio 0; overflow 0 |
| 1440×900 | `Chat`, `Split`, `Editor` | Split → chat 348 at x=93, studio 966 at x=452; overflow 0 |

`Split` is absent on a phone because `layouts()` returns `["chat", "main"]` for
portrait phones and tablets — so asserting its absence *is* the contract. Which
radio is checked on arrival is persisted state and is deliberately not asserted;
the reachable set and the switching are.

## A defect that was mine

The first rewrite of the overflow test still failed, and the reason was mine: the
design surface first appears at **~4.6 s** in this harness (0 surface attributes
at 2.6 s, all of them at 4.65 s), while Playwright's default `expect` timeout is
5 s. An un-timed readiness wait is a coin flip. The wait now takes 30 s
explicitly.

## Evidence, including a control

Clean clone at `dev@c293142cfc`, workers 1, retries 0, real backend:

```
bun run typecheck                                    exit 0
bun test src/context/workbench                       39 pass, 0 fail (4 files)
e2e/modes/design-mode.spec.ts                        4 passed (38.5s)   was 4 failed
```

`provider.test.ts` reads `provider.tsx` **as source text** and regexes it, so the
edit could have broken it; it did not.

**Control for the non-regression check.** Running the same three spec files, the
`TypeError: Failed to fetch dynamically imported module: /src/pages/session.tsx`
appears **5 times with these changes and 5 times on unmodified `origin/dev`** — a
pre-existing Vite dev-server flake that this change neither causes nor worsens,
and which has nothing to do with the banner phase. With the changes: 8 passed /
2 failed; on unmodified dev: 4 passed / 6 failed.

## Not fixed here

`design-visual.spec.ts:162` ("renders identically across a reload") is a
different defect and remains open — see `RC0-DESIGN-VISUAL-BASELINES.md`.
