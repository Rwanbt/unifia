# BLOCKED DECISIONS — décisions en attente

Décisions que l'agent ne peut PAS trancher seul et qui bloquent l'exécution. **À fournir par l'utilisateur avant le passage à l'exécution carte par carte.**

## BD-1 — Plan Directeur V3 Unifia Workbench

**Statut :** ✅ **RÉSOLU — Plan capturé** depuis Obsidian le 2026-07-31.
**Source :** `/vault/OpenCode/Plan-directeur-V3-Unifia-WorkBench-OpenWork-OpenCowork.md` (49 575 bytes, 2149 lignes, 187 sections).
**Snapshot local :** `docs/autonomy/PLAN-DIRECTEUR-V3.md`.
**Structure :** 22 phases (Phase -2 à Phase 19) + 3 gates (A, B, C) + 19 sections thématiques.
**Verdict :** mon TASK-GRAPH DRAFT précédent était sous-dimensionné — il ne couvrait que la Phase 0 (rebrand cosmétique). Le plan réel est un programme 6 mois solo / 3 mois équipe couvrant réécriture runtime, sécurité, capabilities, mobile, web, release.

**Conséquence opérationnelle :** je réécris le TASK-GRAPH en v1.0 aligné sur les 22 phases du plan. J'exécute Phase -2 (audit licences, 100% documentaire) sans décision utilisateur. À partir de la Phase 0, je m'arrête pour validation.

## BD-2 — packages/enterprise/ : EXCLUDE par défaut

**Statut :** `DEFERRED` (par défaut EXCLUDE)
**Sévérité :** MOYENNE
**Risque :** Possible contamination de code propriétaire upstream (licence à vérifier).
**Action requise :** confirmer EXCLUDE (par défaut) ou AUDIT_LICENSE_FIRST.
**Note :** le Plan V3 §3.1 (matrice d'adoption OpenWork) ne mentionne pas enterprise → cohérent avec EXCLUDE.

## BD-3 — packages/desktop-electron/ : DEPRECATE

**Statut :** `DEFERRED` (par défaut DEPRECATE)
**Sévérité :** MOYENNE
**Action requise :** confirmer DEPRECATE (par défaut, ajout README) ou REBRAND comme la version Tauri.
**Note :** le Plan V3 §2.2 parle d'« enfermement Electron » comme risque → cohérent avec DEPRECATE.

## BD-4 — Tauri identifier macOS

**Statut :** `NEEDS_EXTERNAL_E2`
**Sévérité :** HAUTE
**Question :** Le passage de `ai.opencode.desktop.dev` à `ai.unifia.workbench.dev` nécessite une re-certification macOS (Developer ID Apple). Faut-il acheter un nouveau Developer ID Unifia ou conserver l'ancien ? Coût ~$99/an.
**Action requise :** décision budget + certif.
**Note :** le Plan V3 §6.1 prévoit `Rwanbt/unifia` comme fork OpenCode → l'identifier macOS doit s'aligner.

## BD-5 — Couverture i18n du rebrand

**Statut :** `OPEN`
**Sévérité :** FAIBLE
**Question :** faut-il traduire les libellés dans les 21 langues existantes (84 fichiers racine + 21 i18n desktop = 105 fichiers) ou seulement mettre à jour les chaînes en-US ?
**Recommandation :** mettre à jour toutes les langues existantes (cohérence), ne PAS introduire de nouvelles langues.
**Note :** le fork a déjà une session `Session-2026-07-17-i18n-Fork-16-Locales-Complet.md` → l'i18n est mature, ne pas casser.

## BD-6 — Provider MiniMax (M3) en provider de premier plan

**Statut :** `OPEN`
**Sévérité :** MOYENNE
**Question :** Unifia doit-il être listé dans `packages/opencode/src/provider/` comme provider natif, ou rester externe ?
**Recommandation :** provider natif (cohérence avec le fait que ce pack utilise MiniMax M3).
**Note :** le Plan V3 §5 confirme « Providers et modèles = Unifia Core » → cohérent avec provider natif.

## BD-7 — Stratégie de remotes upstream (NOUVEAU, issue Plan V3 §12)

**Statut :** `OPEN`
**Sévérité :** HAUTE
**Question :** le Plan V3 §12 (Phase 0) définit 4 remotes :
- `upstream-opencode` (Rwanbt/opencode ou anomalyco/opencode ?)
- `upstream-openwork` (URL à fournir)
- `upstream-open-cowork` (URL à fournir)
- `origin-unifia` (Rwanbt/unifia — nouveau repo à créer ?)

**Action requise :** confirmer les URLs upstream pour OpenWork et Open Cowork (BD-7a), et confirmer la création du repo `Rwanbt/unifia` (BD-7b).

## BD-8 — Accès aux codebases OpenWork et Open Cowork (NOUVEAU, bloquant Phase -1)

**Statut :** `BLOCKED_MISSING_URLS`
**Sévérité :** BLOQUANT pour Phase -1
**Question :** l'audit comparatif Phase -1 nécessite le code source d'OpenWork et Open Cowork. Sans ces URLs, je ne peux produire qu'un audit **distant** (README + metadata).
**Action requise :** fournir les URLs ou autoriser le clone dans le sandbox.

