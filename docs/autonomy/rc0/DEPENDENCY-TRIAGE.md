<!-- SPDX-License-Identifier: MIT -->
# DEPENDENCY-TRIAGE — `bun audit` sur dev@ff3047f + QA06 (carte QA05, 2026-09-29)

Le commit `a6195bf` (« patch the critical and high advisories ») a déjà fait passer l'audit de 101 alertes à **4** (2 moderate, 2 low). Aucune critique ni haute.

| Advisory | Sévérité | Chemin | Livré ? | Disposition proposée |
|---|---|---|---|---|
| react-router 6.30.4 : redirection ouverte (GHSA-wrjc-x8rr-h8h6), injection de constructeur SSR (GHSA-337j-9hxr-rhxg) — corrigé en ≥ 7.18 | moderate ×2 | `@unifia/console-mail › @jsx-email/cli` (outil de génération d'e-mails, épinglé à 6.30.4 à la racine) | non (console-mail hors racines livrées) | DEFER_APPROVED (à approuver) : saut de version majeure d'un outil de build ; ne s'exécute pas dans l'app |
| aws-sdk v2 (GHSA-j965-2qgj-vjmq, validation de région) | low | `sst › aws-sdk` (outil de déploiement) | non | DEFER_APPROVED : `deploy.yml` est manuel-only ; migration v3 = décision SST |
| `@ai-sdk/provider-utils` < 4.0.33 (GHSA-866g-f22w-33x8, consommation de ressources) | low | épinglé à 4.0.21 avec **patch local** (`patches/@ai-sdk%2Fprovider-utils@4.0.21.patch`), utilisé par `unifia` (runtime livré) | oui | À traiter en lot isolé : monter à ≥ 4.0.33 exige de re-générer le patch et de rejouer les tests provider ; risque > bénéfice pour un « low » — proposé pour le train 2 |

Aucun correctif appliqué dans cette carte : un `bun update` aveugle est exclu (issue #33), et les 3 lignes ci-dessus demandent une décision (versions majeures ou patch local). Les deux défauts que l'issue #33 attribue à un futur bump de `@hey-api/openapi-ts` (`response` optionnel dans `dialog-workspace-list.tsx`, `extra` requis) restent à vérifier le jour de ce bump.
