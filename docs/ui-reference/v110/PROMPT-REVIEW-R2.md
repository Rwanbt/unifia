<!-- SPDX-License-Identifier: MIT -->

# Prompt de review indépendante — PLAN R2 (issue #116)

> À coller tel quel dans une autre IA (accès au repo requis).
> Version du plan sous revue : `PLAN-PIXEL-PERFECT-PORT-2026-09-17-R2.md`.

---

Tu es un reviewer indépendant et hostile. Tu ne valides pas un plan écrit par une autre IA :
tu le **casses**. Lecture seule stricte — tu ne modifies aucun fichier, tu n'implémentes rien.

## Contexte

- Repo `Rwanbt/unifia`, worktree `D:\App\unifia\_a7-automate-memory`, branche `new-ui`.
- Le propriétaire constate que `new-ui` est **visuellement identique à `dev`** après une
  semaine de portage. C'est le fait qui déclenche tout.
- **R1** (`PLAN-PIXEL-PERFECT-PORT-2026-09-17.md`) a été reviewé et jugé NO-GO : bon
  diagnostic, mais 5 faits faux, une contradiction logique bloquante, et un dispositif de
  preuve qui ne prouve rien en CI.
- **R2** (`PLAN-PIXEL-PERFECT-PORT-2026-09-17-R2.md`) prétend corriger tout ça et ajoute une
  thèse nouvelle : *le portage a été écrit mais n'est pas branché*.
- La maquette (`Unifia-UI-UX-v110-PORT-READY-R1.html`, 2,4 Mo, 28 605 l., gelée 2026-09-10)
  est l'autorité d'apparence, jamais modifiable. **Ne la lis jamais linéairement** : R2 §9 B
  donne une table d'ancrages par numéro de ligne.

## Documents

1. `docs/ui-reference/v110/PLAN-PIXEL-PERFECT-PORT-2026-09-17-R2.md` ← **le plan à casser**
2. `docs/ui-reference/v110/PLAN-PIXEL-PERFECT-PORT-2026-09-17.md` (R1, pour le delta)
3. `docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html` (maquette)
4. `docs/ui-reference/v110/{RESPONSIVE-MATRIX,INTERACTIONS,VISUAL-GATES}.md`
5. `docs/adr/ADR-038-visual-parity-scope.md`, `ADR-039-*`, `1033-*`, `1041-*`
6. Code : `packages/app/src/{styles,shell,pages,components,context,i18n}`,
   `packages/ui/src/{styles,components}`, `packages/workbench-shell/src/modes.ts`,
   `packages/app/e2e/`, `packages/app/playwright.config.ts`

---

## A. Reproduis les mesures de R2 — indépendamment

R2 fonde toute sa thèse sur quatre compteurs. **Ne les crois pas. Recalcule-les avec tes
propres commandes**, puis dis si tu obtiens autre chose.

| R2 affirme | À vérifier |
|---|---|
| **W1 = 16** tokens `--v110-*` déclarés sans aucun lecteur (sur 21) | attention au piège que R2 documente lui-même : `grep "var(--v110-target"` matche `--v110-target-touch`. Utilise une frontière `var(--token[,)]`. Exclus `v110.css` et les tests. |
| **W2 = 8** valeurs `data-v110` ciblées par le CSS et absentes du markup | R2 les nomme : `composer`, `work-surface`, `design-bezier`, `design-layers-panel`, `design-selection-handles`, `design-split`, `design-vector-canvas`, `design-vector-toolbar` |
| **W3 = 37** marqueurs `data-v110` dans les `.tsx` sans aucune règle CSS | R2 dit que 25 sont de la famille `work-*` |
| **W4 = 13** usages `var(--v110-*, <littéral>)`, et **zéro** usage sans fallback | si c'est vrai, supprimer `v110.css` ne change rien à l'écran. **Teste cette affirmation** : est-elle réellement démontrée, ou seulement plausible ? |

Vérifie aussi ces trois-là, sur lesquels repose §0.2(a) et §0.3 :

