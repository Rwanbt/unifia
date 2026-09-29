<!-- SPDX-License-Identifier: MIT -->

# PLAN R4 — Parité visuelle v110, pilote visible et preuves locales

> **Statut** : PROPOSÉ — remplace R3 après synthèse des reviews Claude, DeepSeek,
> Mistral, MiniMax et Qwen.
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

R4 empêche cette répétition avec quatre contraintes :

1. une amélioration rendue doit être visible au plus tard dans la deuxième PR ;
2. chaque preuve compare référence et app dans le même Chromium, mais dans des contextes
   isolés et verrouillés ;
3. chaque ancre est appariée positivement et mesurée localement ;
4. aucun total manuscrit, masque large, `skip` ou suppression de marqueur ne peut produire
   un faux vert.

Le résultat final est un port visuel de toute la maquette applicable : accueil, shell,
session/chat, Code, Work, Design, Automate, Browser, Memory, Settings, User, overlays,
responsive, thèmes, états, DPR et locales de forme. Une surface bloquée par un runtime réel
reste explicitement bloquée ; elle n'est ni simulée ni comptée comme paritaire.

### 0.1 Faits locaux conservés comme diagnostic

Les mesures R3 restent un instantané, pas des gates : 168 lecteurs internes `--v110-*`,
12 lectures externes, 16 valeurs `data-v110` ciblées par CSS, 8 cibles absentes du markup,
45 valeurs de markup, 37 sans règle, 28 valeurs de la famille `work-*`, 12 fallbacks
littéraux, 229 `setTimeout`, 131 `requestAnimationFrame`, 4 `setInterval`, 25
`Math.random` et 88 tokens `Date`. S0 les reproduit par parseur ; aucun `git grep` générique
ne fait autorité.

Le dépôt compte environ 3 318 fichiers source et 78,6 Mo de source. R4 est une review ciblée
du système de parité, pas un audit comportemental exhaustif de tout le monorepo.

### 0.2 Ce que la review R3 a changé

- suppression de tout total de cas normatif et de la promesse de 40 PR ;
- verrou complet des entrées déterministes ;
- appariement obligatoire des collections ;
- diff pixel local par ancre et contrôle de la scène hors ancres ;
- interdiction de masquer du texte statique ;
- pilote Home visible avant la construction complète du harnais ;
- G3 défini par commandes et critères exacts ;
- PR de slices vers `new-ui`, puis promotion séparée vers `work-design` ;
- protocole de review unique : rôles A–D exécutables, puis synthèse E.

La matrice d'arbitrage complète est dans
`REVIEW-MULTI-IA-R3-SYNTHESIS-2026-09-17.md`.

---

## 1. Décisions propriétaire

Ces trois décisions seulement peuvent bloquer l'exécution :

| ID | Décision | Recommandation | Bloque |
|---|---|---|---|
| O1 | Accepter ADR-042 et la définition de parité de R4 ? | Oui | P0 |
| O2 | Browser et Memory sont-ils des modes de premier rang, avec état indisponible honnête quand le runtime manque ? | Oui | S4/S9/S12 |
| O3 | Autoriser l'implémentation après quatre reviews A–D exécutables et une synthèse E sans P0 ? | Oui | première PR |

Une réponse est consignée dans l'issue #116 et dans ADR-042. L'absence de réponse est un
arrêt explicite, jamais une hypothèse silencieuse.

---

## 2. Vocabulaire normatif

- **Scène** : route/surface et fixture fonctionnelle nommées, par exemple `home.default`.
- **Vecteur d'état** : état déterministe d'une scène, avec une cible précise pour chaque
  interaction (`home.mode.design:hover`, `settings.modal:open`).
- **Cas de capture** : `scene × viewport × theme × stateVector × DPR × localeProfile`.
- **Assertion d'ancre** : `anchorId × cas de capture`.
- **Run de scène** : une exécution d'un cas de capture produisant capture, mesures et logs.
- **Preuve** : résultat JSON plus captures référence/app, heatmap et provenance.

