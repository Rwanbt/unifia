<!-- SPDX-License-Identifier: MIT -->

# Synthèse adversariale — troisième review multi-IA du PLAN R5

> Date : 2026-09-17
> Sortie : `PLAN-PIXEL-PERFECT-PORT-2026-09-17-R6.md`.

## 1. Autorité des rapports

| Source | Accès | Classe | Autorise |
|---|---|---|---|
| Claude | plan seulement | `DOCUMENT-ONLY` | non |
| DeepSeek | plan seulement | `DOCUMENT-ONLY` | non |
| Mistral | rôles A–E simulés | `DOCUMENT-ONLY` | non |
| MiniMax | plan seulement | `DOCUMENT-ONLY` | non |
| Qwen | plan seulement | `DOCUMENT-ONLY` | non |
| ChatGPT | dépôt GitHub distant, pas le worktree | `REMOTE-READ-ONLY` | non |

Aucun rôle A–D n'a exécuté le futur runner, les mutations ou le dirty state local. Les
rapports améliorent le document mais ne satisfont toujours pas le protocole autorisant.

## 2. Findings acceptés

| Finding dédupliqué | Décision R6 |
|---|---|
| P1 dépend de G1 complet construit après lui | profile pilote du même moteur, périmètre réduit et `notRun` explicites ; replay full en S3 |
| A/A non planifiée et reviewer C sans autorité durable | étude pilote en P0b ; owner GitHub permanent ; update par campagne dédiée |
| P0 incompatible avec 400 LOC | PF0 puis P0a/P0b ≤400 LOC ; P1 troisième PR d'implémentation maximum |
| census référence seulement | census symétrique et compteurs app/invisible focusable |
| census pris seulement à default | census par stateVector puis union |
| mutation harness confondue avec interaction voulue | journaux `harnessDomMutations` et `interactionDomMutations` séparés |
| pilote annonce deux ancres mais utilise les pills | trois ancres nommées, états interactifs portés par `home.mode-pill` |
| fonte sans preuve de licence | provenance et licence hashées pour fonte packagée ou système |
| `retainReferencedAnchors` indéfini | définition normative ajoutée |
| bootstrap `planCommit` circulaire | PF0 antérieur au lock, vérifié comme ancêtre et par contenu du tree |
| checker capable de se re-signer | tool-only puis lock-only ; aucun changement de surface dans ce train |
| environment lock bloqué par PostCSS ajouté en S0 | toutes les devDependencies pilote entrent en P0a ; skips dans le contrat QF0 |
| motion absente de l'identité canonique | `StaticCase` et `MotionCase` calculés, avec `missingMotionCoverage` |
| quiescence contradictoire avec animation | checks statique terminal et timeline motion séparés |
| outputs P1 ambigus entre PR2 et PR séparée | captures/JSON/heatmaps = artifacts CI de la PR P1 ; entrées seules versionnées |
| skip renommé assimilé à suppression | ID stable et mapping explicite `renamedFrom` ; rename/suppression mutés |
| image G0 sans source reproductible | Dockerfile/build script commités, hashés et binaire Bun vérifié dans l'image |
| `git cat-file` et worktree ambiguës | lecture path dans tree exact plus propreté index/worktree des paths verrouillés |
| règles de census trop vagues | `census-rules.json` hashé : paint candidates, pseudo/SVG et focusables |
| profils finaux introuvables | `style-profiles.json` commité/hashé et attaqué propriété par propriété |
| Design `CONTESTED` sans sortie | machine d'état explicite ; silence jamais approbation |
| rebase perdant la base de preuve | slice base et merge-base ajoutés au résultat ; ancien run non promotionnel |

## 3. Findings rejetés ou reclassés

- « Le parseur S0 n'est pas lié à TypeScript/PostCSS » est faux : R5 §3.3 le disait déjà.
  R6 ajoute seulement une fixture de calibration.
- Passer de 20 à 100 paires A/A et invoquer un intervalle de confiance de 95 % est rejeté :
  aucune distribution statistique n'est définie. R6 conserve un minimum, répartit les runs
  entre processus frais et impose un batch de validation séparé.
- Le plafond arbitraire de bruit à `0,5 px` est rejeté : une enveloppe spatiale fonctionne
  sur des positions de pixels, pas sur un rayon générique.
- Acorn `8.11.3` est rejeté : le lock local résout `8.18.0`, et la Compiler API TypeScript
  est l'oracle TSX retenu.
- Les délais Design 2/4/6 jours et l'approbation tacite après 30 jours sont rejetés. Le
  propriétaire fournit `nextReviewAt`; silence = attente/escalade, jamais approbation.
- Une troisième PR après échec P1 est rejetée. Un incident externe peut seulement rejouer
  deux fois le même commit ; un nouveau changement impose une review.
- La visibilité proposée par Qwen (`display`, `visibility`, box) est insuffisante seule :
  R6 ajoute chaîne d'opacité, clipping, pseudo/SVG et focusables invisibles.
- La variation de `--max-old-space-size` n'est pas une mutation de parité pertinente ; les
  redémarrages Chromium et contextes frais couvrent la dérive de session visée.
- Le HEAD `work-design` cité par ChatGPT (`609f2db354…`) ne correspond pas à l'API actuelle
  (`609f2d494064c61d6688b916644560930b72cb79`). Il n'est plus codé en dur dans R6.

## 4. Faits locaux rejoués

```text
worktree/branch  D:\App\unifia\_a7-automate-memory / new-ui
local+remote new-ui 8cc914c0ea575ae675d4067e27754b86f4e9171b
remote work-design 609f2d494064c61d6688b916644560930b72cb79
packageManager bun@1.3.11
TypeScript/Biome 5.8.2 / 2.4.14
Playwright/axe-core 1.57.0 / 4.13.0
PostCSS lock 8.5.26
```

Le rapport ChatGPT annonçait Playwright `1.59.1` et `@axe-core/playwright 4.11.1` ; le dépôt
local contient `@playwright/test 1.57.0` et `axe-core 4.13.0`. Aucun Dockerfile de parité ni
runner R5 n'existe encore. L'issue #116 reste ouverte avec le plan initial. Les quatre
modifications applicatives préexistantes du worktree sont intactes.

## 5. Verdict critic

```json
{
  "passed": false,
  "concerns": ["aucune review A-D locale et exécutable", "issue #116 encore obsolète"],
  "rejected_findings": ["mistral-100-aa", "qwen-half-pixel", "mistral-fixed-design-delays", "mistral-acorn-8.11.3"],
  "plan_completeness": "complete",
  "mvp_disguised": false,
  "recommendations": ["committer PF0 après review R6", "exécuter A-D sur le worktree"],
  "iterations_used": 1,
  "blocking": true
}
```

R5 : **ajuster**. R6 : **prêt pour review exécutable**, non autorisé pour implémentation.