1. `git diff dev...new-ui -- packages/app/src/pages/home.tsx` — R2 affirme que **aucune ligne
   du bloc `return (` n'a changé**. Vrai ? Et surtout : **`home.tsx` est-il bien la route
   d'accueil rendue ?** Cherche le routeur. Si l'accueil réel est ailleurs, l'argument
   central de R2 s'effondre.
2. `--faint` vaut-il `#85858d` (ligne 5557) et non `#6b6b72` (ligne 37) ? Le bloc 5557 est-il
   bien hors media query ?
3. `SHELL_MODES` a-t-il 4 entrées ? ADR-1041 supersede-t-il bien ADR-1033 ?

**Pour chaque compteur : ta valeur, ta commande, et l'écart avec R2 s'il y en a.**

---

## B. Attaque la thèse centrale de R2

R2 réordonne tout autour d'une idée : **le premier gate doit être un gate de câblage (G1),
pas une capture d'écran (G2)**, parce qu'un token non lu est invisible à une capture.

Challenge-la sur trois axes :

1. **Est-ce vrai ?** Un token orphelin est-il réellement invisible à un diff de capture ?
   Cherche un contre-exemple : un cas où G2 aurait attrapé ce que G1 attrape.
2. **Est-ce suffisant ?** G1 est statique. Qu'est-ce qu'un gate statique ne peut
   structurellement pas voir — spécificité CSS, ordre de cascade, `@layer`, styles inline,
   classes Tailwind qui écrasent, `!important` ? **Trouve au moins un mode d'échec où
   W1..W4 sont tous à 0 et l'écran ne change toujours pas.** C'est la question la plus
   importante de cette review.
3. **Est-ce que W1..W4 == 0 est atteignable ?** Passer W3 de 37 à 0 signifie soit écrire une
   règle CSS pour 37 marqueurs, soit supprimer 37 marqueurs. R2 ne dit pas lequel. Est-ce
   que ça tient dans les slices annoncées ?

---

## C. Review par volet (4 verdicts séparés)

### Design
La parité **géométrique** de R2 §2.2 (`boxDelta ≤ 1 px` + `styleDelta` sur 14 propriétés +
`diffRatio` avec contenu masqué) est-elle une vraie parité visuelle, ou une reddition
déguisée ? Un écran peut-il passer ces trois métriques et rester visiblement différent de la
maquette ? Les 14 propriétés de §2.3 sont-elles les bonnes — qu'est-ce qui manque
(`transform`, `overflow`, `z-index`, `backdrop-filter`, `outline`) ? Les états couverts
sont-ils complets (light/dark, hover/active/disabled, overlays, modales, present, mobile) ?

### Eng
- R2 §5.2 exige de **supprimer l'espace de noms `--v110-*`** et les 13 fallbacks. Quel est le
  rayon de souffle ? Note que `packages/app/src/shell/v110-mobile-nav.test.ts:38` **asserte
  la chaîne littérale** `var(--v110-rail-compact, 62px)` : combien d'autres tests cassent ?
- R2 veut écrire les tokens dans un `@theme` de `packages/ui/src/styles/`. Est-ce compatible
  avec Tailwind v4 ? Un `@theme` qui redéfinit les couleurs sémantiques casse-t-il les
  utilitaires existants (`text-text-strong`, `bg-icon-success-base`) consommés dans le
  markup ?
- R2 §5.1 génère `v110-tokens.css` par Chromium headless puis **commite le résultat**, avec
  un test de ré-extraction. Ce test est-il stable entre versions de Chromium et entre OS ?
- ADR-039 : le critère binaire de §8.2 (« S8 ne touche aucun fichier que le chantier ADR-039
  réécrit ») est-il opérationnel, ou impossible à évaluer ?
- 37 PR / 4-6 semaines : crédible, sous-estimé, sur-estimé ? Justifie par le volume réel
  (1 349 classes maquette, 56 578 LOC app).

### QA
- **Baselines Linux** (R2 §4.2) : générer dans `mcr.microsoft.com/playwright:v1.57.0-jammy`
  puis commiter — est-ce reproductible entre la machine du dev (win32) et le runner CI ?
  Que se passe-t-il quand Playwright est bumpé ?
