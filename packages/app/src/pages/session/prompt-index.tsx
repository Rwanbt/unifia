/* SPDX-License-Identifier: MIT */

// A3-01 prompt index (v110 "prompt graduation ticks", INTERACTIONS.md
// §Chat), ported from the maquette's v45 script (module 043): one tick per
// visible user prompt in a packet 11px left of the conversation column's
// right edge. It appears while the pointer is within 64px of that edge, while
// the thread scrolls, or while the index itself is hovered or focused; each
// tick carries its own tip; a click scrolls the prompt to 28% of the thread.
// `props.messages` is already the reactive, revert-aware list the demo's
// MutationObserver existed to fake.

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useChapters } from "@unifia/ui/context/chapters"
import type { UserMessage, TextPart } from "@/types/sdk-shim"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"

// Distance from the column's right edge that reveals the index (reference).
const EDGE_REVEAL = 64

function animationsOn() {
  return document.documentElement.dataset.uiAnimations !== "off"
}

function firstPhrase(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  const match = clean.match(/^(.{1,140}?[.!?](?:\s|$)|.{1,100})/)
  return (match?.[1] ?? clean).trim()
}

export function PromptIndex(props: { messages: () => UserMessage[]; scrollEl: () => HTMLElement | undefined }) {
  const sync = useSync()
  const language = useLanguage()
  const chapters = useChapters()
  const [active, setActive] = createSignal(-1)
  const [visible, setVisible] = createSignal(false)
  const [nav, setNav] = createSignal<HTMLElement>()
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  // A turn is a chapter when its prompt or one of its replies is pinned.
  const isChapter = (message: UserMessage) => {
    if (!chapters) return false
    if (chapters.pinned(message.id)) return true
    const replies = sync.data.message[message.sessionID] ?? []
    return replies.some(
      (reply) => reply.role === "assistant" && reply.parentID === message.id && chapters.pinned(reply.id),
    )
  }

  const ticks = createMemo(() =>
    props.messages().map((message) => {
      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((p): p is TextPart => p.type === "text" && !p.synthetic)
      return { id: message.id, preview: firstPhrase(textPart?.text ?? ""), chapter: isChapter(message) }
    }),
  )

  const targetEl = (id: string) => props.scrollEl()?.querySelector<HTMLElement>(`[data-message-id="${id}"]`)

  const updateActive = () => {
    const root = props.scrollEl()
    if (!root) return
    const center = root.getBoundingClientRect().top + root.clientHeight / 2
    let best = 0
    ticks().forEach((tick, i) => {
      const el = targetEl(tick.id)
      if (el && el.getBoundingClientRect().top <= center) best = i
    })
    setActive(best)
  }

  const show = () => {
    clearTimeout(hideTimer)
    setVisible(true)
  }
  // Never hides under a pointer or focus still on the index.
  const hideLater = (ms = 300) => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!nav()?.matches(":hover, :focus-within")) setVisible(false)
    }, ms)
  }
  onCleanup(() => clearTimeout(hideTimer))

  createEffect(() => {
    const root = props.scrollEl()
    if (!root) return
    const onScroll = () => {
      updateActive()
      show()
      hideLater(420)
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    updateActive()
    onCleanup(() => root.removeEventListener("scroll", onScroll))
  })

  // The reference reveals the index when a mouse comes within 64px of the
  // conversation column's right edge (its scrollbar side).
  createEffect(() => {
    const host = nav()?.parentElement
    if (!host) return
    const column = () => host.querySelector<HTMLElement>('[data-v110="chat-timeline"]') ?? props.scrollEl() ?? host
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      const r = column().getBoundingClientRect()
      const near =
        event.clientX >= r.right - EDGE_REVEAL &&
        event.clientX <= r.right + 2 &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom
      if (near) show()
      else hideLater(160)
    }
    const onLeave = () => hideLater(160)
    host.addEventListener("pointermove", onMove, { passive: true })
    host.addEventListener("pointerleave", onLeave, { passive: true })
    onCleanup(() => {
      host.removeEventListener("pointermove", onMove)
      host.removeEventListener("pointerleave", onLeave)
    })
  })

  const goTo = (index: number) => {
    const root = props.scrollEl()
    const tick = ticks()[index]
    if (!root || !tick) return
    const el = targetEl(tick.id)
    if (!el) return
    const rootTop = root.getBoundingClientRect().top
    const elTop = el.getBoundingClientRect().top
    const target = Math.max(
      0,
      Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + (elTop - rootTop) - root.clientHeight * 0.28),
    )
    setActive(index)
    show()
    root.scrollTo({ top: target, behavior: animationsOn() ? "smooth" : "auto" })
  }

  return (
    <Show when={ticks().length > 1}>
      <nav
        ref={setNav}
        data-v110="prompt-index"
        data-component="prompt-index"
        aria-label={language.t("session.promptIndex.label")}
        classList={{ "prompt-index": true, visible: visible() }}
        onPointerEnter={show}
        onPointerLeave={() => hideLater(300)}
        onFocusIn={show}
        onFocusOut={() => hideLater(300)}
      >
        <For each={ticks()}>
          {(tick, i) => (
            <button
              type="button"
              class="prompt-index-tick"
              classList={{ active: i() === active() }}
              data-chapter={tick.chapter ? "" : undefined}
              aria-label={language.t("session.promptIndex.goTo", { index: i() + 1 })}
              onClick={() => goTo(i())}
            >
              <span class="prompt-index-tick-line" />
              <span class="prompt-index-tip" aria-hidden="true">
                {tick.chapter ? language.t("session.promptIndex.chapter", { title: tick.preview }) : tick.preview}
              </span>
            </button>
          )}
        </For>
      </nav>
    </Show>
  )
}
