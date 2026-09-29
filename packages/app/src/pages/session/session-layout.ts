import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { useMode } from "@/context/mode"

export const useSessionKey = () => {
  const routeParams = useParams()
  const mode = useMode()
  // The session route (`/:dir/session/:id?`) carries the session in the
  // path; every other mode route (`/:dir/:mode`) carries it in `?session=`
  // instead (see modeHref, context/mode-directory.ts). `mode.sessionId()`
  // already resolves both shapes uniformly -- falling back to it here (once)
  // means every existing `params.id` read in session.tsx works unmodified
  // regardless of which route rendered the page, instead of threading a
  // second session-id source through call site.
  const params = {
    get dir() {
      return routeParams.dir
    },
    get id() {
      return routeParams.id ?? mode.sessionId()
    },
  }
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  return { params, sessionKey }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const { params, sessionKey } = useSessionKey()
  return {
    params,
    sessionKey,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey)),
  }
}
