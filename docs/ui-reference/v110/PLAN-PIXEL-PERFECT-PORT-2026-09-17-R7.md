<!-- SPDX-License-Identifier: MIT -->

# PLAN R7 — Parité visuelle v110, convergence exécutable

> **Statut** : PROPOSÉ — remplace R6 après la quatrième review multi-IA.
> **Suivi canonique** : GitHub issue #116, ouverte le 2026-09-17. Son corps pointe encore
> vers le plan initial et doit être mis à jour avant la première PR d'implémentation.
> **Worktree vérifié** : `D:\App\unifia\_a7-automate-memory`.
> **Branche vérifiée** : `new-ui` à `8cc914c0ea575ae675d4067e27754b86f4e9171b`.
> **Base historique de qualification** : `d212bc8098af43ca64a8c4456263dfdb44a56190`.
> Le HEAD distant `work-design` est capturé au run, jamais codé en dur comme cible actuelle.
> **Maquette gelée** : `Unifia-UI-UX-v110-PORT-READY-R1.html`, SHA-256
> `6c01e84c27abf7665bb4de65e0c3969b7af0f020129aa971916376b1ca69818b`.
> **Règle de vérité** : une métrique, un marqueur ou une CI verte ne vaut jamais preuve
> de parité sans comparaison rendue locale G2.

---

## 0. Contexte et résultat attendu

Une semaine de travail a produit une branche volumineuse sans parité visuelle perceptible.
La cause systémique était un chemin de livraison qui récompensait les marqueurs, les règles
CSS et les tests verts sans exiger une différence visible entre la maquette et l'application.

R7 exige P1 en quatrième PR de la séquence PF0/P0a/P0b/P1, première à modifier l'apparence,
compare référence/app dans des contextes
Chromium isolés et verrouillés, apparie chaque ancre et interdit qu'un total manuscrit,
masque, `skip` ou retrait de marqueur puisse produire un faux vert.

Le résultat final est un port visuel de toute la maquette applicable : accueil, shell,
session/chat, Code, Work, Design, Automate, Browser, Memory, Settings, User, overlays,
  responsive, thèmes, états, DPR, motion et locales de forme. Une surface bloquée par un runtime réel
reste explicitement bloquée ; elle n'est ni simulée ni comptée comme paritaire.

### 0.1 Faits locaux conservés comme diagnostic

Instantané non normatif R3 : lecteurs `--v110-*` internes/externes 168/12 ; cibles CSS
`data-v110` 16 dont 8 absentes ; markup 45 dont 37 sans règle et 28 `work-*` ; 12
  fallbacks ; timers 229/131/4 ; `Math.random` 25 ; `Date` 88. S0 les reproduit par la
  Compiler API TypeScript `5.8.2` et PostCSS `8.5.26`, validés sur fixtures ; jamais par grep.

Le périmètre exact est produit par S0 depuis `git ls-files` ; aucun nombre de fichiers
manuscrit n'est normatif. R7 cible le système de parité, pas tout le monorepo.

### 0.2 Ce que les reviews R3 à R6 ont changé

R7 supprime les totaux normatifs, verrouille plan/outils/entrées sans auto-signature, impose appariement et
états dérivés, ajoute un census indépendant, borne pixels et masques localement, rend le
pilote binaire, définit G3, cible `new-ui` avant promotion séparée et unifie la review A–E.

Les arbitrages sont dans les synthèses R3 à R6 du même dossier.

## 1. Décisions propriétaire

Ces trois décisions seulement peuvent bloquer l'exécution :

| ID | Décision | Recommandation | Bloque |
|---|---|---|---|
| O1 | Accepter ADR-042 et la définition de parité de R7 ? | Oui | PF0 |
| O2 | Browser et Memory sont-ils des modes de premier rang, avec état indisponible honnête quand le runtime manque ? | Oui | S4/S9/S12 |
| O3 | Autoriser l'implémentation après quatre reviews A–D exécutables et une synthèse E sans P0 ? | Oui | P0a |

Une réponse est consignée dans l'issue #116 et dans ADR-042. L'absence de réponse est un
arrêt explicite, jamais une hypothèse silencieuse.

