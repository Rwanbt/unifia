/* SPDX-License-Identifier: MIT */

import { onCleanup, onMount, type JSX } from "solid-js"

const READY = "unifia:sketch-ready"
const LOAD = "unifia:sketch-load"
const CHANGE = "unifia:sketch-change"
const PREFIX = "unifia-design-sketch:v1:"

export function DesignSketchTab(props: { id: string }): JSX.Element {
  let frame!: HTMLIFrameElement
  const key = `${PREFIX}${props.id}`
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.type !== READY) return
    const raw = localStorage.getItem(key)
    frame.contentWindow?.postMessage({ type: LOAD, snapshot: raw ? JSON.parse(raw) : undefined }, "*")
  }
  const persist = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.type !== CHANGE) return
    localStorage.setItem(key, JSON.stringify(event.data.snapshot))
  }
  onMount(() => { window.addEventListener("message", receive); window.addEventListener("message", persist) })
  onCleanup(() => { window.removeEventListener("message", receive); window.removeEventListener("message", persist) })
  return <div class="flex h-full min-h-0 flex-col" data-design-sketch>
    <iframe ref={frame} class="min-h-0 flex-1 border-0" title="Croquis Excalidraw" src="/design-sketch/index.html" data-design-sketch-frame />
  </div>
}
