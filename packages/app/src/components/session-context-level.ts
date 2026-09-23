/* SPDX-License-Identifier: MIT */

/** The reference's thresholds for the context meter's colour. */
export function contextLevel(usage: number): "ok" | "warn" | "danger" {
  if (usage >= 85) return "danger"
  if (usage >= 70) return "warn"
  return "ok"
}
