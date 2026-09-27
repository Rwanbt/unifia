/* SPDX-License-Identifier: MIT */

import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"

/**
 * The topbar's Live orb (Jarvis topbar prototype V5, #jarvisOrb) in its OFF
 * state: neutral and static. The Live conversation it toggles lives on the
 * `voice` branch and is not on this one yet, so the orb says so instead of
 * pretending to start anything. It keeps the prototype's place and size so
 * the topbar's geometry is already the final one.
 */
export const LiveOrb: Component = () => {
  const language = useLanguage()
  return (
    <button
      type="button"
      data-v110="live-orb"
      data-state="off"
      aria-disabled="true"
      aria-label={language.t("session.header.live.soon")}
      title={language.t("session.header.live.soon")}
    >
      <span data-slot="live-orb-ring" aria-hidden="true">
        <span data-slot="live-orb-core" />
      </span>
    </button>
  )
}
