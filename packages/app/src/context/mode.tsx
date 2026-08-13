import { createMemo, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createSimpleContext } from "@unifia/ui/context"
import { SHELL_MODES, type ShellMode } from "@unifia/workbench-shell/modes"
import { base64Encode } from "@unifia/util/encode"
import { Persist, persisted } from "@/utils/persist"

const isMode = (value: string | undefined): value is ShellMode => !!value && SHELL_MODES.includes(value as ShellMode)

const { use: useMode, provider: ModeContextProvider } = createSimpleContext({
  name: "Mode",
  init: () => {
    const params = useParams()
    const location = useLocation()
    const navigate = useNavigate()
    const directory = createMemo(() => params.dir ?? "")
    const [store, setStore] = createStore<{ value: ShellMode }>({ value: "code" })
    persisted(Persist.workspace(directory(), "mode"), [store, setStore])

    const active = createMemo<ShellMode>(() => {
      const segment = location.pathname.slice(`/${directory()}`.length).split("/").filter(Boolean)[0]
      return isMode(segment) ? segment : store.value
    })

    function select(mode: ShellMode): void {
      setStore("value", mode)
      if (mode === "code") {
        navigate(`/${base64Encode(directory())}/session`)
        return
      }
      navigate(`/${base64Encode(directory())}/${mode}`)
    }

    return { modes: SHELL_MODES, active, select, directory }
  },
})

export { useMode }
export const ModeProvider = ModeContextProvider
