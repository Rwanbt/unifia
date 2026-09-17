<!-- SPDX-License-Identifier: MIT -->

# PLAN R3 — Parité visuelle v110, contrat positif et preuve reproductible

> **Statut** : PROPOSÉ — remplace R2 après review indépendante NO-GO.
> **Suivi** : GitHub issue #116.
> **Date** : 2026-09-17.
> **Worktree vérifié** : `D:\App\unifia\_a7-automate-memory`.
> **Branche vérifiée** : `new-ui` à `20b2829bbc45f01ed9ee70b0d658026de0bec9f4`.
> **Base locale vérifiée** : `work-design` à `d212bc8098af43ca64a8c4456263dfdb44a56190`.
> **Autorité d'apparence** : `Unifia-UI-UX-v110-PORT-READY-R1.html`, gelée ; aucune PR ne la modifie.
> **Règle de vérité** : aucune déclaration de parité sans preuve rendue G2 dans l'environnement verrouillé.

---

## 0. Pourquoi R3 existe

Une semaine de travail a produit une branche très volumineuse sans parité visuelle perceptible.
Le problème n'est pas un manque d'effort : le système de travail a permis de confondre quantité
de code, marqueurs HTML, règles CSS et tests verts avec un changement réellement rendu.

Faits vérifiés lors de la review de R2 :

- `new-ui` contient 801 commits au-dessus de `dev` au moment de la mesure de R2 ;
- le JSX rendu de l'accueil n'avait pas été remplacé ; `home.tsx` est bien la route `/`
  (`packages/app/src/app.tsx:57,451`) ;
- le `createEffect` de `home.tsx:79-83` est réellement imbriqué dans `chooseProject()` et
  doit être corrigé avant de porter l'accueil ;
- R2 comptait 16 tokens sans lecteur **hors** `v110.css`, mais `v110.css` contient 168 appels
  internes `var(--v110-*)` ; W1 ne mesurait donc pas la vivacité du token ;
- le scan production trouve 12 lectures externes, réparties sur 5 tokens ; elles ne
  remplacent pas l'analyse des lecteurs internes et de l'effet rendu ;
- `--v110-radius-sm` est un contre-exemple concret : déclaration `v110.css:24`, lectures
  `v110.css:159-...`, cible réelle `terminal.tsx:1028` ;
- 16 valeurs `data-v110` sont ciblées par CSS, dont 8 absentes du markup ;
- 45 valeurs sont présentes dans le markup, dont 37 sans règle CSS ; la famille `work-*`
  en contient **28**, pas 25 ;
- il existe **12** fallbacks littéraux réels après exclusion des commentaires et tests,
  pas 13 ; l'occurrence supplémentaire de R2 venait d'un commentaire ;
- les listes de cas de R2 décrivaient 18 scènes par thème, donc 36 cas, tout en annonçant 24 ;
- si Browser et Automate sont inclus comme l'exige l'inventaire des huit vues, le noyau
  décrit ci-dessous contient **40 cas DPR1** ;
- les estimations de PR de R2 totalisaient 39, pas 37 ; avec l'ADR préalable, 40 ;
- `--faint:#85858d` est à la ligne **5560** de la maquette, pas 5557 ;
- la maquette contient 229 `setTimeout`, 131 `requestAnimationFrame`, 4 `setInterval`,
  25 `Math.random` et 88 tokens `Date`, pas les chiffres annoncés par R2 ;
- les huit baselines existantes sont `win32`, alors que la CI E2E tourne sur Ubuntu et
  ignore la baseline manquante (`design-visual.spec.ts:142`) ;
- `ADR-039-merge-base` n'est pas une référence Git ; le critère Design de R2 était inexécutable.

Ces chiffres sont un **instantané de diagnostic**, pas des critères de succès. R3 interdit de
transformer des compteurs de texte en preuve visuelle.

### 0.1 Chaîne de l'échec précédent