Les compteurs `captureCaseCount`, `anchorAssertionCount`, `sceneRunCount` et leurs
dimensions sont calculés depuis le manifest et publiés dans `parity-result.json`. Le schema
interdit un champ `expectedTotal` et le linter du plan refuse un total normatif dupliqué.

---

## 3. Autorités et verrou de preuve

### 3.1 Ordre des autorités

1. apparence : maquette gelée ;
2. comportement : `INTERACTIONS.md`, stores et capabilities réels ;
3. responsive : `RESPONSIVE-MATRIX.md` ;
4. architecture : ADR acceptés, avec ADR-042 supersédant ADR-038 ;
5. travail actif : issue #116.

### 3.2 Deux fichiers, pas de SHA auto-référentiel

S0 crée un verrou d'entrée commité et immuable pendant un run :

`docs/ui-reference/v110/parity/environment-lock.json`

```json
{
  "schemaVersion": 2,
  "plan": "R4",
  "workDesignBase": "<full SHA>",
  "referencePath": "docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html",
  "referenceSha256": "<sha256>",
  "manifestSchemaSha256": "<sha256>",
  "viewportCatalogSha256": "<sha256>",
  "playwrightVersion": "1.57.0",
  "containerImage": "<image@sha256:digest>",
  "bunVersion": "<packageManager value>",
  "browserArgs": [],
  "fixedClockUtc": "2025-01-01T00:00:00.000Z",
  "randomSeed": 110,
  "timezone": "Europe/Paris",
  "locale": "fr-FR",
  "localeCatalogSha256": "<sha256>",
  "devicePixelRatios": [1, 2],
  "motionProfiles": ["reduce", "no-preference"],
  "reducedMotionStaticGate": "reduce",
  "fontSet": [{ "path": "<repo path>", "sha256": "<sha256>" }]
}
```

La CI produit séparément `parity-run.json` avec `sourceCommit`, `sourceTree`, hash du
verrou, hash du manifest fusionné, image réellement exécutée et digest de chaque preuve.
La CI ne réécrit jamais le verrou. Un changement d'entrée nécessite une PR explicite
`chore(v110): update parity environment lock`, avec raison et re-review.

Le repo déclare `bun@1.3.11` tandis que le host local courant exécute `1.3.14`. S0 ne prend
pas le host pour autorité : l'image de parité installe la version déclarée et G0 échoue sur
toute divergence.

### 3.3 G0 — gate d'autorité

`bun run --cwd packages/app parity:lock:check` échoue si :

- un hash, une version, un argument navigateur, une fonte ou une dimension runtime diverge ;
- le fichier de référence a changé, même par normalisation de fin de ligne ;
- l'image n'est pas pinnée par digest ;
- le manifest ou le catalogue de viewports n'est pas celui du verrou ;
- une preuve existante vise un autre commit ou un autre verrou.

Un test de mutation change le seed, l'heure, la locale, le DPR, une fonte et le hash de
référence ; chaque changement doit invalider le run.

---

## 4. Contrat positif et G1

### 4.1 Manifest par surface

Les fragments vivent sous `packages/app/e2e/v110/parity-manifest/*.json`. S0 les valide et
les fusionne dans un ordre lexical. Exemple fondé sur la maquette réelle :

```json
{
  "id": "home.mode-pill",
  "slice": "S3",
  "scene": "home.default",
  "reference": { "selector": ".home-mode-pill", "count": 6 },
  "app": { "selector": "[data-parity='home.mode-pill']", "count": 6 },
  "matchBy": { "kind": "attribute", "reference": "data-home-open-mode", "app": "data-mode" },
  "viewports": ["desktop-wide", "desktop-compact", "tablet-portrait", "phone-portrait", "compact-landscape"],
  "themes": ["dark", "light"],
  "stateVectors": ["default", "hover:design", "focus-visible:design"],
  "styleProfile": "control-v1",
  "mask": null,
  "disposition": "port"
}
```

