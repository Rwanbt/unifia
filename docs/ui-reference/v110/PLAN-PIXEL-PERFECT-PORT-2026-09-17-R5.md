<!-- SPDX-License-Identifier: MIT -->

# PLAN R5 — Parité visuelle v110, contrat fermé et pilote binaire

> **Statut** : PROPOSÉ — remplace R4 après la seconde review multi-IA.
> **Suivi canonique** : GitHub issue #116, ouverte le 2026-09-17. Son corps pointe encore
> vers le plan initial et doit être mis à jour avant la première PR d'implémentation.
> **Worktree vérifié** : `D:\App\unifia\_a7-automate-memory`.
> **Branche vérifiée** : `new-ui` à `8cc914c0ea575ae675d4067e27754b86f4e9171b`.
> **Base locale vérifiée** : `work-design` à `d212bc8098af43ca64a8c4456263dfdb44a56190`.
> **Maquette gelée** : `Unifia-UI-UX-v110-PORT-READY-R1.html`, SHA-256
> `6c01e84c27abf7665bb4de65e0c3969b7af0f020129aa971916376b1ca69818b`.
> **Règle de vérité** : une métrique, un marqueur ou une CI verte ne vaut jamais preuve
> de parité sans comparaison rendue locale G2.

---

## 0. Contexte et résultat attendu

Une semaine de travail a produit une branche volumineuse sans parité visuelle perceptible.
La cause systémique était un chemin de livraison qui récompensait les marqueurs, les règles
CSS et les tests verts sans exiger une différence visible entre la maquette et l'application.

R5 exige un pilote conforme dans la deuxième PR, compare référence/app dans des contextes
Chromium isolés et verrouillés, apparie chaque ancre et interdit qu'un total manuscrit,
masque, `skip` ou retrait de marqueur puisse produire un faux vert.

Le résultat final est un port visuel de toute la maquette applicable : accueil, shell,
session/chat, Code, Work, Design, Automate, Browser, Memory, Settings, User, overlays,
responsive, thèmes, états, DPR et locales de forme. Une surface bloquée par un runtime réel
reste explicitement bloquée ; elle n'est ni simulée ni comptée comme paritaire.

### 0.1 Faits locaux conservés comme diagnostic

Instantané non normatif R3 : lecteurs `--v110-*` internes/externes 168/12 ; cibles CSS
`data-v110` 16 dont 8 absentes ; markup 45 dont 37 sans règle et 28 `work-*` ; 12
fallbacks ; timers 229/131/4 ; `Math.random` 25 ; `Date` 88. S0 les reproduit par parseur,
jamais par `git grep` oracle.

Le dépôt compte environ 3 318 fichiers source et 78,6 Mo de source. R5 est une review ciblée
du système de parité, pas un audit comportemental exhaustif de tout le monorepo.

### 0.2 Ce que les reviews R3/R4 ont changé

R5 supprime les totaux normatifs, verrouille plan/outils/entrées, impose appariement et
états dérivés, ajoute un census indépendant, borne pixels et masques localement, rend le
pilote binaire, définit G3, cible `new-ui` avant promotion séparée et unifie la review A–E.

Les arbitrages sont dans `REVIEW-MULTI-IA-R3-SYNTHESIS-2026-09-17.md` et
`REVIEW-MULTI-IA-R4-SYNTHESIS-2026-09-17.md`.

## 1. Décisions propriétaire

Ces trois décisions seulement peuvent bloquer l'exécution :

| ID | Décision | Recommandation | Bloque |
|---|---|---|---|
| O1 | Accepter ADR-042 et la définition de parité de R5 ? | Oui | P0 |
| O2 | Browser et Memory sont-ils des modes de premier rang, avec état indisponible honnête quand le runtime manque ? | Oui | S4/S9/S12 |
| O3 | Autoriser l'implémentation après quatre reviews A–D exécutables et une synthèse E sans P0 ? | Oui | première PR |

Une réponse est consignée dans l'issue #116 et dans ADR-042. L'absence de réponse est un
arrêt explicite, jamais une hypothèse silencieuse.

## 2. Vocabulaire normatif

- **Scène** : route/surface et fixture fonctionnelle nommées, par exemple `home.default`.
- **Vecteur d'état** : état déterministe d'une scène, avec une cible précise pour chaque
  interaction (`home.mode.design:hover`, `settings.modal:open`).
