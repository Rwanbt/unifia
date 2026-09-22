<!-- SPDX-License-Identifier: MIT -->

# Synthèse adversariale — reviews multi-IA du PLAN R3

> Date : 2026-09-17  
> Périmètre : retours Claude, DeepSeek, Mistral, MiniMax et Qwen fournis par le propriétaire.  
> Sortie : corrections intégrées dans `PLAN-PIXEL-PERFECT-PORT-2026-09-17-R4.md`.

## 1. Qualité des rapports reçus

| Source | Accès repo | Nature | Valeur autorisante |
|---|---|---|---|
| Claude | non | review documentaire explicite et cohérente | non |
| DeepSeek | non | review documentaire explicite et cohérente | non |
| Mistral | non | synthèse simulée, avec extrapolations et exemples inventés | non |
| MiniMax | non | demande de clarification, aucun rapport | non |
| Qwen | non | rôle A documentaire, sans reproduction factuelle | non |

Aucun rapport ne satisfait le protocole repo-access de R4. Les contradictions internes
qu'ils révèlent sont néanmoins recevables lorsqu'elles sont prouvées par le texte de R3.

## 2. Arbitrage des findings

| Finding source | Décision | Confiance | Correction R4 |
|---|---|---:|---|
| Claude DOC-P0-01 — unité de cas ambiguë | accepté | 0,99 | définitions normatives ; comptes calculés ; aucun total DoD |
| Claude DOC-P0-02 — lock déterministe incomplet | accepté | 0,99 | environment lock étendu + run output séparé |
| Claude DOC-P0-03 — appariement `count>1` absent | accepté | 0,99 | `matchBy`, clés, séquence et mutation swap |
| Claude DOC-P0-04 — ratio pixel global trop permissif | accepté | 0,98 | budgets locaux par ancre + contrôle hors ancres |
| Claude DOC-P0-05 — trop d'infrastructure avant pixel visible | accepté | 0,99 | pilote vertical dans la deuxième PR maximum |
| Claude DOC-P1-06 — conflit `retain-nonparity` | accepté | 0,98 | exemption bornée par owner/issue/reviewBy |
| Claude DOC-P1-07 — « exactement une fois » vs count | accepté | 0,99 | cardinalité observée = déclarée |
| Claude DOC-P1-08 — protocole 2 vs 4 reviews | accepté | 1,00 | quatre rôles A–D + synthèse E partout |
| Claude DOC-P1-09 — Design peut bloquer silencieusement | accepté avec nuance | 0,94 | délai et statut `NON_DESIGN_ONLY`; full parity reste bloquée |
| Claude DOC-P1-10 — baseline `16/8/37/12` opaque | accepté | 0,98 | compteurs nommés, produits par parseur |
| Claude DOC-P1-11 — box delta relatif absent | accepté | 0,96 | delta absolu et relatif au parent |
| Claude DOC-P1-12 — data-parity non contrôlé | accepté | 0,99 | scan CSS/TS/TSX hors harness |
| Claude DOC-P1-13 — mutations manquantes | accepté | 0,99 | profils, états, masques ajoutés |
| Claude DOC-P2-14 — exception GPU redondante | accepté | 0,92 | exception supprimée ; tolérance prouvée A/A seulement |
| Claude DOC-P2-15 — doublons cachés | accepté | 0,97 | count DOM total + visibleCount |
| Claude DOC-P2-16 — contamination de contexte | accepté | 0,99 | même process, deux BrowserContext isolés |
| DeepSeek R-P0-01 — texte statique masquable | accepté | 1,00 | texte statique et noms accessibles non masquables |
| DeepSeek R-P1-01 — G3 indéfini | accepté | 1,00 | commandes et critères fonction/a11y explicites |
| DeepSeek R-P1-02 — reviews incohérentes | doublon accepté | 1,00 | protocole unique |
| DeepSeek R-P1-03 — PR vers work-design contradictoire | accepté | 0,99 | slices vers new-ui ; promotion séparée |
| DeepSeek R-P1-04 — G1 runtime non spécifié | accepté | 0,96 | G1 schema + DOM rendu dans G0 |
| DeepSeek R-P2-01 — profil style incomplet | accepté | 0,93 | propriétés visibles ajoutées + exclusion testée |
| DeepSeek R-P2-02 — motion comparée après désactivation | accepté | 0,96 | G2 statique séparé de S14 motion |
| DeepSeek R-P2-03 — data-parity CSS | doublon accepté | 0,99 | scan de références production |
| DeepSeek R-P2-04 — mutation cascade | accepté | 0,91 | mutation d'ordre d'imports |
| DeepSeek R-P2-05 — service référence indéfini | accepté | 0,95 | serveur HTTP commun |
| DeepSeek R-P2-06/07 — DPR et seuil fixe | accepté | 0,98 | dimensions calculées ; double budget local |
| DeepSeek R-P2-08 — appHead auto-référentiel | accepté | 1,00 | lock d'entrée sans app SHA ; run output avec sourceCommit |
| DeepSeek R-P2-09 — structuralMiss indéfini | accepté | 0,95 | définition par nœud/clé non appariable |
| DeepSeek R-P2-10 — masque absent du DoD | accepté | 0,95 | règles masque dans DoD |
| DeepSeek R-P2-11 — nom du fichier prompt joint | rejeté | 0,99 | le fichier repo R3 avait déjà le bon nom |
| Qwen A-P1-01 — delete-dead seulement statique | accepté avec correction | 0,93 | statique + runtime + équivalence avant/après ; un vrai dead hook ne doit pas casser G2 |
| Qwen A-P1-02 — Settings page/modal ambiguës | accepté | 0,94 | IDs et slices explicitement disjoints |
| Qwen A-P2-01 — lock réécrit silencieusement | accepté | 0,97 | CI read-only ; update par PR explicite |

