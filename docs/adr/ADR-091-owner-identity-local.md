<!-- SPDX-License-Identifier: MIT -->
# ADR-091 : identité du propriétaire en local

**Date** : 2026-10-11 | **Statut** : accepté (mandat du propriétaire, décision D1) | **Mise à jour** : 2026-10-12, décision propriétaire prise (voir « Décision prise le 2026-10-12 »)

## Contexte

La mémoire (`/knowledge/*`) se lit et s'écrit au nom d'un propriétaire. Trois questions se posent :

1. Une instance locale sans mot de passe est-elle propriétaire ? Un processus local, une page web qui atteint un port local, ou un en-tête falsifiable ne sont pas une identité.
2. Comment le bureau et l'application web obtiennent-ils l'identité sans la configurer à la main ?
3. Comment un identifiant est-il vérifié, sans fuite de l'information sur le secret ?

L'authentification du serveur est dans `packages/unifia/src/server/auth-jwt.ts`. La décision propriétaire est dans `packages/unifia/src/server/knowledge-authority.ts`.

## Décision

1. **Seul un principal vérifié de rôle `admin` est propriétaire pour les routes mémoire.** `decideOwner` refuse tout le reste : une requête sans principal, un principal d'un autre rôle, et l'absence de mot de passe configuré. La boucle locale (`localhost`) n'est pas une identité. Pour la route Workbench native, hors boucle locale, la règle est plus stricte : seul le principal authentifié par l'identifiant Basic de l'opérateur est propriétaire (`isOwnerPrincipal`, voir la section suivante).
2. **Le bureau reçoit son identité par un mécanisme existant.** L'application de bureau lance son serveur avec `UNIFIA_SERVER_PASSWORD` et envoie les mêmes identifiants (Basic) : elle est donc propriétaire sans configuration supplémentaire. Aucun canal nouveau n'est créé.
3. **Une instance web ou de développement sans mot de passe n'a pas de propriétaire.** Le panneau mémoire reste vide et le serveur répond `403 owner authority required`. Pour l'utiliser, on lance le serveur avec `UNIFIA_SERVER_PASSWORD`. Ce n'est pas un contournement : c'est le même chemin que le bureau.
4. **Les identifiants Basic sont vérifiés en un seul endroit** (`server/basic-credentials.ts`) : le nom d'utilisateur finit au premier `:` (RFC 7617), donc un mot de passe peut contenir `:`. Les deux champs sont comparés en temps constant sur leur empreinte SHA-256, pour ne révéler ni la longueur ni un préfixe du secret.
5. **Les jetons d'accès ne suffisent pas à être propriétaire.** Un jeton valide d'un membre est refusé ; un jeton invalide ou expiré répond `401` avant toute lecture.

## Décision prise le 2026-10-12 : le propriétaire est l'opérateur

**Constat.** Le code n'enregistre aucune identité propriétaire. Un JWT porte le rôle du compte et rien qui marque son propriétaire : le premier compte enregistré devient `admin` (`routes/auth.ts`), comme tout compte admin créé ensuite. Le principal de l'identifiant Basic porte l'identifiant fixe `basic-auth` et le rôle `admin`. Une vérification par le seul rôle accepte donc un admin quelconque comme propriétaire.

**Règle appliquée.** Hors boucle locale, la route Workbench native (`/workbench/native/token`) n'accepte que le principal authentifié par l'identifiant Basic de l'opérateur, de rôle `admin` (`isOwnerPrincipal`, `server/auth-jwt.ts`). Un JWT d'admin qui n'est pas l'opérateur répond `403` ; un membre ou un spectateur répond `403` ; un jeton expiré ou falsifié répond `401`. La boucle locale ne change pas : le jeton IPC seul reste l'autorité de l'hôte du bureau.

**Raison.** Aucun client, aucun agent et aucun processus enfant ne reçoit une autorité d'administrateur implicitement (décision du propriétaire). La route native ouvre des espaces de travail ; le jeton IPC seul ne doit pas le permettre à distance, et un compte admin n'est pas l'opérateur.

**Écart non tranché.** `decideOwner` (routes `/knowledge/*`) accepte encore tout admin vérifié, y compris un compte qui se connecte par `/collab/login`. Aligner ces routes sur la même règle changerait leur comportement pour ces comptes : décision à prendre par le propriétaire, non prise ici.

## Alternatives rejetées

- **Propriétaire par défaut sur `localhost`** : tout processus local ou page qui atteint le port deviendrait propriétaire (DNS rebinding, pages tierces).
- **En-tête de confiance local (`X-Owner`)** : falsifiable par tout client.
- **Canal IPC nouveau pour le web** : duplique le mécanisme du bureau sans bénéfice de sécurité.

## Conséquences

- Le développement web pour la mémoire exige `UNIFIA_SERVER_PASSWORD`. C'est documenté dans `packages/app/AGENTS.md` et couvert par les tests.
- Un mot de passe contenant `:` était refusé avant ce correctif (`split(":")`) : corrigé en #479, avec test de régression.

## Preuves (tests)

- `test/server/knowledge-authority.test.ts` : seul un admin vérifié est propriétaire ; le rôle inférieur est refusé ; la boucle locale seule n'est pas une identité ; les origines, hôtes et ports sont vérifiés.
- `test/server/knowledge-routes.test.ts` : identifiants du bureau acceptés comme propriétaire ; jeton de membre refusé ; requête sans identifiants refusée avant la lecture du coffre ; origine croisée refusée même avec les bons identifiants ; sans identifiants configurés, même une requête locale est refusée.
- `test/server/basic-credentials.test.ts` et `test/server/basic-auth-owner.test.ts` (#479) : mot de passe avec `:` accepté ; mauvais mot de passe, mauvais utilisateur, préfixe du secret, valeur sans `:` et base64 invalide refusés.
- `test/server/native-route-authority.test.ts` (route native hors boucle locale) : identifiants de l'opérateur acceptés (`200`) ; JWT d'un admin qui n'est pas l'opérateur refusé (`403`) ; membre refusé (`403`) ; jeton expiré et jeton falsifié (`401`) ; mauvais jeton IPC (`401`) ; boucle locale avec le seul jeton IPC (`200`).

## Non couvert

- Expiration d'un jeton d'accès : le test existe pour un jeton invalide. Un jeton expiré dans le temps n'est pas encore testé de façon explicite.
- Redémarrage : l'identité ne persiste pas (aucun état), donc un redémarrage ne change pas la décision. Non testé dans une suite dédiée.