- **Cas de capture** : `scene × viewport × theme × stateVector × DPR × localeProfile`.
- **Assertion d'ancre** : `anchorId × cas de capture`.
- **Run de scène** : une exécution d'un cas de capture produisant capture, mesures et logs.
- **Preuve** : résultat JSON plus captures référence/app, heatmap et provenance.
- **Census de référence** : inventaire runtime indépendant du manifest de tous les nœuds
  visibles, interactifs, textuels, images, SVG et pseudo-éléments peints de la scène.

Les compteurs `captureCaseCount`, `anchorAssertionCount`, `sceneRunCount` et leurs
dimensions sont calculés depuis le manifest et publiés dans `parity-result.json`. Le schema
interdit un champ `expectedTotal` et le linter du plan refuse un total normatif dupliqué.
Chaque entrée du census doit être couverte par une ancre, un masque autorisé ou la région
résiduelle de scène ; le manifest ne définit donc pas lui-même l'univers qu'il certifie.

## 3. Autorités et verrou de preuve

### 3.1 Ordre des autorités

1. apparence : maquette gelée ;
2. comportement : `INTERACTIONS.md`, stores et capabilities réels ;
3. responsive : `RESPONSIVE-MATRIX.md` ;
4. architecture : ADR acceptés, avec ADR-042 supersédant ADR-038 ;
5. travail actif : issue #116, tracker de statut uniquement ; elle n'est jamais une
   autorité normative face au bundle de plan commité.

### 3.2 Locks d'entrée et résultat, sans SHA auto-référentiel

P0 crée deux verrous d'entrée commités et immuables pendant un run.

`contract-lock.json` contient `planRevision`, `planPath`, `planCommit`, `planSha256`, les
hashes d'ADR, de référence, du schema manifest, des catalogues viewport/locale/états et des
scripts de parité. G0 vérifie le contenu via `git cat-file`, pas le fichier du worktree.

`environment-lock.json` contient : référence path/hash ; image digest ; Bun/Playwright ;
hashes `bun.lock`, root/app `package.json`, `playwright.config.ts` ; browser args ; horloge
postérieure à toutes les fixtures, seed et timezone ; DPR `[1,2]` ; motion
`[reduce,no-preference]` ; profils locale `fr-FR/ltr`, `de-DE/ltr`, `ar/rtl` ; fontes
path/hash/famille calculée ; TypeScript `5.8.2`, PostCSS `8.5.26`, axe `4.13.0` et Biome
`2.4.14`. Son schema JSON interdit tout champ implicite.

La CI produit séparément `parity-run.json` avec `sourceCommit`, `sourceTree`,
`qualificationBaseCommit`, `targetBranchHeadAtRun`, hashes des deux verrous, du manifest
fusionné, de la baseline de skips, de l'image et de chaque preuve.
La CI ne réécrit jamais le verrou. Un changement d'entrée nécessite une PR explicite
`chore(v110): update parity environment lock`, avec raison et re-review.

Le repo déclare `bun@1.3.11` tandis que le host local courant exécute `1.3.14`. Seul le
binaire dans l'image produit une preuve autorisante ; la divergence du host est un warning.
G1 runtime, G2, mutations et G3 de qualification s'exécutent tous dans l'image.

### 3.3 G0 — gate d'autorité

`bun run --cwd packages/app parity:lock:check` échoue si :

- plan commité, ADR, lockfile, package, config, script, version, argument navigateur, fonte
  ou dimension runtime diverge ;
- le fichier de référence a changé, même par normalisation de fin de ligne ;
- l'image n'est pas pinnée par digest ;
- le manifest ou le catalogue de viewports n'est pas celui du verrou ;
- une preuve existante vise un autre commit ou un autre verrou.

Un test de mutation change le seed, l'heure, la locale, le DPR, une fonte et le hash de
référence ou du lockfile ; chaque changement invalide le run. Un test d'isolation écrit
cookie, localStorage, IndexedDB, cache et service worker dans un BrowserContext puis prouve
leur absence dans l'autre. L'issue #116 doit pointer vers le plan R5 avant P1, mais sa
description n'entre pas dans le calcul de preuve.

