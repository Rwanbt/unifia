// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Shared helpers for the parity runners. No DOM, no Playwright; the runners
// resolve to JSON or exit(1) on a hard gate failure.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"

function findRepoRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 8; i += 1) {
    try {
      const fs = require("node:fs") as typeof import("node:fs")
      if (fs.existsSync(join(dir, "parity", "environment-lock.json"))) return dir
      if (fs.existsSync(join(dir, ".git"))) return dir
    } catch {
      // ignore
    }
    const parent = resolve(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  return resolve(start, "..", "..", "..", "..", "..")
}

export const REPO_ROOT = findRepoRoot(import.meta.dir)
export const PARITY_DIR = join(REPO_ROOT, "parity")
export const SCHEMAS_DIR = join(PARITY_DIR, "schemas")
export const ARTIFACTS_DIR = join(PARITY_DIR, "artifacts")

export type GateResult = {
  status: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED" | "N/A"
  counters: Record<string, number>
  details: string[]
}

export function exit(result: GateResult): never {
  const json = JSON.stringify(result, null, 2)
  if (result.status === "PASS") {
    process.stdout.write(json + "\n")
    process.exit(0)
  }
  process.stderr.write(json + "\n")
  process.exit(1)
}

export function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`missing file: ${path}`)
  return JSON.parse(readFileSync(path, "utf8")) as T
}

export function hashFile(path: string): string {
  const data = readFileSync(path)
  return createHash("sha256").update(data).digest("hex")
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function hashCanonical(value: unknown): string {
  return hashString(stableStringify(value))
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")
  return `{${body}}`
}

export function writeArtifact(name: string, value: unknown): string {
  if (!existsSync(ARTIFACTS_DIR)) {
    const fs = require("node:fs") as typeof import("node:fs")
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  }
  const path = join(ARTIFACTS_DIR, name)
  writeFileSync(path, JSON.stringify(value, null, 2))
  return path
}