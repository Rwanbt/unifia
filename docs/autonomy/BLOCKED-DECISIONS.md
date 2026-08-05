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

**Statut :** `VIOLATED` — rebrand partiel accidentel
**Sévérité :** MOYENNE
**Risque :** Possible contamination de code propriétaire non documenté.
**Action requise :** confirmer EXCLUDE (par défaut) ou AUDIT_LICENSE_FIRST.
**Note :** le Plan V3 §3.1 (matrice d'adoption OpenWork) ne mentionne pas enterprise → cohérent avec EXCLUDE.

**Violation constatée (2026-07-31) :** lors de P0-C003 (rename packages workspaces) puis P2-C090e (openapi specs), `packages/enterprise/package.json` a été partiellement rebrandé :
- `@opencode-ai/enterprise` → `@unifia/enterprise` (P0-C003, cohérent avec workspaces)
- `OPENCODE_DEPLOYMENT_TARGET` → `UNIFIA_DEPLOYMENT_TARGET` (P2-C090e, env var)

**Décision prise :** la restauration complète casserait le workspace (le package n'existerait plus sous son ancien nom). On documente la violation et on attend décision utilisateur :
- Option A : restaurer (mais casser workspace)
- Option B : accepter le rebrand et basculer enterprise/ en INCLUDE (modifier BD-2)
- Option C : exclure enterprise/ de tous les futurs rebrand via une whitelist `enterprise/`

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

**Statut :** ✅ **RÉSOLU** — utilisateur a copié les clones dans `/opt/data/projets/` (openwork-dev/, open-cowork-main/) le 2026-07-31. Clones upstream également verrouillés en bare dans `/opt/data/work/unifia-sandbox/upstreams/`.

## BD-9 — Licence du snapshot i18n utilisateur (NOUVEAU, bloquant Phase 7)

**Statut :** `BLOCKED_MISSING_LICENSE`
**Sévérité :** BLOQUANT pour P7-I18N-MIGRATION
**Question :** le snapshot `.i18n-work/` (16 langues, 325 fichiers, 11 660 clés) n'a pas de licence explicite. Avant toute intégration dans Unifia, l'utilisateur doit confirmer la licence (typiquement : "MIT,Copyright Erwan" ou "CC-BY-SA" ou "domaine public").
**Action requise :** déclarer la licence du snapshot.
**Note :** l'intégration dans le fork Unifia (MIT) suppose une licence compatible.


## BD-10 — Secret `FEISHU_ENCRYPT_KEY` et déploiement du Worker (NOUVEAU, Phase 9 / §22)

**Statut :** `BLOCKED_MISSING_SECRET`
**Sévérité :** BLOQUANT pour la mise en service du bridge Feishu — non bloquant pour le reste de la Phase 9.

**Contexte :** la route `POST /feishu` (`packages/function/src/api.ts`) relayait n'importe quelle
charge POST dans un canal Discord avec un token de bot, **sans aucune vérification de signature**.
Elle vérifie désormais `X-Lark-Signature` et **échoue fermée** : sans clé configurée, aucun callback
n'est accepté. C'est volontaire — pour cette route, refuser tout vaut mieux que relayer tout.

**Action requise :**
1. Récupérer l'Encrypt Key du callback dans la console développeur Feishu (valeur distincte de
   `FEISHU_APP_SECRET`, qui ne permet pas de vérifier un callback).
2. `sst secret set FEISHU_ENCRYPT_KEY <valeur>` pour chaque stage.
3. Déployer, puis confirmer qu'un callback réel est accepté et qu'un callback forgé reçoit 401.

**Pourquoi cela ne peut pas être simulé ici :** la vérification est prouvée localement contre des
signatures calculées indépendamment (`FeishuRemoteAdapter` 20/20), mais qu'un vrai callback Feishu
signe exactement la chaîne attendue ne peut être établi que contre le service réel.
