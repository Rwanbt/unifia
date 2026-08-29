---
id: KNOW-0006
title: Egress policy — default deny, UNCLASSIFIED = DENY EXTERNAL
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §35 (ContextRouter), §36 (ContextPack)
  - runbook V2 §8.6 (Policy et egress)
  - ADR 1026 (ExportProjection boundary)
  - ADR 1032 (Phase 3 content optin)
---

# ADR-KNOW-0006 — Egress policy

## Contexte

Sans politique d'egress explicite, un agent qui injecte le
résultat d'un retrieval dans le prompt d'un provider cloud envoie
tout : secrets, chemins absolus, fragments de mémoire privée.
La PC-03 (WebSocket auth en query param) et la PC-04
(`auth.json` plaintext) documentent des cas où cette absence de
politique a déjà coûté.

Le plan gelé §7 P5, P6, P7 énonce trois systèmes à ne pas
confondre : **Trust** (qui a écrit), **Authority** (qui peut
modifier), **Egress** (qui peut lire vers où).

## Décision

L'egress est régie par un `AgentDataFlowGuard` unique, appliqué
de manière homogène à toutes les sorties (TS `ContextPack`,
Rust `NativeKnowledgePort` response, MCP responses, shell
output, tool output, plugin output, read/grep/glob/edit/write
output).

Règles :

1. **Restrictions portables ne peuvent que restreindre.** Une
   note peut porter `unifia_restrictions.remote_model: deny` ;
   aucune action locale ne peut l'élargir. Une note peut
   porter `unifia_restrictions.local_model: allow` ; une action
   locale peut la réduire (par exemple un
   `egress_grants.local_model: deny` pour un fragment précis),
   jamais l'élargir sans `DeclassificationGrant` explicite.
2. **`UNCLASSIFIED`, provenance non résolue, fallback cloud =
   DENY EXTERNAL.** Une note sans
   `unifia_restrictions.remote_model` (ou avec valeur absente)
   est traitée comme `deny` pour l'egress vers un provider
   cloud. Le `DataFlowGuard` ne tolère pas l'ambiguïté.
3. **Déclassification one-shot**, liée au hash du contenu et à
   la destination exacte. Un
   `EgressGrant { hash, destination, expires_at }` n'est
   valide qu'une seule fois pour ce hash et cette destination.
4. **Héritage** : toute transformation (résumé, traduction,
   re-chunking, embedding) hérite de la restriction **la plus
   stricte** de ses sources. Un résumé d'une note
   `remote_model: deny` reste `remote_model: deny`, même si la
   note cible n'a pas de restriction explicite.
5. **Le shell, les plugins, MCP, read/grep/glob/edit/write et
   les outputs** sont tous soumis au même guard. Une note
   classifiée `secret` ne peut pas être écrite dans un fichier
   `~/.bash_history` ; une commande `cat ~/.ssh/id_rsa` ne
   peut pas apparaître dans un log de session exporté vers le
   cloud.
6. **Egress audit** : toute décision d'egress (allow ou deny)
   produit un événement `egress.decision` dans le control
   event log (Class C), avec : `hash`, `destination`,
   `decision`, `guard_version`, `timestamp`.

## Alternatives rejetées

- **Whitelist par provider** : trop rigide, ne capture pas la
  sémantique de la note.
- **Deny par défaut sans déclassification** : bloque les cas
  légitimes de partage (par exemple envoyer une décision
  publique vers un provider cloud avec consentement explicite).
- **Allow par défaut** : viole la PC-04 (`auth.json` plaintext).
- **Policy par note sans héritage** : une note transformée peut
  accidentellement être moins restreinte que ses sources.

## Conséquences

- `packages/unifia/src/knowledge/policy/dataflow-guard.ts` est
  l'implémentation de référence. Aucun autre module ne peut
  écrire un `ContextPack` sans passer par ce guard.
- `crates/unifia-knowledge-core/src/port/transport.rs`
  applique le même guard côté Rust avant sérialisation.
- `DeclassificationGrant` est un événement auditable, pas un
  flag persistant. Le grant est `consumed` après le premier
  egress réussi.
- `knowledge doctor` détecte les notes
  `unifia_restrictions.remote_model: allow` et propose une
  revue périodique (opt-in).
- L'invariant "tout egress est tracé" est testé par
  `E-07` du DoD (recovery + audit) et par les tests MCP
  `egress-denied`.

## Validation

- Phase 1.4 expose le Context Inspector avec les champs
  `decision`, `restriction`, `destination`, `hash`,
  `relevance`, `token cost`, `reason` (runbook §11 P1.4).
- Phase 6.2 publie les événements domain
  `egress.decision` sur le bus.
- Phase 8 (Git) scanne la plage sortante pour les
  restrictions, refusant tout push contenant un hash
  `remote_model: deny` sans `DeclassificationGrant`.