```text
volume de code élevé
        │
        ▼
marqueurs + CSS + tokens ajoutés en parallèle
        │
        ├── lecteurs internes ignorés par W1
        ├── fallbacks/commentaires mal comptés
        ├── sélecteurs et marqueurs sans contrat positif
        └── baselines Linux absentes donc test ignoré
        │
        ▼
CI verte sans preuve de rendu
        │
        ▼
une semaine consommée, écran sans parité perceptible
```

### 0.2 Principe de correction

```text
autorité gelée + hash
        │
        ▼
manifest positif par scène/ancre/état
        │
        ├── G1 : le contrat est complet et les deux DOM sont appariables
        ├── G2 : les deux rendus sont comparés dans le même navigateur verrouillé
        └── G3 : les fonctions, l'accessibilité et le responsive ne régressent pas
        │
        ▼
preuve versionnée ou échec explicite, jamais SKIP
```

---

## 1. Décisions propriétaire — trois maximum

Le plan tranche toutes les décisions d'ingénierie. Seuls les choix produit irréversibles
restent au propriétaire.

| ID | Décision fermée | Recommandation | Bloque |
|---|---|---|---|
| **O1** | Accepter ADR-042, qui supersede ADR-038, et adopter la parité géométrique + styles + pixels avec contenu dynamique masqué et exceptions §3.7 ? **Oui / Non** | **Oui** | tout |
| **O2** | Browser et Memory sont-ils des entrées de rail de premier rang, avec Browser affichant un état indisponible honnête tant que son runtime manque ? **Oui / Non** | **Oui** | S4, S9, S12 |
| **O3** | Autoriser l'exécution après deux reviews indépendantes GO et une synthèse sans P0 ouvert ? **Oui / Non** | **Oui** | première PR d'implémentation |

Le réglage de police utilisateur est préservé. La parité porte sur sa valeur par défaut :
ce n'est pas une décision propriétaire. Automate reste capability-gated selon ADR-1041.

---

## 2. Autorités, invariants et preuves d'entrée

### 2.1 Autorités

1. Apparence : `docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`.
2. Comportements : `INTERACTIONS.md`, puis stores et capacités réels de l'app.
3. Responsive : `RESPONSIVE-MATRIX.md`.
4. Architecture : ADR acceptés ; ADR-042 doit superseder ADR-038 avant S0.
5. État actif : issue GitHub #116 ; le plan ne remplace pas son statut.

### 2.2 Evidence lock créé par S0

`docs/ui-reference/v110/parity/evidence-lock.json` doit contenir :

```json
{
  "schemaVersion": 1,
  "plan": "R3",
  "appHead": "<full SHA>",
  "workDesignBase": "<full SHA>",
  "referencePath": "docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html",
  "referenceSha256": "<sha256>",
  "playwrightVersion": "<lockfile value>",
  "containerImage": "<image@sha256:digest>",
  "generatedAtUtc": "<ISO-8601>"
}
```

Tout changement de SHA, de maquette, de navigateur ou d'image invalide les preuves et impose
une régénération explicitement reviewée. Aucun script ne met à jour ce fichier silencieusement.

### 2.3 Invariants non négociables

- `data-parity` est un crochet de mesure, jamais un sélecteur de style.
- Une ancre obligatoire existe exactement une fois côté maquette et une fois côté app.
- Un élément supprimé doit avoir une disposition et une preuve ; supprimer pour faire baisser
  un compteur ne peut pas rendre le gate vert.
- G1 ne prouve jamais l'apparence. G2 est obligatoire pour chaque scène activée.
- Référence et app sont capturées dans le même processus Chromium et la même image verrouillée.
- Une preuve manquante est un échec, jamais un `skip`.
- Aucun contenu de démonstration de la maquette n'est introduit dans le runtime de production.
- Aucune régression fonctionnelle n'est acceptée pour satisfaire une métrique visuelle.

---

## 3. Contrat positif de parité

### 3.1 Manifest unique, fragments par surface

Le contrat source est composé de fragments sous
`packages/app/e2e/v110/parity-manifest/*.json`, validés et fusionnés de façon déterministe.
Chaque surface possède son fragment afin de réduire les conflits de worktree.

