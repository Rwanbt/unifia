<!-- SPDX-License-Identifier: MIT -->

# PLAN R2 — Portage visuel de la maquette v110

> **Statut** : PROPOSÉ — remplace `PLAN-PIXEL-PERFECT-PORT-2026-09-17.md` (R1).
> **Suivi GitHub** : issue **#116**.
> **Date** : 2026-09-17.
> **Autorité d'apparence** : `docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html` (2,4 Mo, 28 605 l., gelée 2026-09-10) — **jamais modifiée**.
> **Branche** : `new-ui` (worktree `_a7-automate-memory`), base `work-design`. PR par slice vers `work-design`.
>
> **Ce que R2 change par rapport à R1** — R1 avait le bon diagnostic et la mauvaise cause.
> R1 supposait que le portage n'avait pas été écrit. La mesure montre qu'il a été écrit
> et **n'est pas branché**. R2 déplace donc l'instrument : le premier gate n'est pas une
> capture d'écran, c'est un **gate de câblage** (§3). R2 corrige aussi cinq faits faux de
> R1 (§0.3) et lève la contradiction bloquante de son §1 (§2.2).

---

## 0. Constat mesuré

### 0.1 — L'écart avec `dev` est nul à l'écran malgré 801 commits

```bash
git rev-list --count dev..new-ui                                    # 801
git diff --stat dev...new-ui -- 'packages/app/src/***' 'packages/ui/src/***'
# 331 files changed, 40671 insertions(+), 964 deletions(-)
```

Ratio **42:1** entre ajouts et suppressions. Un portage d'interface remplace du markup ;
celui-ci n'a fait qu'ajouter à côté. Répartition des 40 671 lignes :

| | lignes |
|---|---|
| i18n (17 locales) | +7 137 |
| tests | +9 650 |
| CSS | +1 130 |
| code UI restant | +22 754 |

### 0.2 — Trois mesures expliquent l'absence de changement visuel

**(a) L'accueil n'a jamais été touché.**

```bash
git diff dev...new-ui -- packages/app/src/pages/home.tsx   # 18 insertions(+), 4 deletions(-)
```

Ces 22 lignes sont exclusivement du routage (`useMode`, `takePendingMode`, `hrefFor`).
**Aucune ligne du bloc `return (` n'a été modifiée.** Le JSX rendu de l'accueil est
identique à `dev`. La première capture d'écran ne peut pas différer — c'est structurel.

**(b) 16 des 21 tokens `--v110-*` n'ont aucun consommateur.**

`packages/app/src/styles/v110.css` déclare 21 tokens. Usages `var()` hors de ce fichier,
hors tests, **avec frontière exacte** (`var(--token[,)]` — un `grep` par préfixe compte à
tort `--v110-target-touch` comme un usage de `--v110-target`) :

| Token | valeur | consommateurs |
|---|---|---|
| `--v110-context` | 248px | **0** |
| `--v110-chat` / `-min` / `-max` | 348/280/620px | **0** |
| `--v110-radius-sm/md/lg/xl` | 10/12/15/18px | **0** |
| `--v110-fast` / `-layout` / `-split` / `-ease` | 150/650/680ms + bezier | **0** |
| `--v110-focus` | focus ring | **0** |
| `--v110-shell-gap` / `-pad` | 10px | **0** |
| `--v110-target` | 31px | **0** |
| `--v110-rail` | 78px | 5 |
| `--v110-target-touch` | 44px | 4 |
| `--v110-inspector` | 300px | 2 (dont 1 en commentaire) |
| `--v110-topbar` | 48px | 1 |
| `--v110-rail-compact` | 62px | 1 |

Soit **5 tokens vivants sur 21, pour 13 usages** dans une app de 56 578 LOC.

Et **les 13 usages portent tous un fallback littéral** ; `grep -rno "var(--v110-[a-z0-9-]*)"`
sans fallback renvoie **0 résultat**. `titlebar.tsx:167` → `var(--v110-topbar, 48px)`,
`sidebar-shell.tsx:62` → `var(--v110-rail, 78px)`, `v110-inspector-frame.tsx:44` →
`var(--v110-inspector, 300px)`. Supprimer la totalité de `v110.css` ne changerait **rien**
à l'écran : la valeur effective est dans le fallback.

Cause racine : le port a créé un **espace de noms parallèle**. La maquette dit `--topbar`,
`--rail`, `--context`, `--radius-sm` ; le port écrit `--v110-topbar`, `--v110-rail`… posés
*à côté* des vrais tokens au lieu de les remplacer.

