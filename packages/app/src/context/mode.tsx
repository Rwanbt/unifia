import { createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { createSimpleContext } from "@unifia/ui/context"
import { SHELL_MODES, type ShellMode } from "@unifia/workbench-shell/modes"
import { modeHref, parseModeLocation } from "./mode-directory"
import { isAutomateAccessible, readAutomateDevFlag } from "./automate-flag"
import { Persist, persisted } from "@/utils/persist"

// ADR-1033: SHELL_MODES stays the 4-entry contract (check-mode-registry
// depends on it); production only ever exposes automate behind this flag.
const automateAccessible = isAutomateAccessible(import.meta.env.DEV, readAutomateDevFlag())
const visibleModes: readonly ShellMode[] = automateAccessible ? SHELL_MODES : SHELL_MODES.filter((mode) => mode !== "automate")

const isMode = (value: string | undefined): value is ShellMode =>
  !!value && SHELL_MODES.includes(value as ShellMode) && (value !== "automate" || automateAccessible)

const { use: useMode, provider: ModeContextProvider } = createSimpleContext({
  name: "Mode",
  init: () => {
    const location = useLocation()
    const navigate = useNavigate()
    const route = createMemo(() => parseModeLocation(location.pathname, location.search, automateAccessible))
    const directory = createMemo(() => route().directory)
    const sessionId = createMemo(() => {
      const current = route()
      return current.kind === "invalid" ? undefined : current.sessionId
    })
    const [pendingMode, setPendingMode] = createSignal<ShellMode>()
    const [preferences, setPreferences] = persisted(
      Persist.global("shell-modes", ["shell-modes.v1"]),
      createStore<{ lastModeByWorkspace: Record<string, ShellMode> }>({ lastModeByWorkspace: {} }),
    )
    const active = createMemo<ShellMode>(() => {
      const routeMode = route().mode
      return isMode(routeMode) ? routeMode : "code"
    })

    function select(mode: ShellMode): void {
      if (route().kind === "home") {
        setPendingMode(mode)
        return
      }
      const path = modeHref(route(), mode)
      if (!path) return
      setPreferences("lastModeByWorkspace", directory(), mode)
      navigate(path)
    }

    function hrefFor(workspace: string, mode: ShellMode): string | undefined {
      return modeHref({ kind: "workspace-root", directory: workspace, mode: "code" }, mode)
    }

    function preferredMode(workspace: string): ShellMode {
      const value = preferences.lastModeByWorkspace[workspace]
      return isMode(value) ? value : "code"
    }

    return {
      modes: visibleModes,
      active,
      select,
      directory,
      sessionId,
      routeKind: () => route().kind,
      pendingMode,
      cancelPendingMode: () => setPendingMode(undefined),
      takePendingMode: () => {
        const value = pendingMode()
        setPendingMode(undefined)
        return value
      },
      hrefFor,
      preferredMode,
    }
  },
})

export { useMode }
export const ModeProvider = ModeContextProvider
