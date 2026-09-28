/* SPDX-License-Identifier: MIT */

import type { JSX } from "solid-js"

/**
 * Stroke icons of the Design studio panel, with the reference's exact paths
 * (V5 prototype `#designLayers .design-icon-btn`). The CSS owns the stroke
 * width and colour so the active and hover states follow the palette. Each
 * entry is a factory: a Solid JSX node is a real DOM node, so one shared
 * instance would move between buttons instead of rendering in each.
 */
const paths = {
  refresh: () => (
    <>
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.5 9A7 7 0 0 0 6 6.5L4 9" />
      <path d="M5.5 15A7 7 0 0 0 18 17.5L20 15" />
    </>
  ),
  preview: () => (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  source: () => (
    <>
      <path d="m8 9-3 3 3 3" />
      <path d="m16 9 3 3-3 3" />
      <path d="m14 5-4 14" />
    </>
  ),
  desktop: () => (
    <>
      <rect height="13" rx="2" width="18" x="3" y="4" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ),
  capture: () => (
    <>
      <path d="M5 7h3l1.2-2h5.6L16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  inspect: () => (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
      <path d="M11 8v6M8 11h6" />
    </>
  ),
  comment: () => <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
  annotate: () => (
    <>
      <path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  modify: () => (
    <>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m5.6 5.6 2.8 2.8" />
      <path d="m15.6 15.6 2.8 2.8" />
      <path d="m18.4 5.6-2.8 2.8" />
      <path d="m8.4 15.6-2.8 2.8" />
    </>
  ),
  vector: () => (
    <>
      <path d="M5 18 9 6l6 12 4-9" />
      <circle cx="5" cy="18" r="1.5" />
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
      <circle cx="19" cy="9" r="1.5" />
    </>
  ),
  history: () => (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  comments: () => (
    <>
      <path d="M4 5h16v11H8l-4 3V5Z" />
      <path d="M8 9h8" />
      <path d="M8 12h5" />
    </>
  ),
  export: () => (
    <>
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4 20h16" />
    </>
  ),
  share: () => (
    <>
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    </>
  ),
  audit: () => <path d="M3 12h4l2-5 4 10 2-5h6" />,
  collapse: () => <path d="m14.5 6.5-5 5.5 5 5.5" />,
  expand: () => <path d="m9.5 6.5 5 5.5-5 5.5" />,
  search: () => (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
} satisfies Record<string, () => JSX.Element>

export type StudioIconName = keyof typeof paths

export function StudioIcon(props: { name: StudioIconName }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-design-studio-icon={props.name}>
      {paths[props.name]()}
    </svg>
  )
}