- **Quiescence** (§4.3) : « 3 frames consécutives sans mutation DOM, timeout 5 s » — ce
  critère tient-il face à 209 `setTimeout`, 120 `rAF` et 4 `setInterval` ? Un `setInterval`
  qui mute le DOM toutes les secondes rend le critère inatteignable. Vérifie ce que font les
  4 `setInterval` de la maquette.
- **Appariement `data-parity`** (§2.2) : R2 exige une table d'appariement app↔maquette posée
  dans le markup. Combien de nœuds faut-il apparier pour que `boxDelta` soit significatif ?
  Qui garantit qu'un nœud app correspond bien à ce nœud maquette ? Est-ce que ça ne
  réintroduit pas le problème de W3 (marqueurs posés sans effet) ?
- **24 cas × light/dark** : le coût de run en CI est-il tenable ? R2 reporte DPR 2× à S12 —
  bonne décision ou dette cachée ?

### DX
Prends **S3 (accueil)** et **S7 (work, 25 marqueurs inertes)**. Un worker sans aucun contexte
historique peut-il les exécuter **sans poser de question** ? Critères de sortie binaires ?
Ancrages suffisants ? Si non, dis précisément quelle information manque.
Vérifie aussi que les conditions d'arrêt §8.1.4 ne se déclenchent pas dès la première lecture
de fichier (c'est ce qui tuait R1).

---

## D. Scénarios d'échec — minimum 6

R2 hérite des risques de R1 et en crée de nouveaux. Pour chacun : probabilité, impact, et
**ce que R2 devrait ajouter**. Pistes à creuser (trouves-en d'autres) :

- W1..W4 à 0 et écran inchangé (voir B.2) — **le scénario le plus important**
- La suppression des fallbacks casse le rendu en production si un token ne charge pas
- Le `@theme` de parité entre en conflit avec les couleurs sémantiques Tailwind existantes
- La ré-extraction de tokens diverge après un bump de Chromium
- `boxDelta ≤ 1 px` inatteignable parce que Tailwind arrondit en `rem` et la maquette en `px`
- Les 37 marqueurs inertes sont « résolus » en les supprimant, ce qui fait passer le gate
  sans rien porter
- ADR-042 est écrit mais le propriétaire ne tranche pas D2/D3 → S3 et S4 bloquées
- La maquette étant en `fr` uniquement, une régression sur les 16 autres locales passe
- Le worker atteint `boxDelta ≤ 1px` en figeant des tailles en dur, détruisant le responsive

---

## E. Verdict

- `GO` / `NO-GO` / `GO sous conditions`.
- Liste numérotée de corrections, chacune rattachée à une section de R2 (`§3 W4`, `§5.2`, …).
- Risques classés P0 / P1 / P2.
- **Maximum 3 questions fermées au propriétaire** — uniquement ce qu'un reviewer ne peut pas
  trancher. R2 en pose déjà 7 (D1-D7) : dis lesquelles sont de vraies décisions de
  propriétaire et lesquelles sont des décisions d'ingénierie déguisées que le plan devrait
  trancher lui-même.

## Contraintes de sortie

- Français, structuré A/B/C/D/E, prêt à coller en commentaire de l'issue #116.
- **Chaque constat cite `fichier:ligne` ou la commande exécutée.** Si une information n'est
  pas vérifiable dans ton environnement, écris « non vérifiable » — n'invente rien, ne
  fabrique aucune sortie de commande.
- Termine par un bloc de confiance : ce que tu as vérifié par exécution, ce que tu as seulement
  lu, ce que tu n'as pas inspecté, et **la chose que tu es le plus susceptible d'avoir ratée**.
- Ne reformule pas le plan sans justification. Pas de recommandation générique.

## Avertissement

R1 a échoué parce qu'il affirmait des faits sans les vérifier et qu'un reviewer les a crus.
R2 affirme corriger R1 — **c'est exactement le genre de document qu'on lit avec bienveillance
et qu'on ne vérifie pas**. R2 a déjà dû corriger deux de ses propres compteurs en cours de
rédaction (W1 : 14 → 16 à cause d'un bug de préfixe `grep` ; W4 : 11 → 13). Suppose qu'il en
reste.