Exemple normatif :

```json
{
  "id": "home.mode-pill.design",
  "slice": "S3",
  "scene": "home.default",
  "reference": { "selector": ".home-mode-pill[data-mode='design']", "count": 1 },
  "app": { "selector": "[data-parity='home.mode-pill.design']", "count": 1 },
  "viewports": ["desktop-wide", "desktop-compact", "tablet-portrait", "phone-portrait", "compact-landscape"],
  "themes": ["dark", "light"],
  "states": ["default", "hover", "focus-visible", "disabled"],
  "styleProfile": "control",
  "mask": null,
  "disposition": "port"
}
```

Champs obligatoires : `id`, `slice`, `scene`, sélecteurs et cardinalités des deux côtés,
viewports, thèmes, états, profil de style, masque et disposition. Dispositions autorisées :
`port`, `intentional-difference`, `blocked-by-runtime`, `remove-dead-instrumentation`.
Les trois dernières exigent `reason`, `owner`, `issue`, et une date de réexamen.

### 3.2 G1 — gate de contrat, pas gate de vivacité

`packages/app/scripts/parity/contract-gate.mjs` échoue sur :

| Compteur | Condition d'échec |
|---|---|
| `schemaErrors` | fragment non conforme ou champ implicite |
| `missingReferenceAnchors` | cardinalité référence différente de celle déclarée |
| `missingAppAnchors` | cardinalité app différente de celle déclarée |
| `duplicateParityIds` | même `data-parity` visible plusieurs fois quand `count=1` |
| `unownedLegacyHooks` | `data-v110` ou règle associée sans disposition dans le ledger |
| `missingSceneCoverage` | thème, viewport ou état requis absent |
| `maskPolicyViolations` | masque non déclaré, trop large ou visant le chrome |
| `forbiddenTokenPatterns` | token requis non déclaré, namespace `--v110-*` restant après sa slice, ou fallback non autorisé |

Les anciens chiffres `16/8/37/12` sont publiés comme télémétrie de migration. Ils ne sont
jamais exigés globalement à zéro dès S2. Chaque slice active seulement ses propres ancres
et doit ramener à zéro les erreurs de son périmètre.

### 3.3 Ledger anti « delete-to-green »

S0 crée `packages/app/e2e/v110/legacy-hook-ledger.json` avec chaque token, valeur
`data-v110`, sélecteur et fallback existant. Chaque entrée reçoit :

- `ownerSlice` ;
- `action`: `migrate`, `retain-nonparity`, ou `delete-dead` ;
- les lecteurs internes et externes ;
- le sélecteur ou composant affecté ;
- la preuve attendue après action.

`delete-dead` n'est accepté que si aucune règle, aucun lecteur runtime, aucun test de contrat
et aucune ancre de référence ne dépend de l'entrée. Un test de mutation supprime ensuite une
règle réellement visible et doit faire échouer G2.

### 3.4 G2 — gate rendu

Pour chaque entrée active du manifest :

| Mesure | Contrat |
|---|---|
| `boxDelta` | `x/y/width/height ≤ 1 CSS px` ; seuil `0.5 px` sur chrome fixe |
| `styleDelta` | égalité après normalisation selon le profil §3.5 |
| `structuralMiss` | `0` |
| `diffRatio` | `≤ 0,10 %` hors masques ; `≤ 0,05 %` sur chrome pur |
| `maskedPixelRatio` | `≤ 25 %` par scène ; dépassement = décision propriétaire, pas auto-waiver |
| `xOverflow` | `0` sur tous les viewports déclarés |

Les zones masquées restent soumises à `boxDelta`, à la structure et aux styles de contenant.
Il est interdit de masquer rail, topbar, tabs, panneaux, resizers, contrôles ou overlays.

### 3.5 Profils de style

Le harnais compare au minimum :

- **layout** : `display`, `position`, `inset`, `flex-*`, `align-*`, `justify-*`,
  `grid-template-*`, `gap`, `padding`, `margin`, `min/max-width`, `min/max-height`,
  `overflow-x/y`, `z-index` ;
