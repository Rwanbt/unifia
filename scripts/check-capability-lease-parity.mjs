#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */

/**
 * The connection lease is declared twice, in two languages, and both have to
 * agree or the desktop app cannot connect at all.
 *
 * - `SURFACE_LEASE_CAPABILITIES` (packages/workbench-shell/src/routes.ts) is
 *   what the WebView asks for.
 * - `ALLOWED_CONNECTION_CAPABILITIES` (packages/desktop/src-tauri/src/lib.rs)
 *   is the native gate that decides whether to mint the token at all. It is a
 *   deliberate second boundary — before it existed the requested capability
 *   list reached the sidecar unvalidated — so it cannot simply import the
 *   TypeScript constant.
 *
 * WHY a script and not a test: no test suite spans both languages. When these
 * drifted, `workbench_issue_token` refused the lease and every Workbench
 * surface failed to connect, while `cargo check`, the TypeScript typecheck and
 * every unit test stayed green — the mismatch is between two literals that
 * nothing compared.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relative) => readFileSync(path.join(root, relative), "utf8")

function fail(message) {
  process.stderr.write(`CapabilityLeaseParityGuard: ${message}\n`)
  process.exit(1)
}

const shellSource = read("packages/workbench-shell/src/routes.ts")
const rustSource = read("packages/desktop/src-tauri/src/lib.rs")
const literals = (block) => [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort()

// Each lease the app requests has its own native gate; they are compared pairwise.
const PAIRS = [
  ["SURFACE_LEASE_CAPABILITIES", "ALLOWED_CONNECTION_CAPABILITIES"],
  ["BROWSER_LEASE_CAPABILITIES", "ALLOWED_BROWSER_LEASE_CAPABILITIES"],
]

for (const [shellName, rustName] of PAIRS) {
  const shellMatch = shellSource.match(new RegExp(`export const ${shellName} = \\[([^\\]]*)\\] as const`))
  if (!shellMatch) fail(`could not find ${shellName} in packages/workbench-shell/src/routes.ts`)
  const rustMatch = rustSource.match(new RegExp(`const ${rustName}: &\\[&str\\] = &\\[([^\\]]*)\\];`))
  if (!rustMatch) fail(`could not find ${rustName} in packages/desktop/src-tauri/src/lib.rs`)

  const leased = literals(shellMatch[1])
  const allowed = literals(rustMatch[1])
  if (leased.length === 0) fail(`${shellName} parsed as empty — the guard cannot verify anything`)

  const missingInRust = leased.filter((capability) => !allowed.includes(capability))
  const extraInRust = allowed.filter((capability) => !leased.includes(capability))
  if (missingInRust.length > 0) {
    fail(`${rustName} refuses capabilities ${shellName} leases, so that connection fails outright: ${missingInRust.join(", ")}`)
  }
  if (extraInRust.length > 0) {
    // Not fatal to connection, but it widens the native boundary past anything
    // the app asks for — exactly what that gate exists to prevent.
    fail(`${rustName} allows capabilities ${shellName} never leases: ${extraInRust.join(", ")}`)
  }
  process.stdout.write(`CapabilityLeaseParityGuard: ${rustName} and ${shellName} agree on ${leased.length} capabilities (${leased.join(", ")})\n`)
}
