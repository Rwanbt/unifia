/* SPDX-License-Identifier: MIT */

// Compute glyphs shared by the settings compute page (ADR-047) and the
// status popover's Compute tab. Icon box styling for these svgs is scoped
// per consumer (v110-settings.css under [data-v110="settings-page"], inline
// utilities in the popover rows).

import type { JSX } from "solid-js"
import type { ServerConnection } from "@/context/server"

export type ComputeKind = "local" | "wsl" | "remote" | "ssh"

const ICONS: Record<"auto" | "monitor" | "server" | "phone", () => JSX.Element> = {
  auto: () => (
    <>
      <path d="M4 12a8 8 0 0 1 13.7-5.7" />
      <path d="M20 6v5h-5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.7" />
      <path d="M4 18v-5h5" />
    </>
  ),
  monitor: () => (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  server: () => (
    <>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01M12 7h5M12 17h5" />
    </>
  ),
  phone: () => (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M10 5h4M11 18.5h2" />
    </>
  ),
}

export function ComputeIcon(props: { name: keyof typeof ICONS }) {
  return (
    <svg data-slot="compute-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[props.name]()}
    </svg>
  )
}

export function computeKind(conn: ServerConnection.Any): ComputeKind {
  if (conn.type === "ssh") return "ssh"
  if (conn.type === "sidecar") return conn.variant === "wsl" ? "wsl" : "local"
  return "remote"
}
