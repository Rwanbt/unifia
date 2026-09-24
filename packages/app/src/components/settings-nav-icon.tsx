/* SPDX-License-Identifier: MIT */

// The reference's settings navigation icons (#settingsIntegrated .settings-nav,
// .settings-clean-icon / .v49-nav-icon): 24-unit strokes at 1.65, drawn at
// 16px. Three entries use a text glyph instead of a drawing, as there.

import { Show, type JSX } from "solid-js"

export type SettingsIconName =
  | "general"
  | "audio"
  | "shortcuts"
  | "memory"
  | "providers"
  | "models"
  | "routing"
  | "benchmark"
  | "compute"
  | "security"
  | "configuration"
  | "network"
  | "observability"
  | "mcp"
  | "skills"
  | "hooks"
  | "system"

const GLYPHS: Partial<Record<SettingsIconName, string>> = {
  shortcuts: "⌨",
  models: "✦",
  configuration: "›_",
}

const MCP_PATHS = [
  "M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z",
  "M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z",
]

const DRAWINGS: Partial<Record<SettingsIconName, () => JSX.Element>> = {
  general: () => (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  audio: () => (
    <>
      <path d="M5 10v4h3l4 3V7l-4 3H5Z" />
      <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.3 7.3 0 0 1 0 10" />
    </>
  ),
  // WHY: Memory keeps the app's own brain icon (packages/ui icon.tsx) rather
  // than the reference's drawing; it is drawn on a 20-unit box, stroked to
  // match the 24-unit icons' weight.
  memory: () => (
    <path
      stroke-width="1.35"
      d="M13.332 8.7487C11.4911 8.7487 9.9987 7.25631 9.9987 5.41536M6.66536 11.2487C8.50631 11.2487 9.9987 12.7411 9.9987 14.582M9.9987 2.78209L9.9987 17.0658M16.004 15.0475C17.1255 14.5876 17.9154 13.4849 17.9154 12.1978C17.9154 11.3363 17.5615 10.5575 16.9913 9.9987C17.5615 9.43991 17.9154 8.66108 17.9154 7.79962C17.9154 6.21199 16.7136 4.90504 15.1702 4.73878C14.7858 3.21216 13.4039 2.08203 11.758 2.08203C11.1171 2.08203 10.5162 2.25337 9.9987 2.55275C9.48117 2.25337 8.88032 2.08203 8.23944 2.08203C6.59353 2.08203 5.21157 3.21216 4.82722 4.73878C3.28377 4.90504 2.08203 6.21199 2.08203 7.79962C2.08203 8.66108 2.43585 9.43991 3.00609 9.9987C2.43585 10.5575 2.08203 11.3363 2.08203 12.1978C2.08203 13.4849 2.87191 14.5876 3.99339 15.0475C4.46688 16.7033 5.9917 17.9154 7.79962 17.9154C8.61335 17.9154 9.36972 17.6698 9.9987 17.2488C10.6277 17.6698 11.384 17.9154 12.1978 17.9154C14.0057 17.9154 15.5305 16.7033 16.004 15.0475Z"
    />
  ),
  providers: () => (
    <>
      <path d="M8 12h8" />
      <path d="M9 7V4M15 7V4" />
      <rect x="6" y="7" width="12" height="8" rx="2" />
      <path d="M12 15v5" />
    </>
  ),
  routing: () => <path d="M4 7h10M14 7l-3-3m3 3-3 3M20 17H10m0 0 3-3m-3 3 3 3" />,
  benchmark: () => (
    <>
      <path d="M5 17a7 7 0 1 1 14 0" />
      <path d="m12 14 4-4" />
      <path d="M7 17h10" />
    </>
  ),
  compute: () => (
    <>
      <rect x="4" y="5" width="16" height="6" rx="2" />
      <rect x="4" y="13" width="16" height="6" rx="2" />
      <path d="M8 8h.01M8 16h.01M12 8h5M12 16h5" />
    </>
  ),
  security: () => (
    <>
      <path d="M12 3 19 6v5c0 4.5-2.7 7.7-7 10-4.3-2.3-7-5.5-7-10V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  network: () => (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" />
    </>
  ),
  observability: () => (
    <>
      <path d="M2.8 12s3.45-5.6 9.2-5.6 9.2 5.6 9.2 5.6-3.45 5.6-9.2 5.6S2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  mcp: () => (
    <>
      <path d={MCP_PATHS[0]} />
      <path d={MCP_PATHS[1]} />
    </>
  ),
  skills: () => (
    <>
      <path d="m12 3 1.35 3.65L17 8l-3.65 1.35L12 13l-1.35-3.65L7 8l3.65-1.35Z" />
      <path d="m18.5 13 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />
      <path d="M5 14v6h8" />
    </>
  ),
  hooks: () => (
    <>
      <path d="M12 3v10.2a4.8 4.8 0 1 1-4.8-4.8" />
      <path d="m9 3 3 3 3-3" />
    </>
  ),
  system: () => (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 9h8M8 13h5M8 17h8" />
    </>
  ),
}

export function SettingsNavIcon(props: { name: SettingsIconName }) {
  return (
    <Show
      when={GLYPHS[props.name]}
      fallback={
        <svg
          data-slot="settings-nav-icon"
          data-filled={props.name === "mcp" ? "" : undefined}
          viewBox={props.name === "memory" ? "0 0 20 20" : "0 0 24 24"}
          aria-hidden="true"
        >
          {DRAWINGS[props.name]?.()}
        </svg>
      }
    >
      {(glyph) => (
        <span data-slot="settings-nav-glyph" aria-hidden="true">
          {glyph()}
        </span>
      )}
    </Show>
  )
}
