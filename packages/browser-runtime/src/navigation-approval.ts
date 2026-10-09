/* SPDX-License-Identifier: MIT */

export function navigationApprovalReason(currentUrl: string, destination: string | undefined): string | undefined {
  if (!destination) return undefined
  try {
    const current = new URL(currentUrl)
    const target = new URL(destination, current)
    if (target.protocol !== "http:" && target.protocol !== "https:") return undefined
    if (target.origin === current.origin) return undefined
    return `This action navigates to ${target.origin}, a different origin.`
  } catch {
    return "This action has an invalid destination and requires user approval."
  }
}

export function assertHttpNavigationDestination(currentUrl: string, destination: string | undefined): void {
  if (!destination) return
  let target: URL
  try { target = new URL(destination, currentUrl) }
  catch { throw new Error("invalid browser navigation destination") }
  if (target.protocol !== "http:" && target.protocol !== "https:" && target.href !== "about:blank") {
    throw new Error("external browser protocols are blocked")
  }
}

export function approvedNavigationOrigin(reason: string | undefined): string | undefined {
  if (!reason) return undefined
  const match = /(?:^|\s)This action navigates to (https?:\/\/[^\s,]+), a different origin\./.exec(reason)
  const destination = match?.[1]
  if (!destination) return undefined
  try {
    const parsed = new URL(destination)
    return parsed.origin === destination ? destination : undefined
  } catch {
    return undefined
  }
}

export function requiresNavigationApproval(
  controller: "user" | "ai" | "paused",
  currentOrigin: string | null,
  destination: string,
  approvedOrigin?: string,
): boolean {
  if (controller === "user") return false
  try {
    const target = new URL(destination)
    if (target.protocol !== "http:" && target.protocol !== "https:") return target.href !== "about:blank"
    return target.origin !== currentOrigin && target.origin !== approvedOrigin
  } catch {
    return true
  }
}