## 2. Vocabulaire normatif

- **Scène** : route/surface et fixture fonctionnelle nommées, par exemple `home.default`.
- **Vecteur d'état** : état déterministe d'une scène, avec une cible précise pour chaque
  interaction (`home.mode.design:hover`, `settings.modal:open`).
- **StaticCase** : `scene × viewport × theme × stateVector × DPR × localeProfile × motionPreference`.
- **MotionCase** : `scene × viewport × theme × stateVector × DPR × localeProfile × motionPreference × timelineProfile`.
- **Assertion d'ancre** : `anchorId × cas de capture`.
- **Run de scène** : une exécution d'un cas de capture produisant capture, mesures et logs.
- **Preuve** : résultat JSON plus captures référence/app, heatmap et provenance.
- **Census** : inventaire runtime indépendant du manifest, exécuté des deux côtés et pour
  chaque vecteur d'état, suivant `census-rules.json` hashé.

Les compteurs StaticCase, MotionCase, assertions, runs et leurs
dimensions sont calculés depuis le manifest et publiés dans `parity-result.json`. Le schema
interdit un champ `expectedTotal` et le linter du plan refuse un total normatif dupliqué.
Le census unit tous les états. Il inclut tout élément à pixels peints, pseudo-élément/SVG,
et tout élément interactif ou focusable même non peint. Chaque entrée doit recevoir une
ancre, un masque/disposition valide ou le résidu autorisé ; le manifest ne définit pas son univers.

## 3. Autorités et verrou de preuve

### 3.1 Ordre des autorités

1. apparence : maquette gelée ;
2. comportement : `INTERACTIONS.md`, stores et capabilities réels ;
3. responsive : `RESPONSIVE-MATRIX.md` ;
4. architecture : ADR acceptés, avec ADR-042 supersédant ADR-038 ;
5. travail actif : issue #116, tracker de statut uniquement ; elle n'est jamais une
   autorité normative face au bundle de plan commité.

### 3.2 Freeze et locks à deux phases

PF0 commit R7, synthèses et ADR-042. `planCommit` est strictement antérieur à tout lock ;
G0 lit uniquement le plan à ce commit. P0a (≤400 LOC) ajoute dépendances, Dockerfile, runner,
schemas et policies `census/state/style/motion`. Contrats sous `packages/app/e2e/v110/parity/`,
scripts sous `packages/app/scripts/parity/`. Son CI repart d'un checkout propre, reconstruit
l'image, régénère deux fois les sorties canoniques et publie étude A/A + hashes.

P0b lock-only relit ces artifacts du run P0a, puis crée `pilot-contract-lock.json` avec
`planCommit`, `pilotToolchainCommit` et `noiseSourceRun/hash`; aucun ne vaut le commit du lock.
Après S0/S1/S2, QF0 lock-only crée le contrat complet depuis `qualificationToolchainCommit`.
Les champs communs du lock pilote sont identiques ou portent un delta explicite approuvé.

Chaque contract lock énumère/hache : plan/ADR/référence ; schemas ; census/state/style/motion
policies ; catalogues viewport/locale/timeline ; scripts, Dockerfile/build, mutations ; A/A
policy/enveloppe. La baseline de skips entre en QF0. Les fragments de surface restent
mutables après QF0, validés par le schema verrouillé et hashés dans chaque `parity-run`.

Les environment locks pilote/qualification contiennent : référence path/hash ; digest de
l'image et hash Dockerfile/build script ; Bun/Playwright ; hashes `bun.lock`, root/app
`package.json`, `playwright.config.ts` ; browser args ; horloge post-fixtures, seed/timezone ;
DPR `[1,2]` ; motion `[reduce,no-preference]` ; locales `fr-FR/ltr`, `de-DE/ltr`, `ar/rtl` ;
fontSet path/hash/famille calculée/provenance/licence ; TypeScript `5.8.2`, PostCSS `8.5.26`,
axe `4.13.0` et Biome `2.4.14`. Le schema interdit tout champ implicite.

