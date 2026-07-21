/**
 * team-cli.ts — TEAM-G01
 *
 * Single entry point for the team CLI subcommands.
 * Lives in the repo at packages/opencode/src/team/team-cli.ts.
 *
 * Subcommands (defined in package.json scripts):
 *   team claim          — acquire a new lease (interactive or with --lease-id, ...)
 *   team heartbeat      — refresh an existing lease
 *   team validate       — check a lease is still ACTIVE and tokens match
 *   team release        — free a lease (worker must own it)
 *   team inspect        — list all leases (debug)
 *   team recover        — sweep stale leases + correct watermark
 *   team precommit-check — verify current diff is inside allowed_files
 *   team preintegrate-check — full verify + patch-id stability check
 *
 * The CLI exposes the same primitives as the lock-manager API, but with JSON
 * output and exit codes suitable for shell hook usage.
 */

import { claim, heartbeat, release, validate, inspect, recover, forceRelease, type LeaseSpec } from "./lock-manager";
import { verifyScope, type ScopeManifest, type DiffEntry } from "./scope-monitor";

interface CliResult {
  ok: boolean;
  code: number;
  result: unknown;
}

function exitOk(result: unknown): never {
  console.log(JSON.stringify({ ok: true, result }, null, 2));
  process.exit(0);
}
function exitErr(code: number, msg: string, extra: unknown = {}): never {
  console.error(JSON.stringify({ ok: false, code, error: msg, ...extra }, null, 2));
  process.exit(code);
}

