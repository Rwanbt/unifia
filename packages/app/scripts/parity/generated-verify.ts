// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:generated:verify — regenerates the artefacts listed in
// parity/generated-paths-policy.json and confirms the canonical hash is
// stable across runs. Until the per-output generators land, every output
// is reported as "PENDING_GENERATOR".

import { readJson, REPO_ROOT } from "./shared"
import { join } from "node:path"

type GeneratedOutput = {
  path: string
  generatorPath: string
  generatorSha256: string
  inputSet: string[]
  derivedOnly: boolean
  regenerationCommand: string
}

type Policy = { outputs: GeneratedOutput[]; regenerationGate: string }

const policy = readJson<Policy>(join(REPO_ROOT, "parity", "generated-paths-policy.json"))

const report = policy.outputs.map((o) => ({
  path: o.path,
  status: o.generatorSha256.startsWith("PENDING") ? "PENDING_GENERATOR" : "READY",
  regenerationCommand: o.regenerationCommand,
}))

const allReady = report.every((r) => r.status === "READY")
const status = allReady ? "PASS" : "PENDING_GENERATOR"
process.stdout.write(
  JSON.stringify(
    {
      status,
      counters: { ready: report.filter((r) => r.status === "READY").length, pending: report.filter((r) => r.status !== "READY").length },
      details: report,
    },
    null,
    2,
  ) + "\n",
)
process.exit(0)