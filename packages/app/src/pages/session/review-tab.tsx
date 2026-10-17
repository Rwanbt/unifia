import { createEffect, onCleanup, type JSX } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileDiff } from "../../types/sdk-shim"
import { SessionReview } from "@unifia/ui/session-review"
import type {
  SessionReviewCommentActions,
  SessionReviewCommentDelete,
  SessionReviewCommentUpdate,
} from "@unifia/ui/session-review"
import type { SelectedLineRange } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import type { LineComment } from "@/context/comments"

export type DiffStyle = "unified" | "split"

export interface SessionReviewTabProps {
  title?: JSX.Element
  empty?: JSX.Element
  diffs: () => FileDiff[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  diffStyle: DiffStyle
  onDiffStyleChange?: (style: DiffStyle) => void
  onViewFile?: (file: string) => void
  onLineComment?: (comment: { file: string; selection: SelectedLineRange; comment: string; preview?: string }) => void
  onLineCommentUpdate?: (comment: SessionReviewCommentUpdate) => void
  onLineCommentDelete?: (comment: SessionReviewCommentDelete) => void
  lineCommentActions?: SessionReviewCommentActions
  comments?: LineComment[]
  focusedComment?: { file: string; id: string } | null
  onFocusedCommentChange?: (focus: { file: string; id: string } | null) => void
  focusedFile?: string
  onScrollRef?: (el: HTMLDivElement) => void
  commentMentions?: {
    items: (query: string) => string[] | Promise<string[]>
  }
  classes?: {
    root?: string
    header?: string
    container?: string
  }
}

export function SessionReviewTab(props: SessionReviewTabProps) {
  let scroll: HTMLDivElement | undefined
  let restoreFrame: number | undefined
  let userInteracted = false
  // A transient content collapse (a diff refresh, or the review's mount window
  // swapping diffs for placeholders) clamps the viewport's scrollTop to the
  // top before the reader moved anywhere. Keep the saved anchor alive through
  // that clamp and re-apply it once the content is scrollable again, even
  // when the reader had already scrolled in this session (#736).
  let clampRestore = false
  let restored: { x: number; y: number } | undefined

  const sdk = useSDK()
  const layout = useLayout()

  const readFile = async (path: string) => {
    return sdk.client.file
      .read({ path })
      .then((x) => x.data)
      .catch((error) => {
        console.debug("[session-review] failed to read file", { path, error })
        return undefined
      })
  }

  const handleInteraction = () => {
    userInteracted = true
    // A real gesture supersedes a pending clamp repair: the reader is driving.
    clampRestore = false

    if (restoreFrame !== undefined) {
      cancelAnimationFrame(restoreFrame)
      restoreFrame = undefined
    }
  }

  const doRestore = () => {
    restoreFrame = undefined
    const el = scroll
    if (!el || !layout.ready()) return
    if (userInteracted && !clampRestore) return
    if (el.clientHeight === 0 || el.clientWidth === 0) return

    const s = props.view().scroll("review")
    if (!s || (s.x === 0 && s.y === 0)) return

    // The viewport cannot scroll yet (content still mounting): defer the
    // restore and let the next diff render re-queue it.
    if (el.scrollHeight <= el.clientHeight) return

    const maxY = Math.max(0, el.scrollHeight - el.clientHeight)
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth)

    const targetY = Math.min(s.y, maxY)
    const targetX = Math.min(s.x, maxX)
    const full = targetY === s.y && targetX === s.x

    if (el.scrollTop === targetY && el.scrollLeft === targetX) {
      if (full) clampRestore = false
      return
    }

    if (el.scrollTop !== targetY) el.scrollTop = targetY
    if (el.scrollLeft !== targetX) el.scrollLeft = targetX
    restored = { x: el.scrollLeft, y: el.scrollTop }
    // A clamped (partial) restore keeps the repair armed: later diff renders
    // re-queue it until the content can hold the anchor again.
    if (full) clampRestore = false
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return
    if (userInteracted && !clampRestore) return
    restoreFrame = requestAnimationFrame(doRestore)
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const el = event.currentTarget
    const prev = restored
    if (prev && el.scrollTop === prev.y && el.scrollLeft === prev.x) {
      restored = undefined
      return
    }

    // Not scrollable: the offset is a browser clamp while the content
    // collapses or rebuilds, not a reader's gesture. Ignore it so the saved
    // anchor survives, and arm a one-shot restore for when the content is
    // back (#736).
    if (el.scrollHeight <= el.clientHeight) {
      clampRestore = true
      return
    }

    restored = undefined
    handleInteraction()
    if (!layout.ready()) return
    if (el.clientHeight === 0 || el.clientWidth === 0) return

    props.view().setScroll("review", {
      x: el.scrollLeft,
      y: el.scrollTop,
    })
  }

  createEffect(() => {
    props.diffs().length
    props.diffStyle
    if (!layout.ready()) return
    queueRestore()
  })

  onCleanup(() => {
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return (
    <SessionReview
      title={props.title}
      empty={props.empty}
      scrollRef={(el) => {
        scroll = el
        makeEventListener(el, "wheel", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "mousewheel", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "pointerdown", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "touchstart", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "keydown", handleInteraction, { capture: true })
        props.onScrollRef?.(el)
        queueRestore()
      }}
      onScroll={handleScroll}
      onDiffRendered={queueRestore}
      open={props.view().review.open()}
      onOpenChange={props.view().review.setOpen}
      classes={{
        root: props.classes?.root ?? "pr-3",
        header: props.classes?.header ?? "px-3",
        container: props.classes?.container ?? "pl-3",
      }}
      diffs={props.diffs()}
      diffStyle={props.diffStyle}
      onDiffStyleChange={props.onDiffStyleChange}
      onViewFile={props.onViewFile}
      focusedFile={props.focusedFile}
      readFile={readFile}
      onLineComment={props.onLineComment}
      onLineCommentUpdate={props.onLineCommentUpdate}
      onLineCommentDelete={props.onLineCommentDelete}
      lineCommentActions={props.lineCommentActions}
      lineCommentMention={props.commentMentions}
      comments={props.comments}
      focusedComment={props.focusedComment}
      onFocusedCommentChange={props.onFocusedCommentChange}
    />
  )
}
