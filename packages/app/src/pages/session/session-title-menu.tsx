/* SPDX-License-Identifier: MIT */

// Session actions that used to live in the timeline's sticky title bar,
// mounted in the chat head instead. See ADR-042.
import { createMemo, createSignal, Show } from "solid-js"
import { produce } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { Button } from "@unifia/ui/button"
import { Dialog } from "@unifia/ui/dialog"
import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { IconButton } from "@unifia/ui/icon-button"
import { TextField } from "@unifia/ui/text-field"
import { showToast } from "@unifia/ui/toast"
import { useDialog } from "@unifia/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionKey } from "@/pages/session/session-layout"
import { sessionTitle } from "@/utils/session-title"

function requestErrorMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

// Every session id reachable from `root` through parentID links, root included.
export function sessionSubtree(sessions: readonly { id: string; parentID?: string }[], root: string) {
  const byParent = new Map<string, string[]>()
  for (const item of sessions) {
    if (!item.parentID) continue
    byParent.set(item.parentID, [...(byParent.get(item.parentID) ?? []), item.id])
  }
  const removed = new Set<string>([root])
  const stack = [root]
  while (stack.length) {
    for (const child of byParent.get(stack.pop()!) ?? []) {
      if (removed.has(child)) continue
      removed.add(child)
      stack.push(child)
    }
  }
  return removed
}

function useSessionActions() {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const { params } = useSessionKey()

  const leave = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    const target = parentID ?? nextSessionID
    navigate(target ? `/${params.dir}/session/${target}` : `/${params.dir}/session`)
  }

  const neighbour = (list: readonly { id: string }[], sessionID: string) => {
    const index = list.findIndex((s) => s.id === sessionID)
    return index === -1 ? undefined : (list[index + 1] ?? list[index - 1])
  }

  const archive = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return
    const next = neighbour(sync.data.session ?? [], sessionID)
    await sdk.client.session
      .update({ sessionID, time: { archived: Date.now() } })
      .then(() => {
        sync.set(produce((draft) => void (draft.session = draft.session.filter((s) => s.id !== sessionID))))
        leave(sessionID, session.parentID, next?.id)
      })
      .catch((err) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: requestErrorMessage(err, language.t("common.requestFailed")),
        }),
      )
  }

  const remove = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false
    const roots = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const next = neighbour(roots, sessionID)
    const result = await sdk.client.session
      .delete({ sessionID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: requestErrorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    if (!result) return false
    sync.set(
      produce((draft) => {
        const removed = sessionSubtree(draft.session, sessionID)
        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )
    leave(sessionID, session.parentID, next?.id)
    return true
  }

  const rename = (sessionID: string, title: string) =>
    sdk.client.session
      .update({ sessionID, title })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session[index].title = title
          }),
        )
        return true
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: requestErrorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

  const title = (sessionID: string) => sessionTitle(sync.session.get(sessionID)?.title)

  return { archive, remove, rename, title }
}

// dialog.show() mounts its content at the app root, above the session-scoped
// providers (sync, sdk): the dialogs below must not read any context, they
// receive everything from the menu that opened them.
type DialogDeps = { t: ReturnType<typeof useLanguage>["t"]; close: () => void }

