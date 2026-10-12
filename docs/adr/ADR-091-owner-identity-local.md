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

1. **Seul un principal vérifié de rôle `admin` est propriétaire pour les routes mémoire.** `decideOwner` refuse tout le reste : une requête sans principal, et un principal d'un autre rôle. `decideOwner` ne lit pas le mot de passe configuré : sur une instance sans mot de passe, un compte admin est propriétaire comme les autres (section 3). La boucle locale (`localhost`) n'est pas une identité. Pour les routes Workbench (native et web), hors boucle locale, la règle est plus stricte : seul le principal authentifié par l'identifiant Basic de l'opérateur est propriétaire (`isOwnerPrincipal`, voir la section suivante).
2. **Le bureau reçoit son identité par un mécanisme existant.** L'application de bureau lance son serveur avec `UNIFIA_SERVER_PASSWORD` et envoie les mêmes identifiants (Basic) : elle est donc propriétaire sans configuration supplémentaire. Aucun canal nouveau n'est créé.
3. **Une instance web ou de développement sans mot de passe n'a pas de propriétaire.** Le panneau mémoire reste vide et le serveur répond `403 owner authority required`. Pour l'utiliser, on lance le serveur avec `UNIFIA_SERVER_PASSWORD`. Ce n'est pas un contournement : c'est le même chemin que le bureau.

   Le même principe vaut pour l'enregistrement. `POST /collab/register` ne crée le premier compte (qui devient `admin`) que pour une requête authentifiée par l'identifiant Basic de l'opérateur : le principal `basic-auth`, de rôle `admin`, que le middleware ne lie qu'après une comparaison à `UNIFIA_SERVER_PASSWORD`, jamais à la table des utilisateurs. Toute autre requête reçoit `403 Only the operator can create the first account`. Un identifiant Basic erroné reçoit `401 Invalid credentials` du middleware. Sans mot de passe configuré, aucun identifiant de ce type n'existe : aucun premier compte ne peut être créé (échec fermé). Avec un mot de passe configuré, une requête anonyme est refusée par le middleware avant la route, en `401 Authentication required`. Une fois un compte existant, seul un appelant `admin` peut en créer un ; ce comportement n'a pas changé. Le mode sans mot de passe reste à trancher (décision D10 du propriétaire) : ce changement ne le décide pas.
4. **Les identifiants Basic sont vérifiés en un seul endroit** (`server/basic-credentials.ts`) : le nom d'utilisateur finit au premier `:` (RFC 7617), donc un mot de passe peut contenir `:`. Les deux champs sont comparés sans empreinte : chaque valeur est complétée jusqu'à la plus grande des deux longueurs, puis comparée octet à octet avec `timingSafeEqual`, et l'égalité des longueurs est vérifiée après la comparaison (`sameText`, `server/basic-credentials.ts`). Le remplissage cache le contenu du secret et la position du premier octet qui diffère, puisque la comparaison parcourt tous les octets : il ne révèle pas de préfixe. Il ne cache pas la longueur : le travail de la comparaison est celui de la plus grande des deux valeurs, donc, pour tout candidat non plus long que le secret, celui de la longueur du secret. Un observateur qui mesure le temps de réponse peut en estimer la longueur. Le commentaire du fichier donne la raison de ne pas hacher : un condensat rapide d'un mot de passe est signalé par l'analyse statique, et un condensat lent coûterait à chaque requête. Cacher la longueur demande un changement de code, par exemple un HMAC à clé aléatoire, dont la sortie a une longueur fixe ; ce n'est pas fait ici.

5. **Les jetons d'accès ne suffisent pas à être propriétaire.** Un jeton valide d'un membre est refusé ; un jeton invalide ou expiré répond `401` avant toute lecture.
6. **Un appelant anonyme n'a ni identité ni rôle.** `GET /collab/me` répond `401` sans corps d'identité à un appelant anonyme ; seul l'identifiant Basic de l'opérateur reçoit l'identité `basic-auth` avec le rôle `admin`. Le client web ne lit cette route qu'après une connexion, avec son jeton, et garde sinon l'utilisateur de la réponse de connexion.

## Décision prise le 2026-10-12 : le propriétaire est l'opérateur

**Constat.** Le code n'enregistre aucune identité propriétaire. Un JWT porte le rôle du compte et rien qui marque son propriétaire : le premier compte enregistré devient `admin` (`routes/auth.ts`), comme tout compte admin créé ensuite. Le principal de l'identifiant Basic porte l'identifiant fixe `basic-auth` et le rôle `admin`. Une vérification par le seul rôle accepte donc un admin quelconque comme propriétaire.