Champs obligatoires : identité, slice, scène, sélecteurs, cardinalités DOM et visibles,
`matchBy`, viewports, thèmes, vecteurs d'état, profil, masque et disposition.

### 4.2 Cardinalité et appariement

- La cardinalité observée doit égaler la cardinalité déclarée des deux côtés.
- Le comptage DOM inclut aussi les nœuds cachés ; `visibleCount` est vérifié par état.
- `count=1` exige une clé unique implicite.
- `count>1` exige `matchBy.key` ou un attribut stable. `document-order` n'est autorisé
  qu'avec `reason` et devient lui-même un contrat d'ordre.
- La séquence de clés et l'unicité doivent être identiques ; permuter deux nœuds échoue.

### 4.3 Dispositions et ledger legacy

Dispositions : `port`, `intentional-difference`, `blocked-by-runtime`, `retain-nonparity`,
`delete-dead-instrumentation`. Toute disposition autre que `port` exige `reason`, `owner`,
`issue`, `reviewBy` et preuve attendue. Une date expirée échoue.

`legacy-hook-ledger.json` inventorie par AST/CSS parser chaque token, valeur `data-v110`,
sélecteur et fallback. Les compteurs publiés sont nommés :

- `cssTargetedLegacyValues` ;
- `cssTargetedValuesMissingFromMarkup` ;
- `markupLegacyValues` ;
- `markupValuesWithoutCssRule` ;
- `workFamilyMarkupValues` ;
- `literalFallbackExpressions`.

`delete-dead-instrumentation` exige absence de lecteur statique et runtime, absence d'ancre
et rendu équivalent avant/après sur les scènes affectées. Le test générique reste une
mutation d'une règle visible qui doit faire échouer G2 ; supprimer un hook réellement mort
n'est pas censé faire échouer G2.

### 4.4 G1 — schema puis DOM rendu

`bun run --cwd packages/app parity:contract` exécute :

1. validation statique du schema, ledger, expirations et couverture ;
2. validation runtime des deux DOM rendus dans l'environnement G0.

Il exige zéro : `schemaErrors`, `cardinalityErrors`, `pairingErrors`,
`duplicateAllDomIds`, `missingStateCoverage`, `unownedLegacyHooks`,
`expiredExemptions`, `staticTextMaskViolations`, `maskOverlapViolations`,
`maskBudgetViolations`, `parityHookProductionReferences`, `forbiddenTokenPatterns`.

`data-parity` peut être émis par le JSX mais ne peut être utilisé comme sélecteur CSS,
style inline ou requête runtime hors `packages/app/e2e/v110/parity/**`. Le scan couvre CSS,
TS/TSX et chaînes de sélecteurs.

---

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

Les profils partent de zéro pixel différent. Une tolérance non nulle n'est créée qu'après
une étude A/A dans l'environnement G0 prouvant du bruit incompressible ; elle est locale,
versionnée, justifiée et bornée simultanément en pixels et en ratio. Il n'existe plus de
tolérance globale `0,10 %` de la scène.

Un diff de scène complète vérifie aussi qu'aucun pixel différent ne se trouve hors de
l'union des crops d'ancres et masques déclarés. Ainsi, un élément non déclaré ne disparaît
pas entre les mailles du contrat.

### 5.3 Politique de masque

Le défaut est `mask: null`. Un masque :

- vise uniquement une valeur feuille réellement dynamique ;
- déclare sélecteurs, raison, fixture, `maxPixels`, `maxRatio`, owner, issue et `reviewBy` ;
- ne peut couvrir ni ancêtre, ni chrome, ni contrôle, ni nœud non déclaré ;
- reste soumis à géométrie, structure, style du contenant et contrat sémantique de fixture.