- **paint** : `color`, `background-color`, `background-image`, `border-width/style/color`,
  `border-radius`, `outline`, `box-shadow`, `opacity`, `filter`, `backdrop-filter` ;
- **type** : `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`,
  `letter-spacing`, `text-align`, `text-transform`, `white-space` ;
- **motion/transform** : `transform`, `transform-origin`, `transition-*`, `animation-*`.

Chaque ancre sélectionne un profil. Une propriété ne peut être exclue qu'avec justification
dans le manifest et un test montrant que l'exclusion n'occulte pas une différence visible.

### 3.6 États obligatoires

Chaque contrôle déclare les états applicables parmi : `default`, `hover`, `active`,
`focus-visible`, `disabled`, `selected`, `expanded`, `open`, `loading`, `empty`, `error`,
`present`, `mobile`. Un état non applicable reçoit une justification, pas une omission.

### 3.7 Exceptions exhaustives

1. Texte et données dynamiques : masqués pour les pixels, géométrie et contenant mesurés.
2. Curseur de saisie et scrollbar native.
3. Sous-pixel GPU inférieur à 1 px, documenté par propriété.
4. Police utilisateur non-défaut ; la valeur par défaut est certifiée.
5. Pixel gate en français ; `de` et `ar` ont un gate responsive et directionnel dédié.
6. Contenu Browser absent : uniquement si O2 est accepté, avec état indisponible réel et
   `blocked-by-runtime` relié à l'issue runtime.

---

## 4. Architecture des tokens et Tailwind v4

R3 n'écrit pas les 98 propriétés de la maquette directement dans `@theme` et ne remplace
jamais les namespaces Tailwind existants. `@theme` génère une API d'utilitaires : la casser
ferait régresser les 198 consommateurs `text-text-strong`, les 14
`bg-icon-success-base`, et les autres classes sémantiques.

```text
maquette gelée + thème dark/light
        │  extraction dans Chromium verrouillé
        ▼
reference-tokens.generated.css
  - noms canoniques de la maquette
  - valeurs calculées
  - en-tête de provenance + hash
        │
        ▼
semantic-token-map.css / fichiers propriétaires existants
  - mappe les concepts app vers les tokens de référence
        │
        ▼
@theme existant reste l'API stable
  --color-text-strong: var(--text-strong)
  --color-icon-success-base: var(--icon-success-base)
        │
        ▼
utilitaires existants inchangés
```

### 4.1 Règles de génération

- génération seulement dans l'image verrouillée de §5 ;
- dark et light extraits séparément après cascade complète ;
- fichier commité avec `referenceSha256`, version Chromium et digest d'image ;
- ordre lexical stable, fin de ligne normalisée, aucune date volatile dans le contenu ;
- test de ré-extraction exécuté dans la même image ;
- rapport de collision pour chaque nom déjà déclaré ailleurs ; collision non résolue = échec ;
- aucun téléchargement de police sans licence vérifiée et fichier de licence commité.

### 4.2 Migration sûre

- les tokens structurels (`--topbar`, `--rail`, `--context`, etc.) sont consommés directement ;
- les tokens sémantiques passent par le mapping existant ;
- un fallback reste autorisé uniquement s'il est dans une allowlist avec raison et test de
  thème absent ; les tokens requis par le contrat n'ont pas de fallback littéral ;
- `--v110-*` est supprimé slice par slice après preuve G2, jamais en big bang ;
- un test compile un jeu sentinelle d'utilitaires Tailwind et vérifie que les sélecteurs et
  valeurs sémantiques restent disponibles.

### 4.3 Police

S2 vérifie d'abord le `font-family` calculé de la maquette. Si Inter est l'autorité, les mêmes
WOFF2 et la licence OFL sont packagés pour l'app et injectés dans la capture de référence.
Le réglage utilisateur existant reste fonctionnel et possède un test de non-régression.

---

## 5. Harnais reproductible

### 5.1 Un seul environnement

