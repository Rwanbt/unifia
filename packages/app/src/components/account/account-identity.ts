/* SPDX-License-Identifier: MIT */

// Pure mappings behind the account centre (ADR-051): who the viewer is, and
// how this device is named. Nothing here invents an account or a device.

export type AccountUser = {
  username: string
  displayName?: string | null
  email?: string | null
  role: string
}

export type AccountIdentity = {
  name: string
  initials: string
  email?: string
  role?: string
  signedIn: boolean
}

export const LOCAL_PROFILE_NAME = "User"

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean)
  if (words.length === 0) return "U"
  if (words.length === 1) return words[0][0].toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** The signed-in collaborative user, or the anonymous local profile. */
export function accountIdentity(user: AccountUser | undefined): AccountIdentity {
  if (!user) return { name: LOCAL_PROFILE_NAME, initials: initials(LOCAL_PROFILE_NAME), signedIn: false }
  const name = user.displayName?.trim() || user.username
  return { name, initials: initials(name), email: user.email ?? undefined, role: user.role, signedIn: true }
}

const OS_NAMES = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
} as const

export function osName(os: keyof typeof OS_NAMES | undefined): string | undefined {
  return os ? OS_NAMES[os] : undefined
}