`parity-run.json` contient `sourceCommit/tree`, `sliceBaseCommit`, `mergeBaseAtRun`,
`qualificationBaseCommit`, `targetBranchHeadAtRun`, hashes des locks, manifest, skips,
image/preuves et `prsBeforeFirstVisibleChange`. Un changement de checker suit tool-only puis
lock-only, sans surface ni qualification entre les deux.

Seul le binaire de l'image qualifie : G0 exécute `bun --version` et le compare au
`packageManager`; le host n'est qu'un warning. G1/G2/mutations/G3 tournent dans l'image.

### 3.3 G0 — quatre modes explicites

`G0-bootstrap` couvre PF0/P0a sans exiger de lock et reste `NOT_QUALIFYING`; `G0-pilot`
couvre P0b/P1 ; `G0-tool-change` couvre S0/S1/S2 et toute rotation, compare au lock courant,
exige une allowlist exacte des paths divergents et reste `NOT_QUALIFYING`; `G0-full` commence
à QF0. Chaque mode est imposé par la slice, jamais choisi par l'auteur.

G0 lit plan depuis `planCommit`, outils/rules depuis le `*ToolchainCommit` du lock actif via
`git show`/`ls-tree`, et exige index/worktree propres sur les paths verrouillés. Il échoue sur
toute divergence lockfile/package/config/script/catalogue/profil/fonte/image/version/preuve.

Les mutations changent seed, heure, locale, DPR, fonte, lockfile, Dockerfile et référence.
Le test d'isolation couvre cookies, storages, cache et service worker. L'issue #116 doit
pointer R7 avant P1 mais n'entre pas dans la preuve. P0a installe PostCSS direct ; S0 utilise
Compiler API/PostCSS/Playwright DOM avec roots/exclusions versionnés et une fixture à
compteurs attendus. Census/G1/G2 tournent dans l'image. Deux `canonical-proof.json` normalisés
hors timestamps/run IDs/paths sont byte-identical ; aucun grep n'est oracle.

## 4. Contrat positif et G1

### 4.1 Manifest par surface

Les fragments vivent sous `packages/app/e2e/v110/parity-manifest/*.json`. S0 les valide et
les fusionne dans un ordre lexical. Exemple fondé sur la maquette réelle :

```json
{
  "id": "home.mode-pill",
  "slice": "S3",
  "scene": "home.default",
  "anchorKind": "toggle-control",
  "reference": { "selector": ".home-mode-pill", "count": 6, "visibleCount": 6 },
  "app": { "selector": "[data-parity='home.mode-pill']", "count": 6, "visibleCount": 6 },
  "matchBy": { "kind": "attribute", "reference": "data-home-open-mode", "app": "data-mode" },
  "viewports": ["desktop-wide", "desktop-compact", "tablet-portrait", "phone-portrait", "compact-landscape"],
  "themes": ["dark", "light"],
  "stateVectors": ["default", "hover:design", "focus-visible:design"],
  "styleProfile": "control-v1",
  "mask": null,
  "disposition": "port"
}
```

Champs obligatoires : identité, slice, scène, `anchorKind`, sélecteurs, cardinalités DOM et
visibles, `matchBy`, viewports, thèmes, vecteurs d'état, profil, masque et disposition.

### 4.2 Cardinalité et appariement

- La cardinalité observée doit égaler la cardinalité déclarée des deux côtés.
- Le comptage DOM inclut aussi les nœuds cachés ; `visibleCount` est vérifié par état.
- `count=1` exige une clé unique implicite.
- `count>1` exige une clé sémantique métier stable. IDs générés par framework et index de
  boucle sont interdits. `document-order` n'est autorisé
  qu'avec `reason` et devient lui-même un contrat d'ordre.
- Ensembles et unicité des clés sont identiques ; mapping par clé, jamais par position.
- Réordonner le DOM avec les mêmes clés reste vert sauf contrat d'ordre ; changer/dupliquer une clé échoue.
- G1 vérifie au runtime que les attributs existent et que les ensembles de valeurs sont
  identiques des deux côtés ; l'exemple n'est jamais accepté comme preuve.