S0 utilise la Compiler API TypeScript `5.8.2` déjà directe pour TS/TSX, ajoute PostCSS
`8.5.26` comme devDependency directe pour CSS, et utilise Playwright DOM pour la référence.
Roots, exclusions, catégories et versions sont dans le script ; deux runs produisent un JSON
byte-identical. Aucun `grep` ne sert d'oracle.

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
- La séquence de clés et l'unicité doivent être identiques ; permuter deux nœuds échoue.
- Réordonner le DOM en conservant les mêmes clés doit rester vert ; changer une clé échoue.
- G1 vérifie au runtime que les attributs existent et que les ensembles de valeurs sont
  identiques des deux côtés ; l'exemple n'est jamais accepté comme preuve.

Le census runtime est généré indépendamment du manifest. Tout nœud interactif visible doit
être contenu dans une ancre ; tout autre nœud peint doit être couvert par une ancre, un
masque minimal ou la région résiduelle. Retirer une entrée du manifest sans toucher à la
référence doit produire `untrackedReferenceNodes > 0`.

### 4.3 Dispositions et ledger legacy

Dispositions : `port`, `intentional-difference`, `blocked-external`,
`retain-internal-instrumentation`, `delete-dead-instrumentation`.
`retain-internal-instrumentation` est interdit pour une ancre ou un nœud du census et ne
peut exempter `--v110-*` qu'avec preuve d'absence visuelle. `intentional-difference` garde
un masque nul, une capture et une approbation produit. Les blocages externes utilisent
`escalationOwner`, `nextReviewAt` et `blocksQualifications`; leur expiration bloque la
qualification affectée et déclenche l'escalade, pas toutes les autres lanes.

`legacy-hook-ledger.json` inventorie par AST/CSS parser tokens, `data-v110`, sélecteurs et
fallbacks. Il publie `cssTargetedLegacyValues`, `cssTargetedValuesMissingFromMarkup`,
`markupLegacyValues`, `markupValuesWithoutCssRule`, `workFamilyMarkupValues` et
`literalFallbackExpressions`.

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
`untrackedReferenceNodes`, `retainReferencedAnchors`, `expiredExemptions`,
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

Chaque scène déclare `readyPredicate`, fixtures réseau, séquence d'interaction, timers
autorisés, délai maximum et vecteur d'état. Un timer ou une mutation tardive inconnue échoue.
L'inventaire AST des timers est classé par call site et déclencheur ; le runtime vérifie que
les appels observés appartiennent au registre. Capture A, avance d'horloge bornée, capture B :
A et B doivent être octet-identiques.

La référence gelée n'est jamais mutée, même par ajout de `data-*`. Les nœuds dynamiques
sont localisés par rôle, texte et relation DOM après la séquence d'interaction ; G0 compare
le DOM avant/après installation du harness et exige zéro mutation. Le test d'isolation de
§3.3 fait partie de l'acceptation du runner.

### 5.2 Mesures par ancre

Chaque ancre appariée produit :

| Mesure | Contrat |
|---|---|
| `absoluteBoxDelta` | seuil du profil sur `x/y/width/height` |
| `relativeBoxDelta` | même mesure relativement au parent apparié |
| `styleDelta` | égalité des propriétés du profil, pseudo-éléments inclus |
| `textDelta` | zéro pour texte, placeholder et nom accessible statiques |
| `structuralMiss` | nœud/clé attendu non appariable ; doit être zéro |
| `anchorDiffPixels` | inférieur ou égal au budget absolu **et** au ratio du profil |
| `xOverflow` | zéro dans le cas de capture |

Les profils partent de zéro pixel différent. Une tolérance non nulle exige un artifact A/A
hashé : vingt paires référence/référence consécutives dans G0, union spatiale du bruit,
puis une paire de validation qui ne doit produire aucun pixel hors enveloppe. L'enveloppe,
le budget absolu/ratio, l'owner et l'approbation du rôle C sont versionnés. Une différence
app/référence hors positions de bruit connues échoue même si le nombre total reste bas.

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

G2 statique certifie `no-preference` à t=0 puis à l'état final, sans CSS injecté qui change
les styles calculés ; `reduce` est un cas supplémentaire. S14 active le temps, compare
durées/easings/trajectoires/états finaux et vérifie `reduced-motion`.

