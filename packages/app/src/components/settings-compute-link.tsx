/* SPDX-License-Identifier: MIT */

import { Button } from "@unifia/ui/button"
import { useLanguage } from "@/context/language"
import { useSettingsScope } from "./settings-scope"

/** The reference's `.compute-moved-guide`: remote access now lives on the
 * Compute page (ADR-047), so General points there. */
export function SettingsComputeLink() {
  const language = useLanguage()
  const settings = useSettingsScope()

  return (
    <div data-slot="settings-compute-link">
      <div data-slot="settings-compute-link-icon" aria-hidden="true">
        ▣
      </div>
      <div data-slot="settings-compute-link-copy">
        <b>{language.t("settings.general.computeLink.title")}</b>
        <p>{language.t("settings.general.computeLink.description")}</p>
      </div>
      <Button size="small" onClick={() => settings.openPage("remote")}>
        {language.t("settings.general.computeLink.open")}
      </Button>
    </div>
  )
}