Le census, dans l'image, s'exécute par état puis s'unit. DOM : candidats peints avec boîte
dans viewport, chaîne display/visibility/opacity active, clipping non vide, texte/image/
canvas/SVG/pseudo ; rôles et ordre Tab, y compris skip links sr-only. `tabindex=-1` compte
seulement si focusé par une interaction déclarée ; `display:none` compte dans l'état où il
devient actif. Interaction : Compiler API sur TS/TSX/JS + trace `addInitScript` préchargement
inventorient handlers directs/délégués sans mutation DOM/style dans `interaction-inventory`.
Chaque entrée référence/app reçoit ancre ou disposition ; omission => `untracked*Nodes`, et
focusable app-only non disposé => `unexpectedFocusableAppNodes`. Les deux oracles sont mutés.

### 4.3 Dispositions et ledger legacy

Dispositions : `port`, `intentional-difference`, `app-only-accessibility`, `blocked-external`,
`retain-internal-instrumentation`, `delete-dead-instrumentation`.
`retain-internal-instrumentation` est interdit pour une ancre ou un nœud du census et ne
peut exempter `--v110-*` qu'avec preuve d'absence visuelle. `intentional-difference` garde
un masque nul, une capture et une approbation produit. Les blocages externes utilisent
`app-only-accessibility` exige masque nul, owner a11y et preuve G3 ; un skip link passe, un
focusable décoratif échoue. Les blocages utilisent `escalationOwner`, `nextReviewAt` et
`blocksQualifications`; leur expiration bloque la
qualification affectée et déclenche l'escalade, pas toutes les autres lanes.

`legacy-hook-ledger.json` inventorie par AST/CSS parser tokens, `data-v110`, sélecteurs et
fallbacks. Il publie `cssTargetedLegacyValues`, `cssTargetedValuesMissingFromMarkup`,
`markupLegacyValues`, `markupValuesWithoutCssRule`, `workFamilyMarkupValues` et
`literalFallbackExpressions`.

`retainReferencedAnchors` compte les ancres ou entrées census reliées à une exemption
`retain-internal-instrumentation` ; il doit rester à zéro.

Toute disposition exige `reason`, `owner`, `issue` et preuve attendue.
`delete-dead-instrumentation` exige absence de lecteur statique et runtime, absence d'ancre
et rendu équivalent avant/après sur les scènes affectées. Le test générique reste une
mutation d'une règle visible qui doit faire échouer G2 ; supprimer un hook réellement mort
n'est pas censé faire échouer G2.

### 4.4 Politique d'états indépendante

`state-policy.json` dérive les états dus de `anchorKind` et du rôle DOM : statique
`default` ; bouton/lien `default/hover/active/focus-visible` et `disabled` si supporté ;
toggle/tab/option ajoute `selected/unselected` ; disclosure/dialog `closed/open` ; vue de
données `loading/empty/error/present` quand la capability existe.

Une omission exige `notApplicable` avec `reason`, `owner` et `reviewBy`. Retirer `hover`
d'un contrôle sans exemption doit échouer avant G2. La politique, pas le fragment, définit
la couverture minimale.

### 4.5 G1 — schema puis DOM rendu

`bun run --cwd packages/app parity:contract` valide schema/ledger/expirations/couverture,
puis les deux DOM rendus dans G0.

Il exige zéro : `schemaErrors`, `cardinalityErrors`, `pairingErrors`,
`duplicateAllDomIds`, `missingStateCoverage`, `unownedLegacyHooks`,
`untrackedReferenceNodes`, `untrackedAppNodes`, `unexpectedFocusableAppNodes`,
`retainReferencedAnchors`, `expiredExemptions`,
`staticTextMaskViolations`, `maskOverlapViolations`,
`maskBudgetViolations`, `parityHookProductionReferences`, `forbiddenTokenPatterns`.

`maskBudgetViolations` signifie dépassement du `maxPixels` **ou** du `maxRatio` du masque.
`forbiddenTokenPatterns` ignore uniquement une exemption
`retain-internal-instrumentation` valide et non expirée.

