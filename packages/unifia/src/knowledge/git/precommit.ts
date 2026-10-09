/* SPDX-License-Identifier: MIT */
/**
 * Hardening: Git pre-commit hook (P8.1).
 *
 * Per runbook §18 P8: "pre-commit scan, outgoing-range scan,
 * worktrees, hooks policy, conflict UX et diagnostics".
 *
 * The pre-commit hook scans the staged changes for secrets
 * before allowing the commit. If a secret is detected, the
 * commit is refused (exit 1) and the operator is told which
 * locator triggered the rule.
 *
 * The hook is delivered as a TS module so it can be:
 *  - imported and run from `unifia knowledge precommit`;
 *  - installed into `.git/hooks/pre-commit` via a one-shot
 *    `installPrecommitHook` helper.
 */

import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
  type BigIntStats,
} from "node:fs"
import { resolve, isAbsolute } from "node:path"
import { classifyText, decideWrite } from "../context/dataflow.js"

export interface PrecommitScanInput {
  /** Absolute path to the workspace root (where `.git/` lives). */
  workspaceRoot: string
  /** List of locators (relative to workspaceRoot) that are staged. */
  staged: string[]
  /** Read a locator's content. Caller decides how to read. */
  read: (locator: string) => string | null
}

export interface PrecommitScanFinding {
  locator: string
  /** The classification result from dataflow.classifyText. */
  classification: string
  /** The decision from dataflow.decideWrite. */
  decision: "allow" | "deny"
  /** The byte range that triggered the rule. */
  excerpt: string
}

export interface PrecommitScanResult {
  /** True if the commit is allowed (no findings, or all allow). */
  ok: boolean
  findings: PrecommitScanFinding[]
  scanned: number
  durationMs: number
}

const HOOK_RELATIVE = ".git/hooks/pre-commit"
const HOOK_MARKER = "# unifia-knowledge-precommit-hook"

const HOOK_SCRIPT = `${HOOK_MARKER}
#!/usr/bin/env bun
# Installed by unifia knowledge precommit install
# This hook scans staged changes for secrets before allowing the commit.

set -e

# Get the list of staged files (added, copied, modified, renamed).
STAGED=$(git diff --cached --name-only --diff-filter=ACMR || true)

if [ -z "$STAGED" ]; then
  exit 0
fi

# Run the Unifia pre-commit scanner.
exec bun x unifia-knowledge precommit --staged <<< "$STAGED"
`

/** Scan the staged changes for secrets. */
export function scanStaged(input: PrecommitScanInput): PrecommitScanResult {
  const t0 = Date.now()
  if (!isAbsolute(input.workspaceRoot)) {
    throw new Error(`workspaceRoot must be absolute, got ${input.workspaceRoot}`)
  }

  const findings: PrecommitScanFinding[] = []
  for (const locator of input.staged) {
    const content = input.read(locator)
    if (content === null) continue
    const cls = classifyText(content)
    if (cls.classification !== "secret") continue
    const decision = decideWrite("secret", false)
    if (decision.allowed) continue
    findings.push({
      locator,
      classification: cls.classification,
      decision: "deny",
      excerpt: content.slice(0, 80),
    })
  }

  return {
    ok: findings.length === 0,
    findings,
    scanned: input.staged.length,
    durationMs: Date.now() - t0,
  }
}

/** Result of an install/uninstall operation. */
export interface PrecommitHookInstallResult {
  ok: boolean
  hookPath: string
  reason?: string
}

/** Install the pre-commit hook into `.git/hooks/pre-commit`. */
export function installPrecommitHook(workspaceRoot: string): PrecommitHookInstallResult {
  if (!isAbsolute(workspaceRoot)) {
    return { ok: false, hookPath: "", reason: "workspaceRoot must be absolute" }
  }
  const hookPath = resolve(workspaceRoot, HOOK_RELATIVE)
  if (!existsSync(resolve(workspaceRoot, ".git"))) {
    return { ok: false, hookPath, reason: "no .git directory found" }
  }
  // Ensure the hooks directory exists.
  mkdirSync(resolve(workspaceRoot, ".git/hooks"), { recursive: true })
  let descriptor: number
  try {
    descriptor = openSync(
      hookPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o755,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      return { ok: false, hookPath, reason: `could not create pre-commit hook: ${String(error)}` }
    }
    return rewriteManagedHook(hookPath)
  }

  try {
    writeHook(descriptor)
    return { ok: true, hookPath }
  } catch (error) {
    return { ok: false, hookPath, reason: `could not write pre-commit hook: ${String(error)}` }
  } finally {
    closeSync(descriptor)
  }
}

function rewriteManagedHook(hookPath: string): PrecommitHookInstallResult {
  let descriptor: number
  try {
    descriptor = openSync(hookPath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    return { ok: false, hookPath, reason: `could not open existing pre-commit hook: ${String(error)}` }
  }

  try {
    const opened = fstatSync(descriptor, { bigint: true }) as BigIntStats
    const after = lstatSync(hookPath, { bigint: true }) as BigIntStats
    if (!opened.isFile() || !after.isFile() || after.isSymbolicLink() || !sameHookIdentity(opened, after)) {
      return { ok: false, hookPath, reason: "existing pre-commit hook changed while opening" }
    }
    if (!readFileSync(descriptor, "utf8").includes(HOOK_MARKER)) {
      return {
        ok: false,
        hookPath,
        reason: "a pre-commit hook already exists; refusing to overwrite",
      }
    }
    writeHook(descriptor)
    try {
      fchmodSync(descriptor, 0o755)
    } catch (error) {
      if (process.platform !== "win32") {
        return { ok: false, hookPath, reason: `could not set pre-commit hook mode: ${String(error)}` }
      }
    }
    return { ok: true, hookPath }
  } catch (error) {
    return { ok: false, hookPath, reason: `could not update existing pre-commit hook: ${String(error)}` }
  } finally {
    closeSync(descriptor)
  }
}

function sameHookIdentity(first: BigIntStats, second: BigIntStats): boolean {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.ctimeNs === second.ctimeNs &&
    first.mtimeNs === second.mtimeNs &&
    first.birthtimeNs === second.birthtimeNs &&
    first.size === second.size
  )
}

function writeHook(descriptor: number): void {
  const content = Buffer.from(HOOK_SCRIPT, "utf8")
  ftruncateSync(descriptor, 0)
  let offset = 0
  while (offset < content.length) {
    const written = writeSync(descriptor, content, offset, content.length - offset, offset)
    if (written === 0) throw new Error("pre-commit hook write made no progress")
    offset += written
  }
  ftruncateSync(descriptor, content.length)
}

/** Uninstall the pre-commit hook. */
export function uninstallPrecommitHook(workspaceRoot: string): PrecommitHookInstallResult {
  if (!isAbsolute(workspaceRoot)) {
    return { ok: false, hookPath: "", reason: "workspaceRoot must be absolute" }
  }
  const hookPath = resolve(workspaceRoot, HOOK_RELATIVE)
  if (!existsSync(hookPath)) {
    return { ok: true, hookPath }
  }
  const existing = readFileSync(hookPath, "utf8")
  if (!existing.includes(HOOK_MARKER)) {
    return {
      ok: false,
      hookPath,
      reason: "pre-commit hook is not managed by unifia-knowledge; refusing to delete",
    }
  }
  // Unlink is intentionally not used here so the operator can decide.
  // V1 returns the path; the operator deletes manually.
  return { ok: true, hookPath }
}
