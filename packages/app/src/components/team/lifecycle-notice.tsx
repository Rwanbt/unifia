// =============================================================================
// components/team/lifecycle-notice.tsx — TEAM-M01
//
// Says, once and in one place, why there is no Start / Pause / Cancel here.
//
// The alternative was to render the buttons disabled, which answers "why?" with
// nothing. R-WIRING-001: no application code path constructs a Team run, so the
// runtime in packages/opencode/src/team never executes. The CLI gives the same
// answer with exit 69 (EX_UNAVAILABLE); this is the same fact on screen.
// =============================================================================

import { Show } from "solid-js"
import type { TeamCapabilities } from "@/context/team"

export interface LifecycleNoticeProps {
  readonly capabilities: TeamCapabilities
  /**
   * The explanation to display. Defaults to the reason carried by the
   * capabilities, which is in English; a localised surface passes its own.
   */
  readonly reason?: string
}

export function LifecycleNotice(props: LifecycleNoticeProps) {
  const unavailable = () =>
    !props.capabilities.canStart && !props.capabilities.canPause && !props.capabilities.canCancel

  return (
    <Show when={unavailable()}>
      <p role="note" class="text-10-regular text-text-weaker border border-border-weak-base rounded px-2 py-1">
        {props.reason ?? props.capabilities.lifecycleReason}
      </p>
    </Show>
  )
}
