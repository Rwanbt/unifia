/* SPDX-License-Identifier: MIT */

// Settings scope and detail level -- the reference's "Pour : Moi / Projet"
// select and "Affichage : Guidé / Détails techniques" switch (ADR-047).
// "Moi" writes the global config, "Projet" the open project's config; the
// detail level only shows or hides technical explanations, never a control.

import { createContext, createSignal, useContext, type Accessor, type ParentProps } from "solid-js"
import type { Config } from "@/types/sdk-shim"
import { useSDK } from "@/context/sdk"

export type SettingsScope = "personal" | "project"
export type SettingsDetail = "guided" | "technical"

type SettingsScopeValue = {
  scope: Accessor<SettingsScope>
  setScope: (scope: SettingsScope) => void
  detail: Accessor<SettingsDetail>
  setDetail: (detail: SettingsDetail) => void
  config: {
    get: () => Promise<Config>
    update: (config: Config) => Promise<void>
  }
}

const SettingsScopeContext = createContext<SettingsScopeValue>()

const unwrap = async <T,>(request: Promise<{ data?: T; error?: unknown }>): Promise<T> => {
  const result = await request
  if (result.error) throw result.error instanceof Error ? result.error : new Error(JSON.stringify(result.error))
  return result.data as T
}

export function SettingsScopeProvider(props: ParentProps) {
  const sdk = useSDK()
  const [scope, setScope] = createSignal<SettingsScope>("personal")
  const [detail, setDetail] = createSignal<SettingsDetail>("guided")

  const config = {
    get: () => (scope() === "project" ? unwrap(sdk.client.config.get()) : unwrap(sdk.client.global.config.get())),
    update: async (next: Config) => {
      if (scope() === "project") await unwrap(sdk.client.config.update({ config: next }))
      else await unwrap(sdk.client.global.config.update({ config: next }))
    },
  }

  return (
    <SettingsScopeContext.Provider value={{ scope, setScope, detail, setDetail, config }}>
      {props.children}
    </SettingsScopeContext.Provider>
  )
}

export function useSettingsScope() {
  const value = useContext(SettingsScopeContext)
  if (!value) throw new Error("useSettingsScope must be used inside SettingsScopeProvider")
  return value
}
