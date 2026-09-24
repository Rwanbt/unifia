/* SPDX-License-Identifier: MIT */

// The account centre's data (ADR-051): the collaborative identity, the
// Console organisations and this device's connection. Every page reads it
// from here so the four pages never disagree.

import { createMemo, createResource, createSignal } from "solid-js"
import { showToast } from "@unifia/ui/toast"
import { useCollaborativeAuth } from "@/context/collaborative-auth"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { accountIdentity, osName } from "./account-identity"

export type ConsoleOrg = {
  accountID: string
  accountEmail: string
  orgID: string
  orgName: string
  active: boolean
}

export function useAccount() {
  const auth = useCollaborativeAuth()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const [switching, setSwitching] = createSignal<string>()

  const identity = createMemo(() => accountIdentity(auth.current()?.user))

  const [orgs, { refetch }] = createResource(async (): Promise<ConsoleOrg[]> => {
    const result = await globalSDK.client.experimental.console.listOrgs()
    return result.error ? [] : (result.data?.orgs ?? [])
  })
  const orgList = () => orgs.latest ?? []
  const activeOrg = () => orgList().find((org) => org.active)

  async function switchOrg(org: ConsoleOrg) {
    setSwitching(org.orgID)
    try {
      const result = await globalSDK.client.experimental.console.switchOrg({
        accountID: org.accountID,
        orgID: org.orgID,
      })
      if (result.error) throw new Error(JSON.stringify(result.error))
      await refetch()
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSwitching(undefined)
    }
  }

  const device = createMemo(() => ({
    kind: platform.platform,
    os: osName(platform.os),
    server: server.name,
  }))

  return {
    auth,
    identity,
    orgs: orgList,
    orgsLoaded: () => orgs.latest !== undefined,
    activeOrg,
    switchOrg,
    switching,
    device,
    projectCount: () => layout.projects.list().length,
  }
}

export type Account = ReturnType<typeof useAccount>
