/* SPDX-License-Identifier: MIT */

import type { Component } from "solid-js"

/**
 * The topbar's panel glyph (V5 prototype, #showContextBtn and
 * #topInspectorBtn): a rounded 18x16 frame with one divider, on the left for
 * the context panel and on the right for the inspector. The shared icon set's
 * `sidebar` is a square-cornered 20px frame, which reads as a different icon.
 */
export const PanelToggleIcon: Component<{ side: "left" | "right" }> = (props) => (
  <svg data-slot="panel-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d={props.side === "left" ? "M9 4v16" : "M15 4v16"} />
  </svg>
)
