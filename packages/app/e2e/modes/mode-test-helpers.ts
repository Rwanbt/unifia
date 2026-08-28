/* SPDX-License-Identifier: MIT */

import { expect, type Locator, type Page } from "@playwright/test"

/**
 * C4a / C4b2 — helpers partagés pour piloter le rail de modes.
 *
 * Trois pièges que ces helpers ferment, chacun ayant produit un faux résultat
 * pendant l'investigation du 2026-08-28 :
 *
 *  1. **Deux rails sont rendus.** `layout.tsx` monte `sidebarContent()` (desktop)
 *     ET `sidebarContent(true)` (mobile), donc le document contient huit boutons
 *     de mode pour quatre modes. Au viewport desktop un seul est visible, le
 *     bloc mobile étant sous `<div class="xl:hidden">`. C'est un invariant à
 *     préserver, pas un défaut : quiconque retire `xl:hidden` casse tous les
 *     sélecteurs de rail. `visibleRail` le rend explicite et le fait échouer
 *     bruyamment.
 *  2. **L'`aria-label` est localisé** (`aria-label={props.modeLabel(mode)}`).
 *     `data-mode` est le contrat technique ; le repli par nom accessible ne
 *     sert qu'à exécuter le même spec contre la baseline, qui n'a pas encore
 *     l'attribut.
 *  3. **Code n'a pas de surface Workbench.** Son oracle est composé.
 */

export const MODES = ["code", "work", "design", "automate"] as const
export type ModeName = (typeof MODES)[number]

/** Noms accessibles connus, EN et FR. Repli baseline uniquement. */
const LEGACY_RAIL_NAME: Record<ModeName, RegExp> = {
  code: /^(code mode|mode code)$/i,
  work: /^(work mode|mode travail)$/i,
  design: /^(design mode|mode design)$/i,
  automate: /^(automate mode|mode automatisation)$/i,
}

export const DESKTOP_VIEWPORT = { width: 1400, height: 800 } as const

/**
 * Le rail visible, et un seul. L'assertion de cardinalité est le garde-fou de
 * l'invariant `xl:hidden` décrit plus haut.
 */
export function visibleRail(page: Page): Locator {
  return page.locator('[data-component="sidebar-rail"]:visible')
}

export async function expectSingleVisibleRail(page: Page): Promise<void> {
  await expect(visibleRail(page)).toHaveCount(1)
}

/** Bouton d'un mode dans le rail visible. `data-mode` d'abord, nom accessible en repli. */
export function modeButton(page: Page, mode: ModeName): Locator {
  const rail = visibleRail(page)
  return rail.locator(`[data-mode="${mode}"]`).or(rail.getByRole("button", { name: LEGACY_RAIL_NAME[mode] }))
}

/**
 * Automate n'est pas garanti présent : `isAutomateSurfaceReachable` dépend du
 * flag dev et de la capability `workflow.run`. Ne jamais coder en dur sa
 * disponibilité — la tester.
 */
export async function hasMode(page: Page, mode: ModeName): Promise<boolean> {
  return (await modeButton(page, mode).count()) > 0
}

export async function availableModes(page: Page): Promise<ModeName[]> {
  const present: ModeName[] = []
  for (const mode of MODES) if (await hasMode(page, mode)) present.push(mode)
  return present
}

/**
 * Prédicat d'arrivée, évalué dans la page. Porte sur la **visibilité**, pas sur
 * la présence dans le DOM : si les surfaces deviennent un jour des composants
 * masqués plutôt que démontés, un test basé sur `querySelector` renverrait
 * 0 ms sans que le clic ait rien produit.
 *
 * Exporté comme source pour être injecté tel quel dans `waitForFunction`.
 */
export const ARRIVED_PREDICATE = (mode: string): boolean => {
  const visible = (el: Element | null): boolean => {
    if (!el) return false
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }
  const surfaces = Array.from(document.querySelectorAll("[data-workbench-surface]"))
  if (mode === "code") {
    // Code est le mode SANS surface Workbench : il n'existe pas de
    // `[data-workbench-surface="code"]`. L'oracle est composé.
    if (surfaces.some(visible)) return false
    return visible(document.querySelector('[data-component="session-workspace"]'))
  }
  return visible(document.querySelector(`[data-workbench-surface="${mode}"]`))
}

export async function hasArrived(page: Page, mode: ModeName): Promise<boolean> {
  return page.evaluate(ARRIVED_PREDICATE, mode)
}

/**
 * Mesure `vrai événement click → surface cible visible`.
 *
 * Le chronomètre démarre sur le `click` DOM réel, capté par un écouteur posé
 * sur le bouton lui-même, et non au début du déplacement de souris de
 * Playwright. Le preload produit déclenché par `mouseenter`/`focus` fait donc
 * partie du comportement mesuré, ce qui est voulu : on mesure l'expérience
 * utilisateur, pas un chargement synthétiquement froid.
 *
 * Le timeout d'observation est large (30 s) pour que la baseline à ~10 s
 * termine réellement : le rouge attendu est un dépassement de budget assumé,
 * jamais un timeout de locator.
 */
export async function measureModeSwitch(page: Page, mode: ModeName, timeout = 30_000): Promise<number> {
  const arrivedBefore = await hasArrived(page, mode)
  expect(arrivedBefore, `la destination "${mode}" est déjà atteinte avant le clic`).toBe(false)

  const button = modeButton(page, mode)
  await expect(button).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as unknown as { __unifiaLat?: { t0: number | null; t1: number | null } }).__unifiaLat = {
      t0: null,
      t1: null,
    }
  })
  await button.evaluate((el) => {
    el.addEventListener(
      "click",
      () => {
        const w = window as unknown as { __unifiaLat: { t0: number | null } }
        w.__unifiaLat.t0 = performance.now()
      },
      { capture: true, once: true },
    )
  })

  await button.click()

  // Le prédicat est inliné plutôt que reconstruit depuis `.toString()` :
  // `new Function` est bloqué par la CSP de l'application (`script-src 'self'
  // 'wasm-unsafe-eval'`), donc un helper « élégant » y échouerait en runtime.
  await page.waitForFunction(
    (target: string) => {
      const w = window as unknown as { __unifiaLat: { t0: number | null; t1: number | null } }
      const visible = (el: Element | null): boolean => {
        if (!el) return false
        const box = el.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      }
      const surfaces = Array.from(document.querySelectorAll("[data-workbench-surface]"))
      const arrived =
        target === "code"
          ? !surfaces.some(visible) && visible(document.querySelector('[data-component="session-workspace"]'))
          : visible(document.querySelector(`[data-workbench-surface="${target}"]`))
      if (!arrived) return false
      if (w.__unifiaLat.t1 === null) w.__unifiaLat.t1 = performance.now()
      return true
    },
    mode,
    { timeout, polling: "raf" },
  )

  return page.evaluate(() => {
    const w = window as unknown as { __unifiaLat: { t0: number | null; t1: number | null } }
    if (w.__unifiaLat.t0 === null || w.__unifiaLat.t1 === null) {
      throw new Error("le clic réel n'a pas été capté : mesure invalide")
    }
    return Math.round(w.__unifiaLat.t1 - w.__unifiaLat.t0)
  })
}
