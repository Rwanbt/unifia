/* SPDX-License-Identifier: MIT */

import { createEffect } from "solid-js"
import { createArtifactParser } from "@unifia/artifact-render"
import { adaptRenderArtifactEvents } from "@/pages/workbench/artifact-event-adapter"
import type { ArtifactEvent, createArtifactStreamController } from "@/pages/workbench/use-artifact-stream"
import { extractMessageText } from "@/pages/workbench/workbench-thread-shared"
import { e2eActive } from "@/testing/active"

type Stream = ReturnType<typeof createArtifactStreamController>
type MessageLike = { id: string; role: string }

/**
 * Feeds the Design artifact stream and opens one tab per streamed artifact.
 * Split out of design-surface.tsx (ADR-099); behaviour unchanged.
 *
 * - P4-3: every `artifact:start` opens (once) an `artifact` tab. A tab the
 *   user closed is not reopened by a later chunk.
 * - Phase 7: each assistant message of the shared session is parsed
 *   incrementally — one parser per message id, fed only the new slice of
 *   text since the last run, reset on a session switch.
 * - e2e only: `__opencode_e2e.designStream(events)` lets the harness stream
 *   an artifact without a live model.
 */
export function syncDesignArtifactStream(input: {
  stream: Stream
  sessionId: () => string | undefined
  messages: (sessionId: string) => readonly MessageLike[]
  parts: (messageId: string) => Parameters<typeof extractMessageText>[0]
  openArtifactTab: (id: string, filename: string) => void
}): void {
  const { stream } = input
  if (e2eActive()) {
    const marker = (window as unknown as { __opencode_e2e: Record<string, unknown> }).__opencode_e2e
    marker.designStream = (events: ArtifactEvent[]) => events.forEach((event) => stream.push(event))
  }

  const seen = new Set<string>()
  createEffect(() => {
    for (const [id, entry] of stream.state().byId.entries()) {
      if (seen.has(id)) continue
      seen.add(id)
      input.openArtifactTab(id, entry.filename)
    }
  })

  const parsers = new Map<string, { parser: ReturnType<typeof createArtifactParser>; fed: number }>()
  let parsedSessionId: string | undefined
  createEffect(() => {
    const sessionId = input.sessionId()
    if (sessionId !== parsedSessionId) {
      parsers.clear()
      parsedSessionId = sessionId
    }
    if (!sessionId) return
    for (const message of input.messages(sessionId)) {
      if (message.role !== "assistant") continue
      const text = extractMessageText(input.parts(message.id))
      if (!text) continue
      let tracked = parsers.get(message.id)
      if (!tracked) {
        tracked = { parser: createArtifactParser(), fed: 0 }
        parsers.set(message.id, tracked)
      }
      if (text.length <= tracked.fed) continue
      const delta = text.slice(tracked.fed)
      tracked.fed = text.length
      for (const event of adaptRenderArtifactEvents(tracked.parser.feed(delta))) stream.push(event)
    }
  })
}
