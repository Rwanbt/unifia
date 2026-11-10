<!-- SPDX-License-Identifier: MIT -->
# Markdown sanitisation coverage

Why the DOMPurify policy is tested in Chromium and not under happy-dom, and what
that means for CI.

Context: `GHSA-cg2g-xh64-v4q7` (critical) was fixed by bumping DOMPurify
`3.4.16 → 3.4.17`. A version bump proves the advisory is gone from the graph; it
does not prove the sanitisation still strips hostile HTML. That behavioural proof
is what `packages/app/security/markdown-sanitize.spec.ts` supplies.

## The policy under test

Single source: `packages/ui/src/components/markdown-sanitize.ts`, exporting
`MARKDOWN_SANITIZE_CONFIG` and `anchorRelHook`. It is imported by
`packages/ui/src/components/markdown.tsx`, which renders model output and
user-authored Markdown, and by the security spec — so a weakened config fails
the test rather than passing against a stale copy.

Two call sites gate it in production:

- `packages/ui/src/components/markdown.tsx` (assistant output, user Markdown);
- `packages/web/src/components/share/content-markdown.tsx` (shared conversations).
  This one keeps its own, narrower config (`html` profile only, no MathML) and
  does **not** import the shared module, because `packages/web` has no dependency
  on `@unifia/ui`. That duplication is pre-existing and is a follow-up candidate;
  it is not covered by the test below.

## Why not happy-dom

The repository runs its component suites under happy-dom
(`@happy-dom/global-registrator`, `packages/app/happydom.ts`). DOMPurify does not
behave correctly there: it walks the parsed tree and removes disallowed nodes,
and happy-dom 20.x does not reproduce that removal faithfully.

Measured on 2026-11-10 with DOMPurify `3.4.17` and
`@happy-dom/global-registrator` `20.0.11` / `happy-dom` `20.11.1`:

```
isSupported  = true                      # so a naive test would "run"
default      = "a<script>bad()</script><img src=\"x\" onerror=\"alert(1)\">"
ui-config    = "a<script>bad()</script><img src=\"x\" onerror=\"alert(1)\"><style>x{}</style>"
```

Hostile tags and the `onerror` handler survive **with the default configuration**,
which a browser never allows. The `<p>` wrapper is dropped while `<script>` is
kept — the opposite of the policy — so this is a happy-dom DOM-semantics defect,
not a policy or DOMPurify regression.

Diagnostics for the same run:

```
RETURN_DOM node   = BODY
DOMPurify.removed = [{"element":{}},{"element":{}}]     # claims 2 removals
serialised output = retains <script> and onerror          # ... but keeps them
DOMParser body    = "<p>a</p><script>…</script><img …>"   # parsing itself is fine
```

`DOMPurify.removed` disagreeing with the serialised output means no assertion
built on happy-dom can be trusted in either direction. A test there would either
fail permanently on correct code or, worse, pass on a broken policy.

Adding `jsdom` (DOMPurify's own test environment) was rejected: it is a new
dependency of ~10 MB for one assertion, and it would need its own audit review.

## What runs instead

`packages/app/playwright.security.config.ts` + `packages/app/security/`:
an isolated Playwright project on Chromium — the same engine the Tauri WebView
and browser clients run. It needs no app server: it uses `page.setContent()`
and loads `dompurify/dist/purify.min.js` (the UMD bundle shipped to clients),
then applies the imported production config and hook.

```bash
cd packages/app && bun run test:security
# equivalent: bunx playwright test -c playwright.security.config.ts
```

Asserted: benign markup survives; no `<script>`/`<style>` element; style and
script bodies do not leak back as text; no `on*` handler attribute (HTML or SVG
`<animate onbegin>`); no `javascript:` URL; no `<iframe>`; re-inserting the
sanitised output into the DOM executes nothing (`window.__pwned` stays unset);
`target="_blank"` links gain `noopener noreferrer`; and the policy still forbids
`style`, forbids `script`/`style` contents, and keeps `SANITIZE_NAMED_PROPS`.

## Limit of this proof

This is the client-side path. `content-markdown.tsx:49-50` still returns raw,
unsanitised HTML on the server (`typeof window === "undefined"`), so
server-rendered share pages are unprotected until hydration. That is pre-existing,
out of scope for the dependency lot, and needs its own card.
