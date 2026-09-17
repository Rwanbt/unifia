// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:runtime — orchestrator stub for the surface-level runners that the
// F0/S0/S1/S2 plan expects. Each runner (census, aa, aa-prime, visual,
// motion, mutations, g3, full) emits an explicit "PENDING_IMPL" verdict
// until the harness lands in F0, so the orchestrator never silently says
// PASS. Each runner takes an --emit=stdout|artifact flag.

import { writeArtifact } from "./shared"

const target = process.argv[2] ?? "all"
const runners = [
  "census",
  "aa",
  "aa-prime",
  "visual",
  "motion",
  "mutations",
  "g3",
  "full",
] as const

function stub(name: string): unknown {
  return {
    runner: name,
    status: "PENDING_IMPL",
    counters: { pass: 0, fail: 0, notRun: 1 },
    reason:
      "F0 has not yet built the harness (Docker image, Playwright in image, A/A calibration, BrowserContext isolation, motion sampler, pixel engine, mutations). Until then, this runner is intentionally NOT_RUN; G0_TOOL_CHANGE re-qualification governs the transition.",
    gates: ["G0"],
    emittedAt: new Date().toISOString(),
  }
}

const targets = target === "all" ? runners : [target as (typeof runners)[number]]
for (const name of targets) {
  const value = stub(name)
  writeArtifact(`runtime-${name}.json`, value)
  process.stdout.write(JSON.stringify(value, null, 2) + "\n")
}
process.exit(0)