`data-parity` peut être émis par le JSX mais ne peut être utilisé comme sélecteur CSS,
style inline ou requête runtime hors `packages/app/e2e/v110/parity/**`. Le scan couvre CSS,
TS/TSX et chaînes de sélecteurs.

## 5. G2 — preuve visuelle locale

### 5.1 Environnement et isolement

Référence et app sont servies par le même serveur HTTP de parité, dans la même image et le
même processus Chromium. Elles utilisent deux `BrowserContext` isolés avec options
identiques ; cookies, storage, service workers et classes de thème ne sont jamais partagés.

Chaque scène déclare ready predicate, fixtures, interactions, timers et stabilité. La policy
classe motion `none|finite|continuous` depuis styles calculés et observation. Finite exige
stabilité terminale ; continuous fixe une phase par horloge/API Animation sans CSS injecté,
compare A/B à même phase et vérifie la fermeture du cycle. Le sampler minimal existe en S1 ;
S14 étend la matrice. Un timer/mouvement inconnu ou post-stabilité échoue.

La référence gelée n'est jamais instrumentée. `harnessDomMutations` doit rester vide entre
avant/après installation ; `interactionDomMutations`, causées par les gestes déclarés, sont
comparées par ensemble de nœuds touchés jusqu'à stabilité, pas par ordre des records. Les nœuds dynamiques sont localisés par rôle, texte
et relation DOM. Le test d'isolation de §3.3 accepte le runner.

### 5.2 Mesures par ancre

Chaque ancre publie `absoluteBoxDelta` et `relativeBoxDelta` (x/y/w/h), `styleDelta`
pseudo-éléments inclus, `textDelta`, `structuralMiss`, `anchorDiffPixels` absolu+ratio et
`xOverflow`. Texte/structure/overflow valent zéro ; les autres suivent le profil hashé.

`style-profiles.json` est commité, hashé et chaque propriété est attaquée. Les profils partent
de zéro pixel. Une tolérance exige un artifact A/A : politique d'échantillonnage versionnée,
minimum vingt paires réparties sur au moins quatre processus Chromium/contextes frais,
union spatiale, puis batch de validation tenu à part sans pixel hors enveloppe. Le run CI
P0a produit l'étude ; P0b verrouille son run/hash antérieur. Budget, owner et approbation sont versionnés ;
une hausse exige une nouvelle campagne/PR dédiée, jamais un reviewer A-D temporaire.

Le résidu de scène hors union des crops et masques vaut zéro par défaut. Une exception suit
exactement le même protocole A/A spatial ; `sceneResidualPixels`, ratio et heatmap sont
publiés, ne peuvent croître ni migrer, et ne couvrent jamais un nœud census non disposé.
Il n'existe aucune tolérance globale générique.

### 5.3 Politique de masque

Le défaut est `mask: null`. Un masque :

- vise uniquement une valeur feuille réellement dynamique ;
- déclare sélecteurs, raison, fixture, `maxPixels`, `maxRatio`, owner, issue et `reviewBy` ;
- ne peut couvrir ni ancêtre, ni chrome, ni contrôle, ni nœud non déclaré ;
- reste soumis à géométrie, structure, style du contenant et assertion sémantique : clé i18n,
  code d'état/erreur ou valeur/pattern exact de fixture. Sans assertion, le masque est refusé.

Libellés, titres, placeholders, `aria-label`, textes statiques et icônes fonctionnelles ne
sont jamais masqués. `maskCount`, `maskedPixels` et `maskedPixelRatio` sont publiés par scène
avec delta au run précédent. Aucun plafond arbitraire n'est bloquant : toute hausse exige
review, et chaque valeur dynamique justifie sa boîte minimale.

### 5.4 Styles et motion

Les profils statiques couvrent layout, paint, typographie, visibilité, contenu/pseudo-
éléments, interaction visuelle et transform. Ils incluent notamment `text-decoration`,
`text-shadow`, `outline-offset`, `visibility`, `pointer-events`, `cursor`, `caret-color`,
`accent-color`, `color-scheme`, `scrollbar-*`, `list-style` et `border-collapse` lorsque
applicables. Toute exclusion est déclarée et attaquée par mutation.