**Règle appliquée.** Hors boucle locale, les routes Workbench, native (`/workbench/native/token`) et web (`/workbench-web/token`, ADR-041), n'acceptent que le principal authentifié par l'identifiant Basic de l'opérateur, de rôle `admin` (`isOwnerPrincipal`, `server/auth-jwt.ts`). La route web l'applique à toutes ses actions depuis le 2026-10-12. Un JWT d'admin qui n'est pas l'opérateur répond `403` ; un membre ou un spectateur répond `403` ; un jeton expiré ou falsifié répond `401`. La boucle locale ne change pas : le jeton IPC seul reste l'autorité de l'hôte du bureau.

**Raison.** Aucun client, aucun agent et aucun processus enfant ne reçoit une autorité d'administrateur implicitement (décision du propriétaire). La route native ouvre des espaces de travail ; le jeton IPC seul ne doit pas le permettre à distance, et un compte admin n'est pas l'opérateur.

**Écart non tranché.** `decideOwner` (routes `/knowledge/*`) accepte encore tout admin vérifié, y compris un compte qui se connecte par `/collab/login`. Aligner ces routes sur la même règle changerait leur comportement pour ces comptes : décision à prendre par le propriétaire, non prise ici.

## Alternatives rejetées

- **Propriétaire par défaut sur `localhost`** : tout processus local ou page qui atteint le port deviendrait propriétaire (DNS rebinding, pages tierces).
- **En-tête de confiance local (`X-Owner`)** : falsifiable par tout client.
- **Canal IPC nouveau pour le web** : duplique le mécanisme du bureau sans bénéfice de sécurité.

## Conséquences

- Le développement web pour la mémoire passe par `UNIFIA_SERVER_PASSWORD`, le même chemin que le bureau. Ce n'est pas une exigence du code : sans mot de passe, la mémoire est ouverte au premier compte admin (section 3). `packages/app/AGENTS.md` ne mentionne pas `UNIFIA_SERVER_PASSWORD` (vérifié le 2026-10-12). Le cas avec mot de passe est couvert par `test/server/knowledge-routes.test.ts`.
- Un mot de passe contenant `:` était refusé avant ce correctif (`split(":")`) : corrigé en #479, avec test de régression.
- Le formulaire web d'inscription (`packages/app/src/components/auth/login-form.tsx`) n'envoie pas d'identifiants Basic : il ne peut plus créer le premier compte. Le premier compte passe par l'identifiant de l'opérateur.

## Preuves (tests)

- `test/server/knowledge-authority.test.ts` : seul un admin vérifié est propriétaire ; le rôle inférieur est refusé ; la boucle locale seule n'est pas une identité ; les origines, hôtes et ports sont vérifiés.
- `test/server/knowledge-routes.test.ts` : identifiants du bureau acceptés comme propriétaire ; jeton de membre refusé ; requête sans identifiants refusée avant la lecture du coffre ; origine croisée refusée même avec les bons identifiants ; sans identifiants configurés, même une requête locale est refusée.
- `test/server/basic-credentials.test.ts` et `test/server/basic-auth-owner.test.ts` (#479) : mot de passe avec `:` accepté ; mauvais mot de passe, mauvais utilisateur, préfixe du secret, valeur sans `:` et base64 invalide refusés.
- `test/server/native-route-authority.test.ts` (route native hors boucle locale) : identifiants de l'opérateur acceptés (`200`) ; JWT d'un admin qui n'est pas l'opérateur refusé (`403`) ; membre refusé (`403`) ; jeton expiré et jeton falsifié (`401`) ; mauvais jeton IPC (`401`) ; boucle locale avec le seul jeton IPC (`200`).
- `test/server/collab-register-bootstrap.test.ts` : requête anonyme sans mot de passe refusée en `403`, sans compte créé ; avec mot de passe, anonyme refusé en `401` ; identifiant de l'opérateur crée le premier compte `admin` ; mauvais mot de passe refusé ; sans mot de passe, identifiants Basic sans effet (`403`) ; après le premier compte, anonyme et membre refusés, admin accepté.
- `test/server/workbench-web-bridge.test.ts` (route web hors boucle locale, bloc « the web token route beyond loopback ») : membre et admin à jeton refusés (`403`) pour toutes les actions ; identifiants de l'opérateur acceptés ; membre en boucle locale accepté (`200`).
>
## Non couvert

- Expiration d'un jeton d'accès : le test existe pour un jeton invalide. Un jeton expiré dans le temps n'est pas encore testé de façon explicite.
- Redémarrage : l'identité ne persiste pas (aucun état), donc un redémarrage ne change pas la décision. Non testé dans une suite dédiée.
- Les routes qui n'utilisent pas `decideOwner` ne sont pas inventoriées ici : l'autorisation explicite de chaque route est le chantier P0 suivant (registre route × action).
- Les bundles `packages/mobile/src-tauri/assets/runtime/unifia-cli.js` et sa copie sous `gen/android` contiennent encore l'ancienne logique de premier compte jusqu'à leur régénération.
