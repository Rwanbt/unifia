<!-- SPDX-License-Identifier: MIT -->
# CR04 — diagnostic e2e Automate (2026-09-30)

Current status (2026-10-01): **the corrected browser scenario completed successfully; see the measured run below.** The historical failures remain documented for traceability.

## Mesures

- Le scénario local visait le parcours browser « créer les nœuds, configurer `control.if`/`control.merge`, dessiner les arêtes, lancer ».
- Trois exécutions ciblées de `packages/app/e2e/v110/automate-branch-run.spec.ts` se sont arrêtées avant la première interaction : `[data-workbench-surface="automate"]` restait absent et la capture montrait une page blanche.
- Le troisième essai instrumenté a relevé trois `net::ERR_INSUFFICIENT_RESOURCES`, sans `pageerror` applicatif.
- Le témoin existant `automate-responsive.spec.ts` a monté la surface et passé ses étapes desktop/tablette/téléphone ; il a ensuite expiré sur `compact-landscape-844x390`, où le bouton Nodes est intercepté par le panneau de session en transition.
- L’échec du témoin est préexistant au lot et ne prouve pas la cause de la page blanche du nouveau scénario.
- Le premier lancement sandboxé a échoué avec `spawn EPERM`; l’exécution autorisée a démarré Vite et Chromium. Le warning Vite `@tsconfig/bun/tsconfig.json` manquant était également présent sur le témoin.
- Une reprise instrumentée a démarré depuis une session connectée, ouvert Automate par le rail et ajouté `control.if`. Elle a expiré à 60 s sur un clic redondant du nœud déjà sélectionné : `session-workspace-main` interceptait le clic et la capture montrait l'inspecteur ouvert. Le clic a été supprimé.
- Le scénario corrigé utilise maintenant un `NativeWorkflowRuntimePort` local et le vrai transport HTTP Workbench ; il vérifie la définition sérialisée ainsi que les statuts du chemin true/false et du merge. Il n'a pas été rejoué dans le navigateur. Le test serveur existant passe 3/3, dont le cas CR04 ; ce résultat ne prouve pas le parcours UI.

## Cause racine

Non établie pour l'échec initial du deep link froid. La reprise par rail a franchi le montage Automate ; l'échec suivant venait d'une interaction Playwright interceptée et non d'une panne runtime. Aucun changement produit n'est justifié par ces mesures.

## Pistes de reprise

1. Laisser la CI exécuter le scénario navigateur corrigé et examiner la trace complète si elle échoue ; il n'a pas encore produit de preuve de bout en bout.
2. Si les requêtes runtime échouent, comparer les URL, statuts et corps interceptés avec le test serveur CR04 qui passe via le bridge et le vrai client.
3. Garder séparée la panne compacte-paysage de `automate-responsive.spec.ts` : elle appartient à la transition de layout et ne prouve ni ne réfute le branchement runtime.

Ne pas relancer les trois scénarios initiaux à page blanche : la reprise actuelle change le point de départ, le transport et l'instrumentation ; la preuve attend maintenant la CI du nouveau test.

## Completed browser proof (2026-10-01)

At `468e3f5472` (only documentation differs from `dev@100eae30735e753801e9e27c66e1bf40a12da62f`), run from `packages/app`: `bun run test:e2e:local -- e2e/v110/automate-branch-run.spec.ts --workers=1 --retries=0`, with `PLAYWRIGHT_TIMEOUT=180000`, `PLAYWRIGHT_WORKERS=1` and TEMP/TMP in the RC-0 build directory. Result: `1 passed (45.4s)`, process exit 0, including shutdown.

The committed test creates and configures `control.if`/`control.merge`, draws all six edges, checks the exact POST definition and HTTP 202 through the real Workbench transport, then inspects runtime node statuses: count/condition/true branch/merge/after complete, false branch skipped. It also asserts no tracked page errors, console errors or failed transport requests. File listing and grants use the test fixture; the runtime uses an isolated native workflow port. This proves the selected conditional browser-to-runtime journey, without qualifying physical devices, every branch combination, the compact landscape layout, or production providers. No product changes were needed for this run.