### 5.5 Mutations obligatoires

`bun run --cwd packages/app parity:mutations` doit détecter au minimum :

1. règle visible, propriété de profil ou branche/nœud supprimé ; doublon caché/visible ;
2. inline, `!important`, import CSS, media query, `hover` ou `focus-visible` fautif ;
3. permutation/changement de clés et réordre DOM conservant les clés ;
4. marqueur+sélecteur supprimés, état ou entrée manifest retiré malgré policy/census ;
5. masque total/statique/chevauchant, ou preuve de référence absente ;
6. seed, horloge, fonte, DPR, locale, lockfile ou config divergents ;
7. fuite entre contextes ou mutation du DOM de référence par le harness ;
8. timer inconnu ou mutation après capture A.

---

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

S0 commit `e2e-skip-baseline.json` (IDs de tests et statuts) depuis l'image verrouillée et
en verrouille le hash. Avant promotion, la suite complète passe : nouveau skip ou test
disparu sans disposition = échec ; un ancien skip redevenu PASS est accepté et publié.

S0 vérifie la famille calculée de chaque fonte dans la référence. Toute fonte requise est
packagée et hashée, injectée des deux côtés, puis le réseau externe est bloqué. Une fonte
distante ou de fallback inattendue échoue avant capture.

---

## 7. Pilote vertical avant infrastructure

### P0 — gouvernance minimale

La première PR accepte ADR-042, consigne O1–O3, met à jour #116, commit les deux locks,
l'image pinnée, le serveur de référence immuable et un runner ciblé Home. Elle produit les
captures rouges « avant » pour les deux ancres, sans construire le framework général.

### P1 — premier pixel visible, deuxième PR maximum

Une seule tranche Home porte `.home-title` et `.home-modes-row` sur `desktop-wide`, thème
dark, états `default`, `hover:design` et `focus-visible:design`. Les six pills utilisent
`.home-mode-pill` et la clé
`data-home-open-mode`, toutes deux vérifiées dans la maquette. La PR fournit :

- capture référence, capture avant, capture après et heatmap ;
- mesure locale des deux ancres ;
- résultat G1/G2 pour les deux ancres avec seuils finaux, pas un seuil provisoire ;
- comparaison côte à côte signée dans l'issue comme confirmation non normative ;
- test fonctionnel du clic d'une mode pill ;
- liste exacte des fichiers modifiés.

Succès binaire : `.home-title` et `.home-modes-row` passent géométrie, styles, texte et
pixels sous leur profil final ; les six pills sont appariées par clé ; les trois vecteurs
d'état et le clic fonctionnel passent. Une simple baisse du diff ne suffit pas.

Si la deuxième PR depuis l'acceptation de R5 n'atteint pas ce gate, aucune fondation
supplémentaire n'est autorisée. Le plan revient en review avec cause racine et preuves.

P1 est une preuve de direction, pas une certification finale. Le même cas est rejoué par le
harness final avant de fermer S3.

---

## 8. Slices d'exécution et DAG

Chaque PR modifie au plus 400 LOC hors artifacts générés placés dans une PR séparée. Les
estimations sont recalculées après le pilote ; aucun nombre total de PR n'est une promesse.

| Slice | Portée | Gate de sortie |
|---|---|---|
| P0 | gouvernance, locks, image et runner Home minimal | autorité gelée ; captures rouges reproductibles |
| P1 | pilote Home vertical | deux ancres et états pilotes passent le contrat final |
| S0 | extension G0, census, schema, inventaire, ledger, skip baseline | locks et compteurs reproductibles |
| S1 | G1/G2, serveur commun, contextes isolés, timers, mutations | deux runs identiques ; mutations rouges |
| S2 | tokens, mapping Tailwind, fontes, collision gate | re-extraction identique ; API sentinelle stable |
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
P0 -> P1 -> S0 -> S1 -> S2 -> S3 -> S4
                                      |-> S5 -> S6 --|
                                      |-> S7 -> S9 --|
                                      |-> S10 -------|-> S13 -> S14 -> S15
                                      |-> S11 -------|
                                      |-> S12 -------|
                                      `-> S8 --------|
```

