/* SPDX-License-Identifier: MIT */

import { onCleanup, onMount, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { tDesignApproval } from "@/i18n/design-approval"
import { isApprovalModalVisible, type ApprovalState } from "@/pages/workbench/design-approval"

interface ApprovalModalProps {
  state: ApprovalState
  onAllow: () => void
  onDeny: () => void
  onCancel: () => void
  onRerequest: () => void
}

export function ApprovalModal(props: ApprovalModalProps): JSX.Element {
  return (
    <Show when={isApprovalModalVisible(props.state)}>
      {/* Mounted only while visible, so the focus work below has a mount and
          an unmount to hang on. */}
      <ApprovalDialog {...props} />
    </Show>
  )
}

// A dialog that declares aria-modal but owns neither focus nor Escape is modal
// in name only. INTERACTIONS.md asks overlays for "modals avec focus-trap et
// retour focus": focus enters the dialog, Tab cannot leave it, Escape runs the
// dismissal the user can see, and closing hands focus back to whatever opened
// it. (#553 criterion 5)
function ApprovalDialog(props: ApprovalModalProps): JSX.Element {
  const language = useLanguage()
  let box: HTMLDivElement | undefined
  let returnTo: HTMLElement | undefined

  const reachable = (): HTMLElement[] => {
    if (!box) return []
    const found = box.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    // A disabled or hidden control is not a Tab stop, so it must not become
    // the wrap target either.
    return Array.from(found).filter((item) => item.getClientRects().length > 0)
  }

  onMount(() => {
    const active = document.activeElement
    // <body> means no control was in charge when the modal opened; restoring
    // to it is a no-op dressed up as a focus return.
    returnTo = active instanceof HTMLElement && active !== document.body ? active : undefined
    box?.focus()
  })
  onCleanup(() => {
    const node = returnTo
    returnTo = undefined
    if (node && document.contains(node)) node.focus()
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // The visible cancel action, and a no-op while a decision is already in
      // flight (design-approval.ts accepts it only from approval-required).
      event.preventDefault()
      props.onCancel()
      return
    }
    if (event.key !== "Tab") return
    const stops = reachable()
    if (stops.length === 0) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    const active = document.activeElement
    if (event.shiftKey) {
      if (active === first || active === box) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={(element) => {
        box = element
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="design-approval-title"
      data-design-approval-modal={props.state.kind}
      data-design-approval-expired={
        props.state.kind === "approval-required" && props.state.expired ? "true" : "false"
      }
      tabindex="-1"
      onKeyDown={onKeyDown}
      class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 outline-none"
    >
      <div class="w-full max-w-md rounded-lg border border-border-base bg-background-base p-5 shadow-xl">
        <h2 id="design-approval-title" class="text-16-medium text-text-base">
          {tDesignApproval(language.locale(), "title")}
        </h2>
        <Show when={props.state.kind === "approval-required" ? props.state : null}>
          {(s) => (
            <>
              <p class="mt-2 text-13-regular text-text-weak" data-design-approval-id={s().approvalId}>
                {tDesignApproval(language.locale(), "description", { capability: s().capability })}
              </p>
              <Show when={s().expired}>
                <p
                  data-design-approval-expired-warning
                  class="mt-2 rounded border border-border-warning bg-background-warning/30 p-2 text-12-regular text-text-warning"
                >
                  {tDesignApproval(language.locale(), "expiredWarning")}
                </p>
              </Show>
              <p class="mt-2 text-11-regular text-text-weak" data-design-approval-deadline>
                {tDesignApproval(language.locale(), "expiresAt")}
                {new Date(s().expiresAt).toLocaleTimeString()}
              </p>
            </>
          )}
        </Show>
        <Show when={props.state.kind === "resolving"}>
          <p class="mt-2 text-13-regular text-text-weak">{tDesignApproval(language.locale(), "resolving")}</p>
        </Show>
        <ApprovalActions {...props} />
      </div>
    </div>
  )
}

function ApprovalActions(props: ApprovalModalProps): JSX.Element {
  const language = useLanguage()
  return (
    <div class="mt-4 flex flex-wrap justify-end gap-2">
      {/* An expired approval gets its own pair of actions. The first
                version hid every button here, leaving a full-screen modal
                with a warning and no way out — and the pending request on
                the server with it. */}
      <Show when={props.state.kind === "approval-required" && props.state.expired}>
        <button
          type="button"
          data-design-approval-action="cancel"
          class="rounded border border-border-base px-3 py-1.5 text-12-medium"
          onClick={() => props.onCancel()}
        >
          {tDesignApproval(language.locale(), "cancel")}
        </button>
        <button
          type="button"
          data-design-approval-action="rerequest"
          class="rounded border border-border-focus bg-background-focus px-3 py-1.5 text-12-medium text-text-inverse"
          onClick={() => props.onRerequest()}
        >
          {tDesignApproval(language.locale(), "rerequest")}
        </button>
      </Show>
      <Show when={props.state.kind === "approval-required" && !props.state.expired}>
        <button
          type="button"
          data-design-approval-action="deny"
          class="rounded border border-border-base px-3 py-1.5 text-12-medium"
          onClick={() => props.onDeny()}
        >
          {tDesignApproval(language.locale(), "deny")}
        </button>
        <button
          type="button"
          data-design-approval-action="cancel"
          class="rounded border border-border-base px-3 py-1.5 text-12-medium"
          onClick={() => props.onCancel()}
        >
          {tDesignApproval(language.locale(), "cancel")}
        </button>
        <button
          type="button"
          data-design-approval-action="allow"
          class="rounded border border-border-focus bg-background-focus px-3 py-1.5 text-12-medium text-text-inverse"
          onClick={() => props.onAllow()}
        >
          {tDesignApproval(language.locale(), "allow")}
        </button>
      </Show>
    </div>
  )
}