S1 crée une image de parité dérivée d'une image Playwright **pinnée par digest**, avec la
version Bun du repo. Le wrapper local et le job CI lancent exactement cette image.
Les captures référence et app sont produites dans le même test, le même contexte Chromium,
le même DPR et les mêmes fontes. Les PNG de preuve sont des artifacts ; les résultats ne
dépendent pas des baselines `win32` existantes.

La CI échoue si Docker/image/browser/hash de référence manque. Elle n'utilise aucun chemin
`test.skip` pour une preuve absente.

### 5.2 Déterminisme par scène

La quiescence générique « trois frames sans mutation » est supprimée. Chaque scène déclare :

- un `readyPredicate` observable ;
- les requêtes/fixtures attendues ;
- les timers autorisés ;
- les animations désactivées ;
- la séquence d'interaction menant à l'état ;
- un délai maximal.

Le harnais fixe `Date`, seed `Math.random`, désactive animations/transitions et instrumente
`setTimeout`, `setInterval` et `requestAnimationFrame`. Après le `readyPredicate`, il fige les
timers décoratifs autorisés, capture A, avance l'horloge d'un intervalle maximal déclaré,
capture B et exige A == B octet par octet. Un timer inconnu ou une mutation tardive échoue.

Les quatre `setInterval` de la maquette sont classés dans S1 par déclencheur. Ils ne peuvent
pas être ignorés simplement parce qu'une fenêtre de trois frames semble calme.

### 5.3 Cas de base exacts

| Groupe | Scènes DPR1 | Thèmes | Total |
|---|---:|---:|---:|
| Accueil | 5 viewports | 2 | 10 |
| Session/chat | 5 viewports | 2 | 10 |
| Code, Work, Design, Automate, Browser, Memory, Settings, User | 8 en desktop-wide | 2 | 16 |
| Palette et modale Settings | 2 en desktop-wide | 2 | 4 |
| **Total noyau** | **20** | **2** | **40** |

S13 étend ensuite les surfaces aux viewports applicables, ajoute DPR2, `de` et `ar`.
Le nombre final est calculé depuis le manifest par CI ; aucun total manuscrit divergent.

### 5.4 Tests du harnais

Le harnais n'est accepté que si les mutations suivantes le font échouer :

1. supprimer une règle CSS visible ;
2. ajouter un style inline ou `!important` qui écrase la valeur ;
3. supprimer un nœud apparié ;
4. dupliquer un `data-parity` ;
5. supprimer à la fois un marqueur legacy et son sélecteur ;
6. masquer tout le viewport ;
7. ne pas monter une branche conditionnelle ;
8. placer la différence derrière une media query active dans un viewport certifié ;
9. retirer la baseline/preuve de référence ;
10. faire muter la scène après la première capture.

---

## 6. Slices et gates de sortie

Chaque PR reste ≤ 400 LOC modifiées hors artifacts générés reviewés séparément. Le nombre
ci-dessous est un **minimum de 40 enveloppes PR**, pas une promesse calendaire. Après S3,
le débit réel est mesuré et l'estimation est recalculée ; aucune nouvelle promesse de durée
ne remplace les données observées.

