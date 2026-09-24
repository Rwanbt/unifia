/* SPDX-License-Identifier: MIT */

// The reference's mode-change choreography (UnifiaMotionV83, desktop
// branch, Unifia-UI-UX-v110-PORT-READY-R1.html ~25640-25700), ported onto
// the app's anchors. Before the switch, the outgoing main card and context
// body are cloned as fixed "ghosts" that fall away; after it, the incoming
// ones slide in from the right, and any text that changed (crumbs, context
// subtitle) swaps with a small drop/slide. See ADR-055.

type Frames = Keyframe[]
type Timing = KeyframeAnimationOptions

const MAIN = '[data-v110="workspace"] [data-v110="surface-card"]'
const CONTEXT = '[data-v110="context-panel"] .context-scroll'
const INSPECTOR = '[data-v110="inspector-content"]'
const TEXTS = ['[data-v110="crumbs"]', '[data-v110="context-panel"] .context-sub']

const OUT_EASE = "cubic-bezier(.4,0,.2,1)"
const IN_EASE = "cubic-bezier(.16,.84,.2,1)"
const TEXT_EASE = "cubic-bezier(.18,.82,.22,1)"

function enabled(): boolean {
  if (document.documentElement.dataset.uiAnimations === "off") return false
  return !matchMedia("(prefers-reduced-motion: reduce)").matches
}

function visible(selector: string): HTMLElement | undefined {
  const element = document.querySelector<HTMLElement>(selector)
  // A collapsed panel keeps its size but is faded out and inert; a ghost of
  // it would appear out of nowhere.
  if (!element || element.closest("[inert]")) return undefined
  if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return undefined
  const rect = element.getBoundingClientRect()
  return rect.width >= 8 && rect.height >= 8 ? element : undefined
}

function animate(element: Element | undefined, frames: Frames, timing: Timing) {
  if (!element) return undefined
  try {
    return element.animate(frames, timing)
  } catch {
    // WHY: an element detached between capture and animation throws; the
    // swap itself already happened, so the motion is simply skipped.
    return undefined
  }
}

// A fixed copy of `element` where it stands now, above the new content.
function ghost(element: HTMLElement | undefined): HTMLElement | undefined {
  if (!element) return undefined
  const rect = element.getBoundingClientRect()
  const copy = element.cloneNode(true) as HTMLElement
  copy.removeAttribute("id")
  for (const child of copy.querySelectorAll("[id]")) child.removeAttribute("id")
  copy.setAttribute("aria-hidden", "true")
  copy.setAttribute("inert", "")
  Object.assign(copy.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "40",
  })
  document.body.appendChild(copy)
  return copy
}

function fadeGhost(copy: HTMLElement | undefined, drop: number, duration: number) {
  if (!copy) return
  const animation = animate(copy, [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${drop}px)`, opacity: 0 }], {
    duration,
    easing: OUT_EASE,
    fill: "forwards",
  })
  if (!animation) return copy.remove()
  animation.finished.finally(() => copy.remove()).catch(() => copy.remove())
}

type Snapshot = {
  main?: HTMLElement
  context?: HTMLElement
  contextHtml?: string
  inspectorHtml?: string
  texts: (string | undefined)[]
}

function capture(): Snapshot {
  const context = visible(CONTEXT)
  return {
    main: ghost(visible(MAIN)),
    context: ghost(context),
    contextHtml: context?.innerHTML,
    inspectorHtml: visible(INSPECTOR)?.innerHTML,
    texts: TEXTS.map((selector) => visible(selector)?.textContent ?? undefined),
  }
}

function play(before: Snapshot): void {
  fadeGhost(before.main, 34, 390)
  animate(visible(MAIN), [{ transform: "translateX(34px)", opacity: 0.08 }, { transform: "translateX(0)", opacity: 1 }], {
    duration: 440,
    easing: IN_EASE,
  })

  const context = visible(CONTEXT)
  if (context && context.innerHTML !== before.contextHtml) {
    fadeGhost(before.context, 24, 350)
    animate(context, [{ transform: "translateX(22px)", opacity: 0.08 }, { transform: "translateX(0)", opacity: 1 }], {
      duration: 410,
      easing: IN_EASE,
    })
  } else before.context?.remove()

  const inspector = visible(INSPECTOR)
  if (inspector && inspector.innerHTML !== before.inspectorHtml) {
    animate(inspector, [{ transform: "translateX(18px)", opacity: 0.12 }, { transform: "translateX(0)", opacity: 1 }], {
      duration: 360,
      easing: TEXT_EASE,
    })
  }

  TEXTS.forEach((selector, index) => {
    const element = visible(selector)
    if (!element || element.textContent === before.texts[index]) return
    animate(element, [{ transform: "translateX(10px)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], {
      duration: 360,
      easing: TEXT_EASE,
    })
  })
}

/**
 * Runs `change` (a mode switch) with the reference's transition around it.
 * The new route renders asynchronously, so the incoming half waits two
 * frames for the new surface to be in the DOM.
 */
export function withModeMotion(change: () => void): void {
  if (!enabled()) return change()
  const before = capture()
  change()
  requestAnimationFrame(() => requestAnimationFrame(() => play(before)))
}
