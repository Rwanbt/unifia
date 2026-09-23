import type { Component, JSX } from "solid-js"

export const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div data-v110="settings-section" class="bg-surface-base px-4 rounded-lg">{props.children}</div>
}