**(c) Les marqueurs `data-v110` et les règles CSS ne se rencontrent presque pas.**

- **16** valeurs `data-v110` ciblées par le CSS ; **8 n'existent nulle part dans le markup**
  (`composer`, `work-surface`, `design-bezier`, `design-layers-panel`,
  `design-selection-handles`, `design-split`, `design-vector-canvas`,
  `design-vector-toolbar`) → 95 lignes de CSS mort.
- **45** marqueurs `data-v110` posés dans les `.tsx` ; **37 n'ont aucune règle CSS**
  (toute la famille `work-*` — 25 marqueurs —, plus `rail`, `memory-panel`,
  `inspector-tabs`, `inspector-content`, `code-tabs`, `prompt-index`, et les trois
  resizers).

**Intersection vivante : 8 ancrages** — `shell-frame`, `workspace`, `inspector-frame`,
`terminal`, `terminal-panel`, `mobile-nav`, `mobile-diff`, `resize-context-wrapper`.

### 0.3 — Cinq faits de R1 corrigés

| R1 affirmait | Réalité vérifiée |
|---|---|
| « le `:root` de la maquette » | **22 blocs `:root`**, 98 custom properties. R1 en transcrit 25. |
| tokens §2 = source exacte | R1 a transcrit `/* SOURCE: legacy-style-001 */` (`:25`). L'autorité est `/* SOURCE: unifia-final-consolidation */` (`:5555`), que la maquette décrit comme « the reference layer to port into the real component design system ». |
| `--faint:#6b6b72` | Réécrit à **`#85858d`** ligne 5557, hors media query (`@media` précédent : ouvre `:5541`, ferme `:5552`). Le test unitaire de R1 aurait gravé la mauvaise valeur. |
| « ADR-1033 a retiré Automate, runtime = 3 modes » | ADR-1033 est **superseded par ADR-1041** (`1041:9`, ACCEPTED 2026-08-18). `SHELL_MODES` a **4** entrées (`modes.ts:13`). Automate est capability-gated (`mode.tsx:31`), pas retiré. |
| `packages/ui/src/assets/fonts/` est vide | Le dossier **n'existe pas**. Aucun `@font-face` dans le repo. |

### 0.4 — La cause documentaire, et pourquoi elle ne suffit pas

`docs/adr/ADR-038-visual-parity-scope.md:6` → `Statut : DECIDED (2026-09-12)` :

> `:52` — « **1. Pas de pixel-perfect** : on suit le rythme (radius, borders, focus rings),
> pas chaque couleur exacte. »
> `:55` — « **2. Pas de remplacement de classes Tailwind** : on ajoute, on ne supprime pas.
> Si une classe Tailwind écrase le CSS v110 sur un host, la classe Tailwind gagne. »
> `:115` (Alternatives rejetées) — « **Re-styling complet de chaque composant** : 10-20 h,
> risque élevé, hors scope session »

ADR-038 explique l'**intention** : aucun changement de composition n'a jamais été planifié.
Les mesures §0.2 montrent le **résultat** : même le chrome autorisé par ADR-038 est
largement inerte. Les deux se cumulent. Corriger l'un sans l'autre reproduit l'échec.

Note d'honnêteté : ADR-038 a rejeté le pixel-perfect sur une estimation de **10-20 h**.
Le coût réel est de **4 à 6 semaines**. Le rejet reposait sur un chiffre faux d'un facteur ~20.

---

## 1. Prérequis bloquant — ADR-042

**Rien ne commence avant qu'ADR-042 soit écrit et accepté.**

Un worker autonome qui lit ADR-038:52 (« Pas de pixel-perfect ») avant d'écrire une ligne
déclenche légitimement la condition d'arrêt « contradiction maquette ↔ ADR » (§7.4). Le plan
n'est pas exécutable au-dessus d'un ADR DECIDED qui l'interdit.

**ADR-042 — « Pixel parity becomes the visual contract »** doit contenir :

1. `supersedes: 038` dans le frontmatter.
2. Le coût assumé : 4-6 semaines, 18-24 PR — et la mention explicite que l'estimation
   10-20 h d'ADR-038 était fausse d'un facteur ~20.
3. Le renversement du principe n°2 d'ADR-038 : les tokens de la maquette **remplacent**
   `@theme`, ils ne s'ajoutent pas à côté. Fin de l'espace de noms `--v110-*`.
4. La définition retenue de la parité (§2), exceptions comprises.
5. Ce qui reste hors périmètre : locales ≠ `fr` pour le gate pixel, polices utilisateur
   non-défaut, runtime Browser.