`motion-policy.json` dérive timeline/applicabilité depuis anchorKind et animations/transitions
observées. `none` exige `notApplicable` prouvé ; finite/continuous exigent MotionCase et
préférences dues. Au moins un échantillon intermédiaire diffère de t0 et final, sinon
`motionAliasToStatic > 0`. Supprimer reduce/timeline produit `missingMotionCoverage > 0`.

### 5.5 Mutations obligatoires

`bun run --cwd packages/app parity:mutations` doit détecter au minimum :

1. règle visible, propriété de profil ou branche/nœud supprimé ; doublon caché/visible ;
2. inline, `!important`, import CSS, media query, `hover` ou `focus-visible` fautif ;
3. permutation/changement de clés et réordre DOM conservant les clés ;
4. marqueur+sélecteur, état, entrée dynamique, résultat motion ou handler délégué supprimé ;
5. masque total/statique/chevauchant, ou preuve de référence absente ;
6. seed, horloge, fonte, DPR, locale, lockfile ou config divergents ;
7. skip link disposé vs focusable décoratif, nœud peint/SVG/pseudo, fuite de contexte ;
8. mutation harness, motion aliasée/statique, animation continue mal phasée ou profil retiré.

## 6. G3 — fonction, accessibilité et régression

G3 est binaire. Les commandes locales donnent un feedback, mais seule leur exécution dans
l'image G0 qualifie une preuve. Les commandes existantes sont :

```powershell
bun run --cwd packages/app typecheck
bun run --cwd packages/app test:unit
bunx biome check packages/app/src packages/app/e2e/v110 packages/app/scripts/parity
bun run --cwd packages/app build
bun run --cwd packages/app test:e2e -- e2e/v110/<surface>.spec.ts
```

Chaque slice ajoute ou référence un test fonctionnel et un test a11y de surface. Le gate
a11y combine axe (`critical=0`, `serious=0`), navigation clavier, focus visible, ordre du
focus, noms accessibles et contraste. Les specs de parité n'emploient aucun `test.skip`.

S0 commit `e2e-skip-baseline.json` avec ID stable, specPath, titre et statut. Nouveau skip,
ID disparu ou renommé sans mapping explicite `renamedFrom` = échec ; un ancien skip redevenu
PASS est accepté. QF0 en verrouille le hash ; rename autorisé et suppression sont mutés.

P0a vérifie famille calculée et provenance. Toute fonte packagée porte fichier/licence hashés ;
toute fonte système porte package/image/licence. G0 compare `fc-list` et toutes les fontes
réellement résolues au fontSet, injecte les mêmes côtés et bloque le réseau. Divergence échoue.

## 7. Freeze et pilote vertical borné

PF0 commit R7/synthèses/ADR-042 et consigne O1–O3/#116, sans code. P0a (≤400 LOC) ajoute
dépendances, image, runner et contrats pilotes ; son CI publie A/A et rouge. P0b lock-only
fige le commit et les artifacts P0a antérieurs dans `artifact-manifest.json` hashé.

P1 est la quatrième PR de la séquence PF0/P0a/P0b/P1 et la première à modifier l'apparence ;
`prsBeforeFirstVisibleChange=3`. Son
`gateProfile=pilot` emploie le même moteur et les seuils finaux, mais un périmètre explicite :
schema, cardinalité, matchBy, state-policy et census symétrique des sous-arbres des trois
ancres `home.title`, `home.modes-row`, `home.mode-pill`. Les compteurs globaux non exécutés
sont listés `notRun`; aucun n'est marqué PASS. Résultat publie pass/notRun/fail par surface,
anchorKind et global ; fermer une surface ou promouvoir exige `notRun=0`. S3 rejoue en full.

Sur desktop-wide/dark : titre et row passent `default`; six pills appariées par
`data-home-open-mode` passent default/hover:design/focus-visible:design et clic fonctionnel.
Les trois ancres passent géométrie, styles, texte et pixels ; une baisse du diff ne suffit
pas. Captures référence/avant/après, heatmap, JSON et commandes sont artifacts CI de P1,
jamais une PR séparée ; seuls locks/schemas/enveloppes approuvées sont versionnés.

