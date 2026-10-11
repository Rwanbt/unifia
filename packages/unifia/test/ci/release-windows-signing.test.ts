/* SPDX-License-Identifier: MIT */
/**
 * The Windows installer's signing profile, read from the release workflow itself.
 *
 * The profile is `optional` only for a dry run, which publishes nothing. Every other run (a draft, a publication, a tag
 * push) requires the signature: an unsigned installer fails the build. These tests read the YAML, so the profile cannot
 * drift back to a silent `optional` in one of the steps that decide it.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"

const WORKFLOW = path.resolve(import.meta.dir, "../../../../.github/workflows/release.yml")
const PROFILE = "${{ inputs.dry_run && 'optional' || 'required' }}"

interface Step {
  name?: string
  if?: string
  uses?: string
  env?: Record<string, string>
}

interface Job {
  permissions?: Record<string, string>
  steps?: Step[]
}

const workflow = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> }
const tauri = workflow.jobs["build-tauri"]
const steps = tauri?.steps ?? []
const stepIndex = (predicate: (step: Step) => boolean) => steps.findIndex(predicate)

describe("the Windows installer's signing profile", () => {
  test("the build and its verification both use the release profile", () => {
    const build = steps.find((step) => step.name?.startsWith("Build Tauri bundle"))
    const verify = steps.find((step) => step.name === "Verify Windows installer signature state")
    expect(build?.env?.UNIFIA_WINDOWS_SIGNING).toBe(PROFILE)
    expect(verify?.env?.UNIFIA_WINDOWS_SIGNING).toBe(PROFILE)
  })

  test("no step pins the signature to optional, whatever the run", () => {
    const profiles = Object.values(workflow.jobs)
      .flatMap((job) => job.steps ?? [])
      .map((step) => step.env?.UNIFIA_WINDOWS_SIGNING)
      .filter((value): value is string => value !== undefined)
    expect(profiles.length).toBeGreaterThan(0)
    for (const value of profiles) expect(value).toBe(PROFILE)
  })

  test("the Azure identity is logged in before the Windows build, and only outside a dry run", () => {
    const login = stepIndex((step) => step.name === "Azure login (Windows installer signing)")
    const build = stepIndex((step) => step.name?.startsWith("Build Tauri bundle") ?? false)
    expect(login).toBeGreaterThanOrEqual(0)
    expect(login).toBeLessThan(build)
    const loginStep = steps[login]
    expect(loginStep?.if).toContain("runner.os == 'Windows'")
    expect(loginStep?.if).toContain("!inputs.dry_run")
    expect(loginStep?.uses).toMatch(/^azure\/login@[0-9a-f]{40}/)
  })

  test("the build job may request the OIDC token that the Azure login needs", () => {
    expect(tauri?.permissions?.["id-token"]).toBe("write")
  })

  test("the signing endpoint names the Trusted Signing account the build reads", () => {
    const build = steps.find((step) => step.name?.startsWith("Build Tauri bundle"))
    expect(build?.env?.AZURE_TRUSTED_SIGNING_ENDPOINT).toBe("${{ secrets.AZURE_TRUSTED_SIGNING_ENDPOINT }}")
    expect(build?.env?.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME).toBe("${{ secrets.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME }}")
    expect(build?.env?.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE).toBe(
      "${{ secrets.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE }}",
    )
  })
})