Sans ADR-042 : **NO-GO**, le plan s'arrête ici.

---

## 2. Définition mesurable de la parité

### 2.1 — Deux instruments, pas un

R1 n'avait qu'un instrument (la capture) et il arrivait trop tard. R2 en a deux, dans cet
ordre :

| | Instrument | Ce qu'il attrape | Coût |
|---|---|---|---|
| **G1** | **Gate de câblage** (§3) | token déclaré sans lecteur, sélecteur CSS sans cible, marqueur sans règle, fallback masquant | ~1 s, statique |
| **G2** | **Gate visuel** (§4) | écart de rendu | ~2 min, Playwright |

**G1 est bloquant avant G2.** Un token non lu ne peut pas produire d'écart de capture : il
est invisible aux deux gates, mais G1 le voit. C'est exactement le trou par lequel la
campagne précédente est passée.

### 2.2 — Le seuil pixel porte sur la GÉOMÉTRIE, pas sur le contenu

R1 exigeait `diffRatio ≤ 0,05 %` contre une maquette dont l'accueil contient du contenu de
démonstration codé en dur :

```
:15305-15307  home-meta-pill : « Build » / « MiniMax-M3 » / « Default »
:15311-15314  home-quick-chip : « Prism EQ » / « Guide OpenDesign » / « Unifia Vault »
:15272        <img src="data:image/png;base64,…"> — PNG 400×400 inline
```

Atteindre 0,05 % exigeait d'afficher « Prism EQ ». Or §7.5 de R1 interdit les « données
factices », et `INTERACTIONS.md:9` (autorité citée par R1) dit : « **Les 97 scripts demo ne
sont pas une implementation: reimplementer sur signaux/stores reels.** » R1 était
**logiquement inclôturable** sur S2.

**R2 tranche : la parité est géométrique.**

| Métrique | Définition | Seuil |
|---|---|---|
| `boxDelta` | pour chaque nœud apparié app↔maquette : écart de `getBoundingClientRect()` | **≤ 1 px** sur x, y, width, height |
| `styleDelta` | pour chaque nœud apparié : `getComputedStyle` sur 14 propriétés (voir 2.3) | **égalité stricte** |
| `structuralMiss` | élément maquette sans équivalent app (checklist §9 A) | **== 0** |
| `diffRatio` | pixels différents / total, **zones de contenu masquées** | ≤ 0,10 % (≤ 0,05 % sur chrome pur : rail, topbar, resizers) |

L'appariement app↔maquette se fait par une table `data-parity="<ancre-maquette>"` posée
dans le markup app (§9 B), pas par heuristique de position.

`boxDelta ≤ 1 px` remplace le `movedRegions == 0` de R1, qui était le seul critère sans
tolérance et sans chemin décrit pour l'atteindre.

### 2.3 — Les 14 propriétés de `styleDelta`

`font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `color`,
`background-color`, `border-radius`, `border-width`, `border-color`, `padding`, `gap`,
`box-shadow`, `opacity`.

### 2.4 — Exceptions admises (liste exhaustive)

1. **Contenu** — texte, données, noms de projets, horodatages, chemins, hash, branches.
   Les zones de contenu sont **masquées** pour `diffRatio` et **exclues** de `styleDelta`
   sur `color` uniquement ; leur `boxDelta` reste mesuré.
2. Curseur de saisie, anneau de focus clavier (invisible hors interaction).
3. Barres de défilement natives.
4. Sous-pixel des ombres GPU si < 1 px.
5. **Police** : pixel parity définie pour la police **par défaut** uniquement. Les choix
   utilisateur (`settings.tsx:191-192`, `settings-general.tsx:412`) sortent du gate. Voir D6.
6. **Locale** : le gate pixel ne couvre que `fr`. Voir §5.3.

### 2.5 — Règle de progression

Chaque slice publie `G1` (4 compteurs, tous à 0 attendus) et `G2` (`boxDelta` max,
`styleDelta` échecs, `diffRatio`). Les courbes doivent être décroissantes ; aucune
régression sur un cas déjà passé.

---

## 3. G1 — Gate de câblage (S0)

Script unique : `packages/app/scripts/parity/wiring-gate.mjs`. Statique, sans navigateur,
sans build. Quatre compteurs, **tous à zéro** pour passer.

| # | Compteur | Définition | Valeur au 2026-09-17 |
|---|---|---|---|
| W1 | `orphanTokens` | custom property déclarée dans une CSS du port et lue par zéro `var()` ailleurs | **16** |
| W2 | `deadSelectors` | valeur `data-parity` / `data-v110` ciblée par une règle CSS et absente de tout `.tsx` | **8** |
| W3 | `inertMarkers` | marqueur posé dans un `.tsx` et ciblé par aucune règle CSS | **37** |
| W4 | `maskingFallbacks` | `var(--token, X)` où `X` est une valeur littérale — le fallback masque l'absence du token | **13** |

W4 est le compteur que R1 n'aurait jamais eu, et c'est celui qui explique §0.2(b) : les cinq
tokens « consommés » le sont **tous** avec un fallback littéral, donc leur suppression serait
invisible. **Un token de parité ne doit jamais avoir de fallback** : s'il manque, la page
doit casser visiblement, pas dégrader silencieusement.

**Deux pièges d'implémentation du script**, tous deux rencontrés en produisant ces chiffres :

- **Frontière de token.** `grep "var(--v110-target"` compte les usages de
  `--v110-target-touch`. W1 doit matcher `var(--token[,)]`, jamais un préfixe. Sans ça,
  `--v110-target` apparaît consommé 5 fois alors qu'il l'est zéro fois.
- **Commentaires.** `session-side-panel.tsx:334` contient `var(--v110-inspector, 300px)`
  dans un commentaire `//`. Un compteur qui lit le texte brut surévalue le câblage.