Un échec de parité P1 renvoie immédiatement en review. Seuls pull d'image/réseau, panne
runner ou OOM avec exit code/log sont externes ; ils peuvent rejouer le **même commit** deux
fois, sans nouvelle PR ; persistant, il retourne
en review avec cause racine. P1 ne certifie pas Home complet.

## 8. Slices d'exécution et DAG

Chaque PR modifie au plus 400 LOC suivies ; les sorties de run restent des artifacts CI. Les
locks/enveloppes ont leur PR dédiée et aucune exemption implicite au plafond n'existe.

| Slice | Portée | Gate de sortie |
|---|---|---|
| PF0 | plan/synthèse commités | `planCommit` immuable et reviewable |
| P0a | toolchain pilote + artifacts CI | runner reconstruit ; aucun claim produit |
| P0b | lock pilote seul | commit/run P0a antérieurs gelés |
| P1 | trois ancres Home | profile pilote binaire, artifacts CI |
| S0 | census/schema/inventaire/ledger/skips complets | compteurs reproductibles |
| S1 | G1/G2, motion sampler, contexts, timers, mutations | preuves canoniques identiques |
| S2 | pré-freeze tokens/Tailwind/fontes | re-extraction identique ; API sentinelle stable |
| QF0 | qualification locks seuls | toolchain S2 antérieure gelée |
| S3 | Home complet : symbol, titre, composer, quick chips, mode pills, hint | tous cas calculés Home G0–G3 |
| S4 | shell : topbar, rail, tabs, context, inspector, chat, resizers | chrome local conforme ; O2 appliquée |
| S5 | session/chat et ses états | G0–G3 surface |
| S6 | Code : arbre, tabs, éditeur, panneaux, terminal | G0–G3 surface |
| S7 | Work et modal Approval Gate dynamique | inventaire Work disposé ; G0–G3 |
| S8 | chrome Design selon §9 | ownership approuvé ; runtime intact |
| S9 | Memory | G0–G3 surface |
| S10 | Settings page, User, Settings modal, palette | IDs disjoints ; G0–G3 |
| S11 | Automate capability accordée/refusée | aucun faux runtime |
| S12 | Browser | runtime réel ou état indisponible contractuel |
| S13 | viewports applicables, DPR2, `de`, `ar` | overflow/direction/géométrie |
| S14 | motion et reduced-motion | gate motion dédié |
| S15 | full suite, a11y, dossier de promotion | DoD et synthèse de preuves |

```text
PF0 -> P0a -> P0b -> P1 -> S0 -> S1 -> S2 -> QF0 -> S3 -> S4
                                      |-> S5 -> S6 --|
                                      |-> S7 -> S9 --|
                                      |-> S10 -------|-> S13 -> S14 -> S15
                                      |-> S11 -------|
                                      |-> S12 -------|
                                      `-> S8 --------|
