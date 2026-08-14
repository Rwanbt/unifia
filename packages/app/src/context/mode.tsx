import { createMemo, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { createSimpleContext } from "@unifia/ui/context"
import { SHELL_MODES, type ShellMode } from "@unifia/workbench-shell/modes"
import { base64Encode } from "@unifia/util/encode"
import { Persist, persisted } from "@/utils/persist"
import { usePlatform } from "./platform"
import { resolveModeDirectory, routeDirectoryFromPathname, sessionSearchFromLocation } from "./mode-directory"

const isMode = (value: string | undefined): value is ShellMode => !!value && SHELL_MODES.includes(value as ShellMode)

const { use: useMode, provider: ModeContextProvider } = createSimpleContext({
  name: "Mode",
  init: () => {
    const location = useLocation()
    const navigate = useNavigate()
    const platform = usePlatform()
    const routeDirectory = createMemo(() => routeDirectoryFromPathname(location.pathname))
    const directory = createMemo(() => resolveModeDirectory(routeDirectory()))
    const sessionSearch = createMemo(() => sessionSearchFromLocation(location.search))
    const [connection, { refetch: retryConnection }] = createResource(
      () => platform.workbench && directory(),
      async (workspacePath) => {
        if (!platform.workbench || !workspacePath) throw new Error("Workbench bridge is unavailable for this workspace")
        return platform.workbench.connect({ workspacePath, capabilities: ["workspace.read", "workspace.watch", "artifact.export"] })
      },
    )
    onCleanup(() => { void connection()?.revoke() })
    const [store, setStore] = createStore<{ value: ShellMode }>({ value: "code" })
    persisted(Persist.workspace(directory(), "mode"), [store, setStore])

    const active = createMemo<ShellMode>(() => {
      const segment = location.pathname.slice(`/${routeDirectory()}`.length).split("/").filter(Boolean)[0]
      return isMode(segment) ? segment : store.value
    })

    function select(mode: ShellMode): void {
      setStore("value", mode)
      if (mode === "code") {
        navigate(`/${base64Encode(directory())}/session${sessionSearch()}`)
        return
      }
      navigate(`/${base64Encode(directory())}/${mode}${sessionSearch()}`)
    }

    return { modes: SHELL_MODES, active, select, directory, connection, retryConnection }
  },
})

export { useMode }
export const ModeProvider = ModeContextProvider