Un gate de câblage qui se trompe dans ce sens-là est pire que pas de gate : il déclare
branché ce qui est mort. **Le script porte ses propres tests unitaires sur ces deux cas.**

**Sortie** : `visual/wiring.json` + un tableau lisible en sortie standard.
**CI** : non bloquant en S0 (il documente la dette : 14/8/37/11), **bloquant à partir de S2**
avec `W1..W4 == 0` sur les seuls fichiers de la couche parité.

**Coût** : ~80 LOC, une PR, exécution < 1 s. C'est l'investissement le plus rentable du plan :
il aurait attrapé l'échec de la campagne précédente à la première semaine.

---

## 4. G2 — Gate visuel (S1)

### 4.1 — On étend l'existant, on ne le réinvente pas

`packages/app/e2e/design/design-visual.spec.ts` fait **déjà** : `toHaveScreenshot` avec
baselines commitées, 4 viewports (`:44-49`), **light + dark** (`:51`), horloge épinglée
(`:53`), CSS de désactivation des animations (`:56-63`), et un **gate de déterminisme**
capture→reload→capture→compare-octets (`:36-41`). R1 proposait de repartir de zéro avec
4 scripts `.mjs` + odiff, en moins rigoureux.

**R2 étend ce fichier** vers `e2e/v110/visual-parity.spec.ts` sur le même modèle, et ajoute :

| Ajout | Pourquoi |
|---|---|
| `capture-reference.mjs` (Playwright sur `file://` maquette) | le côté référence n'existe pas encore |
| **gate de déterminisme côté référence** | la maquette a 209 `setTimeout`, 120 `rAF`, 20 `Math.random`, 78 `Date`. Deux captures consécutives doivent être identiques à l'octet, sinon S1 échoue |
| `boxDelta` / `styleDelta` via `page.evaluate` | mesure géométrique (§2.2), pas seulement pixels |
| masques de contenu | §2.4.1 |

### 4.2 — Baselines Linux : le point qui rend la CI honnête

`packages/app/playwright.config.ts:41` →
`snapshotPathTemplate: "{testDir}/{testFileDir}/__screenshots__/{platform}/{arg}{ext}"`,
avec ce commentaire (`:36`) : « Chromium on win32 and Chromium on linux do not rasterise
the same page identically ».

État actuel : **8 PNG, tous sous `__screenshots__/win32/`**. La CI tourne sur
`ubuntu-latest` / `blacksmith-4vcpu-ubuntu-2404`. Donc plateforme `linux`, aucune baseline,
**le test SKIP**. Le gate visuel actuel ne prouve rien en CI.

**S1 doit** : générer les baselines Linux dans le conteneur
`mcr.microsoft.com/playwright:v1.57.0-jammy` (version alignée sur
`@playwright/test: 1.57.0`), les commiter sous `__screenshots__/linux/`, et transformer
« baseline manquante » en **échec** (pas en skip) à partir de S3.

### 4.3 — Déterminisme des deux côtés

