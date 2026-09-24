import { Button } from "@unifia/ui/button"
import { Icon } from "@unifia/ui/icon"
import { Popover } from "@unifia/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { createHoverIntent } from "@/shell/hover-intent"

const Body = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverBody })))

export function StatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  // #serverBtn: hovering peeks the compute popover, a click pins it.
  const hover = createHoverIntent({ open: () => setShown(true), close: () => setShown(false), isOpen: shown })
  let pressed = false
  const openChange = (next: boolean) => {
    const click = pressed
    pressed = false
    // The click that lands on a peeked popover pins it instead of closing it.
    if (!next && click && hover.peeking()) {
      hover.pin()
      return
    }
    if (!next) hover.reset()
    setShown(next)
  }
  const ready = createMemo(() => server.healthy() === false || sync.data.mcp_ready)
  const healthy = createMemo(() => {
    const serverHealthy = server.healthy() === true
    const mcp = Object.values(sync.data.mcp ?? {})
    const issue = mcp.some((item) => item.status !== "connected" && item.status !== "disabled")
    return serverHealthy && !issue
  })

  return (
    <Popover
      open={shown()}
      onOpenChange={openChange}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        "data-v110": "top-server",
        class: "titlebar-icon w-8 h-[31px] p-0 box-border",
        "aria-label": language.t("status.popover.trigger"),
        style: { scale: 1 },
        onPointerEnter: hover.enterTrigger,
        onPointerLeave: hover.leaveTrigger,
        onPointerDown: () => {
          pressed = true
        },
      }}
      trigger={
        <div class="relative size-4">
          <div class="badge-mask-tight size-4 flex items-center justify-center">
            <Icon name={shown() ? "status-active" : "status"} size="small" />
          </div>
          <div
            classList={{
              "absolute -top-px -right-px size-1.5 rounded-full": true,
              "bg-icon-success-base": ready() && healthy(),
              "bg-icon-critical-base": server.healthy() === false || (ready() && !healthy()),
              "bg-border-weak-base": server.healthy() === undefined || !ready(),
            }}
          />
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-168}
    >
      <Show when={shown()}>
        <Suspense
          fallback={
            <div class="w-[360px] h-14 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]" />
          }
        >
          <div onPointerEnter={hover.enterPanel} onPointerLeave={hover.leavePanel}>
            <Body shown={shown} />
          </div>
        </Suspense>
      </Show>
    </Popover>
  )
}
