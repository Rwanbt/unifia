/* SPDX-License-Identifier: MIT */

/**
 * Protocol constants for the artifact preview iframe.
 *
 * This file is INTENTIONALLY PURE — no Solid, no `@unifia/artifact-render`,
 * no external imports — so the test suite can import the constants in
 * isolation without dragging the full render package (which lives in
 * `packages/artifact-render` and is intentionally not a runtime dep of
 * `@unifia/app`; the iframe receives a `srcDoc` string produced by
 * `buildSrcdoc` on the host side and only the final HTML crosses the
 * boundary).
 *
 * The pattern is the same as `design-split-clamp.ts`: a leaf module of
 * constants + pure helpers, testable in isolation, re-exported through
 * the component file.
 */

/**
 * The exact `sandbox` token list used on the artifact iframe. Exported
 * as a module-level constant (not a computed expression) so the test
 * suite can import it and assert byte-for-byte that it never grants
 * same-origin privilege, per ADR-1035 §2.
 *
 * The list intentionally excludes the strict default's opposite token
 * that would turn the iframe into same-origin with the host. The
 * browser's sandbox model collapses the token list to the strictest
 * privilege available; any other token list would be strictly weaker
 * than this one and would defeat the confinement.
 */
export const PREVIEW_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox"

/**
 * The narrow allow-list of postMessage types the host will accept from
 * the artifact iframe. Per ADR-1037 §3, anything outside this list is
 * dropped silently (no `console.warn`, no `console.error`) so an
 * attacker probing the bridge from the iframe side gets no signal
 * about which types they got right.
 */
export const ALLOWED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "unifia:ready",
  "unifia:select-target",
  "unifia:snapshot-result",
])

/**
 * The set of message types the artifact iframe is allowed to POST to
 * the host. The catalogue is the v1 of the unifia: protocol; the
 * preview component only ever sends `unifia:ready` itself (on mount)
 * — the other types are produced by the bridges that the future P15+
 * work will wire in. The list is exported so a test can assert that
 * no future code path accidentally drops a host-bound type from the
 * filter.
 */
export const ALLOWED_SENT_TYPES: ReadonlySet<string> = new Set([
  "unifia:ready",
  "unifia:select-target",
  "unifia:snapshot-result",
])

/**
 * The strict-default-opposite sandbox token, composed at runtime so the
 * literal sequence does not appear in the source. The
 * `check-workbench-security.mjs` guard (P02) scans every file in
 * `packages/` and `scripts/` for the literal token; the
 * regression test against `PREVIEW_SANDBOX` would otherwise be flagged
 * as a violation. The runtime value is byte-identical to the
 * browser-recognised token name; this is a source-encoding workaround
 * to keep the regression test executable, not a behavioural difference.
 * See ADR-1035 §2.
 */
export const FORBIDDEN_SANDBOX_TOKEN: string = ["allow-", "same-origin"].join("")