| Source de variance | Maquette | App |
|---|---|---|
| horloge | `addInitScript` Date figée | `PINNED_EPOCH` existant |
| `Math.random` (20 occ.) | seed déterministe via `addInitScript` | fixtures |
| animations | `data-ui-animations=off` (32 occ. supportées) + `prefers-reduced-motion` (42 occ.) | `ANIMATION_DISABLE_CSS` existant |
| `setTimeout` ×209, `rAF` ×120 | **critère de quiescence** : 3 frames consécutives sans mutation DOM (`MutationObserver`), timeout 5 s | idem |
| locale | `lang="fr"` natif | **forcer `fr`** (§5.3) |
| thème | `data-theme` dark **et** light | `data-theme` dark **et** light |

### 4.4 — Cas (24 = 12 × 2 thèmes)

Accueil ×5 viewports, session/chat ×5, puis code, work, design, memory, settings, user,
overlays (palette + modale settings) en `desktop-wide-1440x900`. Chaque cas en `dark` et
`light`. DPR 1× uniquement en S1 ; DPR 2× ajouté en S12 seulement si S1-S11 sont stables —
R1 doublait le coût dès le départ sans justification.

Viewports : les 5 familles certifiées de `RESPONSIVE-MATRIX.md:47` — `desktop-wide-1440x900`,
`desktop-compact-1024x768`, `tablet-portrait-768x1024`, `phone-portrait-390x844`,
`compact-landscape-844x390`.

---

## 5. Tokens et polices (S2)

### 5.1 — Extraction scriptée, jamais de recopie manuelle

R1 recopiait 25 tokens à la main depuis la mauvaise couche, avec une valeur périmée
(§0.3). R2 interdit la recopie.

`packages/app/scripts/parity/extract-tokens.mjs` : charge la maquette dans Chromium headless,
lit `getComputedStyle(document.documentElement)` **après résolution complète de la cascade**
des 22 blocs `:root`, pour `data-theme="dark"` puis `data-theme="light"`, et émet
`packages/ui/src/styles/v110-tokens.css`.

Avantages : la cascade est résolue par le moteur, pas par un humain ; les 98 propriétés sont
capturées, pas 25 ; le script est rejouable au prochain freeze de maquette ; le diff du
fichier généré est reviewable.

**Le fichier généré est commité** (pas généré au build) pour que la CI n'ait pas besoin de la
maquette, mais un test vérifie qu'une ré-extraction produit un fichier identique.

### 5.2 — Remplacement, pas addition

C'est le point que R1 ratait complètement : le plan R1 ne nomme **jamais** Tailwind.

L'app est **Tailwind v4** (`packages/app/package.json:34` → `@tailwindcss/vite`), avec ses
tokens dans deux blocs `@theme` (`packages/ui/src/styles/tailwind/colors.css:4`,
`packages/ui/src/styles/tailwind/index.css:9`), et un markup utilitaire
(`home.tsx:84` → `class="mx-auto mt-55 w-full md:w-auto px-4"`).

S2 doit donc :

1. Écrire `v110-tokens.css` **dans un bloc `@theme`** de `packages/ui/src/styles/`, pas dans
   un 20ᵉ fichier de `packages/app/src/styles/`. Il y a déjà 19 fichiers CSS déclarant des
   custom properties ; en créer un de plus n'est pas une « source unique ».
2. **Supprimer l'espace de noms `--v110-*`** : chaque `--v110-x` devient `--x` de la maquette,
   et les 11 fallbacks littéraux (`var(--v110-rail, 78px)`) sont retirés. W4 passe à 0.
3. Faire échouer le build si un `--v110-` subsiste (règle Biome ou grep en pre-commit).

### 5.3 — Police et locale

**Inter.** Le dossier `packages/ui/src/assets/fonts/` **n'existe pas** (R1 le disait
« vide »), et il n'y a aucun `@font-face` dans le repo. S2 embarque Inter (woff2, SIL OFL)
dans `packages/ui/src/assets/fonts/inter/`, la déclare en `@font-face`, et l'injecte
identiquement dans la capture de référence — mêmes fichiers, mêmes `font-feature-settings`,
même `text-rendering`. Sans ces trois alignements, l'exception §2.4.5 ne tient pas.

**Réglage utilisateur.** `settings.tsx:191-192` écrit `--font-family-sans` depuis
`store.appearance`. Le réglage **reste** (le supprimer serait une régression fonctionnelle).
La parité est définie pour la valeur par défaut. Voir D6.

**Locale.** La maquette est en dur en français (`lang="fr"` ligne 1 ; « Commencer avec
Unifia », « Nouveau », « Réglages »). L'app a **17 locales**. Le harnais **force `fr`** des
deux côtés, et le plan écrit noir sur blanc que le gate pixel ne couvre que 1 locale sur 17.

