<!-- SPDX-License-Identifier: MIT -->
# Carte des dépendances entre services

Relations vérifiées dans le code au SHA indiqué. Une flèche désigne un import ou un appel observé, pas une intention.

## Côté mémoire (`packages/unifia`)

| Depuis | Vers | Preuve | SHA |
|---|---|---|---|
| `src/server/routes/knowledge.ts` | `src/knowledge/app/memory.ts` (`openMemory`, `memoryEnabled`) | import | `2d2e2146c9` |
| `src/server/routes/knowledge.ts` | `src/server/knowledge-authority.ts` (`decideOwner`, `isTrustedRequestTarget`) | import | `2d2e2146c9` |
| `src/knowledge/app/memory.ts` | `src/knowledge/facade/compose.ts` (`composeKnowledgeService`) | import | `2d2e2146c9` |
| `src/cli/knowledge/runtime.ts` | `src/knowledge/app/memory.ts` | import | `aca300d1a0` (#464, non fusionnée) |
| `src/cli/knowledge/runtime.ts` | `src/server/knowledge-authority.ts` (`assertDefaultVaultInside`) | import | `aca300d1a0` (#464) |
| `src/cli/knowledge/runtime.ts` | `src/config/config.ts`, `src/project/instance.ts` | import | `aca300d1a0` (#464) |
| `src/knowledge/app/memory.ts` | `src/knowledge/policy/store.ts` | import | `2d2e2146c9` |

## Points à retenir

- Le CLI dépend désormais du module d'autorité du serveur (#464). C'est un import de la couche interface vers une autre couche interface. Il est accepté pour garder une seule garde de confinement (ADR-090). Si `knowledge-authority.ts` grossit, extraire la garde dans `knowledge/app/`.
- Sur `dev`, le CLI ne dépend ni de `Config` ni de `Instance`. Il compose son propre espace par `composeKnowledgeService` (c'est précisément l'écart corrigé par #464).
- La configuration (`memory.directory`) entre dans la résolution du coffre à deux endroits seulement : la route serveur et le CLI après #464. Tout autre appelant devra passer par `openMemory`.

## Hors périmètre de cette carte

Les autres services (Browser, Voice, Automate, Team, Work, Design) n'ont pas été cartographiés. Voir CAPABILITY-MATRIX.
