<!-- SPDX-License-Identifier: MIT -->
# CR04 — diagnostic e2e Automate (2026-09-30)

Statut : **aucune preuve navigateur de bout en bout ; le test d'intégration serveur CR04 passe, mais le nouveau parcours navigateur attend sa CI**.

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
