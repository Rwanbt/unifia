<!-- SPDX-License-Identifier: MIT -->

# Dependency acceptances — issue #33

> [!IMPORTANT]
> **Décision propriétaire 1A — 16/10/2026 — correction systématique et exceptions strictement bornées**
>
> Corriger par lots isolés toutes les vulnérabilités exploitables ou corrigeables par une mise à
> jour compatible, avec `bun.lock`, tests, typecheck, génération du SDK si affectée et preuve au
> SHA exact. Pour les alertes sans correctif viable : démontrer chemin de dépendance, atteignabilité
> réelle, contrôles compensatoires, propriétaire de risque, échéance et conditions de révocation de
> l'acceptation. Ne pas appliquer un `bun update` aveugle, ni exiger fictivement zéro alerte si une
> dépendance sans fix est démontrée non exploitable. Les acceptations ne sont pas permanentes.
> `#444` gère les acceptations précises. **DECIDED ; remédiation/validation à terminer ; pas de GO
> PROD tant qu'un risque exploitable inacceptable subsiste.**

**Révision du registre :** 2026-11-10 (remplace la révision 2026-10-17 sur `dev@24adc8cabc`).

**Référence mesurée :** `fix/crit-alerts` = `22975f5d6bb9d31656eafae85ac874b3f9234cb2`, branche
poussée non fusionnée, appliquée par-dessus `origin/dev` = `e487ea285edfbad7879b149cc27219715c0bcbb6`.
Ce registre décrit l'état **après** les correctifs critiques ; il prend effet à la fusion de
`fix/crit-alerts`. Tant que la fusion n'est pas faite, `origin/dev` porte encore **74** avis
(3 critiques) : `dompurify@3.4.16` et `storybook`/`@storybook/addon-vitest@10.5.7` sont documentés
comme **corrigés en attente de fusion** en §3.4 et §3.5 — pas comme acceptés.

**Outil et commande exacte :**

```
bun audit            # exit 1 si au moins un avis ; c'est la mesure de référence
bun audit -p         # arbre de production seul
bun audit --json     # forme structurée utilisée pour ce registre
bun audit fix --dry-run   # inventaire des correctifs réellement disponibles
```

**Version de l'outil :** `bun 1.4.4 (38afee6c8)` sur la machine de mesure. Le dépôt **épingle
`bun@1.3.11`** (`package.json:7`, `packageManager`, lu par `.github/actions/setup-bun/action.yml`).
Écart signalé, pas dissimulé : un compteur d'avis n'est comparable qu'à outil et date identiques ;
les révisions antérieures de ce fichier ont été prises avec `bun 1.3.14`, `1.3.11` puis `1.4.4`.
Toute re-mesure doit noter la version et l'horodatage.

**Périmètre :** npm uniquement — le graphe résolu par `bun.lock`. Le Rust (46 alertes Dependabot :
`packages/desktop/src-tauri/Cargo.lock` 25, `packages/mobile/src-tauri/Cargo.lock` 21) est **hors
périmètre de ce registre** et n'est couvert par aucun `bun audit` : voir §5.

**Règle de non-permanence.** Toute acceptation porte un propriétaire, une échéance et une condition
de révocation. Une échéance dépassée **annule** l'acceptation jusqu'à réexamen. Une acceptation ne
se renouvelle pas par défaut : elle se re-mesure.

## 0. Comment lire ce registre

- **Un avis = une ligne** : GHSA, sévérité, plage vulnérable, correctif disponible, décision, échéance.
- **Un paquet = une fiche** (§2) : chemin de dépendance verbatim issu de `bun audit`, atteignabilité
  au SHA **avec sa preuve**, propriétaire.
- Les paquets à plusieurs versions installées (`vite`, `zod`, `glob`, `body-parser`,
  `postcss-selector-parser`) ont une ligne par avis : c'est la **plage** qui indique la version
  concernée, pas le numéro de version affiché en tête de fiche.
- Trois décisions seulement : **CORRIGER** (un correctif compatible existe), **ACCEPTER
  TEMPORAIREMENT** (correctif inexistant, majeur bloqué, ou exposition nulle — mais l'avis reste
  ouvert et daté), **ACCEPTER DURABLEMENT** (réservé à `aws-sdk`, §4, avec justification opposable).