## 3. Arbitrage du rapport Mistral

Le rapport Mistral contient quelques thèmes valides déjà couverts par Claude/DeepSeek :
timer registry, digest d'image, paquet S3/S7, conditions d'arrêt et collision de tokens.
Ils sont intégrés sous une forme déterministe.

Les propositions suivantes sont rejetées :

- `git grep "work-" | wc -l` ne compte pas les valeurs `data-v110` et mélange code,
  documentation, tests et commentaires ;
- `git grep "W4"` ne mesure aucun fallback CSS ;
- `git log | grep PR` ne compte pas les enveloppes du plan ;
- `.home-hero-logo` n'existe pas dans la maquette ; les sélecteurs réels incluent
  `.home-title`, `.home-modes-row` et `.home-mode-pill` ;
- `.approval-gate` n'existe pas : le modal est généré dynamiquement après `Inspecter` ;
- `packages/ui/src/fonts/Inter-OFL.txt` n'est pas une autorité vérifiée ; le chemin de fonte
  est découvert et verrouillé par hash en S2 ;
- « 5 masques par scène / 20 global » est un seuil arbitraire sans preuve produit ;
- « 100 masques à 24 % chacun » comprend mal un ratio agrégé de scène ;
- le risque qu'une slice dépasse 400 LOC est une hypothèse, pas un finding ;
- les exemples `s3.json` et `s7.json` utilisent des sélecteurs inventés et ne sont pas
  copiés dans R4.

## 4. Faits rejoués localement

```text
top-level       D:/App/unifia/_a7-automate-memory
branch          new-ui
HEAD            8cc914c0ea575ae675d4067e27754b86f4e9171b
origin/new-ui   8cc914c0ea575ae675d4067e27754b86f4e9171b
work-design     d212bc8098af43ca64a8c4456263dfdb44a56190
reference SHA   6c01e84c27abf7665bb4de65e0c3969b7af0f020129aa971916376b1ca69818b
Playwright      1.57.0
Bun package     1.3.11
Bun host local  1.3.14 (divergence à neutraliser dans l'image G0)
```

Le worktree contenait avant cette correction quatre modifications utilisateur non reliées :
`packages/app/AI_SUMMARY.md`, `packages/desktop/AI_SUMMARY.md`,
`packages/desktop/src/bindings.ts`, `packages/ui/AI_SUMMARY.md`. Elles ne sont pas touchées.

L'issue #116 est ouverte, mais son corps référence encore le plan initial et un protocole de
deux GO ; R4 en fait une précondition P0 à corriger avant implémentation.

## 5. Verdict

R3 : **NO-GO documentaire**.  
R4 : **prêt à être re-reviewé**, mais pas autorisé pour implémentation.  
Autorisation : O1–O3 consignées, quatre rôles repo-access A–D, synthèse E et zéro P0 ouvert.

```json
{
  "verdict": "adjust",
  "summary": "R3 contenait des ambiguïtés de comptage, de déterminisme, d'appariement et de preuve pixel. R4 les ferme et ajoute un pilote visible précoce.",
  "authorization": "pending_repo_access_reviews"
}
```
