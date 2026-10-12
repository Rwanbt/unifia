<!-- SPDX-License-Identifier: MIT -->
# ADR-091 : identité du propriétaire en local

**Date** : 2026-10-11 | **Statut** : accepté (mandat du propriétaire, décision D1)

## Contexte

La mémoire (`/knowledge/*`) se lit et s'écrit au nom d'un propriétaire. Trois questions se posent :

1. Une instance locale sans mot de passe est-elle propriétaire ? Un processus local, une page web qui atteint un port local, ou un en-tête falsifiable ne sont pas une identité.
2. Comment le bureau et l'application web obtiennent-ils l'identité sans la configurer à la main ?
3. Comment un identifiant est-il vérifié, sans fuite de l'information sur le secret ?

L'authentification du serveur est dans `packages/unifia/src/server/auth-jwt.ts`. La décision propriétaire est dans `packages/unifia/src/server/knowledge-authority.ts`.

## Décision

1. **Seul un principal vérifié de rôle `admin` est propriétaire.** `decideOwner` refuse tout le reste : une requête sans principal, un principal d'un autre rôle, et l'absence de mot de passe configuré. La boucle locale (`localhost`) n'est pas une identité.
2. **Le bureau reçoit son identité par un mécanisme existant.** L'application de bureau lance son serveur avec `UNIFIA_SERVER_PASSWORD` et envoie les mêmes identifiants (Basic) : elle est donc propriétaire sans configuration supplémentaire. Aucun canal nouveau n'est créé.
3. **Une instance web ou de développement sans mot de passe n'a pas de propriétaire.** Le panneau mémoire reste vide et le serveur répond `403 owner authority required`. Pour l'utiliser, on lance le serveur avec `UNIFIA_SERVER_PASSWORD`. Ce n'est pas un contournement : c'est le même chemin que le bureau.

   Le même principe vaut pour l'enregistrement. `POST /collab/register` ne crée le premier compte (qui devient `admin`) que pour une requête authentifiée par l'identifiant Basic de l'opérateur : le principal `basic-auth`, de rôle `admin`, que le middleware ne lie qu'après une comparaison à `UNIFIA_SERVER_PASSWORD`, jamais à la table des utilisateurs. Toute autre requête reçoit `403 Only the operator can create the first account`. Un identifiant Basic erroné reçoit `401 Invalid credentials` du middleware. Sans mot de passe configuré, aucun identifiant de ce type n'existe : aucun premier compte ne peut être créé (échec fermé). Avec un mot de passe configuré, une requête anonyme est refusée par le middleware avant la route, en `401 Authentication required`. Une fois un compte existant, seul un appelant `admin` peut en créer un ; ce comportement n'a pas changé. Le mode sans mot de passe reste à trancher (décision D10 du propriétaire) : ce changement ne le décide pas.
4. **Les identifiants Basic sont vérifiés en un seul endroit** (`server/basic-credentials.ts`) : le nom d'utilisateur finit au premier `:` (RFC 7617), donc un mot de passe peut contenir `:`. Les deux champs sont comparés en temps constant sur leur empreinte SHA-256, pour ne révéler ni la longueur ni un préfixe du secret.
5. **Les jetons d'accès ne suffisent pas à être propriétaire.** Un jeton valide d'un membre est refusé ; un jeton invalide ou expiré répond `401` avant toute lecture.

## Alternatives rejetées

- **Propriétaire par défaut sur `localhost`** : tout processus local ou page qui atteint le port deviendrait propriétaire (DNS rebinding, pages tierces).
- **En-tête de confiance local (`X-Owner`)** : falsifiable par tout client.
- **Canal IPC nouveau pour le web** : duplique le mécanisme du bureau sans bénéfice de sécurité.

## Conséquences

- Le développement web pour la mémoire exige `UNIFIA_SERVER_PASSWORD`. C'est documenté dans `packages/app/AGENTS.md` et couvert par les tests.
- Un mot de passe contenant `:` était refusé avant ce correctif (`split(":")`) : corrigé en #479, avec test de régression.
- Le formulaire web d'inscription (`packages/app/src/components/auth/login-form.tsx`) n'envoie pas d'identifiants Basic : il ne peut plus créer le premier compte. Le premier compte passe par l'identifiant de l'opérateur.

## Preuves (tests)

- `test/server/knowledge-authority.test.ts` : seul un admin vérifié est propriétaire ; le rôle inférieur est refusé ; la boucle locale seule n'est pas une identité ; les origines, hôtes et ports sont vérifiés.
- `test/server/knowledge-routes.test.ts` : identifiants du bureau acceptés comme propriétaire ; jeton de membre refusé ; requête sans identifiants refusée avant la lecture du coffre ; origine croisée refusée même avec les bons identifiants ; sans identifiants configurés, même une requête locale est refusée.
- `test/server/basic-credentials.test.ts` et `test/server/basic-auth-owner.test.ts` (#479) : mot de passe avec `:` accepté ; mauvais mot de passe, mauvais utilisateur, préfixe du secret, valeur sans `:` et base64 invalide refusés.
- `test/server/collab-register-bootstrap.test.ts` : requête anonyme sans mot de passe refusée en `403`, sans compte créé ; avec mot de passe, anonyme refusé en `401` ; identifiant de l'opérateur crée le premier compte `admin` ; mauvais mot de passe refusé ; sans mot de passe, identifiants Basic sans effet (`403`) ; après le premier compte, anonyme et membre refusés, admin accepté.

## Non couvert

- Expiration d'un jeton d'accès : le test existe pour un jeton invalide. Un jeton expiré dans le temps n'est pas encore testé de façon explicite.
- Redémarrage : l'identité ne persiste pas (aucun état), donc un redémarrage ne change pas la décision. Non testé dans une suite dédiée.
- `GET /collab/me` répond `role: "admin"` à un appelant anonyme (branche de repli `basic-auth` dans `routes/auth.ts`). Ce n'est pas un droit serveur, car les routes propriétaire passent par `decideOwner`, mais l'identité annoncée est fausse. Non traité ici.
- Les bundles `packages/mobile/src-tauri/assets/runtime/unifia-cli.js` et sa copie sous `gen/android` contiennent encore l'ancienne logique de premier compte jusqu'à leur régénération.