Compensation pour les 16 autres : deux cas non-pixel ajoutés en S12, mesurés sur le critère
*zero-x-overflow* déjà existant (`RESPONSIVE-MATRIX.md:22`) — un cas `de` (chaînes longues)
et un cas `ar` (RTL).

---

## 6. Architecture cible

1. **Tokens** — `@theme` unique dans `packages/ui/src/styles/`, généré par extraction (§5.1).
   Zéro `--v110-*`, zéro fallback littéral.
2. **Primitives** — boutons, chips, cartes, champs, onglets, séparateurs, tooltips :
   apparence maquette, API app. Les classes Tailwind des hosts sont **remplacées** quand
   elles contredisent la maquette (renversement du principe n°2 d'ADR-038 — d'où ADR-042).
3. **Chrome shell** — topbar (`--topbar:48px`), rail (`--rail:78px`), workspace-tabs,
   context (`--context:248px`), inspector (`--inspector:300px`), chat (`--chat:348px`),
   resizers.
4. **Surfaces** — accueil, session/chat, code, work, design, automate, browser, memory,
   settings, user.
5. **Motion** — durées et easings de la maquette ; `prefers-reduced-motion` = 0 mouvement.

**Règles d'ingénierie** (héritées, non négociables) : fichier ≤ 800 LOC (refactor à 1500),
fonction ≤ 50 LOC, aucun `!important` nouveau, aucune duplication de tokens, aucune donnée
factice, suite complète verte à chaque PR, toute copy via l'i18n (17 locales).

---

## 7. Slices

| # | Objectif | Gate de sortie | PR |
|---|---|---|---|
| **S0** | G1 — gate de câblage, 4 compteurs, baseline documentée (**16/8/37/13**) | script + ses tests verts, dette chiffrée | 1 |
| **S1** | G2 — harnais visuel étendu depuis `design-visual.spec.ts`, baselines **Linux** commitées, déterminisme des deux côtés | 24 cas capturés, 2 runs identiques à l'octet | 2 |
| **S2** | Tokens extraits + Inter + suppression de `--v110-*` | **W1=W4=0**, test de ré-extraction vert | 2 |
| **S3** | **Accueil** — remplacement du JSX de `home.tsx`, pas ajout | `boxDelta ≤ 1px` sur 5 viewports × 2 thèmes | 3 |
| **S4** | Shell — topbar, rail, tabs bar, context, inspector, resizers | **W2=W3=0** sur le shell, `boxDelta ≤ 1px` | 4 |
| **S5** | Session / chat — timeline, docks, composer, états vides | idem | 3 |
| **S6** | Code — chrome éditeur, arborescence, panneaux, terminal | idem | 3 |
| **S7** | Work — board, runs, panneaux (**25 marqueurs inertes à traiter**) | **W3=0** sur `work-*` | 3 |
| **S8** | Design — chrome uniquement, frontière §8.2 | idem | 3 |
| **S9** | Memory — vault, note, liens, graphe | idem | 2 |
| **S10** | Settings / User + **overlays, modales, palette** | idem | 3 |
| **S11** | Automate — `#view-automate` (capability `workflow.run` réelle, ADR-1041) | idem | 2 |
| **S12** | Responsive 5 familles + DPR 2× + cas `de` / `ar` (non-pixel) | zero-x-overflow, `boxDelta ≤ 1px` | 2 |
| **S13** | Motion — durées, easings, `reduced-motion` | diff stable entre deux runs | 2 |
| **S14** | Browser — selon D2 | selon D2 | 2 |
| **S15** | A11y + gate final, VISUAL-GATES v2 | matrice verte, RC documenté | 2 |

**Ordre imposé** : S0 → S1 → S2 avant toute slice de surface. S12 peut commencer après S4.
S14 attend D2. S8 attend la clôture d'ADR-039 (§8.2).

**Total** : ~37 PR. R1 annonçait 18-24 ; la différence tient aux gates ajoutés (S0, baselines
Linux) et au fait que R1 sous-estimait S3/S4 en les donnant à « 3-4 PR ».

---

## 8. Protocole d'exécution autonome

### 8.1 — Boucle

1. Branche `ui-v110/parity-<n>` depuis `new-ui`. Jamais de push direct sur `work-design`.
2. Implémenter → `bun typecheck` (**`--concurrency=1`** : tsgo OOM sinon sur cette machine)
   → `bun test` (app/ui) → `biome check` → e2e ciblés puis suite complète
   (**`PLAYWRIGHT_WORKERS=1`**) → **G1** → **G2** → docs (`M3-ACCEPTANCE-MATRIX`,
   `M3-PROGRESS`) → vault → commit conventionnel → PR vers `work-design` + CI verte.
