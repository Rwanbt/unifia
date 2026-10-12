/* SPDX-License-Identifier: MIT */

// S5 chat / composer surface test (test of surface, NOT visual parity claim).
// Verifies the v110 chat anchors documented in COMPONENT-MAP §2 and §66
// (S5 Session/Chat) land once a project + session are open. Real backend.
// G2 visual parity vs the maquette is NOT claimed by this checkpoint.

import { test, expect } from "../fixtures"
import { withSession } from "../actions"

// `data-parity="session.chat"` is on the turn list inside MessageTimeline
// (message-timeline.tsx), and MessageTimeline is gated behind
// `props.messagesReady()` (session-timeline-section.tsx). A freshly opened
// project lands on the messageless "new session" screen, so the anchor is not in
// the DOM at all and both tests failed with "element(s) not found" before
// asserting anything. This is the same precondition a3-responsive already seeds
// for the context meter, reused here rather than re-derived. The assertions run
// inside withSession because it deletes the session in its `finally`.

test("chat carries the v110 chat anchor", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  await withSession(project.sdk, "v110 chat anchor", async (session) => {
    await project.sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [{ type: "text", text: "v110 chat anchor seed" }],
    })
    await expect
      .poll(
        async () =>
          (await project.sdk.session.messages({ sessionID: session.id, limit: 1 }).then((r) => r.data ?? []))
            .length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)
    await project.gotoSession(session.id)

    const chat = page.locator('[data-parity="session.chat"]')
    await expect(chat).toBeVisible()
    await expect(chat).toHaveAttribute("role", "log")
  })
})

test("composer dock anchor is mounted when the session view opens", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  // The composer is not behind messagesReady(), so no seed is needed here.
  await expect(page.locator('[data-parity="session.composer"]')).toBeVisible()
})

test("chat and composer are siblings of the shell frame (stable anchoring)", async ({ page, project }) => {
  await project.open()
  await page.setViewportSize({ width: 1440, height: 900 })

  await withSession(project.sdk, "v110 chat anchoring", async (session) => {
    await project.sdk.session.promptAsync({
      sessionID: session.id,
      noReply: true,
      parts: [{ type: "text", text: "v110 chat anchoring seed" }],
    })
    await expect
      .poll(
        async () =>
          (await project.sdk.session.messages({ sessionID: session.id, limit: 1 }).then((r) => r.data ?? []))
            .length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)
    await project.gotoSession(session.id)

    const inside = await page.evaluate(() => {
      const topbar = document.querySelector('[data-parity="shell.topbar"]')
      const chat = document.querySelector('[data-parity="session.chat"]')
      const composer = document.querySelector('[data-parity="session.composer"]')
      if (!topbar || !chat || !composer) return false
      const top = topbar.getBoundingClientRect().bottom
      const chatTop = chat.getBoundingClientRect().top
      const composerTop = composer.getBoundingClientRect().top
      return composerTop >= chatTop && chatTop >= top
    })
    expect(inside).toBe(true)
  })
})