Libellés, titres, placeholders, `aria-label`, textes statiques et icônes fonctionnelles ne
sont jamais masqués. Le total masqué est publié, mais aucun plafond arbitraire « 5 masques »
ou « 25 % » n'est accepté : chaque valeur dynamique doit justifier sa boîte minimale.

### 5.4 Styles et motion

Les profils statiques couvrent layout, paint, typographie, visibilité, contenu/pseudo-
éléments, interaction visuelle et transform. Ils incluent notamment `text-decoration`,
`text-shadow`, `outline-offset`, `visibility`, `pointer-events`, `cursor`, `caret-color`,
`accent-color`, `color-scheme`, `scrollbar-*`, `list-style` et `border-collapse` lorsque
applicables. Toute exclusion est déclarée et attaquée par mutation.

G2 statique fige l'animation et n'utilise pas les valeurs injectées comme preuve de motion.
S14 active les animations, compare durées/easings/états finaux et vérifie `reduced-motion`.

### 5.5 Mutations obligatoires

`bun run --cwd packages/app parity:mutations` doit détecter au minimum :

1. règle visible supprimée ;
2. style inline ou `!important` écrasant la valeur ;
3. ordre d'imports CSS inversé ;
4. propriété visible retirée du profil ;
5. nœud apparié supprimé ou branche non montée ;
6. doublon caché ou visible ;
7. deux clés appariées permutées ;
8. marqueur legacy et sélecteur supprimés ensemble ;
9. différence limitée à `hover` ou `focus-visible` ;
10. media query active fautive ;
11. masque total, masque sur texte statique ou masque chevauchant un nœud non déclaré ;
12. seed, horloge, fonte, DPR ou locale divergents ;
13. preuve de référence absente ;
14. timer inconnu ou mutation après capture A.

---

## 6. G3 — fonction, accessibilité et régression

G3 est binaire. Les commandes existantes sont :

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

Avant promotion, `bun run --cwd packages/app test:e2e` passe sans nouvelle régression ; le
delta de skips par rapport au run verrouillé est zéro. Les skips historiques hors parité
sont publiés, jamais transformés en PASS de qualification.

---

## 7. Pilote vertical avant infrastructure

### P0 — gouvernance minimale

Une PR accepte ADR-042, consigne O1–O3, met à jour le lien de l'issue #116 et ajoute le
schema minimal du verrou. Aucun framework général n'est construit ici.

### P1 — premier pixel visible, deuxième PR maximum

Une seule tranche Home porte `.home-title` et `.home-modes-row` sur `desktop-wide`, thème
dark, état default. Les six pills utilisent `.home-mode-pill` et la clé
`data-home-open-mode`, toutes deux vérifiées dans la maquette. La PR fournit :

- capture référence, capture avant, capture après et heatmap ;
- mesure locale des deux ancres ;
- comparaison manuelle côte à côte signée dans l'issue ;
- test fonctionnel du clic d'une mode pill ;
- liste exacte des fichiers modifiés.

Condition d'arrêt : si la deuxième PR depuis l'acceptation de R4 ne produit pas une
amélioration visible et mesurée sur Home, aucune fondation supplémentaire n'est autorisée.
Le plan revient en review avec cause racine, temps consommé et preuve du blocage.

P1 est une preuve de direction, pas une certification finale. Le même cas est rejoué par le
harness final avant de fermer S3.

---

## 8. Slices d'exécution et DAG

Chaque PR modifie au plus 400 LOC hors artifacts générés placés dans une PR séparée. Les
estimations sont recalculées après le pilote ; aucun nombre total de PR n'est une promesse.

| Slice | Portée | Gate de sortie |
|---|---|---|
| P0 | ADR, décisions, issue, schema minimal | O1–O3 consignées ; autorité gelée |
| P1 | pilote Home vertical | première amélioration visible et fonctionnelle |
| S0 | G0, manifest schema, inventaire AST, ledger, package scripts | verrou et compteurs reproductibles |
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