| Étape | Objectif | Gate binaire | PR min. |
|---|---|---|---:|
| **P0** | ADR-042 + O1/O2 consignées | ADR accepté ; contradiction ADR-038 levée | 1 |
| **S0** | evidence lock, manifest schema, ledger legacy, baseline corrigée `16/8/37/12`, `work-* = 28` | tests G1 verts ; aucun chiffre contradictoire | 1 |
| **S1** | harnais G2 même environnement, 40 cas noyau, tests de mutation | deux runs octet-identiques ; chaque mutation échoue ; zéro skip | 2 |
| **S2** | tokens, mapping sémantique, fonte, migration initiale | utilitaires sentinelles stables ; re-extraction identique ; G2 shell pilote vert | 2 |
| **S3** | accueil : corriger `createEffect`, remplacer le JSX, 5 viewports × 2 thèmes | toutes ancres/états Home verts G1/G2/G3 | 3 |
| **S4** | shell : topbar, rail, tabs, context, inspector, chat, resizers | chrome ≤0,5 px ; O2 reflétée ; aucun hook shell sans disposition | 4 |
| **S5** | session/chat : timeline, docks, composer, vides/chargement/erreur | scènes et états déclarés verts | 3 |
| **S6** | code : arbre, tabs, éditeur, panneaux, terminal | scènes et états déclarés verts | 3 |
| **S7** | Work : conversation, hero, grille, plan, agents, progression, safe action, approval gate | 28 hooks `work-*` tous migrés/disposés ; aucune suppression sans preuve | 3 |
| **S8** | Design chrome selon frontière §7 | ownership gate vert ; runtime ADR-039 intact ; G2 chrome vert | 3 |
| **S9** | Memory : vault, note, liens, graphe | scènes et états déclarés verts | 2 |
| **S10** | Settings, User, palette, modales | scènes et états déclarés verts | 3 |
| **S11** | Automate avec `workflow.run` accordé/refusé | deux capacités testées ; pas de fake runtime | 2 |
| **S12** | Browser selon O2 | runtime réel ou état indisponible explicite ; contrat honnête | 2 |
| **S13** | responsive complet, DPR2, `de`, `ar` | zéro overflow ; DPR1+DPR2 ; LTR+RTL | 2 |
| **S14** | motion et reduced-motion | durées/easings verts ; zéro mouvement en reduced-motion | 2 |
| **S15** | a11y, suite complète, dossier de promotion | DoD §10 ; synthèse de preuves signée | 2 |
| | **Total minimum** | | **40** |

### 6.1 Paquet d'exécution obligatoire par surface

Avant toute modification de surface, sa première PR contient dans le fragment de manifest :

- toutes les ancres de référence et app ;
- la cardinalité ;
- les scènes, viewports, thèmes et états ;
- les masques et leur budget ;
- les tests fonctionnels existants à préserver ;
- les fichiers autorisés et interdits ;
- une capture de départ et les métriques rouges attendues.

S3 et S7 ne commencent pas avec « reproduire la maquette » comme seule instruction.
Le paquet S3 doit au minimum couvrir hero/logo, carte composer, quick chips, six mode pills
et hint. Le paquet S7 doit couvrir les nœuds source de `#view-work` autour de
`Unifia-UI-UX-v110-PORT-READY-R1.html:15423-15480`, plus l'approval gate injecté par le
script de référence, avec états desktop et responsive.

---

## 7. Frontière Design / ADR-039

S0 crée `docs/ui-reference/v110/parity/design-ownership.json` avec :

- `baseSha` exact ;
- allowlist de fichiers chrome ;
- denylist de fichiers runtime/document/canvas ;
- propriétaire de chaque entrée ;
- raison et issue associée.

Le fichier est approuvé par le propriétaire du runtime Design. La CI compare le diff de S8
à cette allowlist et échoue sur toute entrée denylist. Il n'existe plus de pseudo-référence
`ADR-039-merge-base`. Si l'allowlist est vide ou non approuvée, S8 attend sans bloquer les
autres surfaces.

Commits historiques à connaître, sans les transformer en frontière implicite :

- `b9449a2dff` accepte ADR-039 ;
- `1bf720afc4` ajoute les commentaires du document canonique ;
- l'état courant et l'ownership manifest priment sur ces repères historiques.

---

## 8. Exécution autonome et parallélisation

### 8.1 Boucle par PR

1. Revalider top-level, branche, HEAD, dirty state et issue #116.
2. Vérifier `evidence-lock.json` ; arrêter si une autorité a changé.
3. Ouvrir uniquement la slice active et son paquet de manifest.
4. Écrire d'abord le test rouge ou activer les ancres rouges.
5. Modifier la plus petite responsabilité cohérente.
6. Exécuter package typecheck/tests, Biome, G1, G2 ciblé, G3 ciblé.
7. Exécuter la suite complète requise avant PR avec `PLAYWRIGHT_WORKERS=1` et les limites
   mémoire documentées du repo.
