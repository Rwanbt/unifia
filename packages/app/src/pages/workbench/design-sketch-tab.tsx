/* SPDX-License-Identifier: MIT */

import { onMount, type JSX } from "solid-js"

type Point = { x: number; y: number }
const PREFIX = "unifia-design-sketch:v1:"

export function DesignSketchTab(props: { id: string }): JSX.Element {
  let canvas!: HTMLCanvasElement
  let drawing = false
  let points: Point[] = []
  const key = `${PREFIX}${props.id}`
  const persist = () => localStorage.setItem(key, JSON.stringify(points))
  const draw = () => {
    const context = canvas.getContext("2d")
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (points.length < 2) return
    context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke()
  }
  const point = (event: PointerEvent): Point => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height } }
  onMount(() => { try { points = JSON.parse(localStorage.getItem(key) ?? "[]") as Point[] } catch { points = [] }; draw() })
  return <div class="flex h-full min-h-0 flex-col" data-design-sketch>
    <div class="flex shrink-0 justify-between border-b border-border-base p-2 text-12-regular"><span>Croquis</span><button type="button" class="rounded border border-border-base px-2 py-1" data-design-sketch-clear onClick={() => { points = []; persist(); draw() }}>Effacer</button></div>
    <canvas ref={canvas} width="1200" height="800" class="min-h-0 flex-1 touch-none" onPointerDown={(event) => { drawing = true; points.push(point(event)); canvas.setPointerCapture(event.pointerId); draw() }} onPointerMove={(event) => { if (drawing) { points.push(point(event)); draw() } }} onPointerUp={(event) => { drawing = false; persist(); canvas.releasePointerCapture(event.pointerId) }} data-design-sketch-canvas />
  </div>
}
