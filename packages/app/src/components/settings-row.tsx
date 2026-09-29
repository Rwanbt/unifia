import type { Component, JSX } from "solid-js"

export interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

export const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div
      data-v110="setting-row"
      class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap"
    >
      <div data-slot="setting-copy" class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span data-slot="setting-name" class="text-14-medium text-text-strong">
          {props.title}
        </span>
        <span data-slot="setting-desc" class="text-12-regular text-text-weak">
          {props.description}
        </span>
      </div>
      <div data-slot="setting-control" class="flex w-full justify-end sm:w-auto sm:shrink-0">
        {props.children}
      </div>
    </div>
  )
}