async function loadManifestFromLease(lease_id: string): Promise<ScopeManifest> {
  const { getDb } = await import("./lock-manager");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT scope_manifest_hash, allowed_files_json, protected_files_json, scope_mode, lease_id, card_id, base_sha FROM leases WHERE lease_id = ?`,
    )
    .get(lease_id) as any;
  if (!row) exitErr(64, `lease ${lease_id} not found`);
  return {
    schema_version: "1.0.0",
    card_id: row.card_id,
    lease_id: row.lease_id,
    base_sha: row.base_sha,
    scope_mode: row.scope_mode as "OPEN" | "E2_REQUIRED",
    allowed_files: JSON.parse(row.allowed_files_json),
    protected_files: JSON.parse(row.protected_files_json),
    reserved_paths: [],
    symlink_policy: "REJECT",
    case_policy: "REJECT_DUPLICATE_CASE",
    long_path_policy: "FAIL_OVER_260",
    eol_policy: "LF_NORMALIZED",
  };
}

function readDiff(gitRoot: string): DiffEntry[] {
  // Read `git status --porcelain` and parse.
  const proc = Bun.spawnSync({
    cmd: ["git", "status", "--porcelain", "--untracked-files=all", "--ignore-submodules"],
    cwd: gitRoot,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf-8",
  });
  if (proc.status !== 0) {
    return [];
  }
  const out = proc.stdout as string;
  const entries: DiffEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    // Porcelain format: XY <path>
    // For rename/copy, original path is before arrow.
    const idxArrow = line.indexOf(" -> ");
    let first: string, second: string | null = null;
    if (idxArrow > 0) {
      first = line.slice(0, idxArrow);
      second = line.slice(idxArrow + 4);
    } else {
      first = line;
    }
    const match = first.match(/^([?! MTADRCU]{2})\s+(.*)$/);
    if (!match) continue;
    const xy = match[1];
    const path = second ?? match[2];
    let change_type: DiffEntry["change_type"];
    if (xy === "??") change_type = "untracked";
    else if (xy.includes("D")) change_type = "deleted";
    else if (xy.includes("A")) change_type = "added";
    else change_type = "modified";
    entries.push({ path: path.trim(), change_type });
  }
  return entries;
}

async function cmdClaim(args: string[]): Promise<never> {
  // Parse minimal flag set.
  const spec: Partial<LeaseSpec> = {};
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--lease-id") { spec.lease_id = args[++i]; i++; continue; }
    if (a === "--card") { spec.card_id = args[++i]; i++; continue; }
    if (a === "--worker") { spec.worker_id = args[++i]; i++; continue; }
    if (a === "--branch") { spec.branch = args[++i]; i++; continue; }
    if (a === "--worktree") { spec.worktree = args[++i]; i++; continue; }
    if (a === "--base") { spec.base_sha = args[++i]; i++; continue; }
    if (a === "--manifest-hash") { spec.scope_manifest_hash = args[++i]; i++; continue; }
    if (a === "--scope-mode") { spec.scope_mode = args[++i] as any; i++; continue; }
    if (a === "--ttl") { spec.ttl_seconds = Number(args[++i]); i++; continue; }
    if (a === "--allowed-files") {
      spec.allowed_files = args[++i].split(",");
      i++;
      continue;
    }
    if (a === "--protected-files") {
      spec.protected_files = args[++i].split(",");
      i++;
      continue;
    }
    if (a === "--manifest-yaml") {
      const yamlPath = args[++i];
      const yamlText = await Bun.file(yamlPath).text();
      // Tiny YAML: read scope_manifest via plain JSON for now (we accept JSON-shaped YAML).
      const data = JSON.parse(yamlText);
      Object.assign(spec, data);
      i++;
      continue;
    }
    i++;
  }
  if (!spec.lease_id || !spec.card_id || !spec.worker_id || !spec.branch || !spec.worktree || !spec.base_sha) {
    exitErr(64, "missing required flags");
  }
  const result = claim(spec as LeaseSpec);
  if (!result.ok) exitErr(1, result.message, { code: result.code });
  exitOk(result);
}

async function cmdHeartbeat(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let worker_id: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--worker") worker_id = args[++i];
  }
  if (!lease_id || !worker_id) exitErr(64, "missing --lease-id or --worker");
  const r = heartbeat(lease_id, worker_id);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r);
}

async function cmdValidate(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let token: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--fencing-token") token = Number(args[++i]);
  }
  if (!lease_id || token === undefined) exitErr(64, "missing --lease-id or --fencing-token");
  const r = validate(lease_id, token);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r.lease);
}

async function cmdRelease(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let worker_id: string | undefined;
  let reason = "VOLUNTARY";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--worker") worker_id = args[++i];
    if (args[i] === "--reason") reason = args[++i];
  }
  if (!lease_id || !worker_id) exitErr(64, "missing --lease-id or --worker");
  const r = release(lease_id, worker_id, reason);
  if (!r.ok) exitErr(1, r.message, { code: r.code });
  exitOk(r);
}

async function cmdInspect(): Promise<never> {
  exitOk(inspect());
}

async function cmdRecover(args: string[]): Promise<never> {
  let force_lease: string | undefined;
  let reason = "MANUAL_RECOVERY";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force-lease") force_lease = args[++i];
    if (args[i] === "--reason") reason = args[++i];
  }
  if (force_lease) {
    const r = forceRelease(force_lease, reason, "team-cli");
    if (!r.ok) exitErr(1, r.message, { code: r.code });
    exitOk(r);
  } else {
    const r = recover();
    exitOk(r);
  }
}

async function cmdPrecommitCheck(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let git_root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--git-root") git_root = args[++i];
  }
  if (!lease_id) exitErr(64, "missing --lease-id");
  const manifest = await loadManifestFromLease(lease_id);
  const diff = readDiff(git_root);
  const verdict = verifyScope(manifest, diff, git_root);
  if (!verdict.ok) exitErr(2, "scope violations", { violations: verdict.violations });
  exitOk({ ok: true, n: diff.length });
}

async function cmdPreintegrateCheck(args: string[]): Promise<never> {
  let lease_id: string | undefined;
  let git_root = process.cwd();
  let base = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lease-id") lease_id = args[++i];
    if (args[i] === "--git-root") git_root = args[++i];
    if (args[i] === "--base") base = args[++i];
  }
  if (!lease_id || !base) exitErr(64, "missing --lease-id or --base");
  // Step 1: scope check (same as precommit-check).
  const manifest = await loadManifestFromLease(lease_id);
  const diff = readDiff(git_root);
  const verdict = verifyScope(manifest, diff, git_root);
  if (!verdict.ok) exitErr(2, "scope violations", { violations: verdict.violations });

  // Step 2: patch-id stability check.
  const proc = Bun.spawnSync({
    cmd: ["git", "format-patch", "--stdout", `${base}..HEAD`],
    cwd: git_root,
    encoding: "utf-8",
  });
  if (proc.status !== 0) exitErr(3, `git format-patch failed: ${proc.stderr}`);
  const procId = Bun.spawnSync({
    cmd: ["git", "patch-id", "--stable"],
    cwd: git_root,
    encoding: "utf-8",
    stdin: proc.stdout as string,
  });
  if (procId.status !== 0 || !procId.stdout) exitErr(3, `git patch-id failed: ${procId.stderr}`);
  exitOk({ ok: true, n: diff.length, patch_id: (procId.stdout as string).trim() });
}

export async function main(argv: string[]): Promise<never> {
  const [, , sub, ...rest] = argv;
  switch (sub) {
    case "claim":
      return cmdClaim(rest);
    case "heartbeat":
      return cmdHeartbeat(rest);
    case "validate":
      return cmdValidate(rest);
    case "release":
      return cmdRelease(rest);
    case "inspect":
      return cmdInspect();
    case "recover":
      return cmdRecover(rest);
    case "precommit-check":
      return cmdPrecommitCheck(rest);
    case "preintegrate-check":
      return cmdPreintegrateCheck(rest);
    default:
      exitErr(64, `unknown subcommand: ${sub}`);
  }
}
if (import.meta.main) await main(process.argv);
