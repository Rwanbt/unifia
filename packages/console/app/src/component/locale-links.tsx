import { Link } from "@solidjs/meta"
import { For } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import type { APIEvent } from "@solidjs/start/server"
import { config } from "~/config"
import { useLanguage } from "~/context/language"
import { LOCALES, route, tag } from "~/lib/language"

function skip(path: string) {
  const evt = getRequestEvent() as APIEvent | undefined
  if (!evt) return false

  const key = "__locale_links_seen"
  const locals = evt.locals as Record<string, unknown>
  const seen = locals[key] instanceof Set ? (locals[key] as Set<string>) : new Set<string>()
  locals[key] = seen
  if (seen.has(path)) return true
  seen.add(path)
  return false
}

export function LocaleLinks(props: { path: string }) {
  const language = useLanguage()
  if (skip(props.path)) return null

  // No configured canonical origin means no canonical origin to advertise.
  // Emitting a relative or placeholder URL here would tell a crawler and a
  // browser the same wrong thing, so the whole set is omitted instead.
  const base = config.baseUrl
  if (!base) return null

  return (
    <>
      <Link rel="canonical" href={`${base}${route(language.locale(), props.path)}`} />
      <For each={LOCALES}>
        {(locale) => <Link rel="alternate" hreflang={tag(locale)} href={`${base}${route(locale, props.path)}`} />}
      </For>
      <Link rel="alternate" hreflang="x-default" href={`${base}${props.path}`} />
    </>
  )
}
