/* SPDX-License-Identifier: MIT */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { createHoverIntent } from "@/shell/hover-intent"
import { liveOrbView, type LiveOrbView } from "@/voice/live-orb"
import { isLiveActive } from "@/voice/live-state"
import { liveAvailable, liveDetails, liveState, toggleLive } from "@/voice/live-store"

const PEEK_ID = "live-orb-peek"
const PEEK_WIDTH = 300
const PEEK_MARGIN = 8
const PEEK_GAP = 7

type Translate = (key: string) => string

/** Places the peek under the orb (above it when there is no room), inside the viewport. */
function placePeek(orb: HTMLElement, peek: HTMLElement) {
  const rect = orb.getBoundingClientRect()
  const width = Math.min(PEEK_WIDTH, Math.max(240, window.innerWidth - PEEK_MARGIN * 2))
  peek.style.width = `${width}px`
  const height = peek.getBoundingClientRect().height
  const centered = rect.left + rect.width / 2 - width / 2
  const left = Math.max(PEEK_MARGIN, Math.min(centered, window.innerWidth - width - PEEK_MARGIN))
  const below = rect.bottom + PEEK_GAP
  const top =
    below + height > window.innerHeight - PEEK_MARGIN ? Math.max(PEEK_MARGIN, rect.top - height - PEEK_GAP) : below
  peek.style.left = `${Math.round(left)}px`
  peek.style.top = `${Math.round(top)}px`
}

/**
 * The topbar's Live orb (Jarvis topbar prototype V5): a click starts or ends
 * the Live conversation, hovering it while Live runs opens a peek with the
 * conversation's real state. It drives the same conversation as the
 * composer's Live button (`toggleLive`).
 */
export const LiveOrb: Component = () => {
  const language = useLanguage()
  const command = useCommand()
  const t: Translate = (key) => language.t(key as Parameters<typeof language.t>[0])
  const [open, setOpen] = createSignal(false)
  const active = () => isLiveActive(liveState())
  const view = createMemo(() => liveOrbView(liveState(), liveDetails()))
  let orb: HTMLButtonElement | undefined
  let peek: HTMLDivElement | undefined

  const hover = createHoverIntent({
    open: () => active() && setOpen(true),
    close: () => setOpen(false),
    isOpen: open,
    hovered: () => !!orb?.matches(":hover") || !!peek?.matches(":hover"),
  })
  const close = () => {
    hover.reset()
    setOpen(false)
  }
  const reposition = () => orb && peek && placePeek(orb, peek)

  // Ending Live (from anywhere) closes the peek; there is nothing left to show.
  createEffect(() => {
    if (!active()) close()
  })
  createEffect(() => {
    if (!open()) return
    requestAnimationFrame(reposition)
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close()
    window.addEventListener("resize", reposition, { passive: true })
    window.addEventListener("scroll", reposition, { passive: true, capture: true })
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, { capture: true })
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <Show when={liveAvailable() || active()}>
      <button
        ref={orb}
        type="button"
        data-v110="live-orb"
        data-action="topbar-live-toggle"
        data-visual={view().visual}
        aria-label={active() ? t("prompt.live.stop") : t("prompt.live.start")}
        aria-pressed={active()}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={open() ? PEEK_ID : undefined}
        // A click has one job: Live on/off. The peek follows the pointer.
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          toggleLive()
        }}
        onPointerEnter={(event) => hover.enterTrigger(event)}
        onPointerLeave={() => hover.leaveTrigger()}
        onFocus={() => active() && setOpen(true)}
        onBlur={(event) => {
          // Keyboard peek: closes with the focus unless the pointer keeps it open.
          if (hover.peeking() || peek?.contains(event.relatedTarget as Node | null)) return
          if (!orb?.matches(":hover")) setOpen(false)
        }}
      >
        <span data-slot="live-orb-ring" aria-hidden="true">
          <span data-slot="live-orb-core" />
          <span data-slot="live-orb-orbit" />
        </span>
        <span data-slot="live-orb-attention" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <Portal>
          <LiveOrbPeek
            ref={(element) => (peek = element)}
            view={view()}
            t={t}
            onEnter={() => hover.enterPanel()}
            onLeave={() => hover.leavePanel()}
            onClose={close}
            onSettings={() => {
              close()
              command.trigger("settings.open")
            }}
          />
        </Portal>
      </Show>
    </Show>
  )
}

const LiveOrbPeek: Component<{
  ref: (element: HTMLDivElement) => void
  view: LiveOrbView
  t: Translate
  onEnter: () => void
  onLeave: () => void
  onClose: () => void
  onSettings: () => void
}> = (props) => (
  <div
    ref={props.ref}
    id={PEEK_ID}
    role="dialog"
    aria-label={props.t("live.orb.panel")}
    data-v110="live-orb-peek"
    onPointerEnter={() => props.onEnter()}
    onPointerLeave={() => props.onLeave()}
  >
    <div data-slot="live-orb-peek-head">
      <div data-slot="live-orb-peek-identity">
        <span data-slot="live-orb-mini" aria-hidden="true" />
        <div>
          <b>Live</b>
          <span role="status" aria-live="polite">
            {props.t(`prompt.live.state.${liveState()}`)}
          </span>
        </div>
      </div>
      <button
        type="button"
        data-slot="live-orb-peek-close"
        aria-label={props.t("live.orb.close")}
        onClick={() => props.onClose()}
      >
        ×
      </button>
    </div>
    <div data-slot="live-orb-peek-body">
      <div data-slot="live-orb-peek-copy">
        <b>{props.t(props.view.title)}</b>
        <span>{props.t(props.view.detail)}</span>
      </div>
      <div data-slot="live-orb-progress" data-busy={props.view.busy ? "" : undefined} aria-hidden="true">
        <i />
      </div>
      <div data-slot="live-orb-rows">
        <For each={props.view.rows}>
          {(row) => (
            <div data-slot="live-orb-row" data-row={row.id}>
              <span data-slot="live-orb-dot" data-tone={row.tone} />
              <span>{props.t(`live.orb.row.${row.id}.label`)}</span>
              <b>{props.t(row.value)}</b>
            </div>
          )}
        </For>
      </div>
    </div>
    <div data-slot="live-orb-peek-actions">
      <button type="button" onClick={() => props.onSettings()}>
        {props.t("live.orb.action.settings")}
      </button>
      <button type="button" data-action="live-orb-stop" onClick={() => toggleLive()}>
        {props.t("live.orb.action.stop")}
      </button>
    </div>
  </div>
)
