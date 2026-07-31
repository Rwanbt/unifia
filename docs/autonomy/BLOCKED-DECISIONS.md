# BLOCKED DECISIONS — décisions en attente

Décisions que l'agent ne peut PAS trancher seul et qui bloquent l'exécution. **À fournir par l'utilisateur avant le passage à l'exécution carte par carte.**

## BD-1 — Plan Directeur V3 Unifia Workbench

**Statut :** `BLOCKED_MISSING_INPUT`
**Sévérité :** BLOQUANT
**Impact :** Sans ce document, le TASK-GRAPH ne peut pas lier ses cartes à des `plan_sections` réelles. Le draft actuel est une proposition de structuration, pas un plan validé.
**Action requise :** fournir le document (même en mode brouillon) ou confirmer que le TASK-GRAPH DRAFT peut servir de plan de référence.

## BD-2 — packages/enterprise/

**Statut :** `DEFERRED` (par défaut EXCLUDE)
**Sévérité :** MOYENNE
**Risque :** Possible contamination de code propriétaire upstream (licence à vérifier).
**Action requise :** confirmer EXCLUDE (par défaut) ou AUDIT_LICENSE_FIRST.

## BD-3 — packages/desktop-electron/

**Statut :** `DEFERRED` (par défaut DEPRECATE)
**Sévérité :** MOYENNE
**Action requise :** confirmer DEPRECATE (par défaut, ajout README) ou REBRAND comme la version Tauri.

## BD-4 — Tauri identifier macOS

**Statut :** `NEEDS_EXTERNAL_E2`
**Sévérité :** HAUTE
**Question :** Le passage de `ai.opencode.desktop.dev` à `ai.unifia.workbench.dev` nécessite une re-certification macOS (Developer ID Apple). Faut-il acheter un nouveau Developer ID Unifia ou conserver l'ancien ? Coût ~$99/an.
**Action requise :** décision budget + certif.

## BD-5 — Couverture i18n du rebrand

**Statut :** `OPEN`
**Sévérité :** FAIBLE
**Question :** faut-il traduire les libellés dans les 21 langues existantes (84 fichiers racine + 21 i18n desktop = 105 fichiers) ou seulement mettre à jour les chaînes en-US ?
**Recommandation :** mettre à jour toutes les langues existantes (cohérence), ne PAS introduire de nouvelles langues.

## BD-6 — Provider MiniMax (M3) en provider de premier plan

**Statut :** `OPEN`
**Sévérité :** MOYENNE
**Question :** Unifia doit-il être listé dans `packages/opencode/src/provider/` comme provider natif, ou rester externe ?
**Recommandation :** provider natif (cohérence avec le fait que ce pack utilise MiniMax M3).
