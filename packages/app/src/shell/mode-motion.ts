/* SPDX-License-Identifier: MIT */

// The reference's mode-change choreography (UnifiaMotionV83, desktop
// branch, Unifia-UI-UX-v110-PORT-READY-R1.html ~25640-25700), ported onto
// the app's anchors. Before the switch, the outgoing main card and context
// body are cloned as fixed "ghosts" that fall away; after it, the incoming
// ones slide in from the right, and any text that changed (crumbs, context
// subtitle) swaps with a small drop/slide. See ADR-055.

type Frames = Keyframe[]
type Timing = KeyframeAnimationOptions

const WORKSPACE = '[data-v110="workspace"]'
const MAIN = '[data-v110="workspace"] [data-v110="surface-card"]'
const CONTEXT = '[data-v110="context-panel"] .context-scroll'
// The active tab's body only: the frame, its title bar and tabs stay put,
// as the reference moves only its active pane.
const INSPECTOR = "#v110-inspector-panel"
const INSPECTOR_TITLE = '[data-v110="inspector-title"]'
const TEXTS = ['[data-v110="crumbs"]', '[data-v110="context-panel"] .context-sub']

// About two thirds of a second (a lazy main card measured ~330ms): past
// it a part that has not changed yet is shown without the slide.
const MAX_WAIT_FRAMES = 40

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

// What an element looks like now, to be shown as a "ghost" once the real
// one has changed. The ghost is put back inside the same container (the
// app's CSS styles many elements through their ancestors); when that
// container is itself replaced, inside `fallback`, with the inherited
// typography copied so the text does not reflow.
type Shot = { copy: HTMLElement; rect: DOMRect; text: string; host: Element | null; fallback: Element | null }

const INHERITED = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color"] as const

function shoot(element: HTMLElement | undefined, fallback: string): Shot | undefined {
  if (!element) return undefined
  const copy = element.cloneNode(true) as HTMLElement
  copy.removeAttribute("id")
  for (const child of copy.querySelectorAll("[id]")) child.removeAttribute("id")
  const style = getComputedStyle(element)
  for (const key of INHERITED) copy.style[key] = style[key]
  return {
    copy,
    rect: element.getBoundingClientRect(),
    text: element.textContent ?? "",
    host: element.parentElement,
    fallback: document.querySelector(fallback),
  }
}

function fadeGhost(shot: Shot | undefined, drop: number, duration: number) {
  if (!shot) return
  const { copy, rect } = shot
  const host = shot.host?.isConnected ? shot.host : shot.fallback?.isConnected ? shot.fallback : undefined
  if (!host) return
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
  host.appendChild(copy)
  // A transformed or contained ancestor becomes the fixed box's containing
  // block; measure where it landed and correct by the difference.
  const landed = copy.getBoundingClientRect()
  copy.style.left = `${2 * rect.left - landed.left}px`
  copy.style.top = `${2 * rect.top - landed.top}px`
  const animation = animate(copy, [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${drop}px)`, opacity: 0 }], {
    duration,
    easing: OUT_EASE,
    fill: "forwards",
  })
  if (!animation) {
    copy.remove()
    return
  }
  animation.finished.finally(() => copy.remove()).catch(() => copy.remove())
}

function slideIn(element: Element | undefined, offset: number, opacity: number, duration: number, easing: string) {
  animate(element, [{ transform: `translateX(${offset}px)`, opacity }, { transform: "translateX(0)", opacity: 1 }], { duration, easing })
}

type Snapshot = {
  mainNode?: HTMLElement
  main?: Shot
  // The context body section by section: a section that reads the same in
  // the new mode (the projects list) stays still, as in the reference.
  sections: (Shot | undefined)[]
  inspector?: string
  inspectorTitle?: string
  texts: (Shot | undefined)[]
}

function sections(): HTMLElement[] {
  // The body wraps its sections in single-child roots; the sections are
  // the first level with siblings.
  let body: Element | undefined = visible(CONTEXT)
  while (body && body.children.length === 1) body = body.children[0]
  return body ? ([...body.children] as HTMLElement[]) : []
}

function capture(): Snapshot {
  const main = visible(MAIN)
  return {
    mainNode: main,
    main: shoot(main, WORKSPACE),
    sections: sections().map((section) => shoot(section, CONTEXT)),
    inspector: visible(INSPECTOR)?.textContent ?? undefined,
    inspectorTitle: visible(INSPECTOR_TITLE)?.textContent ?? undefined,
    texts: TEXTS.map((selector) => shoot(visible(selector), "body")),
  }
}

// Each part moves on the first frame it shows its new content: waiting for
// the slowest (a lazily loaded main card) showed the others' new content
// unanimated for a third of a second before they slid in.
type Part = () => boolean

function parts(before: Snapshot): Part[] {
  const mainPart: Part = () => {
    const main = visible(MAIN)
    if (!main || main === before.mainNode) return false
    if (main.textContent !== before.main?.text) {
      fadeGhost(before.main, 34, 390)
      slideIn(main, 34, 0.08, 440, IN_EASE)
    }
    return true
  }
  const contextPart: Part = () => {
    const now = sections()
    const changed = now.some((section, index) => section.textContent !== before.sections[index]?.text)
    if (!changed && now.length === before.sections.length) return false
    now.forEach((section, index) => {
      const old = before.sections[index]
      if (old && section.textContent === old.text) return
      fadeGhost(old, 24, 350)
      slideIn(section, 22, 0.08, 410, IN_EASE)
    })
    // Sections the new mode no longer shows fall away too.
    for (const old of before.sections.slice(now.length)) fadeGhost(old, 24, 350)
    return true
  }
  // The inspector's tab body only moves when what it shows changes.
  const inspectorPart: Part = () => {
    const inspector = visible(INSPECTOR)
    if (!inspector || inspector.textContent === before.inspector) return false
    slideIn(inspector, 18, 0.12, 360, TEXT_EASE)
    return true
  }
  const titlePart: Part = () => {
    const title = visible(INSPECTOR_TITLE)
    if (!title || title.textContent === before.inspectorTitle) return false
    slideIn(title, 7, 0.1, 250, "ease-out")
    return true
  }
  const textParts = TEXTS.map((selector, index): Part => () => {
    const element = visible(selector)
    const old = before.texts[index]
    if (!element || element.textContent === old?.text) return false
    fadeGhost(old, 11, 300)
    animate(element, [{ transform: "translateX(10px)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], {
      duration: 360,
      easing: TEXT_EASE,
    })
    return true
  })
  return [mainPart, contextPart, inspectorPart, titlePart, ...textParts]
}

/**
 * Runs `change` (a mode switch) with the reference's transition around it.
 * The new route renders asynchronously (a lazy surface can take several
 * frames), so each part is watched frame by frame until it changes.
 */
export function withModeMotion(change: () => void): void {
  if (!enabled()) {
    change()
    return
  }
  const before = capture()
  change()
  let pending = parts(before)
  let frames = 0
  const tick = () => {
    pending = pending.filter((part) => !part())
    if (pending.length === 0 || ++frames >= MAX_WAIT_FRAMES) return
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
