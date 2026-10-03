/* SPDX-License-Identifier: MIT */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function providerIconsPlugin(
  url = process.env.OPENCODE_MODELS_URL || "https://models.dev",
  outputDirectory = "./src/assets/icons/provider",
) {
  const refresh = () => fetchProviderIcons(url, outputDirectory)
  return { name: "provider-icons-plugin", configureServer: refresh, buildStart: refresh }
}

export function providerIconFilename(provider: string): string {
  if (!PROVIDER_ID.test(provider) || WINDOWS_DEVICE.test(provider)) {
    throw new Error(`Invalid provider icon identifier: ${JSON.stringify(provider)}`)
  }
  return `${provider}.svg`
}

export async function fetchProviderIcons(url: string, outputDirectory: string): Promise<void> {
  const response = await fetch(`${url}/api.json`)
  if (!response.ok) throw new Error(`Provider catalog request failed: ${response.status}`)
  const catalog: unknown = await response.json()
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("Provider catalog must be an object")
  }
  // Validate the complete catalog before a later invalid key can leave partial writes.
  const providers = Object.keys(catalog).map((provider) => ({ provider, filename: providerIconFilename(provider) }))
  await Promise.all(
    providers.map(async ({ provider, filename }) => {
      const icon = await fetch(`${url}/logos/${encodeURIComponent(provider)}.svg`)
      if (!icon.ok) throw new Error(`Provider icon request failed: ${icon.status}`)
      await writeFile(join(outputDirectory, filename), await icon.text())
    }),
  )
}
