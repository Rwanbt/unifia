<!-- SPDX-License-Identifier: MIT -->

# PLAN — Portage visuel **pixel-perfect** de la maquette v110 (UI/UX)

> **Statut** : PROPOSÉ — à reviewer par plusieurs IA puis à valider par le propriétaire (D5).
> **Suivi GitHub** : issue **#116** (review multi-IA + tracking des slices).
> **Plans antérieurs** (contexte, remplacés par celui-ci pour la partie visuelle) : vault `roadmaps/Plan-Parite-Complete-Design-2026-08-20.md`, `roadmaps/Plan-Correction-Design-MiniMax-M3-2026-08-27.md`.
> **Date** : 2026-09-17.
> **Autorité d'apparence** : `docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html` (2,4 Mo, gelée 2026-09-10) — **jamais modifiée**.
> **Branche de travail** : `new-ui` (worktree `_a7-automate-memory`), base `work-design` (post-#115). PR par slice vers `work-design`.
> **Autorités secondaires** : `INTERACTIONS.md` (comportement), `RESPONSIVE-MATRIX.md` (viewports), `VISUAL-GATES.md` (gates, à amender v2), `ADR-038` (périmètre parité visuelle, à réviser), `ADR-039` (document Design — à ne pas casser), `ADR-1033` (conflit connu, voir D1/D2).

---

## 0. Constat factuel qui déclenche ce plan

Mesuré le 2026-09-17 sur l'app compilée (`new-ui`, `work-design` post-promotion) :

- Accueil app : « Créez ce que vous voulez » + composer-bar, rail 3 icônes, topbar recherche.
- Accueil maquette : hero U + « Commencer avec Unifia » + composer-carte + chips modes + cartes projets + topbar « ● Auto · 2 ».
- **0 occurrence** dans `packages/app/src` de : `Commencer avec`, `Aucun projet ouvert`, `home-mode-pill`, placeholder home de la maquette.
- Ce qui existe côté apparence = chrome CSS (`v110.css`, 932 l. : bordures/fonds/hover/focus) + marqueurs `[data-v110]` + tokens partiels. Audit v110 : 7,5/10, matrice cartésienne **NO-GO**, « tolérances documentées ».
- Conclusion : la campagne a livré de la parité **fonctionnelle** et du **chrome** ; l'**identité visuelle** de la maquette (écrans, composition, proportions, typographie) n'a **jamais été implémentée**. Ce plan la livre, et la vérifie au pixel.

---

## 1. Définition mesurable de « pixel-perfect »

« Pixel-perfect » = sortie mesurable, pas une intention.

**Instrument** : captures comparées app ↔ maquette (Chromium, DPR 1× **et** 2×, viewports de `RESPONSIVE-MATRIX.md`), différenciées par `odiff` (fallback `pixelmatch`).

**Métriques par cas** :
| Métrique | Définition | Seuil de sortie |
|---|---|---|
| `diffRatio` | pixels différents / pixels totaux | ≤ 0,10 % (≤ 0,05 % sur home, shell, composer) |
| `movedRegions` | régions déplacées de > 2 px (match d'images) | == 0 |
| `structuralMiss` | élément maquette sans équivalent app (checklist §13) | == 0 |

**Exceptions admises (liste exhaustive — seule tolérance)** :
1. Contenu dynamique : horodatages relatifs, chemins absolus, hash de commit, branches.
2. Curseur/clignotement de saisie, focus ring clavier (invisible hors interaction).
3. Barres de défilement natives (largeur/rendu OS).
4. Sous-pixel des ombres GPU si le diff reste < 1 px et ≤ seuil global.
5. Rendu de police : **identiques car même fichier Inter packagé des deux côtés** (§2) — sinon PAS d'exception.

**Règle de progression** : chaque slice publie son `diffRatio` ; la courbe doit être **décroissante** (jamais de régression d'un cas déjà passé).

---

## 2. Prérequis techniques (traités en S0/S1)

1. **Police Inter packagée** : la maquette déclare `font-family: Inter, ui-sans-serif, …`. Le dossier `packages/ui/src/assets/fonts/` est **vide** → rendre déterministe : embarquer `Inter` (woff2, SIL OFL) dans le repo, la charger dans l'app **et** l'injecter dans la capture de référence (même fichiers, mêmes `font-feature-settings`). Sans cela, le pixel-perfect est impossible.
2. **Tokens transcrits littéralement** depuis le `:root` de la maquette (source exacte) :
   `--bg:#0e0e10; --bg-soft:#121214; --surface:#161618; --surface-2:#1b1b1e; --surface-3:#212125; --surface-4:#26262b; --hover:#2a2a2f; --text:#f2f2f3; --muted:#9b9ba1; --faint:#6b6b72; --line:rgba(255,255,255,.07); --line-strong:rgba(255,255,255,.12); --shadow:0 12px 30px rgba(0,0,0,.18); --radius-xl:18px; --radius-lg:15px; --radius-md:12px; --radius-sm:10px; --success:#8aca9a; --warning:#d7ae74; --danger:#df848a; --info:#b1b5bd; --topbar:48px; --rail:78px; --context:248px; --inspector:300px`.
   Test unitaire d'égalité valeur-par-valeur (source unique, pas de recopie dans deux fichiers).
3. **Données figées** : fixtures e2e existantes (`installWorkbenchMock`, `seedStorage`, `directory`) pour la capture app ; snapshot déterministe pour la maquette (horloge gelée, `Math.random` seedé, animations off : `data-ui-animations=off` + `prefers-reduced-motion: reduce`).

---

## 3. Harnais visuel (S0) — l'instrument avant le travail

Nouveau dossier `packages/app/scripts/visual-gate/` :

| Script | Rôle |
|---|---|
| `capture-reference.mjs` | Playwright, `file://` maquette, pilotage des vues via `.rail-btn[data-mode]` / `.home-mode-pill` / `#view-*`, injection Inter, freeze données/animations, screenshots `visual/reference/<case>.png` (DPR 1×/2×) |
| `capture-app.mjs` | Playwright sur le build app + fixtures e2e, **mêmes** viewports/données/freeze, `visual/current/<case>.png` |
| `diff.mjs` | odiff → `visual/report/<case>.json` (`diffRatio`, `movedRegions`), heatmap `visual/report/<case>.diff.png` |
| `visual/config.json` | liste des cas + seuils + exceptions par cas (versionné) |
| `e2e/v110/visual-parity.spec.ts` | orchestre les 3 étapes ; non bloquant jusqu'à S2, **bloquant ensuite** (CI) |

**Cas initiaux (12)** : home ×5 viewports ; session/chat ×5 ; + code, design, work, memory, settings, user (desktop-large) ; états : vide / chargé / panneau ouvert / mobile.
**Baseline** : générée en S0, versionnée ; toute PR visuelle fournit capture côte à côte + JSON de diff.

---

## 4. Architecture cible (5 couches, une seule source par couche)

1. **Tokens + polices** — transcription exacte (§2), échelle typographique et d'espacement lues dans la maquette.
2. **Primitives UI** — boutons, chips, cartes, champs, onglets, séparateurs, tooltips : style maquette, API app.
3. **Chrome shell** — topbar (wordmark, « ● Auto · 2 », toggle thème), rail (icônes + tooltips, état actif, `--rail:78px`), workspace-tabs, context (`--context`), inspector (`--inspector`), resizers, layout switch.
4. **Surfaces** — home, session/chat, code, work, design, automate, browser, memory, settings, user.
5. **Motion** — durées/easings de la maquette, `prefers-reduced-motion` = 0 mouvement.

**Règles d'ingénierie** (héritées du repo, non négociables) : un fichier ≤ 800 LOC (refactor à 1500), fonction ≤ 50 LOC, pas de `!important` nouveau (garde existante documentée uniquement), pas de duplication de tokens, aucune donnée factice, aucune régression fonctionnelle (suite complète verte à chaque PR), toute copy passe par l'i18n (17 locales).

---

## 5. Slices autonomes S0 → S14

| # | Objectif | Ancrages maquette | Fichiers (cible) | Preuves | PR |
|---|---|---|---|---|---|
| **S0** | Harnais visuel + baseline chiffrée | `#view-*`, `.rail-btn`, `.home-mode-pill` | `scripts/visual-gate/*`, `e2e/v110/visual-parity.spec.ts`, `visual/**` | baseline 12 cas + rapport initial | 2 |
| **S1** | Tokens + Inter + échelle typo | `:root` (valeurs §2), `--sans` | `src/styles/v110-tokens.css` (nouveau, source unique), `packages/ui/src/assets/fonts/inter/**` | test unitaire tokens ; diff typo sur home | 2 |
| **S2** | Accueil maquette | hero U, chip « Aucun projet ouvert », titre/sous-titre, composer-carte, chips modes, cartes projets, footer hint | nouveau `src/pages/home/**` (route d'entrée), `workspace-tabs` | e2e home + captures 5 viewports ≤ 0,05 % | 3 |
| **S3** | Shell identité | topbar, rail (`.rail-btn`, `.label{display:none}`, `.tip`), tabs bar, context/inspector | `src/pages/layout.tsx`, `src/shell/*`, `v110-shell.css` | e2e shell + diff ≤ 0,05 % | 3–4 |
| **S4** | Session / chat | timeline, docks (followup/revert), composer, états vides | `src/pages/session/**` | e2e session + diff | 3 |
| **S5** | Code | chrome éditeur, arborescence, panneaux, terminal | `src/pages/session/{editor-panel,file-tabs,terminal*}` | e2e code + diff | 3 |
| **S6** | Work | board, runs, panneaux, contrôles | `src/pages/workbench/work-*` | e2e work + diff | 2–3 |
| **S7** | Design studio | toolbar v55, layers, canvas chrome, comments, inspecteur | `src/pages/workbench/design/**` (chrome uniquement — ADR-039 intact) | e2e design + diff | 3 |
| **S8** | Automate | `#view-automate` complet | `automate-*` | e2e + diff | 2–3 (décision D1/D2) |
| **S9** | Browser | `#view-browser` | `design-browser-*`/`browser-runtime` | e2e + diff | 2 (décision D2 / gap #97) |
| **S10** | Memory | vault, note, liens, graphe | `src/pages/session/memory-*` | e2e + diff | 2 |
| **S11** | Settings / User | dialogs, préférences | `components/settings-*`, `user-*` | e2e + diff | 2 |
| **S12** | Responsive/mobile | `RESPONSIVE-MATRIX.md` (5 familles) | shell/surfaces | diff ×5 viewports par cas | 2 |
| **S13** | Motion | durées/easings, `reduced-motion` | CSS couches 2–4 | e2e motion + diff stable | 1–2 |
| **S14** | A11y + gate final | VISUAL-GATES v2 | transverse | matrice cartésienne verte, RC documenté | 2 |

**Ordre imposé** : S0 et S1 d'abord (sans instrument et sans tokens/police, tout le reste est non mesurable). S12 peut commencer après S3. S8/S9 attendent D1/D2.

---

## 6. Modèle de fiche de slice (obligatoire pour chaque PR autonome)

```md
### S<n> — <titre>
Objectif : … (1 phrase mesurable)
Ancrages maquette : <classes/sections/numéros de lignes>
Fichiers cibles : …
Étapes : 1..N (chacune ≤ 400 LOC)
Preuves : unit … / e2e … / capture <case>.png / diffRatio avant→après
Critères de sortie : seuils §1 atteints sur les cas de la slice, zéro régression ailleurs
Risques : …
Escalade si : …
```

---

## 7. Protocole d'exécution autonome (worker IA)

1. Branche `ui-v110/pixel-<n>` depuis `new-ui`. Jamais de push direct sur `work-design`.
2. Boucle : implémenter → `bun typecheck` + `bun test` (app/ui) + `biome check` (racine) → e2e ciblés puis suite complète → `visual-gate` (capture + diff) → docs (`M3-ACCEPTANCE-MATRIX`, `M3-PROGRESS`) → vault (session) → commit conventionnel → push + PR vers `work-design` + CI verte.
3. PR ≤ 400 LOC ; une slice se découpe en autant de PR que nécessaire, chacune buildable et vérifiable seule.
4. **Conditions d'arrêt** (documenter puis attendre) : contradiction maquette ↔ ADR ; capacité runtime manquante ; licence/police ; diff non réductible sous le seuil sans casser un test ; ambiguïté de spec.
5. **Interdits** : données factices, `!important` nouveaux, duplication de tokens, modification de la maquette de référence, régression fonctionnelle silencieuse.

---

## 8. Protocole de review multi-IA

**Dossier à remettre à chaque IA reviewer** (tout est dans le repo) :
1. Ce plan ; 2. la maquette (`docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`) ; 3. `RESPONSIVE-MATRIX.md`, `INTERACTIONS.md`, `VISUAL-GATES.md` ; 4. ADR-038, ADR-039, ADR-1033 ; 5. les captures actuelles app ↔ maquette (home + shell) et le rapport de diff baseline (S0).

**Grilles par reviewer** (4 angles, un verdict chacun) :
- **Design** : fidélité (composition, typo, couleur, espacement), hiérarchie, détails (rayons, ombres), complétude vs `#view-*`.
- **Eng** : architecture en couches, source unique des tokens, perf (budget < 16,6 ms/frame), zéro régression, découpage ≤ 400 LOC.
- **QA** : couverture des cas, seuils atteignables, déterminisme des captures, CI bloquante au bon moment.
- **DX** : autonomie réelle des slices (contexte suffisant), outillage, conditions d'arrêt, coût d'entrée pour un nouveau worker.

**Sortie attendue** : verdict `GO` / `NO-GO` / `GO sous conditions` + liste numérotée de corrections + risques.
**Critère d'adoption** : **2 IA indépendantes `GO` sans condition bloquante** ; les conditions sont intégrées (§10) puis re-review des deltas uniquement.

---

## 9. Décisions requises du propriétaire (bloquantes avant S2/S8/S9)

| # | Sujet | Options | Défaut proposé |
|---|---|---|---|
| **D1** | Rail : la maquette montre 6 modes (Code/Work/Design/Automate/Browser/Memory) ; le runtime en a 3 (ADR-1033 a retiré Automate) | (a) restaurer 6 entrées avec gating runtime (b) 3 entrées + sous-vues (c) amender ADR-1033 | **(a)** — la maquette est l'autorité |
| **D2** | Automate/Browser sans runtime complet (pas de fake autorisé) | (a) porter le chrome + état « indisponible » documenté (b) implémenter les runtimes (#86/#97) d'abord | **(a)** puis (b) en suivi |
| **D3** | Exceptions pixel (§1) | valider / étendre | liste telle quelle |
| **D4** | Ordre des slices | S0→S14 / autre | S0→S14 (S12 après S3) |
| **D5** | Autorisation d'implémentation après review | GO / attendre | GO après 2 reviews |

---

## 10. Journal de décisions & corrections (à remplir par les reviews)

| # | Sujet | Décision / correction | Source (IA) | Date | Statut |
|---|---|---|---|---|---|
| | | | | | |

---

## 11. Risques & mitigations

| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| Polices non identiques → diff permanent | Haute si non traité | Bloquant pixel-perfect | S1 : Inter packagée, injectée des deux côtés, vérifiée par diff |
| Maquette non déterministe (animations, données) | Moyenne | Captures instables | S0 : freeze horloge/random, `data-ui-animations=off`, `reduced-motion`, snapshot figé |
| Régressions fonctionnelles par restyle | Moyenne | Bloquant | Suite e2e complète verte exigée par PR ; ADR-039 (Design) en zone rouge |
| Périmètre qui explose | Haute | Dérive | Slices ≤ 400 LOC, courbe de diff, conditions d'arrêt §7 |
| Conflit ADR-1033/maquette | Certaine | Blocage D1 | Décision propriétaire avant S3 |
| Browser/Automate sans runtime | Certaine | S9/S8 bloquées | D2 : chrome + état indisponible, runtime en suivi |

---

## 12. Definition of Done (globale)

- [ ] 12→20 cas visuels (× DPR 1×/2× × 5 familles) ≥ seuils §1 ; courbe décroissante puis stable, versionnée.
- [ ] `--sans`/Inter unique, tokens à source unique testés, zéro `!important` nouveau.
- [ ] 8 vues `#view-*` couvertes (ou désactivées proprement selon D1/D2, avec mention explicite — jamais de fake).
- [ ] Suite e2e complète + unit + typecheck verts ; matrice cartésienne stabilisée ; VISUAL-GATES v2 signé.
- [ ] ADR-038 révisé (pixel-perfect + exceptions), ADR-039 intact, ADR-1033 traité selon D1.
- [ ] PR de promotion `new-ui` → `work-design` avec captures finales côte à côte.

---

## 13. Annexes

**A — Vues maquette** : `#view-code`, `#view-work`, `#view-design`, `#view-automate`, `#view-browser`, `#view-memory`, `#view-user`, `#view-settings` (8 ; la maquette a aussi les overlays settings/modales et les états present/mobile).

**B — Ancrages clés** : `.rail-btn` (+ `.label{display:none}`, `.tip`, `:before` 3 px actif), `.home-mode-pill`, `#view-*`, tokens `:root` (§2), topbar `--topbar:48px` (wordmark, « ● Auto · 2 », toggle thème), composer-carte accueil, cartes projets, `--context:248px`, `--inspector:300px`.

**C — Instruments existants à réutiliser** : `packages/app/e2e/v110/*` (fixtures, `installWorkbenchMock`, `seedStorage`, `dirPath`), `e2e/v110/gate.ts` (`track`, `overflow`, `modes`), `docs/ui-reference/v110/VISUAL-GATES.md`, `RESPONSIVE-MATRIX.md`.

**D — Budget indicatif** : ~18–24 PR, ~4–6 semaines de worker unique ; S0+S1 ≈ 4 PR (1 semaine) avant tout gain visible — d'où leur priorité.
