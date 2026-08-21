/* SPDX-License-Identifier: MIT */

import { createSignal, type JSX } from "solid-js"

const DEFAULT_URL = "https://example.com"
const normalizeUrl = (value: string) => {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed || "example.com"}`
}

export function DesignBrowserTab(): JSX.Element {
  const [address, setAddress] = createSignal(DEFAULT_URL)
  const [url, setUrl] = createSignal(DEFAULT_URL)
  return <div class="flex h-full min-h-0 flex-col" data-design-browser>
    <form class="flex shrink-0 gap-2 border-b border-border-base p-2" onSubmit={(event) => { event.preventDefault(); const next = normalizeUrl(address()); setAddress(next); setUrl(next) }}>
      <input class="min-w-0 flex-1 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular" aria-label="URL" value={address()} onInput={(event) => setAddress(event.currentTarget.value)} data-design-browser-address />
      <button type="submit" class="rounded border border-border-base px-2 py-1 text-12-medium" data-design-browser-go>Go</button>
    </form>
    <iframe class="min-h-0 flex-1 border-0" title="Browser" src={url()} referrerPolicy="no-referrer" data-design-browser-frame />
  </div>
}
