// SPDX-License-Identifier: MIT
// Mounts the real app provider tree and router, as entry.tsx does, against a
// given server URL, in a memory router starting at `path`.
import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { render } from "@solidjs/testing-library"
import type { BaseRouterProps } from "@solidjs/router"
import { AppProviders } from "@/app"
import { type Platform, PlatformProvider } from "@/context/platform"
import { ServerConnection } from "@/context/server"

export function mountApp(input: { serverUrl: string; path: string }) {
  const history = createMemoryHistory()
  history.set({ value: input.path })
  const platform: Platform = {
    platform: "web",
    version: "0.0.0-test",
    openLink: () => {},
    back: () => history.back(),
    forward: () => history.forward(),
    restart: async () => {},
    notify: async () => {},
    getDefaultServer: async () => ServerConnection.Key.make(input.serverUrl),
    setDefaultServer: () => {},
  }
  const server: ServerConnection.Http = { type: "http", http: { url: input.serverUrl } }
  const router = (props: BaseRouterProps) => <MemoryRouter history={history} {...props} />
  const view = render(() => (
    <PlatformProvider value={platform}>
      <AppProviders
        defaultServer={ServerConnection.Key.make(input.serverUrl)}
        servers={[server]}
        router={router}
        disableHealthCheck
      />
    </PlatformProvider>
  ))
  return { view, history }
}
