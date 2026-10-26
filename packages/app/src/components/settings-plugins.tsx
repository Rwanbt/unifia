/* SPDX-License-Identifier: MIT */
// Extensions > Plugins: the on-device toolchains and containers. Android only, since the desktop app runs the
// user's own tools; dialog-settings.tsx lists the page only there.
import type { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { SettingsDevEnvironment } from "./settings-dev-environment"
import { SettingsPage } from "./settings-page"

export const SettingsPlugins: Component = () => {
  const language = useLanguage()
  return (
    <SettingsPage
      title={language.t("settings.fork.plugins.title")}
      subtitle={language.t("settings.fork.devEnvironment.description")}
    >
      <SettingsDevEnvironment />
    </SettingsPage>
  )
}
