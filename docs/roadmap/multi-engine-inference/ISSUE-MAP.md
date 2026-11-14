# MEI — Index GitHub des user stories et tickets

> **Statut : PLANNED / PROPOSED**. Epic [#1148](https://github.com/Rwanbt/unifia/issues/1148), branche `feat/multi-engine-inference`, PR documentaire draft [#1157](https://github.com/Rwanbt/unifia/pull/1157). Ce registre lie 8 stories et 33 tickets ; l'ouverture d'une issue ne prouve aucune implémentation.

| Gate | User story | Tickets techniques |
|---|---|---|
| **P-1** | [#1149](https://github.com/Rwanbt/unifia/issues/1149) | [#1158](https://github.com/Rwanbt/unifia/issues/1158) Baseline / décisions / GPU · [#1159](https://github.com/Rwanbt/unifia/issues/1159) Cartographie legacy / tests · [#1160](https://github.com/Rwanbt/unifia/issues/1160) POC JNI Prism · [#1161](https://github.com/Rwanbt/unifia/issues/1161) Fable et propriétaire des processus |
| **P0** | [#1150](https://github.com/Rwanbt/unifia/issues/1150) | [#1162](https://github.com/Rwanbt/unifia/issues/1162) Contrats / flag off · [#1163](https://github.com/Rwanbt/unifia/issues/1163) Localité / DLP · [#1164](https://github.com/Rwanbt/unifia/issues/1164) Manifestes / allowlist · [#1165](https://github.com/Rwanbt/unifia/issues/1165) Clés / offline · [#1166](https://github.com/Rwanbt/unifia/issues/1166) Téléchargement sécurisé · [#1167](https://github.com/Rwanbt/unifia/issues/1167) Store / récupération · [#1168](https://github.com/Rwanbt/unifia/issues/1168) Routes / consentement · [#1169](https://github.com/Rwanbt/unifia/issues/1169) DeviceProfile / admission minimal |
| **A1** | [#1151](https://github.com/Rwanbt/unifia/issues/1151) | [#1170](https://github.com/Rwanbt/unifia/issues/1170) Manifests llama / Prism · [#1171](https://github.com/Rwanbt/unifia/issues/1171) Installeur archives · [#1172](https://github.com/Rwanbt/unifia/issues/1172) Owner Rust unique / instance · [#1173](https://github.com/Rwanbt/unifia/issues/1173) Adaptateurs / external-managed · [#1174](https://github.com/Rwanbt/unifia/issues/1174) UI et packaging |
| **C1** | [#1152](https://github.com/Rwanbt/unifia/issues/1152) | [#1175](https://github.com/Rwanbt/unifia/issues/1175) Modèles et compatibilité · [#1176](https://github.com/Rwanbt/unifia/issues/1176) ParamPolicy / contexte · [#1177](https://github.com/Rwanbt/unifia/issues/1177) Probes fonctionnels · [#1178](https://github.com/Rwanbt/unifia/issues/1178) Scheduler multi-instance · [#1179](https://github.com/Rwanbt/unifia/issues/1179) Recommandations / bench |
| **D1** | [#1153](https://github.com/Rwanbt/unifia/issues/1153) | [#1180](https://github.com/Rwanbt/unifia/issues/1180) Rollback / crash-loop · [#1181](https://github.com/Rwanbt/unifia/issues/1181) Quota / canaux · [#1182](https://github.com/Rwanbt/unifia/issues/1182) Packaging / audit sécurité |
| **B** | [#1154](https://github.com/Rwanbt/unifia/issues/1154) | [#1183](https://github.com/Rwanbt/unifia/issues/1183) venv / mistral.rs / mlx · [#1184](https://github.com/Rwanbt/unifia/issues/1184) Conteneurs / vLLM / SGLang · [#1185](https://github.com/Rwanbt/unifia/issues/1185) Services / routeurs / colibri |
| **E** | [#1155](https://github.com/Rwanbt/unifia/issues/1155) | [#1186](https://github.com/Rwanbt/unifia/issues/1186) NativeRegistry / JNI · [#1187](https://github.com/Rwanbt/unifia/issues/1187) IPC / reprise Android · [#1188](https://github.com/Rwanbt/unifia/issues/1188) Téléchargement / mobile QA |
| **F** | [#1156](https://github.com/Rwanbt/unifia/issues/1156) | [#1189](https://github.com/Rwanbt/unifia/issues/1189) Conformance / Voice / offline · [#1190](https://github.com/Rwanbt/unifia/issues/1190) Preuves / revue / GO |

## Dépendances et ordre d'exécution

```text
P-1 (#1149) → P0 (#1150) → A1 (#1151, UNE instance) → C1 (#1152, multi-instance)
                                                    └─→ D1 (#1153) → B (#1154)
                                                            └─→ E (#1155) sous POC JNI P-1.5
F (#1156) après gates applicables + décision propriétaire
```

**Exceptions normatives de v4.1 :** P-1.7 dans [#1161](https://github.com/Rwanbt/unifia/issues/1161), clé offline P0-04b [#1165](https://github.com/Rwanbt/unifia/issues/1165), scheduler P0-10 [#1169](https://github.com/Rwanbt/unifia/issues/1169), multi-instance déplacée de A1-03 [#1172](https://github.com/Rwanbt/unifia/issues/1172) vers C1-05 [#1178](https://github.com/Rwanbt/unifia/issues/1178). Android Bun recovery E-03 [#1187](https://github.com/Rwanbt/unifia/issues/1187).

## ADR

16 ADR sous `docs/adr/MEI-*.md` sont tous **PROPOSED**. Ratification par propriétaire après revue, sans ignorer les décisions déjà ACCEPTED du dépôt. ADR-MEI-16 est un prérequis au démarrage de A1-03.

## Liens à l'historique existant

GP-inference #628, #629, #630, #631, #632 et #636 ; #941 Android, #560 RC-1 ; #581 file exécution RC-1 ; #597 priorité stabilisation ; #598 périmètre global. La préparation MEI ne modifie pas leur autorité et ne clôture aucune issue historique.

## Consignes aux agents

- Travailler depuis `dev` avec PR courtes sur issues autorisées; ne pas fusionner ni publier automatiquement.
- En cas de divergence du plan, lire **d'abord** [delta vault v4.1](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md), puis baseline source et décisions propriétaire.
- Tests et preuves au SHA exact, statut `PASS/FAIL/NOT RUN` ; pas de faux SUCCESS ni de désactivation E2E.
- Les ADR proposés ne sont pas ratifiés par leur commit.
