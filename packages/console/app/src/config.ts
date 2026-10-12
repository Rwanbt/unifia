// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

/**
 * WHY there is no default here.
 *
 * The rebrand fabricated `unifia.ai` and the fork does not hold that domain.
 * `packages/web/config.mjs` already states the house rule: writing a domain
 * nobody holds is worse than having none, because it presents dead links as
 * official. A default would put it straight back, so the canonical origin is
 * read from the environment and is `null` when the environment does not supply
 * one.
 *
 * Failing closed means the console then emits no canonical link, no `og:url`,
 * and no copyable install command, rather than pointing a user at a host the
 * project cannot vouch for. Set `VITE_UNIFIA_BASE_URL` to a host the project
 * controls and every one of those surfaces comes back.
 */

/**
 * Returns the canonical origin, or `null` when it is unset or not usable.
 *
 * Rejected on purpose: credentials in the authority (`https://u:p@host`), any
 * path, query or fragment, and any scheme other than https — plus plain `http`,
 * which is tolerated only for loopback so a developer can run the console
 * locally without a certificate. A value that fails any of those is treated as
 * absent, because a half-valid origin would produce a canonical link that is
 * wrong rather than one that is missing.
 */
export function readBaseUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim()
  if (!value) return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.username || url.password) return null
  if (url.pathname !== "/" || url.search || url.hash) return null
  if (url.protocol === "https:") return url.origin
  if (url.protocol === "http:" && isLoopback(url.hostname)) return url.origin
  return null
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

/**
 * The install command, or `null` when no origin is configured.
 *
 * It used to be a literal `unifia.ai/install` sitting next to a copied command
 * that actually fetched `opencode.ai/install`, so the label a user read and the
 * command a user pasted named different hosts. Both now come from the same
 * configured origin, or neither is shown.
 */
export function installCommand(baseUrl: string | null): string | null {
  if (!baseUrl) return null
  return `curl -fsSL ${baseUrl}/install | bash`
}

/** The host part of the install path, for the highlighted span in the markup. */
export function installPath(baseUrl: string | null): string | null {
  if (!baseUrl) return null
  return `${baseUrl}/install`
}

/** Application-wide constants and configuration. */
export const config = {
  // Canonical origin, or null when the environment supplies none.
  baseUrl: readBaseUrl(import.meta.env.VITE_UNIFIA_BASE_URL),

  // GitHub
  github: {
    repoUrl: "https://github.com/Rwanbt/unifia",
    starsFormatted: {
      compact: "120K",
      full: "120,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/opencode",
    discord: "https://discord.gg/opencode",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "800",
    commits: "10,000",
    monthlyUsers: "5M",
  },
} as const
