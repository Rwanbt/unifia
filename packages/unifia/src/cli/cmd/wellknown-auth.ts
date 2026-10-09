// SPDX-License-Identifier: MIT
import z from "zod"

const manifestSchema = z.object({
  auth: z.object({
    command: z.array(z.string().min(1).max(4096).refine((value) => !value.includes("\0"))).min(1).max(64),
    env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  }),
})

export interface WellKnownAuthDependencies {
  fetch: (url: string) => Promise<Response>
  approve: (url: string, command: readonly string[]) => Promise<boolean>
  run: (command: string[]) => Promise<{ code: number; stdout: Buffer }>
}

export async function authenticateWellKnownProvider(url: string, dependencies: WellKnownAuthDependencies) {
  const providerUrl = new URL(url)
  if (providerUrl.protocol !== "https:" && providerUrl.protocol !== "http:") {
    throw new Error("Provider login requires an HTTP or HTTPS URL")
  }
  const response = await dependencies.fetch(`${url.replace(/\/+$/, "")}/.well-known/opencode`)
  if (!response.ok) throw new Error(`Provider authentication manifest returned HTTP ${response.status}`)
  const manifest = manifestSchema.parse(await response.json())
  // Selecting a login URL does not authorize a server-supplied local command.
  if (!(await dependencies.approve(url, manifest.auth.command))) return undefined
  const result = await dependencies.run(manifest.auth.command)
  if (result.code !== 0) throw new Error(`Provider authentication command exited with code ${result.code}`)
  const token = result.stdout.toString().trim()
  if (!token) throw new Error("Provider authentication command returned an empty token")
  return { type: "wellknown" as const, key: manifest.auth.env, token }
}
