/* SPDX-License-Identifier: MIT */

import { type Component, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"

/**
 * The topbar's Live orb (Jarvis topbar prototype V5, #jarvisOrb). A click
 * does one thing, as in the prototype: ON (the idle presence, in motion) or
 * OFF (neutral and static). The Live conversation it will drive lives on the
 * `voice` branch, so ON starts nothing yet and the label says so.
 */
export const LiveOrb: Component = () => {
  const language = useLanguage()
  const [on, setOn] = createSignal(false)
  return (
    <button
      type="button"
      data-v110="live-orb"
      data-state={on() ? "idle" : "off"}
      aria-pressed={on()}
      aria-label={language.t("session.header.live.soon")}
      title={language.t("session.header.live.soon")}
      onClick={() => setOn((value) => !value)}
    >
      <span data-slot="live-orb-ring" aria-hidden="true">
        <span data-slot="live-orb-core" />
        <span data-slot="live-orb-orbit" />
      </span>
    </button>
  )
}
