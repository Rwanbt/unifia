/* SPDX-License-Identifier: MIT */

import { Show, type JSX } from "solid-js"
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
  const language = useLanguage()
  return (
    <Show when={isApprovalModalVisible(props.state)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-approval-title"
        data-design-approval-modal={props.state.kind}
        data-design-approval-expired={
          props.state.kind === "approval-required" && props.state.expired ? "true" : "false"
        }
        class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
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
    </Show>
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
