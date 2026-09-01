import { createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { createSimpleContext } from "@unifia/ui/context"
import { SHELL_MODES, type ShellMode } from "@unifia/workbench-shell/modes"
import { modeHref, parseModeLocation, sessionAdoptionPath } from "./mode-directory"
import { Persist, persisted } from "@/utils/persist"
import { useWorkspaceWorkbench } from "./workbench/provider"

// ADR-1041 supersedes ADR-1033. SHELL_MODES is still the 4-entry contract
// (check-mode-registry depends on it). The Automate surface is reachable
// from the rail whenever the workspace has `workflow.run` granted; the
// decision is reactive — it tracks the connection's `grants` set so a
// rotation that adds or removes a grant updates the rail on the next
// microtask without a hard navigation.

const { use: useMode, provider: ModeContextProvider } = createSimpleContext({
  name: "Mode",
  init: () => {
    const location = useLocation()
    const navigate = useNavigate()
    const workbench = useWorkspaceWorkbench()
    // DA-UI-01 — the rail hides Automate unless the principal holds
    // `workflow.run` on the active workspace. The memo reads the
    // connection's `grants` (see `useWorkspaceWorkbench`); an empty
    // set is returned before the first `connect` resolves, which is
    // the correct "hidden" posture (an in-flight connection must not
    // flash Automate into the rail before the broker decides).
    const automateAccessible = createMemo<boolean>(() => workbench.grants().has("workflow.run"))
    const visibleModes = createMemo<readonly ShellMode[]>(() =>
      automateAccessible() ? SHELL_MODES : SHELL_MODES.filter((mode) => mode !== "automate"),
    )
    const isMode = (value: string | undefined): value is ShellMode =>
      !!value && SHELL_MODES.includes(value as ShellMode) && (value !== "automate" || automateAccessible())
    const route = createMemo(() => parseModeLocation(location.pathname, location.search, automateAccessible()))
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

    /**
     * Records a session the app just created into the current location.
     *
     * WHY it belongs here: the route is the only carrier that survives a mode
     * change — `modeHref` already forwards `sessionId` both ways. A session
     * created inside a surface and kept in that surface's own signal is
     * invisible to the next mode, which then starts a second conversation for
     * the same project. `replace` because the user did not navigate; the app
     * is naming where it already is.
     */
    function adoptSession(sessionId: string): void {
      const path = sessionAdoptionPath(route(), active(), sessionId)
      if (!path) return
      navigate(path, { replace: true })
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
      adoptSession,
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
