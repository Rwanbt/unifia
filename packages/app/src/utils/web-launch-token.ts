/* SPDX-License-Identifier: MIT */

// `unifia web` opens the interface with a generated password in the URL fragment (`#token=…`), as Jupyter does. The
// fragment never reaches the server or its logs; it is read once here, removed from the address bar so it is not
// bookmarked or shared, and kept so a reload of the same server still authenticates. A new launch brings a new token.

export const WEB_LAUNCH_TOKEN_KEY = "unifia.web.launchToken"

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void }
type Place = { hash: string; pathname: string; search: string }
type History = { replaceState(data: unknown, unused: string, url: string): void }

/** The launch token from the fragment if it carries one (stored, then stripped), else the one stored by an earlier load. */
export function takeWebLaunchToken(place: Place, history: History, storage: Storage | undefined): string | undefined {
  const fragment = new URLSearchParams(place.hash.replace(/^#/, ""))
  const fresh = fragment.get("token")
  if (!fresh) return readStored(storage)
  fragment.delete("token")
  const rest = fragment.toString()
  history.replaceState(null, "", `${place.pathname}${place.search}${rest ? `#${rest}` : ""}`)
  try {
    storage?.setItem(WEB_LAUNCH_TOKEN_KEY, fresh)
  } catch {
    // Storage can be unavailable (private mode); the token still serves this page load.
  }
  return fresh
}

function readStored(storage: Storage | undefined): string | undefined {
  try {
    return storage?.getItem(WEB_LAUNCH_TOKEN_KEY) ?? undefined
  } catch {
    return undefined
  }
}