8. Publier `parity-result.json`, PNG côte à côte, diff heatmap et ledger delta.
9. Mettre à jour progression et preuves, puis commit conventionnel et PR vers `work-design`.
10. Ne jamais pousser directement une branche stable, merger ou publier sans autorité.

### 8.2 Conditions d'arrêt

- O1/O2 non décidée pour la slice concernée ;
- hash d'autorité ou image différente ;
- capability/runtime manquant non couvert par une disposition approuvée ;
- licence de fonte non prouvée ;
- écart irréductible nécessitant de casser une fonction ou l'accessibilité ;
- test de mutation du harnais qui ne détecte plus son défaut ;
- ownership Design absent ou conflictuel.

### 8.3 Lanes de worktrees

| Lane | Étapes | Dépend de | Règle de conflit |
|---|---|---|---|
| A — fondation | P0 → S0 → S1 → S2 → S3 → S4 | — | strictement séquentiel |
| B — conversation/code | S5 → S6 | S4 | n'édite pas les tokens globaux |
| C — modes | S7, S9, S11 | S4 | fragments de manifest séparés |
| D — compte/overlays | S10 | S4 | ownership composants partagé déclaré |
| E — Design | S8 | S4 + ownership approuvé | aucune denylist ADR-039 |
| F — Browser | S12 | S4 + O2 | aucune simulation de runtime |
| G — qualification | S13 → S14 → S15 | lanes B-F mergées | strictement séquentiel |

Après S4, B/C/D/E/F peuvent avancer en parallèle seulement si leurs fichiers propriétaires
ne se recouvrent pas. Toute évolution de primitive ou token global devient une PR séparée
mergeée avant reprise des lanes. Aucun agent parallèle ne modifie le manifest fusionné :
seulement son fragment de surface.

---

## 9. Risques et réponses

| Risque | Prob. | Impact | Réponse vérifiable |
|---|---|---|---|
| G1 vert, écran inchangé | haute sans G2 | total | G2 obligatoire + mutation inline/important/media/unmounted |
| suppression pour faire baisser W2/W3 | haute | total | ledger, disposition et ancre positive |
| Tailwind sémantique cassé | moyenne | large | mapping stable + compilation sentinelle |
| preuve CI ignorée | déjà observé | total | preuve absente = échec ; zéro skip |
| variance OS/browser | haute | large | même image et même processus pour les deux côtés |
| timer tardif | moyenne | faux pass/flaky | timer registry + horloge avancée + A/B identiques |
| masque cachant le défaut | moyenne | faux pass | budget 25 %, chrome interdit, geometry toujours mesurée |
| responsive cassé par px fixes | moyenne | large | cinq familles + xOverflow + DPR2 en DoD |
| conflit Design runtime | haute | large | ownership allow/deny exact par SHA |
| plan trop gros | haute | délai | PR ≤400 LOC, checkpoint de vélocité après S3 |
| semaine de travail sans gain visible | déjà observé | confiance | S3 doit livrer la première preuve visible avant expansion |

---

## 10. Definition of Done