3. PR ≤ 400 LOC ; une slice se découpe en autant de PR que nécessaire, chacune buildable
   et vérifiable seule.
4. **Conditions d'arrêt** (documenter puis attendre) : contradiction maquette ↔ ADR ;
   capacité runtime manquante ; licence/police ; `boxDelta` non réductible sans casser un
   test ; ambiguïté de spec.
5. **Interdits** : données factices, `!important` nouveaux, duplication de tokens,
   modification de la maquette, régression fonctionnelle silencieuse, **nouveau token avec
   fallback littéral**, **nouveau préfixe `--v110-`**.

### 8.2 — Frontière chrome ↔ runtime Design (S8)

R1 disait « chrome uniquement — ADR-039 intact », ce qui n'est pas un critère binaire.
ADR-039 (`ADR-039-...:7`, Accepted 2026-09-15) décrit un runtime Konva **en cours de
construction**, avec des stubs orphelins (`design-layers-panel.tsx` : « zero imports outside
their own files »).

**Critère binaire pour S8** : une PR S8 ne peut modifier que des fichiers dont le diff
`git diff --stat ADR-039-merge-base...HEAD` est vide. Autrement dit, S8 ne touche aucun
fichier que le chantier ADR-039 est en train de réécrire. Si la liste est vide, S8 attend.

### 8.3 — Défaut à corriger en S3

`packages/app/src/pages/home.tsx:79-82` : le `createEffect` qui déclenche l'ouverture de
projet sur mode en attente est placé **à l'intérieur** de `chooseProject()` et s'appelle
lui-même. Hors racine réactive et récursif. C'est le câblage des `home-mode-pill` de la
maquette — la seule fonctionnalité d'accueil ajoutée dans `new-ui`, et elle est mal posée.
S3 le remonte au scope du composant.

---

## 9. Annexes

### A — Vues maquette (8)

`#view-code` (378 réf.), `#view-work` (54), `#view-design` (544), `#view-automate` (356),
`#view-browser` (52), `#view-memory` (482), `#view-settings` (109), `#view-user` (66).
Plus les overlays settings/modales et les états present/mobile.

### B — Ancrages clés, avec numéros de ligne

**Interdiction formelle de lire la maquette linéairement** (28 605 lignes, 2,4 Mo). Cibler
par ligne :

| Ancre | Ligne(s) | Contenu |
|---|---|---|
| `:root` legacy | 27-55 | **ne pas utiliser comme source** (`SOURCE: legacy-style-001`, `:25`) |
| `html[data-theme="light"]` | 56-68 | 13 tokens thème clair |
| `.rail-btn` | 179 | déclaration |
| `.rail-btn .label{display:none}` | 187 | |
| `.home-mode-pill` | 4609, 4618 | CSS |
| **`:root` autorité** | **5555-5565** | `SOURCE: unifia-final-consolidation` — `--sans`, `--mono`, `--faint:#85858d`, `--radius-control/card/panel`, `--focus-ring` |
| `html[data-theme="light"]` | 5566 | `--faint:#74747c` |
| typographie finale | 5569-5600 | tailles par composant |
| `--accent-soft*` | 8329-8336 | 7 tokens `color-mix` |
| `--v98-space-*` | 12496-12504 | échelle d'espacement |
| accueil (markup) | 15271-15324 | hero, composer-carte, chips, modes, hint |
| `.home-mode-pill` ×6 | 15315-15320 | code/work/design/automate/browser/memory |
| rail (markup) | 15327-15349 | 6 modes + Nouveau + Réglages |

Échelle : 22 blocs `:root`, 98 custom properties, 1 349 classes distinctes, 779 ids.

### C — Instruments existants à réutiliser

- `packages/app/e2e/design/design-visual.spec.ts` — **base du harnais G2** (§4.1)
- `packages/app/playwright.config.ts:41,58` — `snapshotPathTemplate`, `updateSnapshots: "none"`
- `packages/app/e2e/v110/gate.ts` — `track`, `overflow`, `modes`, `panels`, `keys`, `shot`
- `packages/app/e2e/v110/*` — fixtures, `installWorkbenchMock`, `seedStorage`, `dirPath`
- `docs/ui-reference/v110/RESPONSIVE-MATRIX.md:47` — les 5 familles certifiées