- Quatre lots, aucun n'est un `bun update` global :
  - **L1** — correctifs dans les plages déclarées, échéance **2026-11-21** ;
  - **L2** — majeurs d'outillage (build, test, dev), réexamen **2026-12-15** ;
  - **L3** — majeurs produit (dépendant d'un outil tiers), réexamen **2026-12-15** ;
  - **L4** — `aws-sdk`, réexamen **2027-03-31**.
- **Atteignabilité** : `atteignable (prouvé)` = un chemin d'exécution existe dans le code livré et
  il est cité ; `non atteignable (prouvé)` = l'appel vulnérable est absent de la source (grep = 0) ;
  `non livré` = paquet de build/test seulement ; `à prouver` = chemin de dépendance établi, chemin
  d'exécution non démontré — **ce n'est pas** une preuve de non-exploitabilité.

## 1. État mesuré au 2026-11-10

```
bun audit    -> 67 vulnerabilities (20 high, 35 moderate, 12 low)      # 0 critical
bun audit -p -> 54 vulnerabilities (17 high, 28 moderate, 9 low)      # production seule
bun audit fix --dry-run -> "Would fix 41 vulnerabilities in 15 packages (checked 2204)"
                           "26 vulnerabilities remaining"
```

| Indicateur | Avant correctifs (`origin/dev`) | Après correctifs (`fix/crit-alerts`) |
|---|---|---|
| Avis | 74 (3 critiques, 23 élevés, 35 modérés, 13 faibles) | **67** (0 critique, 20 élevés, 35 modérés, 12 faibles) |
| GHSA distincts | 65 | **60** (67 avis : 7 avis apparaissent sur deux plages) |
| Paquets | 26 | **23** |
| Production seule | 57 | **54** |
| Corrigeables dans les plages | 48 / 18 paquets | **41 / 15 paquets** |
| Sans correctif publié | 1 (`aws-sdk`) | **1** (`aws-sdk`) |
| Correctif = majeur bloqué | 25 avis | **25 avis** |

**Découpage du registre :** 42 avis **CORRIGER**, 25 avis **ACCEPTER TEMPORAIREMENT**, 1 avis
**ACCEPTER DURABLEMENT** = 67.

> Écart assumé et documenté : `bun audit fix --dry-run` annonce 41 avis corrigeables, le découpage
> ci-dessus en classe 42. L'écart de 1 n'a pas été isolé ; il porte sur un avis à cheval sur deux
> décisions (`zod` : un seul avis couvre 6 versions installées, dont des 3.x non corrigeables, et
> `vite` : un avis couvre 4.5.14 et 7.3.5). Le registre préfère exhiber cet écart plutôt que de le
> lisser en recopiant le chiffre de l'outil.

### Tableau maître (23 paquets, 67 avis)

| Paquet | Version(s) installée(s) | Avis | Sévérités | Correctif disponible | Décision | Échéance |
|---|---|---|---|---|---|---|
| `@azure/msal-node` | 5.5.0 | 1 | 1 élevé | NON — 7.1.0 exige un majeur vs @azure/identity ^5.1.0 | ACCEPTER TEMPORAIREMENT | 2026-12-15 |
| `@hono/node-server` | 2.1.0 | 1 | 1 modéré | OUI — 2.1.3 | CORRIGER | 2026-11-21 |
| `@vitest/mocker` | 4.1.11 | 2 | 2 modéré | OUI — 4.1.12 | CORRIGER | 2026-11-21 |
| `aws-sdk` | 2.1692.0 | 1 | 1 faible | NON — aucune version publiée (first_patched_version = null) | ACCEPTER DURABLEMENT | 2027-03-31 |
| `body-parser` | 1.20.6, 2.3.0 | 2 | 2 élevé | OUI — 1.20.9 / 2.4.0 | CORRIGER | 2026-11-21 |
| `deepmerge` | 4.3.1 | 1 | 1 faible | NON — seule correction = downgrade 4.1.2, hors plage de html-to-text ^4.3.1 | ACCEPTER TEMPORAIREMENT | 2026-12-15 |
| `electron` | 42.10.0 | 8 | 1 élevé, 4 modéré, 3 faible | OUI — 42.11.16 | CORRIGER | 2026-11-21 |
| `fast-uri` | 4.2.1 | 4 | 2 modéré, 2 faible | OUI — 4.2.3 | CORRIGER | 2026-11-21 |
| `fastify` | 5.12.5 | 1 | 1 faible | OUI — 5.12.6 | CORRIGER | 2026-11-21 |
| `follow-redirects` | 1.16.0 | 3 | 3 élevé | OUI — 1.16.2 | CORRIGER | 2026-11-21 |
| `glob` | 13.0.5, 7.2.3, 10.5.0, 9.3.5, 11.1.0 | 1 | 1 modéré | NON — 14.0.2 = majeur (bloqué par archiver-utils ^10, js-beautify ^10.4, rimraf ^10.3, map-workspaces ^13) | ACCEPTER TEMPORAIREMENT | 2026-12-15 |
| `happy-dom` | 20.11.1 | 3 | 2 élevé, 1 modéré | NON — 21.0.4 = majeur | ACCEPTER TEMPORAIREMENT | 2026-12-15 |
| `hono` | 4.13.10 | 1 | 1 modéré | OUI — 4.13.11 | CORRIGER | 2026-11-21 |
| `ip-address` | 10.7.2 | 1 | 1 modéré | OUI — 10.7.4 | CORRIGER | 2026-11-21 |
| `minimatch` | 10.2.5 | 1 | 1 modéré | NON — 11.0.1 = majeur (override racine 10.2.5) | ACCEPTER TEMPORAIREMENT | 2026-12-15 |
| `postcss-selector-parser` | 6.1.4, 7.1.4 | 2 | 2 modéré | OUI — 6.1.5 / 7.1.6 | CORRIGER | 2026-11-21 |
| `qs` | 6.16.0 | 1 | 1 modéré | OUI — 6.16.1 | CORRIGER | 2026-11-21 |
| `react-router` | 6.30.4 | 2 | 2 modéré | NON — 7.18.0 = majeur contre @jsx-email/cli épinglé 6.16.0 | ACCEPTER TEMPORAIREMENT | 2026-12-15 |
| `seroval` | 1.6.8 | 2 | 2 modéré | OUI — 1.6.11 | CORRIGER | 2026-11-21 |
| `toml` | 4.3.0 | 3 | 3 élevé | NON — 5.0.1 = majeur | ACCEPTER TEMPORAIREMENT | 2026-12-15 |
| `undici` | 7.30.0 | 8 | 4 élevé, 4 modéré | OUI — 7.30.1 | CORRIGER | 2026-11-21 |
| `vite` | 7.3.5, 8.3.4, 4.5.14 | 17 | 3 élevé, 10 modéré, 4 faible | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | PARTAGÉE | 2026-11-21 / 2026-12-15 |
| `zod` | 4.1.8, 4.4.3, 3.25.76, 4.6.5, 3.24.2, 3.22.3 | 1 | 1 élevé | PARTIEL — 4.6.6 (4.x) ; NON pour 3.x (majeur) | PARTAGÉE | 2026-11-21 / 2026-12-15 |


## 2. Registre avis par avis (23 paquets, 67 avis)

Chaque fiche donne le chemin de dépendance **verbatim** de un audit, la ou les versions
installées, une ligne par avis, l'atteignabilité au SHA **avec sa preuve**, et le propriétaire.
Les intitulés d'avis sont repliés en fin de fiche pour ne pas noyer la décision.
### `@azure/msal-node` — 1 élevé

Version(s) installée(s) : `5.5.0` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/web > astro > unstorage > @azure/identity > @azure/msal-node
workspace:@unifia/console-app > nitro > unstorage > @azure/identity > @azure/msal-node
workspace:@unifia/console-core > drizzle-orm > mssql > tedious > @azure/identity > @azure/msal-node
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-xcx6-jx8p-x3h5` | élevé | `>=5.0.0-beta.0 <7.1.0` | NON — 7.1.0 exige un majeur vs @azure/identity ^5.1.0 | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |

**Atteignabilité au SHA : non atteignable (prouvé).** Aucune importation de `@azure/identity` ni de `msal` dans `packages/**/*.ts` (grep = 0). Chemin latent seulement : astro → unstorage → @azure/identity, nitro, tedious (mssql).

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-xcx6-jx8p-x3h5` — MSAL Node authorization code flow may disclose parameters to an attacker-controlled endpoint

</details>

### `@hono/node-server` — 1 modéré

Version(s) installée(s) : `2.1.0` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > @modelcontextprotocol/sdk > @hono/node-server
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-rmxm-3fg6-px4f` | modéré | `>=1.19.10 <2.1.3` | OUI — 2.1.3 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : non atteignable (prouvé).** L'avis porte sur `serveStatic` ; aucun appel `serveStatic` dans `packages/**` (grep = 0). Le paquet est présent via `@modelcontextprotocol/sdk` uniquement.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-rmxm-3fg6-px4f` — @hono/node-server: `serveStatic` decodes the request path a second time, leading to bypass of middleware on static paths

</details>

### `@vitest/mocker` — 2 modéré

Version(s) installée(s) : `4.1.11` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/contracts > vitest > @vitest/mocker
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-qxg6-89mg-rqv8` | modéré | `>=2.1.0-beta.7 <4.1.12` | OUI — 4.1.12 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-xp26-3454-mjgp` | modéré | `>=4.1.11 <4.1.12` | OUI — 4.1.12 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : non livré.** Outillage de test (`vitest`), jamais inclus dans un artefact distribué.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-qxg6-89mg-rqv8` — Vitest: Code injection via unauthenticated manual mock registration
- `GHSA-xp26-3454-mjgp` — Vitest: Windows backslash traversal bypasses the @vitest/mocker redirect allowlist fix

</details>

### `aws-sdk` — 1 faible

Version(s) installée(s) : `2.1692.0` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/console-core > sst > aws-sdk
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-j965-2qgj-vjmq` | faible | `>=2.0.0 <=3.0.0` | NON — aucune version publiée (first_patched_version = null) | ACCEPTER DURABLEMENT (L4) | 2027-03-31 |

**Atteignabilité au SHA : non livré.** `sst` (devDependency racine) → `aws-sdk` v2. La région vient de `sst.config.ts` ou du shell du développeur, jamais d'une requête.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-j965-2qgj-vjmq` — JavaScript SDK v2 users should add validation to the region parameter value in or migrate to v3

</details>

### `body-parser` — 2 élevé

Version(s) installée(s) : `1.20.6, 2.3.0` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > @modelcontextprotocol/sdk > express > body-parser
workspace:@unifia/slack > @slack/bolt > express > body-parser
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-27r3-jxmh-p828` | élevé | `<1.20.9` | OUI — 1.20.9 / 2.4.0 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-27r3-jxmh-p828` | élevé | `>=2.0.0 <2.4.0` | OUI — 1.20.9 / 2.4.0 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : atteignable sous condition.** `packages/slack/src/index.ts:1` importe `App` de `@slack/bolt`, dont le récepteur HTTP utilise express → body-parser. L'exposition dépend du déploiement de `@unifia/slack` (non prouvé).

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-27r3-jxmh-p828` — body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body
- `GHSA-27r3-jxmh-p828` — body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body

</details>

### `deepmerge` — 1 faible

Version(s) installée(s) : `4.3.1` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/console-app > @jsx-email/render > html-to-text > deepmerge
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-gcqx-w48m-w2h4` | faible | `>=4.2.0 <=4.3.1` | NON — seule correction = downgrade 4.1.2, hors plage de html-to-text ^4.3.1 | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |

**Atteignabilité au SHA : chemin prouvé, exposition à prouver.** `@unifia/console-app` → `@jsx-email/render` → `html-to-text` → `deepmerge` (rendu e-mail).

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-gcqx-w48m-w2h4` — deepmerge mergeObject() allows prototype poisoning of returned objects

</details>

### `electron` — 1 élevé, 4 modéré, 3 faible

Version(s) installée(s) : `42.10.0` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/desktop-electron > electron
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-jr5w-w6x2-84p9` | élevé | `<42.11.16` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-fw47-9c62-h3vw` | modéré | `<42.11.3` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-2p8c-gr87-2676` | modéré | `<42.11.3` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-x562-297c-g43g` | modéré | `<42.11.9` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-997q-gvvc-jwmx` | modéré | `<42.11.3` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-98mx-cjp9-gchm` | faible | `<42.11.1` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-3qxv-5xgr-q7w9` | faible | `<42.11.6` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-h3v5-h239-pg29` | faible | `<42.11.6` | OUI — 42.11.16 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : livré.** `packages/desktop-electron` est une coquille Electron distribuable ; le chemin précis de chaque avis (certificats eMudhra, permissions HID/USB, `window.open`) reste à prouver. La distribution effective n'est pas vérifiée.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-jr5w-w6x2-84p9` — Electron: Mitigation for compromised eMudhra intermediate certificates
- `GHSA-fw47-9c62-h3vw` — Electron: HID and USB permission checks can be attributed to the wrong origin
- `GHSA-2p8c-gr87-2676` — Electron: SameSite cookie restrictions are not applied to windows opened from links
- `GHSA-x562-297c-g43g` — Electron: Pointer lock permission requests can be attributed to the wrong frame
- `GHSA-997q-gvvc-jwmx` — Electron: openExternal permission requests can be attributed to the wrong origin
- `GHSA-98mx-cjp9-gchm` — Electron: Extension tabs.query returns tab URLs and titles without the tabs permission
- `GHSA-3qxv-5xgr-q7w9` — Electron: Frame subscription trusts GPU-supplied frame geometry
- `GHSA-h3v5-h239-pg29` — Electron: Off-screen rendering on macOS trusts GPU-supplied frame geometry

</details>

### `fast-uri` — 2 modéré, 2 faible

Version(s) installée(s) : `4.2.1` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > @modelcontextprotocol/sdk > ajv > fast-uri
workspace:unifia > opencode-gitlab-auth > fastify > fast-json-stringify > ajv > fast-uri
workspace:@unifia/desktop-electron > electron-builder > dmg-builder > app-builder-lib > ajv > fast-uri
workspace:@unifia/desktop-electron > electron-store > conf > ajv-formats > ajv > fast-uri
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-w74x-v6f9-j3xg` | modéré | `>=4.0.0 <4.2.3` | OUI — 4.2.3 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-wjr9-j795-jxcr` | modéré | `>=4.0.1 <4.2.3` | OUI — 4.2.3 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-xhq7-xmqj-769h` | faible | `>=4.0.0 <4.2.3` | OUI — 4.2.3 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-333x-w4r6-6crp` | faible | `>=4.0.0 <4.2.3` | OUI — 4.2.3 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : à prouver.** Chaînes `ajv` : MCP SDK, `fast-json-stringify` (fastify), `electron-store`, `yaml-language-server`. Aucun appel direct dans la source Unifia.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-w74x-v6f9-j3xg` — fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding
- `GHSA-wjr9-j795-jxcr` — fast-uri vulnerable to host confusion via unchecked WHATWG host canonicalization
- `GHSA-xhq7-xmqj-769h` — fast-uri vulnerable to improper path equivalence in relative reference normalization
- `GHSA-333x-w4r6-6crp` — fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references

</details>

### `fastify` — 1 faible

Version(s) installée(s) : `5.12.5` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > opencode-gitlab-auth > fastify
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-389g-gv7q-r4x8` | faible | `>=5.12.2 <5.12.6` | OUI — 5.12.6 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : à prouver.** `opencode-gitlab-auth` → `fastify` (serveur d'authentification GitLab).

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-389g-gv7q-r4x8` — fastify is vulnerable to header validation bypass via case-sensitive propertyNames

</details>

### `follow-redirects` — 3 élevé

Version(s) installée(s) : `1.16.0` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/slack > @slack/bolt > axios > follow-redirects
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-mrwp-f3q8-3g9p` | élevé | `>=1.16.0 <=1.16.1` | OUI — 1.16.2 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-q3jh-wrc6-jgq8` | élevé | `>=1.16.0 <1.16.1` | OUI — 1.16.2 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-8r9p-f939-6h3c` | élevé | `>=1.16.0 <1.16.1` | OUI — 1.16.2 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : atteignable sous condition.** `packages/slack/src/index.ts:1` → `@slack/bolt` → `axios` → `follow-redirects`.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-mrwp-f3q8-3g9p` — follow-redirects: Cross-realm sensitiveHeaders arrays are discarded and custom credentials can follow redirects
- `GHSA-q3jh-wrc6-jgq8` — follow-redirects array-form headers bypass cross-origin credential stripping
- `GHSA-8r9p-f939-6h3c` — follow-redirects sensitiveHeaders regex escaping can expose credential headers

</details>

### `glob` — 1 modéré

Version(s) installée(s) : `13.0.5, 7.2.3, 10.5.0, 9.3.5, 11.1.0` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > glob
workspace:@unifia/app > vite-plugin-icons-spritesheet > glob
workspace:unifia > @npmcli/arborist > cacache > glob
workspace:@unifia/plugin > @opentui/solid > babel-plugin-module-resolver > glob
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-3g3m-2fjr-6pw4` | modéré | `>=9.0.0 <=14.0.1` | NON — 14.0.2 = majeur (bloqué par archiver-utils ^10, js-beautify ^10.4, rimraf ^10.3, map-workspaces ^13) | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |

**Atteignabilité au SHA : atteignable (prouvé).** `packages/unifia/src/util/glob.ts:1` importe `glob` ; aussi dépendance directe racine et `packages/unifia`. L'avis (contournement d'`AbortSignal`) demande un appel annulable : sous-chemin à prouver.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-3g3m-2fjr-6pw4` — Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal

</details>

### `happy-dom` — 2 élevé, 1 modéré

Version(s) installée(s) : `20.11.1` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/app > happy-dom
workspace:@unifia/ui > happy-dom
workspace:@unifia/app > @happy-dom/global-registrator > happy-dom
workspace:@unifia/contracts > vitest > happy-dom
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-834v-8h66-3h79` | élevé | `>=17.0.0 <=21.0.3` | NON — 21.0.4 = majeur | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |
| `GHSA-c8p4-j97h-3vg8` | élevé | `<=20.14.6` | NON — 21.0.4 = majeur | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |
| `GHSA-5fpq-26gf-qwcr` | modéré | `<=20.14.5` | NON — 21.0.4 = majeur | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |

**Atteignabilité au SHA : non livré.** `devDependencies` de `@unifia/app`, `@unifia/ui`, `@unifia/contracts` — DOM de test uniquement.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-834v-8h66-3h79` — Happy DOM: Incomplete fix for CVE-2026-33943: unsanitized import alias leads to host code execution
- `GHSA-c8p4-j97h-3vg8` — Happy DOM: SSRF via iframe and link stylesheet when parsing untrusted HTML
- `GHSA-5fpq-26gf-qwcr` — Happy DOM has cookie scope forgery: no DNS-label boundary on Domain= matching , attacker origin sets victim cookies

</details>

### `hono` — 1 modéré

Version(s) installée(s) : `4.13.10` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/console-function > hono
workspace:@unifia/function > hono
workspace:unifia > hono
workspace:unifia > @hono/standard-validator > hono
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-5r4p-p66f-jhc7` | modéré | `>=4.12.4 <4.13.11` | OUI — 4.13.11 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : atteignable (prouvé) pour le paquet.** `packages/unifia/src/server/server.ts:3` + ~40 routes. L'avis `serveStatic` (GHSA-5r4p-p66f-jhc7) n'est **pas** atteignable : `serveStatic` jamais appelé (grep = 0).

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-5r4p-p66f-jhc7` — Hono: `serveStatic` decodes the request path a second time, leading to bypass of middleware on static paths

</details>

### `ip-address` — 1 modéré

Version(s) installée(s) : `10.7.2` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > @modelcontextprotocol/sdk > express-rate-limit > ip-address
workspace:unifia > @npmcli/arborist > npm-registry-fetch > make-fetch-happen > @npmcli/agent > socks-proxy-agent > socks > ip-address
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-rxp7-6hxx-x8q5` | modéré | `<=10.7.3` | OUI — 10.7.4 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : à prouver.** `express-rate-limit` (MCP SDK) et `socks-proxy-agent` (CLI npm).

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-rxp7-6hxx-x8q5` — ip-address: Address6 matches a zone identifier in quadratic time ahead of its length limit, allowing a single long string to stall the process

</details>

### `minimatch` — 1 modéré

Version(s) installée(s) : `10.2.5` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > minimatch
workspace:unifia > @npmcli/arborist > minimatch
workspace:unifia > glob > minimatch
workspace:@unifia/desktop-electron > electron-builder > dmg-builder > app-builder-lib > @electron/universal > @electron/asar > minimatch
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-g3hv-75wg-m249` | modéré | `>=7.0.0 <11.0.1` | NON — 11.0.1 = majeur (override racine 10.2.5) | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |

**Atteignabilité au SHA : atteignable (prouvé).** `packages/unifia/src/util/glob.ts:2,32` applique `minimatch` à des patterns ; l'avis (amplification `globparts`) exige un pattern surdimensionné : déclencheur à prouver.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-g3hv-75wg-m249` — minimatch has potential denial of service via globparts amplification

</details>

### `postcss-selector-parser` — 2 modéré

Version(s) installée(s) : `6.1.4, 7.1.4` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/app > tailwindcss > postcss-nested > postcss-selector-parser
workspace:unifia > @npmcli/arborist > @npmcli/query > postcss-selector-parser
workspace:@unifia/web > @astrojs/starlight > astro-expressive-code > rehype-expressive-code > expressive-code > @expressive-code/plugin-text-markers > @expressive-code/core > postcss-nested > postcss-selector-parser
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-rj75-hqrm-r3gf` | modéré | `<6.1.5` | OUI — 6.1.5 / 7.1.6 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-rj75-hqrm-r3gf` | modéré | `>=7.0.0 <7.1.6` | OUI — 6.1.5 / 7.1.6 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : non livré.** Build Tailwind/PostCSS (`@unifia/app`, `@unifia/web`, `@npmcli/query`) — jamais chargé au runtime.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-rj75-hqrm-r3gf` — PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion
- `GHSA-rj75-hqrm-r3gf` — PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion

</details>

### `qs` — 1 modéré

Version(s) installée(s) : `6.16.0` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/console-core > stripe > qs
workspace:unifia > @modelcontextprotocol/sdk > express > body-parser > qs
workspace:@unifia/slack > @slack/bolt > express > body-parser > qs
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-6pq8-jhm2-2vcw` | modéré | `>=6.7.0 <=6.16.0` | OUI — 6.16.1 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : à prouver.** `stripe` et express (MCP SDK, Slack).

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-6pq8-jhm2-2vcw` — qs : qs.stringify with arrayFormat 'comma' throws an uncaught TypeError on array elements carrying a non-callable own toString (DoS)

</details>

### `react-router` — 2 modéré

Version(s) installée(s) : `6.30.4` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/console-mail > @jsx-email/cli > react-router-dom > react-router
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-wrjc-x8rr-h8h6` | modéré | `>=6.0.0 <7.18.0` | NON — 7.18.0 = majeur contre @jsx-email/cli épinglé 6.16.0 | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-337j-9hxr-rhxg` | modéré | `>=6.4.0 <7.18.0` | NON — 7.18.0 = majeur contre @jsx-email/cli épinglé 6.16.0 | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |

**Atteignabilité au SHA : non livré.** `@jsx-email/cli` (preview e-mail du paquet privé `console-mail`), outil de développement.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-wrjc-x8rr-h8h6` — React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass)
- `GHSA-337j-9hxr-rhxg` — React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration

</details>

### `seroval` — 2 modéré

Version(s) installée(s) : `1.6.8` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/console-app > @solidjs/start > seroval
workspace:@unifia/app > solid-js > seroval-plugins > seroval
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-f86p-h4j2-7qgj` | modéré | `>=1.6.0 <1.6.11` | OUI — 1.6.11 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-9wx9-5pv9-3349` | modéré | `>=1.5.5 <1.6.10` | OUI — 1.6.11 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : à prouver.** `@solidjs/start` (SSR `console-app`) et `solid-js` (`app`) sérialisent de l'état ; chemin d'injection non démontré.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-f86p-h4j2-7qgj` — Seroval: Code injection through a typed array's own constructor property
- `GHSA-9wx9-5pv9-3349` — Seroval: Script injection through RegExp sources in serialized output

</details>

### `toml` — 3 élevé

Version(s) installée(s) : `4.3.0` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/app > effect > toml
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-4qx8-w7c3-pj3p` | élevé | `<=5.0.0` | NON — 5.0.1 = majeur | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |
| `GHSA-9j65-hcg3-gc64` | élevé | `<=5.0.0` | NON — 5.0.1 = majeur | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |
| `GHSA-9qmh-m7c6-f92p` | élevé | `<=5.0.0` | NON — 5.0.1 = majeur | ACCEPTER TEMPORAIREMENT (L2) | 2026-12-15 |

**Atteignabilité au SHA : non atteignable (prouvé).** Le module TOML d'`effect` n'est importé nulle part dans `packages/**` (grep = 0) : `toml.parse` n'est jamais appelé par du code Unifia.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-4qx8-w7c3-pj3p` — toml-node: Quadratic-complexity DoS via many array-of-tables headers in toml.parse()
- `GHSA-9j65-hcg3-gc64` — toml-node: Quadratic-complexity DoS via long dotted keys or table paths in toml.parse()
- `GHSA-9qmh-m7c6-f92p` — toml-node: Uncontrolled resource consumption (CPU DoS) via unbounded-length integer literals in toml.parse()

</details>

### `undici` — 4 élevé, 4 modéré

Version(s) installée(s) : `7.30.0` · Chemin(s) dans `bun.lock` :

```
workspace:unifia > @actions/github > undici
workspace:unifia > @ai-sdk/provider-utils > undici
workspace:unifia > @effect/platform-node > undici
workspace:@unifia/desktop > @actions/artifact > @actions/http-client > undici
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-xjj6-f33q-929c` | élevé | `>=7.18.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-4w7w-5xrc-9h26` | élevé | `>=7.0.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-2m5v-pch6-74hx` | élevé | `>=7.0.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-qrxm-fqhp-jwvm` | élevé | `>=7.0.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-4qv8-2p9j-2685` | modéré | `>=7.0.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-f72v-6w45-q472` | modéré | `>=7.15.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-9fm3-97px-rjf6` | modéré | `>=7.0.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |
| `GHSA-55wc-3pg8-jfw6` | modéré | `>=7.15.0 <7.30.1` | OUI — 7.30.1 | CORRIGER (L1) | 2026-11-21 |

**Atteignabilité au SHA : atteignable (prouvé) pour le paquet.** Runtime livré via `@effect/platform-node` et `@ai-sdk/provider-utils` (client HTTP du cœur). Les avis TLS/redirections portent sur des options d'`Agent` : sous-chemin précis à prouver.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-xjj6-f33q-929c` — undici vulnerable to Denial of Service via unhandled error on excessive content-encodings
- `GHSA-4w7w-5xrc-9h26` — undici vulnerable to cache poisoning and cross-user disclosure via cross-origin redirects
- `GHSA-2m5v-pch6-74hx` — undici vulnerable to TLS certificate validation bypass via dropped tls options in Agent
- `GHSA-qrxm-fqhp-jwvm` — undici vulnerable to Denial of Service via TLS 1.2 certificate-changing renegotiation
- `GHSA-4qv8-2p9j-2685` — undici vulnerable to Denial of Service via unbounded memory in the EventSource parser
- `GHSA-f72v-6w45-q472` — undici vulnerable to Subresource Integrity bypass via non-lowercase algorithm tokens
- `GHSA-9fm3-97px-rjf6` — undici WebSocket client vulnerable to Denial of Service via unbounded automatic PONG buffering
- `GHSA-55wc-3pg8-jfw6` — undici vulnerable to Denial of Service via unhandled exception in the decompress interceptor

</details>

### `vite` — 3 élevé, 10 modéré, 4 faible

Version(s) installée(s) : `7.3.5, 8.3.4, 4.5.14` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/app > vite
workspace:@unifia/console-app > vite
workspace:@unifia/desktop > vite
workspace:@unifia/desktop-electron > vite
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-c27g-q93r-2cwf` | élevé | `<=5.4.8` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-587h-7wmj-h5pm` | élevé | `>=7.0.0 <=7.3.6` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | CORRIGER (L1) | 2026-11-21 |
| `GHSA-587h-7wmj-h5pm` | élevé | `<=6.4.3` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-rq7h-c2jc-7f22` | modéré | `<=6.4.3` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-r825-w8mm-5pxw` | modéré | `>=7.0.0 <=7.3.6` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | CORRIGER (L1) | 2026-11-21 |
| `GHSA-r825-w8mm-5pxw` | modéré | `<=6.4.3` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-698v-4r3x-3vcv` | modéré | `>=7.0.0 <=7.3.6` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | CORRIGER (L1) | 2026-11-21 |
| `GHSA-698v-4r3x-3vcv` | modéré | `<=6.4.3` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-rq7h-c2jc-7f22` | modéré | `>=7.0.0 <=7.3.6` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | CORRIGER (L1) | 2026-11-21 |
| `GHSA-fx2h-pf6j-xcff` | modéré | `<=6.4.2` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-4w7w-66w2-5vf9` | modéré | `<=6.4.1` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-v6wh-96g9-6wx3` | modéré | `<=6.4.2` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-93m4-6634-74q7` | modéré | `>=4.5.3 <5.0.0` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-9jrq-w75r-8gcw` | faible | `<=6.4.3` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-jqfw-vq24-v9c3` | faible | `<=5.4.19` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |
| `GHSA-9jrq-w75r-8gcw` | faible | `>=7.0.0 <=7.3.6` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | CORRIGER (L1) | 2026-11-21 |
| `GHSA-g4jq-h2w9-997c` | faible | `<=5.4.19` | PARTIEL — 7.3.7 (7.3.5) ; NON pour 4.5.14 (6.4.4 = majeur) | ACCEPTER TEMPORAIREMENT (L3) | 2026-12-15 |

**Atteignabilité au SHA : non livré (serveur de dev).** `4.5.14` uniquement via `@jsx-email/cli` (console-mail, dev) ; `7.3.5` est le serveur de dev des paquets ; `8.3.4` est hors des plages signalées.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-c27g-q93r-2cwf` — launch-editor vulnerable to command injection via the crafted request on Windows
- `GHSA-587h-7wmj-h5pm` — launch-editor: `fs.existsSync()` existence check can be bypassed on Windows
- `GHSA-587h-7wmj-h5pm` — launch-editor: `fs.existsSync()` existence check can be bypassed on Windows
- `GHSA-rq7h-c2jc-7f22` — Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine
- `GHSA-r825-w8mm-5pxw` — launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors
- `GHSA-r825-w8mm-5pxw` — launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors
- `GHSA-698v-4r3x-3vcv` — launch-editor: escapeCmdArgs() omits % escaping on Windows
- `GHSA-698v-4r3x-3vcv` — launch-editor: escapeCmdArgs() omits % escaping on Windows
- `GHSA-rq7h-c2jc-7f22` — Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine
- `GHSA-fx2h-pf6j-xcff` — vite: `server.fs.deny` bypass on Windows alternate paths
- `GHSA-4w7w-66w2-5vf9` — Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling
- `GHSA-v6wh-96g9-6wx3` — launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows
- `GHSA-93m4-6634-74q7` — vite allows server.fs.deny bypass via backslash on Windows
- `GHSA-9jrq-w75r-8gcw` — Vite: Cross origin script execution through Vite custom middleware
- `GHSA-jqfw-vq24-v9c3` — Vite's `server.fs` settings were not applied to HTML files
- `GHSA-9jrq-w75r-8gcw` — Vite: Cross origin script execution through Vite custom middleware
- `GHSA-g4jq-h2w9-997c` — Vite middleware may serve files starting with the same name with the public directory

</details>

### `zod` — 1 élevé

Version(s) installée(s) : `4.1.8, 4.4.3, 3.25.76, 4.6.5, 3.24.2, 3.22.3` · Chemin(s) dans `bun.lock` :

```
workspace:@unifia/app > zod
workspace:@unifia/automate-migration-tool > zod
workspace:@unifia/console-app > zod
workspace:@unifia/console-core > zod
```

| Avis | Sév. | Plage vulnérable | Correctif | Décision | Échéance |
|---|---|---|---|---|---|
| `GHSA-mrhx-c7xc-m3w5` | élevé | `<4.6.6` | PARTIEL — 4.6.6 (4.x) ; NON pour 3.x (majeur) | CORRIGER si 4.x / ACCEPTER si 3.x (L1/L2) | 2026-11-21 / 2026-12-15 |

**Atteignabilité au SHA : atteignable (prouvé).** Validation des routes du serveur livré : `packages/unifia/src/server/server.ts:261` (`validator("json", …)`), `routes/*.ts`, `routes/observability.ts:486` (`validator("query", …)`). L'avis porte sur l'épuisement mémoire à la validation de collections contraintes surdimensionnées.

**Propriétaire :** @Rwanbt (propriétaire du dépôt).

<details><summary>Intitulés des avis</summary>

- `GHSA-mrhx-c7xc-m3w5` — Zod can exhaust memory while validating oversized constrained collections

</details>



## 3. Sections historiques : closes, requalifiées, renouvelées, maintenues

Cette section **conserve** les décisions passées. Aucune n'est supprimée : celles qui sont périmées
sont datées comme closes, avec la raison et la preuve.

> **Attention à la numérotation.** Les renvois `§1` … `§9` utilisés dans cette section sont ceux de
> la **révision 2026-10-17** (`§1` `braces`, `§2/§3` `react-router`, `§4` `aws-sdk`, `§5`
> `sprintf-js`, `§6` `smol-toml`, `§7` `postcss-selector-parser`, `§8` `katex`, `§9` `vite`). Ils ne
> coïncident pas avec les sections `§0` … `§8` de cette révision, qui sont thématiques. Les titres de
> cette section portent les deux repères quand c'est nécessaire.

### 3.1 §1 `braces` — CLOSE le 2026-11-10 (avis retiré par GitHub)

**Décision historique :** acceptée par le propriétaire le **2026-10-07** (`GHSA-vfj7-8cjw-p6xm`,
high, `braces <= 3.0.3`, aucun correctif publié). Mitigation produit livrée en **#309** :
`FileIgnore.MAX_BRACE_DEPTH = 32` (`isPathologicalPattern()`, `boundPatterns()`), appliquée à
`cfg.watcher.ignore` dans `FileWatcher`, épinglée par
`packages/unifia/test/file/ignore-glob-depth.test.ts` (8 tests passants au 2026-10-17 sur
`dev@24adc8cabc`). Échéance inscrite : **2026-11-07**.

**Fait nouveau (vérifié, pas supposé) :** l'avis est **RETIRÉ** côté GitHub —
`gh api advisories/GHSA-vfj7-8cjw-p6xm` → `"withdrawn_at": "2026-10-23T12:53:02Z"` (« Withdrawn
Advisory »). `braces@3.0.3` reste dans `bun.lock`, mais `bun audit` ne le signale plus.

**Clôture :** la section est close **sans renouvellement** — il n'y a plus d'avis à accepter. La
mitigation #309 **n'est pas retirée** : elle reste une défense en profondeur légitime contre un
pattern d'ignore pathologique (indépendamment de l'avis). Condition de réouverture : si un avis
`braces`/`micromatch` réapparaît, rouvrir une section et re-prouver l'atteignabilité au SHA courant.

### 3.2 §5 `sprintf-js` — CLOSE le 2026-11-10 (avis retiré par GitHub)

**Décision historique :** acceptée (`GHSA-hp3w-g68c-fv3c`, moderate, `sprintf-js <= 1.1.3`, aucun
correctif publié ; atteint uniquement par `electron`/`electron-builder`, devDependencies de
`@unifia/desktop-electron`, sur des patterns contrôlés par le développeur).

**Fait nouveau :** avis **RETIRÉ** —
`gh api advisories/GHSA-hp3w-g68c-fv3c` → `"withdrawn_at": "2026-10-22T19:21:04Z"`.
`sprintf-js@1.1.3` est toujours dans `bun.lock` ; `bun audit` ne le signale plus.

**Clôture :** sans renouvellement. Rien à corriger, rien à accepter.

### 3.3 §8 `katex` — CLOSE le 2026-11-10 (corrigé en fait par #390)

**Décision historique :** « laissé volontairement » (`GHSA-238p-pmpm-9mq7`, low, prototype
pollution, `katex < 0.18.2`, installé `0.16.27`), au motif qu'un bump mineur 0.x est cassant et
qu'une régression de rendu ne se découvre pas pendant une release.

**Fait nouveau :** **#390** (« bump katex to 0.18.11 for the prototype-pollution advisory »,
fusionnée le 2026-10-07) a déjà appliqué le correctif ; `bun.lock` résout `katex@0.18.11`, hors de
la plage vulnérable, et `bun audit` ne le signale plus. La section décrivait donc un état qui
n'existait plus.

**Clôture :** close comme **corrigée**, pas comme acceptée. Le constat historique (risque de
régression de rendu) reste la raison pour laquelle ce bump a été isolé dans son propre lot.

### 3.4 §6 `smol-toml` — FIXED (#360), conservé comme référence

**Décision historique :** correctif par `overrides` racine `smol-toml: 1.9.0`, PR **#360**, pour
`GHSA-r4xh-jqrq-34v2` (quadratique dans `parseKey`, `<= 1.8.0`). Deux copies existaient (`1.7.1`
hoistée via `knip` et `@astrojs/internal-helpers`, `1.9.0` imbriquée sous `astro`) ; l'override les
a fusionnées et supprimé le doublon. Mesure conservée : sur 40 000 clés, `1.7.1` ≈ 435 ms (×3,70 par
doublement, quadratique) contre `1.9.0` ≈ 25 ms (×2,49) — 17,6× d'écart. `1.9.0` satisfait toutes
les plages déclarées et exporte la même surface (`parseKey` n'a jamais été exporté).

**Statut :** maintenu comme **correctif de référence** (le motif d'un override compatible, mesuré et
justifié). `bun.lock` résout `smol-toml@1.9.0` ; plus aucun avis.

### 3.5 §2 & §3 `react-router` — MAINTENUE (acceptation temporaire renouvelée au 2026-12-15)

**Décision historique (conservée) :** accepter `GHSA-wrjc-x8rr-h8h6` (open redirect via backslash,
`>= 6.0.0 < 7.18.0`) et `GHSA-337j-9hxr-rhxg` (constructor injection via `deserializeErrors()` en SSR
hydration, `>= 6.4.0 < 7.18.0`), tous deux corrigés en **7.18.0**.

**Chemin unique :** `@unifia/console-mail › @jsx-email/cli@1.4.3 › react-router-dom@6.16.0 ›
react-router@6.30.4`. `@jsx-email/cli` épingle `react-router-dom: 6.16.0` et `react: 18.2.0` ; forcer
`react-router >= 7.18.0` est le majeur hors plage que ce dépôt s'interdit (cf. l'incident
`@ai-sdk/provider-utils`).

**Atteignabilité :** non livré au runtime. Le code React Router n'existe que dans l'outil de
preview e-mail local (`packages/console/mail`), pas dans l'application SolidJS. Aucun arbre de
routes React Router dans `packages/console/app`.

**Décision 2026-11-10 :** **ACCEPTER TEMPORAIREMENT**, échéance **2026-12-15** (renouvelée, pas
permanente), propriétaire @Rwanbt. Condition de révocation : dès que `@jsx-email/cli` déclare
`react-router-dom ^7`, ou si `@unifia/console-mail` cesse d'être une dépendance de production de
`console-app`/`console-core`, l'acceptation est caduque et le bump redevient un correctif
compatible (L1).

### 3.6 §4 `aws-sdk` — REQUALIFIÉE en acceptation durable bornée → voir §4

L'ancienne §4 acceptait `GHSA-j965-2qgj-vjmq` (`aws-sdk` v2, `region` non validée, low, migration
notice, `first_patched_version: null`) **sans échéance**. Une acceptation sans échéance est
précisément ce que la décision 1A interdit. Elle est donc **requalifiée** : acceptation durable
**bornée** (échéance et conditions en §4), pas permanente.

### 3.7 §7 `postcss-selector-parser` — REQUALIFIÉE EN CORRECTION (le correctif existe désormais)

**Décision historique (conservée) :** accepter `GHSA-rj75-hqrm-r3gf` (quadratique dans le parsing de
sélecteurs plats), au motif mesuré qu'**aucune version compatible corrigée n'existait** : la ligne
6.x s'arrêtait à `6.1.4` (vulnérable) et la seule version hors plage était `7.1.6`, un **majeur**
imposé à `tailwindcss@4.1.11` qui déclare `^6.0.11`. Un override `7.1.6` avait été construit et
mesuré : même surface d'export (40 symboles), AST identique sur 16 jeux de sélecteurs réalistes et
sur un document plat de 400 sélecteurs, `bun audit` 8 → 7. Il n'avait pas été retenu pour deux
raisons locales : **aucun gate CI ne compile le CSS** sur une PR vers `dev` (`vite build` vit dans
`publish.yml`/`release.yml`), et le build CSS n'était pas reproductible sur la machine de mesure.

**Fait nouveau (mesuré le 2026-11-10) :** `npm view postcss-selector-parser@6.1.5 version` → **6.1.5**.
La ligne 6.x a reçu un patch ; `bun audit fix --dry-run` propose désormais
**`6.1.4 → 6.1.5`** (et `7.1.4 → 7.1.6`) **dans les plages déclarées**, sans `--latest`.

**Requalification :** la base factuelle de l'ancienne acceptation (« aucune version compatible
corrigée ») est **fausse depuis la publication de 6.1.5**. La décision 1A impose de **remédier dès
qu'une solution compatible apparaît** : §7 passe de « acceptée » à **CORRIGER (L1, 2026-11-21)**,
sans override majeur. L'historique du raisonnement est conservé ci-dessus pour que le prochain
lecteur ne « re-découvre » pas l'override 7.x comme une nouveauté.

### 3.8 §9 `vite@4.5.14` — RENOUVELÉE, échéance 2026-12-15 (majeur bloqué, chemin dev-only)

**Décision historique (conservée) :** accepter les avis **serveur de développement** de `vite 4.5.14`
(`GHSA-c27g-q93r-2cwf`, `GHSA-fx2h-pf6j-xcff`, `GHSA-v6wh-96g9-6wx3`, `GHSA-93m4-6634-74q7`,
`GHSA-4w7w-66w2-5vf9`, `GHSA-g4jq-h2w9-997c`, `GHSA-jqfw-vq24-v9c3`), échéance **2026-11-07**.

**Faits vérifiés à la révision :** le chemin unique est toujours
`vite@4.5.14 ← @jsx-email/cli@1.4.3 ← @unifia/console-mail` (paquet privé, script
`"dev": "email preview emails/templates"`). `email build` ne charge pas vite ; le runtime console
importe un template e-mail dynamiquement (`packages/console/core/src/user.ts:141`) sans charger le
CLI ; aucun root livré (`app`, `desktop`, `desktop-electron`, `mobile`, `unifia`) ne dépend de
`console-mail`. Le workspace `vite` résout par ailleurs `7.3.5` (corrigé en L1 → 7.3.7) et des
copies `8.3.4` hors des plages signalées.

**Pourquoi l'échéance du 2026-11-07 ne peut pas être simplement « exécutée » :** le correctif est
`vite 6.4.4`, un **majeur** contre `@jsx-email/cli@1.4.3` qui déclare `vite@^4.4.9` — exactement le
override majeur que la décision 1A interdit sans preuve. L'alternative prévue par la section
d'origine (« retirer `@jsx-email/cli` de `console-mail` ») est une décision de dépendance produit,
pas une correction de registre.

**Décision 2026-11-10 :** **RENOUVELER** l'acceptation, échéance **2026-12-15**, avec les deux
conditions d'origine **conservées** : (1) ne pas passer `--host` au serveur de preview, (2) arrêter
le preview quand il n'est pas utilisé. Condition de révocation : si `console-mail` est un jour servi
dans le runtime de la console, l'acceptation est caduque (le paquet sort du dev-only) ; si
`@jsx-email/cli` publie une version sur `vite ^6`/`^7`, le bump redevient L1.

### 3.9 `dompurify` et `storybook` (les 3 critiques) — CORRIGÉS, en attente de fusion

**Décision 2026-11-10 (branche `fix/crit-alerts` = `22975f5d6b`) :** les trois avis critiques au SHA
`origin/dev` sont corrigés par bump compatible, sans acceptation :

| Avis | Paquet | Version | Correctif appliqué |
|---|---|---|---|
| `GHSA-cg2g-xh64-v4q7` (critique) + `GHSA-mrv2-3pqr-j5jr` (élevé) + `GHSA-c6gr-qvv4-5v3f` (faible) | `dompurify` | `3.4.16` → **`3.4.17`** | L1 exécuté |
| `GHSA-f2ph-cmg5-wxc8` (critique) + `GHSA-px85-f4q5-jh77` (élevé) | `storybook` | `10.5.7` → **`10.6.2`** | L1 exécuté |
| idem | `@storybook/addon-vitest` | `10.5.7` → **`10.6.2`** | L1 exécuté |

`dompurify` était le risque le plus élevé du registre précédent : chemin **prouvé** dans du code
livré (`packages/ui/src/components/markdown.tsx:3,24-25,51` et
`packages/web/src/components/share/content-markdown.tsx:1,42-43` assainissent du HTML dérivé de
Markdown). Il n'est **pas** accepté : il est corrigé. Tant que `fix/crit-alerts` n'est pas fusionnée,
`origin/dev` porte encore ces 3 avis critiques et le GO PROD reste refusé (décision 1A).

### 3.10 Re-mesures historiques conservées (le compteur n'est pas une constante)

Ce registre a toujours refusé de traiter un décompte d'avis comme un seuil. L'historique le prouve :

| Date | Référence | Outil | Résultat | Cause du mouvement |
|---|---|---|---|---|
| 2026-10-05 15:45Z | `dev@56ad2a2ad` | bun 1.3.14 | 5 (2H/2M/1L) | référence initiale |
| 2026-10-05 (8 h plus tard) | même lockfile | bun 1.3.14 | 12 | flux d'avis : `proxy-addr` 23:30Z, `seroval` 23:40Z, `katex` 23:41Z |
| 2026-10-06 | `dev@66b6071df` | bun 1.3.14 | 8 (1H/5M/2L) | + correctifs #329/#330/#331 |
| 2026-10-06 (après #360) | idem | bun 1.3.14 | 7 (1H/4M/2L) | `smol-toml` corrigé |
| 2026-10-15 | `dev@24c2b93588` | bun 1.3.11 | 13 (3H/7M/3L) | flux d'avis |
| 2026-10-17 | `dev@24adc8cabc` | bun 1.3.11 | 13 (3H/7M/3L) | aucun changement |
| 2026-11-10 | `origin/dev` `e487ea285e` | bun 1.4.4 | **74** (3C/23H/35M/13L) | **graphe** (4 commits sur `bun.lock`, +102/−118) **et** flux d'avis |
| 2026-11-10 | `fix/crit-alerts` `22975f5d6b` | bun 1.4.4 | **67** (0C/20H/35M/12L) | correctifs critiques |

Entre le 2026-10-17 et le 2026-11-10, **259 commits** séparent les deux SHA et `git log
24adc8cabc..origin/dev -- bun.lock` liste 4 commits (`472add5fdf`, `8a6462f614`, `82077d168d`,
`4b1afec48f`). L'écart 13 → 74 n'est donc **pas** attribuable au seul flux d'avis : le graphe a
bougé. C'est la raison pour laquelle la révision du 2026-10-17 ne pouvait pas être « prolongée » et
a dû être refaite.

**Enseignement opérationnel conservé :** un gate écrit comme un compteur absolu doit porter un
horodatage et une version d'outil, sinon il est rouge/vert pour de mauvaises raisons.

## 4. Avis sans correctif viable : `aws-sdk` v2 (acceptation durable bornée)

| Champ | Valeur |
|---|---|
| Avis | `GHSA-j965-2qgj-vjmq` — low |
| Paquet | `aws-sdk@2.1692.0` |
| Plage | `>= 2.0.0 <= 3.0.0` |
| Correctif | **AUCUN** — `first_patched_version: null` ; c'est un avis de migration (valider `region` ou passer à v3), pas une faille mémoire |
| Chemin | `@unifia/console-core › sst@3.18.10 › aws-sdk@2.1692.0` ; `sst` est une **devDependency racine** (CLI d'infra et de dev local) |
| Atteignabilité | **non livré** : aucun artefact distribué n'embarque `sst`/`aws-sdk` v2 ; la `region` provient de `sst.config.ts` ou du shell du développeur, jamais d'une requête |
| Décision | **ACCEPTER DURABLEMENT** (bornée, pas permanente) |
| Propriétaire | @Rwanbt |
| Échéance | **2027-03-31** |
| Condition de révocation | si `sst` cesse d'être une devDependency, si un `aws-sdk` v2 client est construit avec une `region` dérivée d'une entrée, ou si `sst` migre vers le SDK v3 (le correctif devient alors L1) |

**Pourquoi durable et pas temporaire :** il n'existe rien à corriger — l'avis lui-même est une
consigne de migration, et la migration appartient au calendrier de `sst`, pas à ce dépôt. Le risque
résiduel est nul dans le périmètre livré (devDependency, entrée développeur). L'échéance 2027-03-31
oblige malgré tout à re-mesurer : une acceptation durable n'est pas une ligne oubliée.

## 5. Écarts entre outils : `bun audit` (67) vs Dependabot GitHub (132)

Deux compteurs, deux périmètres. Les confondre est l'erreur qui a rendu la révision précédente
inutilisable. Mesures du 2026-11-10, toutes deux à la même heure :

| | `bun audit` (`fix/crit-alerts` `22975f5d6b`) | Dependabot (branche par défaut `main`) |
|---|---|---|
| Total | **67** avis | **132** alertes |
| Critiques | 0 | 3 |
| Élevées | 20 | 32 |
| Modérées | 35 | 63 |
| Faibles | 12 | 34 |
| Écosystèmes | npm seulement | npm **86** + rust **46** |
| Paquets | 23 | 14 paquets npm + crates Rust |
| GHSA distincts | 60 | 71 (npm) |

**Quatre causes, mesurées :**

1. **Le Rust (46 alertes) échappe à `bun audit`.** `bun audit` ne lit que `bun.lock` (npm).
   Dependabot couvre `packages/desktop/src-tauri/Cargo.lock` (25) et
   `packages/mobile/src-tauri/Cargo.lock` (21). Aucun outil du dépôt ne scanne ces deux lockfiles :
   c'est un trou de couverture, pas un désaccord. **Ces 46 alertes ne sont donc ni acceptées ni
   corrigées ici** — elles relèvent d'un outil Rust (`cargo audit`, `osv-scanner --lockfile`) et
   d'un lot dédié.
2. **Dependabot juge la branche par défaut (`main`), pas `dev` ni la branche de correctifs.** Preuve
   directe : `dompurify` est déclaré `3.4.2` dans `main` (26 alertes Dependabot) mais `3.4.16` sur
   `dev`, et le lockfile de `fix/crit-alerts` résout `3.4.17`. Dependabot décrit un état **en
   retard sur le travail réel**.
3. **Dependabot juge les manifestes (`version_requirement`), `bun audit` le graphe résolu.** Écarts
   relevés (déclaré/vu par Dependabot → résolu dans `bun.lock`) : `@modelcontextprotocol/sdk`
   1.27.1 → 1.32.1 ; `electron` 40.8.5 → 42.10.0 ; `katex` 0.16.27 → 0.18.11 ; `astro` 5.18.1 →
   7.3.5 ; `turbo` 2.8.13 → 2.10.9 ; `wrangler` 4.50.0 → 4.148.0 ; `nitro` 3.0.1-alpha.1 →
   3.0.260429-beta ; `mysql2` 3.14.4 → 3.24.4 ; `@hey-api/openapi-ts` 0.90.10 → 0.99.0 ;
   `@babel/core` 7.28.4 → 7.29.7 ; `@astrojs/cloudflare` 12.6.6 → 14.3.4 ;
   `@ai-sdk/provider-utils` 4.0.21 → 4.0.56 ; `minimatch` 10.2.1 → 10.2.5. Plusieurs de ces
   paquets sont **déjà hors de la plage vulnérable** dans le lockfile : Dependabot alerte sur une
   version que le dépôt n'installe pas.
4. **Dependabot ne remonte pas les transitives.** L'intersection des GHSA est de **8** seulement.
   21 paquets signalés par `bun audit` n'apparaissent pas chez Dependabot parce qu'ils ne sont
   déclarés dans aucun `package.json` : `vite` (17 avis), `undici` (8), `zod`, `glob`,
   `body-parser`, `qs`, `react-router`, `seroval`, `follow-redirects`, `fast-uri`, `toml`,
   `postcss-selector-parser`, `happy-dom`, `@vitest/mocker`, `aws-sdk`, `deepmerge`, `ip-address`,
   `@hono/node-server`, `@azure/msal-node`, `fastify`, `hono`.

**Lequel fait foi, et pourquoi :**

- **Pour le risque d'exécution npm, c'est `bun audit` qui fait foi**, et il est la référence de ce
  registre : il mesure le **graphe résolu**, donc le code réellement chargé par un artefact, y
  compris les transitives que Dependabot ne voit pas. Un avis qui n'atteint aucune version installée
  n'est pas un risque ; un avis qui atteint une transitive est invisible pour Dependabot.
- **Pour le Rust, Dependabot fait foi** (et `bun audit` est aveugle) : les 46 alertes cargo sont un
  périmètre réel, hors de ce registre, à traiter par un scan Rust et à documenter séparément.
- **Pour la fraîcheur des manifestes, Dependabot est le seul à parler** — mais il parle de `main`,
  donc de l'état publié, pas du travail en cours. Ses 3 « critiques » npm ne sont pas des critiques
  du code livré sur `dev` : ce sont des critiques de `main`, dont deux (`dompurify`, `storybook`)
  sont déjà corrigés sur la branche de correctifs.
- **Conclusion opposable :** aucun des deux outils ne suffit seul. Un registre qui ne citerait que
  l'un des deux serait faux — soit en ignorant les transitives (Dependabot), soit en ignorant le
  Rust (`bun audit`). Ce registre couvre npm/bun et **déclare explicitement** le trou Rust.

## 6. Priorités de correction (consignées ici, pas appliquées dans le code)

Ce lot est documentaire : **aucun `package.json`, aucun `bun.lock` n'est modifié ici**. Les priorités
suivent l'atteignabilité prouvée, pas le seul compteur.

### L1 — correctifs dans les plages déclarées (41 avis, 15 paquets, échéance 2026-11-21)

Ordre recommandé, du risque prouvé vers l'outillage :

1. **`undici` 7.30.0 → 7.30.1** (4 high : TLS, redirections) — runtime livré, correctif d'un patch.
2. **`electron` 42.10.0 → 42.11.16** (1 high + 7) — coquille desktop livrée ; à re-tester sur les
   surfaces Electron (`packages/desktop-electron`) avant merge.
3. **`body-parser` 1.20.6 → 1.20.9 / 2.3.0 → 2.4.0** (2 high) + **`follow-redirects` 1.16.0 →
   1.16.2** (3 high) — chemin Slack (`@slack/bolt`).
4. **`vite` 7.3.5 → 7.3.7** (5 avis) — serveur de dev seulement.
5. **`postcss-selector-parser` 6.1.4 → 6.1.5 et 7.1.4 → 7.1.6** (2 modérés) — requalifié, cf. §3.7.
6. **`seroval` 1.6.8 → 1.6.11**, **`qs` 6.16.0 → 6.16.1**, **`fast-uri` 4.2.1 → 4.2.3**,
   **`ip-address` 10.7.2 → 10.7.4**, **`hono` 4.13.10 → 4.13.11**, **`@hono/node-server` 2.1.0 →
   2.1.3**, **`fastify` 5.12.5 → 5.12.6**, **`@vitest/mocker` 4.1.11 → 4.1.12**,
   **`zod` 4.x → 4.6.6**.
7. **`dompurify` 3.4.17 et `storybook` 10.6.2** — déjà appliqués sur `fix/crit-alerts` : à vérifier
   au merge, pas à refaire.

Chaque paquet doit être corrigé **isolément** avec `bun.lock`, typecheck du paquet et tests du
paquet ; jamais un `bun update` global (décision 1A).

### L2 — majeurs d'outillage (réexamen 2026-12-15)

`glob` 14.0.2 (bloqué par `archiver-utils ^10`, `js-beautify ^10.4`, `rimraf ^10.3`,
`@npmcli/map-workspaces ^13`), `minimatch` 11.0.1 (override racine `10.2.5`),
`happy-dom` 21.0.4, `toml` 5.0.1, `deepmerge` (seule « correction » = downgrade 4.1.2, hors plage de
`html-to-text ^4.3.1` — donc pas de correctif), `@azure/msal-node` 7.1.0 (contre `@azure/identity
^5.1.0`), `zod` 3.x → 4.6.6.

### L3 — majeurs produit (réexamen 2026-12-15)

`react-router` 7.18.0 (bloqué par `@jsx-email/cli`), `vite` 4.5.14 → 6.4.4 (même blocage).

### L4 — durable

`aws-sdk` v2, réexamen 2027-03-31 (§4).

## 7. Réexamen et automatisation

### Calendrier

| Échéance | Ce qui doit être re-mesuré | Décision attendue |
|---|---|---|
| **2026-11-21** | L1 (41 avis / 15 paquets) | constat d'exécution ou justification de report |
| **2026-12-15** | 25 avis en majeur bloqué + §3.5 (`react-router`) + §3.8 (`vite@4.5.14`) | corriger, ou renouveler avec une raison nouvelle |
| **2027-03-31** | `aws-sdk` + réexamen global (registre entier) | reconduire ou retirer |

Chaque réexamen doit produire : la commande, la version de `bun`, l'horodatage, le SHA, et la
comparaison avec la révision précédente. Un réexamen qui ne produit pas ces cinq éléments n'est pas
un réexamen.

### Ce qui devrait être automatisé (le gate CI relève d'un autre lot)

1. **Un job `bun audit` horodaté** sur `dev` et sur les PR de dépendances, exécuté avec la version
   **épinglée** (`bun@1.3.11` → à aligner avec la version de mesure), échouant sur les avis
   **critiques/élevés atteignables** — pas sur un compteur absolu.
2. **Une comparaison générée entre le registre et la mesure** : tout avis rapporté sans entrée dans
   ce fichier doit faire échouer le gate (« aucun avis non dispositionné »), et toute entrée sans
   avis correspondant doit être signalée comme périmée. C'est le contrôle qui aurait évité la
   révision 13 → 74.
3. **Un scan Rust** (`cargo audit` / `osv-scanner`) sur `packages/desktop/src-tauri/Cargo.lock` et
   `packages/mobile/src-tauri/Cargo.lock` : 46 alertes aujourd'hui invisibles du registre.
4. **Un rappel d'échéance** : les dates du tableau ci-dessus doivent casser la CI (ou au minimum
   échouer sur une PR) quand elles sont dépassées.

## 8. Journal des révisions

| Date | Auteur | Référence | Changement |
|---|---|---|---|
| 2026-10-05 | Lane D | `dev@56ad2a2ad` | création (5 avis, bun 1.3.14) |
| 2026-10-06 | Lane D | `dev@66b6071df` | 8 → 7 après #360 (`smol-toml`), §6/§7 closes |
| 2026-10-07 | propriétaire | — | acceptation `braces` (§1) |
| 2026-10-10 | Lane D | `dev` | re-vérification `braces` par exécution du test |
| 2026-10-15 | RC-1 | `dev@24c2b93588` | re-mesure 13 avis (bun 1.3.11) |
| 2026-10-17 | RC-1 lot F | `dev@24adc8cabc` | re-mesure 13 avis, aucune section modifiée |
| **2026-11-10** | **ce lot** | `fix/crit-alerts@22975f5d6b` (+ `dev@e487ea285e`) | **réécriture : 67 avis, 23 paquets, 60 GHSA ; §1 `braces` close (avis retiré), §5 `sprintf-js` close (avis retiré), §8 `katex` close (corrigé #390), §7 `postcss-selector-parser` requalifiée en correction (6.1.5 publié), §9 `vite` renouvelée au 2026-12-15, §4 `aws-sdk` requalifiée en durable bornée ; ajout §5 « écarts entre outils » ; ajout des 22 paquets qui n'avaient aucune fiche** |

