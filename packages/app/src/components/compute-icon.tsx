/* SPDX-License-Identifier: MIT */

// Stroke glyphs shared by the settings compute page (ADR-047) and every tab
// of the status popover, so the popover's tiles stay one family. Sizing and
// stroke are scoped per consumer (v110-settings.css, v110-status.css).

import type { JSX } from "solid-js"
import type { ServerConnection } from "@/context/server"

export type ComputeKind = "local" | "wsl" | "remote" | "ssh"

const ICONS: Record<"auto" | "monitor" | "server" | "phone" | "plug" | "code" | "plugin", () => JSX.Element> = {
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
  plug: () => (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  code: () => <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />,
  plugin: () => (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
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

/** The glyph a connection's tile shows: a screen for this machine, a rack otherwise. */
export function computeGlyph(conn: ServerConnection.Any): "monitor" | "server" {
  const kind = computeKind(conn)
  return kind === "local" || kind === "wsl" ? "monitor" : "server"
}

export function computeKind(conn: ServerConnection.Any): ComputeKind {
  if (conn.type === "ssh") return "ssh"
  if (conn.type === "sidecar") return conn.variant === "wsl" ? "wsl" : "local"
  return "remote"
}
