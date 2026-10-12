/* SPDX-License-Identifier: MIT */

import { createEffect, getOwner, onCleanup, runWithOwner } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useGlobalSDK, useLayout, useServer } from "@unifia/app"
import { showToast } from "@unifia/ui/toast"
import { base64Encode } from "@unifia/util/encode"
import type { MobileNavigationLink } from "./navigation-link"

export function MobileNavigationLinks(props: {
  links: MobileNavigationLink[]
  onConsumed: () => void
}) {
  const sdk = useGlobalSDK()
  const server = useServer()
  const layout = useLayout()
  const navigate = useNavigate()
  const owner = getOwner()
  let disposed = false
  let pending = Promise.resolve()
  onCleanup(() => { disposed = true })

  async function apply(link: MobileNavigationLink, target: string) {
    if (disposed || server.key !== target) return
    if (link.kind === "session") {
      const response = await sdk.client.session.get({ sessionID: link.sessionID })
      if (!response.data) throw new Error("Session was not found on the selected device")
      if (disposed || server.key !== target) return
      const directory = response.data.directory
      layout.projects.open(directory)
      navigate(`/${base64Encode(directory)}/session/${encodeURIComponent(link.sessionID)}`)
      return
    }
    if (!server.isLocal()) throw new Error("Open-project links require the local device")
    const response = await sdk.client.path.get({ directory: link.directory })
    if (!response.data) throw new Error("Project was not found on the local device")
    if (disposed || server.key !== target) return
    const directory = response.data.directory
    const slug = base64Encode(directory)
    layout.projects.open(directory)
    if (link.file) {
      // Layout readers create memos: bind them to this connection's lifecycle after the await.
      const readers = runWithOwner(owner, () => ({ tabs: layout.tabs(slug), view: layout.view(slug) }))
      if (!readers) return
      await readers.tabs.open(`file://${link.file}`)
      readers.view.workspace.set("main")
    }
    if (!disposed && server.key === target) navigate(`/${slug}/session`)
  }

  createEffect(() => {
    const links = props.links
    if (!links.length) return
    const target = server.key
    props.onConsumed()
    for (const link of links) {
      pending = pending.then(() => apply(link, target)).catch((error) => {
        if (disposed || server.key !== target) return
        showToast({ variant: "error", title: "Unable to open link", description: String(error) })
      })
    }
  })
  return null
}
