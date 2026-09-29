<!-- SPDX-License-Identifier: MIT -->

# Synthèse adversariale — seconde review multi-IA du PLAN R4

> Date : 2026-09-17  
> Sortie : `PLAN-PIXEL-PERFECT-PORT-2026-09-17-R5.md`.

## 1. Autorité des rapports

| Source | Cible réelle | Accès repo | Valeur autorisante |
|---|---|---|---|
| ChatGPT | R3, SHA `20b2829…` | GitHub seulement | rejeté pour R4 : rapport obsolète |
| Claude | R4 | aucun | `DOCUMENT-ONLY` |
| DeepSeek | R4 | aucun | `DOCUMENT-ONLY` |
| MiniMax | aucun rapport | aucun | nulle |
| Mistral | R4, rôles simulés | aucun | non autorisante |
| Qwen | R4 | aucun | `DOCUMENT-ONLY` |

Aucun rôle A–D exécutable n'a encore été fourni. R5 reste donc non autorisé, quelle que
soit la qualité documentaire de certains findings.

## 2. Findings acceptés

| Finding | Décision | Correction R5 |
|---|---|---|
| plan absent du lock | accepté hors rapport R3 | `contract-lock.json` verrouille commit/path/hash du plan |
| issue #116 contradictoire | accepté | issue = tracker non normatif ; pointer R5 reste gate P0 |
| complétude auto-déclarée du manifest | accepté avec nuance | census runtime indépendant + mutation d'omission |
| états auto-déclarés | accepté P0 | `state-policy.json` dérive les états de `anchorKind`/rôle |
| résidu strict sans chemin A/A | accepté avec garde-fou | zéro par défaut ; enveloppe spatiale A/A seulement |
| statique certifié sous `reduce` | accepté | `no-preference` t=0/final + `reduce` supplémentaire |
| locale scalaire | accepté | catalogue `fr/de/ar` avec BCP47 et direction |
| périmètre Bun/G3 flou | accepté | seule l'image qualifie ; host = feedback/warning |
| échéance `blocked-by-runtime` circulaire | accepté | statuts approval/contested + escalation owner, lane affectée seule |
| pilote non binaire | accepté | les deux ancres et leurs états doivent passer le profil final |
| base `work-design` dans environment lock | accepté | base et target head déplacés dans `parity-run.json` |
| horloge antérieure aux fixtures | accepté | instant verrouillé postérieur à toutes les fixtures |
| budget masque ambigu | accepté | dépassement individuel maxPixels/maxRatio défini + télémétrie agrégée |
| `retain-nonparity` échappatoire | accepté | remplacé par instrumentation interne interdite aux ancres/census |
| mutation de la référence par adapter | accepté | aucune mutation DOM ; locator rôle/texte/relation |
| lockfile/configs non hashés | accepté | hashes lockfile/packages/config/scripts et versions outils |
| baseline de skips indéfinie | accepté | baseline commitée ; nouveau skip ou test disparu échoue |
| fonte de référence non prouvée | accepté | famille calculée, fichiers hashés, réseau externe bloqué |
| P1 avant une preuve minimale | accepté | P0 construit locks/image/runner ciblé puis P1 |
| texte dynamique masqué sans sémantique | accepté | assertion i18n/code/fixture obligatoire |
| absence d'abandon S0/S1 | accepté | deux échecs identiques renvoient en review |
| concurrence `new-ui` | accepté avec correction | rebase/rerun ; environment lock ne change que si ses entrées changent |
| clés `matchBy` instables | accepté | clés métier ; IDs framework/index interdits ; mutations ordre/clé |
| A/A non spécifiée | accepté | artifact hashé, vingt paires + validation, enveloppe spatiale |

## 3. Findings rejetés ou reclassés

- Le rapport ChatGPT audite R3, recompte les 40 cas/PR et cite l'ancien `appHead` : il ne
  peut ni ouvrir ni fermer un finding R4. Son idée de census a été retenue indépendamment.
- « Parseur non spécifié = P0 » est reclassé P1 de reproductibilité. R5 choisit les outils
  réellement présents : Compiler API TypeScript `5.8.2`, PostCSS `8.5.26`, Playwright DOM.
- `acorn@8.11.3` est rejeté : le lock résout `8.18.0` et Acorn seul ne parse pas TSX typé.
- Comparer l'AST à `git grep` est rejeté : le grep mélange commentaires, docs et tests.
- `matchBy` non prouvé par l'exemple n'est pas un P0 du plan : G1 doit le prouver au runtime.
- L'isolation BrowserContext est une propriété Playwright connue, mais un test sentinelle
  explicite est ajouté ; ce n'était pas une preuve de faux vert déjà observé.
- Les seuils proposés « 5 px », « 0,1 % », 100 runs ou 5 jours sont arbitraires. R5 utilise
  le profil final du pilote, une enveloppe spatiale A/A et une escalade sans délai inventé.
- « DPR2 doit passer avant S13 » est rejeté : il doit être supporté par G0 dès P0, mais sa
  qualification exhaustive reste correctement placée en S13.
- « fragments non validés avant S3 » est déjà fermé : G1 valide schema puis DOM avant slice.
- `NON_DESIGN_ONLY` sur silence n'est pas une promotion complète ; R5 distingue attente et
  contestation, mais `FULL_PARITY` reste bloqué dans les deux cas.

## 4. Faits locaux rejoués

```text
branch/origin   new-ui / 8cc914c0ea575ae675d4067e27754b86f4e9171b
work-design     d212bc8098af43ca64a8c4456263dfdb44a56190
reference SHA   6c01e84c27abf7665bb4de65e0c3969b7af0f020129aa971916376b1ca69818b
TypeScript      5.8.2
PostCSS         8.5.26
Playwright      1.57.0
axe/Biome       4.13.0 / 2.4.14
```

La maquette ne charge aucune webfont distante ; elle demande `Inter` puis les fallbacks
système. L'issue #116 est toujours ouverte et pointe encore le plan initial. Les quatre
modifications applicatives préexistantes du worktree restent intactes.

## 5. Verdict critic

```json
{
  "passed": false,
  "concerns": ["aucune review A-D repo-access", "issue #116 encore obsolète"],
  "rejected_findings": ["chatgpt-r3-as-r4", "mistral-arbitrary-thresholds", "mistral-grep-oracle"],
  "plan_completeness": "complete",
  "mvp_disguised": false,
  "recommendations": ["reviewer R5 avec accès dépôt", "mettre à jour #116 avant P1"],
  "iterations_used": 1,
  "blocking": true
}
```

R4 : **ajuster**. R5 : **prêt pour review exécutable**, non autorisé pour implémentation.