Les branches de slice sont `feat/116-r5-sX-<scope>` depuis le HEAD `new-ui` revalidé. Les
PR de slice ciblent `new-ui`. La promotion `new-ui -> work-design` est une PR séparée,
explicitement autorisée après S15.

---

## 9. Frontière Design

P0 crée `design-ownership.json` avec `baseSha`, allowlist chrome, denylist runtime/canvas,
`ownerGithubLogin`, `escalationOwnerGithubLogin`, issue et `nextReviewAt`. L'approbation est
demandée dès P0. Sans réponse à S4, le statut devient `AWAITING_OWNERSHIP_APPROVAL` et est
escaladé ; un refus devient `CONTESTED`. Les autres surfaces continuent, mais seule une
qualification `NON_DESIGN_ONLY_<statut>` peut être publiée. `FULL_PARITY` et la promotion
finale restent bloquées tant que S8 ne passe pas.

Le modal Approval Gate de la maquette n'a pas de classe `.approval-gate` : il est créé par
interaction avec le bouton `Inspecter`. Le fragment S7 décrit cette séquence et le reference
harness localise le dialog par rôle, titre et relation DOM, sans mutation de la référence.

---

## 10. Boucle autonome par PR

1. Revalider top-level, branche, HEAD, dirty state, remote et issue #116.
2. Vérifier G0 ; arrêter si une autorité a changé.
3. Ouvrir le fragment de la slice et son inventaire de fichiers autorisés/interdits.
4. Activer le cas rouge et prouver qu'il échoue pour la bonne raison.
5. Modifier la plus petite responsabilité cohérente.
6. Exécuter G0, G1, G2 ciblé et G3 ciblé.
7. Exécuter les mutations concernées et la suite complète requise avec
   `PLAYWRIGHT_WORKERS=1` si la mémoire du host l'exige.
8. Publier JSON, captures, heatmap, ledger delta, commandes et exit codes.
9. Mettre à jour l'issue ; commit conventionnel ; PR vers `new-ui`.
10. Ne jamais merger, promouvoir ou pousser une branche stable sans autorité explicite.

Si `new-ui` avance, la slice rebase sur le nouveau tip puis rejoue les gates impactés ;
`targetBranchHeadAtRun` est mis à jour. L'environment lock ne change que si une de ses
entrées change. Les PR sont sérialisées par merge queue quand leurs fichiers se recouvrent.

Arrêt immédiat si : décision manquante, hash divergent, licence non prouvée, capability
absente non disposée, mutation non détectée, preuve manquante, régression fonctionnelle,
a11y cassée ou ownership conflictuel.
Deux échecs consécutifs du même gate avec la même cause racine renvoient le plan en review ;
aucun troisième essai d'infrastructure n'est lancé sans décision explicite.

---

## 11. Definition of Done

- [ ] O1–O3, ADR-042, issue #116, plan commité et locks sont cohérents.
- [ ] `parity-run.json` désigne commit, base, target head et preuves exacts.
- [ ] Schema, cardinalité, clés, state-policy, census et ledger passent sans total manuel.
- [ ] Ancres et résidu passent géométrie, styles, texte, structure et pixels sous enveloppes A/A.
- [ ] Masques minimaux : aucun texte statique, contrôle, chrome ou nœud non déclaré.
- [ ] DPR, thèmes, viewports, états, locales et motion applicables passent.
- [ ] Mutations, tokens, fontes, G3 et skip baseline passent dans l'image.
- [ ] Browser, Automate et Design reflètent leurs capabilities réelles.
- [ ] Chaque PR publie JSON, captures, heatmap, commandes et exit codes.
- [ ] A–D exécutables puis E donnent GO sans P0 ; promotion séparée explicitement autorisée.

---

## 12. Review multi-IA autorisante

`PROMPT-REVIEW-MULTI-IA-R5.md` exige quatre rapports A–D, deux familles de modèles et
contextes d'outils, identité Git et résultats exécutés, puis une synthèse E. Un rapport sans
repo est `DOCUMENT-ONLY`. Autorisation : quatre rôles exécutables et zéro P0.

Le vote majoritaire ne remplace jamais une preuve. Un conflit factuel est rejoué par une
commande déterministe ou reste ouvert.

**VERDICT R5** : prêt pour review indépendante ; non autorisé pour implémentation avant O1–O3
et la review autorisante ci-dessus.
