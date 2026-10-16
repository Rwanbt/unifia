import { type Component, For, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@unifia/ui/icon"
import type { ImageAttachmentPart } from "@/context/prompt"

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

const fallbackClass = "size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base"
const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center transition-opacity hover:bg-surface-raised-base-hover"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  // Tailwind puts every `hover:` variant behind `@media (hover: hover)`, so a
  // pointer that cannot hover would never reveal the remove control. Same
  // treatment as the file tree node actions (file-tree-actions.tsx): the
  // keyboard focus reveals it, and it stays visible where nothing can hover.
  const isTouch = createMediaQuery("(hover: none)")

  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <For each={props.attachments}>
          {(attachment) => (
            <div class="relative group">
              <Show
                when={attachment.mime.startsWith("image/")}
                fallback={
                  <div class={fallbackClass}>
                    <Icon name="folder" class="size-6 text-text-weak" />
                  </div>
                }
              >
                <img
                  src={attachment.dataUrl}
                  alt={attachment.filename}
                  class={imageClass}
                  onClick={() => props.onOpen(attachment)}
                />
              </Show>
              <button
                type="button"
                onClick={() => props.onRemove(attachment.id)}
                class={removeClass}
                classList={{
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100": !isTouch(),
                  "opacity-60": isTouch(),
                }}
                aria-label={props.removeLabel}
              >
                <Icon name="close" class="size-3 text-text-weak" />
              </button>
              <div class={nameClass}>
                <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
