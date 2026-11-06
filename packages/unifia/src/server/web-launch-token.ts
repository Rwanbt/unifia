/* SPDX-License-Identifier: MIT */

import { randomBytes } from "node:crypto"
import { Flag } from "../flag/flag"
import { heldCredentials, holdCredentials } from "../flag/held-credentials"

/**
 * The web runtime's Jupyter-style launch secret.
 *
 * The Workbench surfaces need a password-protected server in a browser (ADR-041): without one, any page or local process
 * could mint a lease. `unifia web` therefore generates a random password when none is configured, and hands it to the
 * page it opens in the URL fragment, which browsers never send to the server and which stays out of its logs.
 */
export function ensureWebLaunchToken(): string | undefined {
  if (Flag.UNIFIA_SERVER_PASSWORD) return undefined
  const token = randomBytes(24).toString("base64url")
  holdCredentials({ ...heldCredentials(), password: token })
  return token
}

/** The address to open: the server's URL, carrying the launch token in its fragment when one was generated. */
export function webLaunchUrl(base: string, token: string | undefined): string {
  if (!token) return base
  const url = new URL(base)
  url.hash = `token=${encodeURIComponent(token)}`
  return url.toString()
}