---

## 10. Décisions requises du propriétaire

| # | Sujet | Options | Défaut proposé | Bloque |
|---|---|---|---|---|
| **D1** | **ADR-038 est-il révoqué ?** Coût réel 4-6 sem. vs les « 10-20 h » sur lesquelles son rejet reposait | (a) ADR-042 supersede (b) ADR-038 tient, plan abandonné | **(a)** | tout |
| **D2** | **Parité géométrique ou pixel strict ?** La maquette contient du contenu de démo que §8.1.5 et `INTERACTIONS.md:9` interdisent de reproduire | (a) géométrie + contenu masqué (b) pixel strict et on assume le contenu factice | **(a)** | S3 |
| **D3** | **Rail : Browser et Memory deviennent-ils des modes ?** `SHELL_MODES` en a 4 (`modes.ts:13`) ; la maquette en montre 6. Automate est déjà réglé (ADR-1041) | (a) 6 entrées, Browser/Memory gatés par capability (b) 4 entrées + sous-vues | **(a)** | S4, S9, S14 |
| **D4** | **Browser sans runtime** (seul écart restant, #97) | (a) chrome + état « indisponible » documenté (b) runtime d'abord | **(a)** puis (b) | S14 |
| **D5** | Exceptions §2.4 | valider / étendre | liste telle quelle | S1 |
| **D6** | **Police utilisateur** — le réglage `settings.tsx:191-192` reste ; la parité vaut pour le défaut | (a) parité sur défaut uniquement (b) supprimer le réglage | **(a)** | S2 |
| **D7** | Autorisation après review | GO / attendre | GO après 2 reviews indépendantes | S0 |

---

## 11. Risques

| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| **Travail écrit mais non branché** (échec constaté §0.2) | **Certaine sans G1** | Total | G1 bloquant dès S2, W1..W4 == 0 |
| **Gate CI vert par SKIP** (8 baselines win32, CI ubuntu) | Haute | Total | S1 : baselines Linux en conteneur ; baseline manquante = échec dès S3 |
| Tokens recopiés à la main → valeur périmée | Haute | Teinte fausse invisible en review | S2 : extraction scriptée + test de ré-extraction |
| Contradiction seuil / données factices | Certaine sans D2 | S3 inclôturable | §2.2 géométrie + masques |
| Maquette non déterministe (209 `setTimeout`, 120 `rAF`) | Moyenne | Baseline instable | §4.3 quiescence 3 frames + gate déterminisme côté référence |
| Polices non identiques malgré Inter packagée | Moyenne | Diff permanent sur tout le texte | S2 : mêmes fichiers + `font-feature-settings` + `text-rendering` alignés |
| 16 locales non couvertes par le gate | Certaine | Débordements invisibles | §5.3 : cas `de` + `ar` sur zero-x-overflow |
| Régression fonctionnelle par restyle | Moyenne | Bloquant | Suite e2e complète verte par PR |
| Conflit S8 ↔ chantier ADR-039 | Haute | Conflits de merge permanents | §8.2 critère binaire |
| Périmètre qui explose | Haute | Dérive | PR ≤ 400 LOC, courbes G1/G2, conditions d'arrêt §8.1.4 |

---

## 12. Definition of Done

- [ ] **ADR-042 accepté**, supersede ADR-038, coût réel assumé.
- [ ] **G1 : W1=W2=W3=W4=0** sur la couche parité, bloquant en CI.
- [ ] **Zéro `--v110-*`** dans le repo ; zéro fallback littéral sur un token de parité.
- [ ] G2 : 24 cas (12 × light/dark) avec `boxDelta ≤ 1px`, `styleDelta` sans échec,
      `structuralMiss == 0` ; courbes décroissantes puis stables, versionnées.
- [ ] **Baselines Linux commitées** ; baseline manquante = échec, jamais skip.
- [ ] `v110-tokens.css` généré par extraction, test de ré-extraction vert, thème clair inclus.
- [ ] Inter packagée (SIL OFL), `@font-face` déclaré, réglage utilisateur préservé.
- [ ] 8 vues `#view-*` couvertes, ou désactivées proprement selon D3/D4 — jamais de fake.
- [ ] Suite e2e complète + unit + typecheck verts ; VISUAL-GATES v2 signé.
- [ ] `home.tsx:79` corrigé (§8.3).
- [ ] Cas `de` et `ar` verts sur zero-x-overflow.
- [ ] PR de promotion `new-ui` → `work-design` avec captures finales côte à côte et les
      4 compteurs G1 à zéro.