```

Les branches de slice sont `feat/116-r7-sX-<scope>` depuis le HEAD `new-ui` revalidé. Les
PR de slice ciblent `new-ui`. La promotion `new-ui -> work-design` est une PR séparée,
explicitement autorisée après S15.

## 9. Frontière Design

PF0 crée `design-ownership.json` avec `baseSha`, allowlist chrome, denylist runtime/canvas,
owner/escalation GitHub, issue, `nextReviewAt` et machine d'état : `PENDING -> APPROVED |
AWAITING_OWNERSHIP_APPROVAL | CONTESTED`; `CONTESTED -> APPROVED | WITHDRAWN`; `WITHDRAWN ->
ARCHIVED`. À `nextReviewAt` sans réponse, attente puis escalade ; le silence n'approuve jamais.
`design-ownership.status` est la source unique du libellé `NON_DESIGN_ONLY_<statut>` ;
`blocksQualifications` ne décide que les gates affectés. `FULL_PARITY` reste bloqué sans S8.

Le modal Approval Gate de la maquette n'a pas de classe `.approval-gate` : il est créé par
interaction avec le bouton `Inspecter`. Le fragment S7 décrit cette séquence et le reference
harness localise le dialog par rôle, titre et relation DOM, sans mutation de la référence.

## 10. Boucle autonome par PR

1. Revalider top-level, branche, HEAD, dirty state, remote et issue #116.
2. Exécuter le mode G0 imposé par la slice ; seul un run QUALIFYING peut certifier.
3. Ouvrir le fragment de la slice et son inventaire de fichiers autorisés/interdits.
4. Activer le cas rouge et prouver qu'il échoue pour la bonne raison.
5. Modifier la plus petite responsabilité cohérente.
6. Exécuter G0, G1, G2 ciblé et G3 ciblé.
7. Exécuter les mutations concernées et la suite complète requise avec
   `PLAYWRIGHT_WORKERS=1` si la mémoire du host l'exige.
8. Publier JSON, captures, heatmap, ledger delta, commandes et exit codes.
9. Mettre à jour l'issue ; commit conventionnel ; PR vers `new-ui`.
10. Ne jamais merger, promouvoir ou pousser une branche stable sans autorité explicite.

Si `new-ui` avance, la slice rebase puis rejoue les gates ; source, slice base, merge-base et
target head sont republiés. Un ancien run reste historique mais ne qualifie plus la promotion.
L'environment lock ne change que si une entrée change. Deux PR se chevauchent si path modifié,
fragment ID ou clé de contrat se recoupe ; elles sont sérialisées par queue GitHub ou manuelle.

PF0 capture rulesets/protections dans `branch-protection.json`. Tant que `new-ui` et
`work-design` sont non protégées, statut `MANUAL_MERGE_ONLY` : aucun agent ne merge/push la
cible ; une approbation humaine explicite par opération est obligatoire.

Arrêt immédiat si : décision manquante, hash divergent, licence non prouvée, capability
absente non disposée, mutation non détectée, preuve manquante, régression fonctionnelle,
a11y cassée ou ownership conflictuel.
Hors règle P1 de §7, deux échecs consécutifs du même gate et de même cause renvoient en
review ; aucun troisième changement d'infrastructure n'est lancé sans décision explicite.

## 11. Definition of Done

- [ ] O1–O3, ADR-042, issue #116, PF0 et locks à commits antérieurs sont cohérents.
- [ ] `parity-run.json` désigne commit, base, target head et preuves exacts.
- [ ] Schema, cardinalité, clés, state-policy, census et ledger passent sans total manuel.
- [ ] Ancres et résidu passent géométrie, styles, texte, structure et pixels sous enveloppes A/A.
- [ ] Masques minimaux : aucun texte statique, contrôle, chrome ou nœud non déclaré.
- [ ] StaticCase/MotionCase couvrent toutes dimensions ; `notRun=0` par surface close et global.
- [ ] Mutations, tokens, fontes, G3 et skip baseline passent dans l'image.
- [ ] Browser, Automate et Design reflètent leurs capabilities réelles.
- [ ] Chaque PR publie JSON, captures, heatmap, commandes et exit codes.
- [ ] A–D exécutables puis E donnent GO sans P0 ; promotion séparée explicitement autorisée.

## 12. Review multi-IA autorisante

`PROMPT-REVIEW-MULTI-IA-R7.md` exige quatre rapports A–D, deux familles de modèles et
contextes d'outils, identité Git et résultats exécutés, puis une synthèse E. Un rapport sans
repo est `DOCUMENT-ONLY`. Autorisation : quatre rôles exécutables et zéro P0.

Le vote majoritaire ne remplace jamais une preuve. Un conflit factuel est rejoué par une
commande déterministe ou reste ouvert.

Convergence : après R7, un rapport documentaire peut clarifier mais ne déclenche aucune
révision. Seule une preuve repo/exécution nouvelle de confiance ≥0,7 peut rouvrir le plan.

**VERDICT R7** : candidat documentaire final ; non autorisé pour implémentation avant O1–O3
et la review autorisante ci-dessus.