function DialogRenameSession(props: DialogDeps & { title: string; onRename: (title: string) => Promise<boolean> }) {
  const [draft, setDraft] = createSignal(props.title)
  const [pending, setPending] = createSignal(false)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const next = draft().trim()
    if (!next || next === props.title) return props.close()
    setPending(true)
    const renamed = await props.onRename(next)
    setPending(false)
    if (renamed) props.close()
  }

  return (
    <Dialog title={props.t("common.rename")} fit>
      <form onSubmit={submit} class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 min-w-[320px]">
        <TextField type="text" value={draft()} onChange={setDraft} autofocus disabled={pending()} />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={props.close}>
            {props.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={pending()}>
            {props.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function DialogDeleteSession(props: DialogDeps & { name: string; onDelete: () => Promise<boolean> }) {
  const confirm = async () => {
    await props.onDelete()
    props.close()
  }

  return (
    <Dialog title={props.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <span class="text-14-regular text-text-strong">{props.t("session.delete.confirm", { name: props.name })}</span>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={props.close}>
            {props.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={confirm}>
            {props.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function SessionSharePopover(props: {
  sessionID: string
  open: boolean
  anchor: () => HTMLElement | undefined
  onOpenChange: (open: boolean) => void
}) {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()
  const shareUrl = createMemo(() => sync.session.get(props.sessionID)?.share?.url)
  const [dismiss, setDismiss] = createSignal<"escape" | "outside" | null>(null)

  const share = useMutation(() => ({
    mutationFn: () => globalSDK.client.session.share({ sessionID: props.sessionID, directory: sdk.directory }),
    onError: (err) => console.error("Failed to share session", err),
  }))
  const unshare = useMutation(() => ({
    mutationFn: () => globalSDK.client.session.unshare({ sessionID: props.sessionID, directory: sdk.directory }),
    onError: (err) => console.error("Failed to unshare session", err),
  }))
  const close = (reason: "escape" | "outside") => {
    setDismiss(reason)
    props.onOpenChange(false)
  }

  return (
    <KobaltePopover
      open={props.open}
      anchorRef={props.anchor}
      placement="bottom-end"
      gutter={4}
      modal={false}
      onOpenChange={(open) => {
        if (open) setDismiss(null)
        props.onOpenChange(open)
      }}
    >
      <KobaltePopover.Portal>
        <KobaltePopover.Content
          data-component="popover-content"
          style={{ "min-width": "320px" }}
          onEscapeKeyDown={(event) => {
            close("escape")
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => close("outside")}
          onFocusOutside={() => close("outside")}
          onCloseAutoFocus={(event) => {
            if (dismiss() === "outside") event.preventDefault()
            setDismiss(null)
          }}
        >
          <div class="flex flex-col p-3">
            <div class="text-13-medium text-text-strong">{language.t("session.share.popover.title")}</div>
            <div class="text-12-regular text-text-weak mt-1">
              {shareUrl()
                ? language.t("session.share.popover.description.shared")
                : language.t("session.share.popover.description.unshared")}
            </div>
            <div class="mt-3 flex flex-col gap-2">
              <Show
                when={shareUrl()}
                fallback={
                  <Button size="large" variant="primary" class="w-full" onClick={() => share.mutate()} disabled={share.isPending}>
                    {share.isPending
                      ? language.t("session.share.action.publishing")
                      : language.t("session.share.action.publish")}
                  </Button>
                }
              >
                {(url) => (
                  <>
                    <TextField value={url()} readOnly copyable copyKind="link" tabIndex={-1} class="w-full" />
                    <div class="grid grid-cols-2 gap-2">
                      <Button
                        size="large"
                        variant="secondary"
                        class="w-full shadow-none border border-border-weak-base"
                        onClick={() => unshare.mutate()}
                        disabled={unshare.isPending}
                      >
                        {unshare.isPending
                          ? language.t("session.share.action.unpublishing")
                          : language.t("session.share.action.unpublish")}
                      </Button>
                      <Button
                        size="large"
                        variant="primary"
                        class="w-full"
                        onClick={() => platform.openLink(url())}
                        disabled={unshare.isPending}
                      >
                        {language.t("session.share.action.view")}
                      </Button>
                    </div>
                  </>
                )}
              </Show>
            </div>
          </div>
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  )
}

export function SessionTitleMenu(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const actions = useSessionActions()
  const deps: DialogDeps = { t: language.t, close: () => dialog.close() }
  // Snapshot the id and title when the dialog opens: deleting navigates away,
  // which unmounts this menu while the dialog is still on screen.
  const openRename = () => {
    const sessionID = props.sessionID
    const title = actions.title(sessionID) ?? ""
    dialog.show(() => (
      <DialogRenameSession {...deps} title={title} onRename={(next) => actions.rename(sessionID, next)} />
    ))
  }
  const openDelete = () => {
    const sessionID = props.sessionID
    const name = actions.title(sessionID) ?? language.t("command.session.new")
    dialog.show(() => <DialogDeleteSession {...deps} name={name} onDelete={() => actions.remove(sessionID)} />)
  }
  const shareEnabled = createMemo(() => sync.data.config?.share !== "disabled")
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [shareOpen, setShareOpen] = createSignal(false)
  // Kobalte restores focus to the trigger when the menu closes; opening the
  // share popover in the same tick would be dismissed by that focus move.
  let pendingShare = false
  let trigger: HTMLButtonElement | undefined

  return (
    <>
      <DropdownMenu gutter={4} placement="bottom-end" open={menuOpen()} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          data-v110="session-menu"
          classList={{ "bg-surface-base-active": shareOpen() }}
          aria-label={language.t("common.moreOptions")}
          aria-expanded={menuOpen() || shareOpen()}
          ref={(el: HTMLButtonElement) => (trigger = el)}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            style={{ "min-width": "104px" }}
            onCloseAutoFocus={(event) => {
              if (!pendingShare) return
              pendingShare = false
              event.preventDefault()
              requestAnimationFrame(() => setShareOpen(true))
            }}
          >
            <DropdownMenu.Item onSelect={openRename}>
              <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <Show when={shareEnabled()}>
              <DropdownMenu.Item onSelect={() => (pendingShare = true)}>
                <DropdownMenu.ItemLabel>{language.t("session.share.action.share")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Item onSelect={() => void actions.archive(props.sessionID)}>
              <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={openDelete}>
              <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <SessionSharePopover
        sessionID={props.sessionID}
        open={shareOpen()}
        anchor={() => trigger}
        onOpenChange={setShareOpen}
      />
    </>
  )
}

export function SessionParentBack(props: { parentID: string }) {
  const navigate = useNavigate()
  const language = useLanguage()
  const { params } = useSessionKey()
  return (
    <IconButton
      icon="arrow-left"
      variant="ghost"
      size="small"
      onClick={() => navigate(`/${params.dir}/session/${props.parentID}`)}
      aria-label={language.t("common.goBack")}
    />
  )
}