- [ ] O1, O2 et O3 sont consignées ; ADR-042 est accepté et supersede ADR-038.
- [ ] `evidence-lock.json` correspond aux SHAs, au hash maquette et à l'image exécutés.
- [ ] Tous les fragments du manifest passent le schema et les cardinalités.
- [ ] Aucun `data-parity` n'est utilisé pour styler la production.
- [ ] Chaque hook legacy a une disposition prouvée ; aucune baisse de compteur sans preuve.
- [ ] G2 noyau couvre exactement les 40 cas calculés depuis le manifest.
- [ ] Chaque surface applicable couvre ses états interactifs déclarés.
- [ ] `boxDelta`, `styleDelta`, `structuralMiss`, `diffRatio`, masques et overflow passent.
- [ ] DPR1 **et DPR2** passent dans l'image verrouillée.
- [ ] Les tests de mutation du harnais échouent tous comme prévu.
- [ ] Aucune preuve manquante n'est ignorée ou marquée `skip`.
- [ ] L'API Tailwind sémantique existante reste compilable et ses sentinelles passent.
- [ ] Les tokens générés sont reproductibles, avec provenance et collisions résolues.
- [ ] Inter ou la police autoritative est packagée avec licence ; réglage utilisateur préservé.
- [ ] `home.tsx` n'imbrique plus `createEffect` dans `chooseProject()`.
- [ ] Browser et Automate reflètent les capacités réelles, sans données ou runtime factices.
- [ ] Design respecte l'ownership manifest ADR-039.
- [ ] `fr` passe le pixel gate ; `de` et `ar` passent overflow/direction.
- [ ] Unit, intégration, E2E, a11y, typecheck et Biome sont verts.
- [ ] Chaque PR contient résultats JSON, captures app/référence et heatmap.
- [ ] Deux reviews IA indépendantes donnent GO et la synthèse ne contient aucun P0 ouvert.
- [ ] La promotion `new-ui` → `work-design` reste une action séparée, explicitement autorisée.

---

## 11. Hors périmètre explicite

- Réécriture du runtime Browser : suivie par son issue propre ; R3 ne le simule pas.
- Réécriture du document/canvas Design ADR-039 : seule l'enveloppe chrome autorisée est visée.
- Pixel parity sur les 17 locales : `fr` est pixel-certifiée ; `de`/`ar` protègent la forme.
- Police utilisateur non-défaut : fonction préservée, non utilisée comme baseline.
- Refonte produit ou changement des flux : la maquette guide l'apparence, pas de nouvelles fonctions.

---

## 12. Ce qui existe déjà et doit être réutilisé

- `packages/app/e2e/design/design-visual.spec.ts` : patterns de thème, viewport et capture,
  mais son skip de baseline manquante ne doit pas être copié.
- `packages/app/playwright.config.ts` : configuration Playwright à étendre sans dépendre de
  baselines d'un autre OS.
- `packages/app/e2e/v110/` : fixtures, stockage et helpers à inventorier avant duplication.
- `packages/ui/src/styles/tailwind/colors.css:78,162` : mapping sémantique existant à préserver.
- `packages/workbench-shell/src/modes.ts:13` et `context/mode.tsx` : contrat Automate réel.
- `RESPONSIVE-MATRIX.md`, `INTERACTIONS.md`, `VISUAL-GATES.md` : autorités de test à mettre
  à jour, pas à réécrire en parallèle.

---

## 13. Protocole de review multi-IA

Le fichier `PROMPT-REVIEW-MULTI-IA-R3.md` définit quatre reviews indépendantes puis une
synthèse. Les reviewers ne partagent pas leurs brouillons, ne modifient rien et refont les
mesures. Le plan est autorisable seulement avec :

1. au moins deux IA de familles différentes ;
2. les quatre rôles couverts : faits, CSS/architecture, QA visuelle, exécution/DX ;
3. une synthèse qui déduplique les constats et classe P0/P1/P2 ;
4. zéro P0 ouvert ;
5. les divergences explicites, sans vote majoritaire aveugle.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | NOT RUN | O1/O2/O3 à valider |
| Outside Voice | prompt R2 indépendant | Challenge factuel | 1 | NO-GO R2 | thèse W1 fausse, gates et chiffres incohérents |
| Eng Review | `/plan-eng-review` | Architecture & tests | 0 | NOT RUN | grille appliquée à la rédaction, review indépendante encore requise |
| Design Review | `/plan-design-review` | Couverture visuelle | 0 | NOT RUN | grille appliquée à la rédaction, review indépendante encore requise |
| DX Review | `/plan-devex-review` | Exécution par agent froid | 0 | NOT RUN | grille appliquée à la rédaction, review indépendante encore requise |

**UNRESOLVED** : O1, O2 et O3 uniquement.
**VERDICT** : R3 est prêt pour review indépendante ; il n'est pas encore autorisé à être exécuté.