Les branches de slice sont `feat/116-r4-sX-<scope>` depuis le HEAD `new-ui` revalidé. Les
PR de slice ciblent `new-ui`. La promotion `new-ui -> work-design` est une PR séparée,
explicitement autorisée après S15.

---

## 9. Frontière Design

S0 crée `design-ownership.json` avec `baseSha`, allowlist chrome, denylist runtime/canvas,
`ownerGithubLogin`, issue et `reviewBy`. La CI compare le diff S8 à cette frontière.

L'owner dispose de deux jours ouvrés après S4 pour approuver. Sans réponse, S8 devient
`blocked-by-runtime` et les surfaces indépendantes continuent. Une qualification
`NON_DESIGN_ONLY` peut être publiée avec ce libellé exact ; elle n'est jamais appelée
« parité complète ». `FULL_PARITY` et la promotion finale restent bloquées tant que S8 ne
passe pas.

Le modal Approval Gate de la maquette n'a pas de classe `.approval-gate` : il est créé par
interaction avec le bouton `Inspecter`. Le fragment S7 décrit cette séquence et le reference
adapter ajoute un attribut de mesure neutre après avoir vérifié le titre `Approval Gate`.

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

Arrêt immédiat si : décision manquante, hash divergent, licence non prouvée, capability
absente non disposée, mutation non détectée, preuve manquante, régression fonctionnelle,
a11y cassée ou ownership conflictuel.

---

## 11. Definition of Done

- [ ] O1–O3, ADR-042 et issue #116 sont cohérents avec R4.
- [ ] G0 prouve toutes les entrées et `parity-run.json` désigne le commit testé.
- [ ] Tous les fragments passent schema, cardinalité, appariement et couverture calculée.
- [ ] Aucun total manuscrit ne contredit les compteurs générés.
- [ ] Aucun hook de mesure ne style ou pilote le runtime de production.
- [ ] Chaque hook legacy a une disposition valide et non expirée.
- [ ] Chaque assertion d'ancre passe géométrie absolue/relative, styles, texte, structure et pixels.
- [ ] Aucun diff de scène n'existe hors ancres et masques déclarés.
- [ ] Aucun texte statique, contrôle, chrome ou nœud non déclaré n'est masqué.
- [ ] DPR1/DPR2, thèmes, viewports, états et profils de locale applicables passent.
- [ ] Toutes les mutations obligatoires sont détectées.
- [ ] Tokens et fontes sont reproductibles, licenciés et sans collision non résolue.
- [ ] Browser, Automate et Design reflètent leurs capabilities réelles.
- [ ] G3 ciblé et complet est vert ; aucun nouveau skip n'est introduit.
- [ ] Chaque PR possède résultats JSON, captures et commandes reproductibles.
- [ ] Les rôles A–D exécutables et la synthèse E concluent GO sans P0.
- [ ] La promotion vers `work-design` est séparée et explicitement autorisée.

---

## 12. Review multi-IA autorisante

Le protocole unique est défini par `PROMPT-REVIEW-MULTI-IA-R4.md` :

1. quatre rapports indépendants A–D ;
2. au moins deux familles de modèles et deux contextes d'outils indépendants ;
3. chaque rôle donne repo, branche, SHA, dirty state, commandes et résultats ;
4. un rapport sans accès repo est `DOCUMENT-ONLY` : utile, mais sans voix GO ;
5. une synthèse E déduplique, arbitre par preuve et classe P0/P1/P2 ;
6. autorisation seulement avec quatre rôles exécutables et zéro P0 ouvert.

Le vote majoritaire ne remplace jamais une preuve. Un conflit factuel est rejoué par une
commande déterministe ou reste ouvert.

**VERDICT R4** : prêt pour review indépendante ; non autorisé pour implémentation avant O1–O3
et la review autorisante ci-dessus.
