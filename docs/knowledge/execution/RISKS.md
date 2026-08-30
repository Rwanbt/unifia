<!-- SPDX-License-Identifier: MIT -->
# RISKS — Sovereign Knowledge Core V1

> Registre des risques actifs. Format : ID · date · description · severite
> (Critical/High/Medium/Low) · mitigation · owner. Append-only.

---

## R-0001 — Scope >> budget d'une seule session

- **Severite** : High (organisationnel)
- **Description** : 13 phases, ~106 cartes, ~300 fichiers source,
  device Android parfois non disponible dans la session courante.
  Tout passage "PASS" sans preuve viole le runbook.
- **Mitigation** : execution par cartes avec preuves ; a chaque
  checkpoint documenter dans `STATE.md` la prochaine carte ; pas
  de "PASS hypothetique".
- **Owner** : orchestrateur session.
- **Statut** : **CLOSED** (104/106 cartes executees a HEAD bdb123a18e ;
  2/106 en `PASS_WITH_SAFE_FALLBACK` — P10.2 et P10.3).

## R-0002 — Bun version drift (1.3.14 vs 1.3.11 declare)

- **Severite** : Low
- **Description** : le repo epingle bun@1.3.11 dans `bun.lock` ; la
  machine installe 1.3.14. Le risque est mineur tant que `bun.lock`
  est respecte par le binaire, ce qui est le cas pour des versions
  compatibles 1.3.x.
- **Mitigation** : garder `bun.lock` source de verite ; ne pas
  regenerer le lockfile ; signaler toute regression.
- **Owner** : session.
- **Statut** : **OPEN** (mineur, en attente de clarification upstream).

## R-0003 — Pas de device Android (partiellement leve)

- **Severite** : Medium
- **Description** : Phase 10 (Android) requiert un device. Sans
  device, certains gates (P10.2 chaine reelle) restent
  `PASS_WITH_SAFE_FALLBACK`.
- **Mitigation** : Xiaomi Mi 10 Pro (cmi_eea) connecte en
  fin de session 12 ; probe executable (adb, app installed,
  app running, fs writable, deep-link works) ; full chain
  necessite APK rebuild avec `rootfs.tgz` integre
  (`bun --cwd packages/mobile build:android`, 30-60 min).
- **Owner** : operateur.
- **Statut** : **OPEN** (en attente de decision operateur pour
  rebuild APK).

## R-0004 — Pas de modele d'embedding telecharge

- **Severite** : Medium
- **Description** : Phase 5 (semantique) requiert un modele ONNX
  telechargeable. Sans telechargement autorise, capability =
  `disabled`.
- **Mitigation** : le runbook autorise `disabled` comme sortie
  valide ; la FTS+graph reste le produit V1. P5.5 utilise un
  fake embed deterministe (4-dim, byte-mixed) pour les tests.
  Documenter la desactivation dans `STATE.md` et `DECISIONS.md`.
- **Owner** : session.
- **Statut** : **OPEN** (V1 delivre, extension V1.1 si necessaire).

## R-0005 — Reseau potentiellement instable

- **Severite** : Low
- **Description** : operations `git fetch origin dev`, `cargo fetch`,
  `bun install` peuvent echouer. Une erreur reseau n'est pas un PASS.
- **Mitigation** : retry borne (3 fois), puis `UNVERIFIED_ENVIRONMENT`
  dans `blockers/` et continuer.
- **Owner** : session.
- **Statut** : **CLOSED** (aucune operation reseau requise pour V1
  en mode `offline-first` ; le cas ne s'est pas presente).

## R-0006 — Perimetre knowledge/ croise des packages existants

- **Severite** : High (architecture)
- **Description** : `packages/memory-governance/`, `packages/memory-runtime/`,
  ADR 0018 (memory system) pre-existent. Le plan prevoit un namespace
  `knowledge/` qui peut entrer en conflit.
- **Mitigation** : Phase 0 inventaire l'existant ; ADR de coexistence ;
  contrats `@unifia/contracts/knowledge/` ajoutes sans casser les
  exports actuels ; tests de non-regression sur les packages existants.
- **Owner** : session.
- **Statut** : **CLOSED** (zero conflit detecte ; les imports entre
  `knowledge` et `memory-*` sont separes par namespace).

## R-0007 — 50 ADR pre-existants non lus exhaustivement

- **Severite** : Medium
- **Description** : `docs/adr/0001..1032` existe. Tous ne sont pas
  lus dans cette session. Risque de reinventer une decision deja
  actee.
- **Mitigation** : Phase 0.1 inclut un inventaire des ADR pertinents
  (memory, knowledge, contracts, OpenDesign, MCP, workflow, security).
- **Owner** : session.
- **Statut** : **CLOSED** (ADR 0017, 0018, 0019, 0020, 0021, 0028,
  1026, 1027, 1028, 1029, 1030 relus ; voir `STATE.md` P0.1).

## R-0008 — BruteForceIndex O(n) par query

- **Severite** : Low (performance)
- **Description** : `BruteForceIndex` est O(n) par query. Si un
  vault depasse 50k notes, le defer-ANN (ADR-KNOW-0008 §3) sera
  declenche.
- **Mitigation** : bench-large (100 notes x 256 chunks) vert ;
  vecteur d'indexation ANN deferred jusqu'a preuve de besoin.
- **Owner** : session.
- **Statut** : **OPEN** (a surveiller au-dela de 50k notes).

## R-0009 — `mavis-trash` policy Windows-specifique

- **Severite** : Low
- **Description** : `mavis-trash` (recoverable delete) est
  Windows-specifique ; portabilite macOS/Linux repose sur
  PowerShell-Core UTF-8 detection.
- **Mitigation** : cf. gotcha 2026-08-24 memory tail ; alternative
  est `os.remove` / `shutil.rmtree` Python.
- **Owner** : session.
- **Statut** : **OPEN** (mineur, documente).

## R-0010 — TypeScript `useDefineForClassFields` shadow edge cases

- **Severite** : Low
- **Description** : field prive et method public de meme nom sous
  ce mode strict peuvent shadow (cf. P11 events/bus). Tests ne
  couvrent pas systematiquement ce cas.
- **Mitigation** : naming discipline (fields en `#evts`, methods
  en `events()`) ; ajouter biome + tsc strict progressif.
- **Owner** : session.
- **Statut** : **OPEN** (documente en MEMORY, a surveiller).

## R-0011 — Frontier review non declenchee

- **Severite** : Medium
- **Description** : packet pret (`FRONTIER-REVIEW-PACKET.md`,
  14 318 bytes) mais aucun modele frontier externe n'a ete
  sollicite. Risque : decisions architecturales non challengees.
- **Mitigation** : presenter le packet a Claude Opus / GPT-5 /
  Gemini 2.x Pro ; integrer le feedback dans V1.1 ou V2.
- **Owner** : operateur.
- **Statut** : **OPEN** (en attente de presentation externe).

## R-0012 — Parties d'ADR-KNOW-0006 non implémentées

**Sévérité** : haute (sécurité, latente)
**Statut** : OUVERT
**Ouvert le** : 2026-08-29, après la contre-revue frontier

La contre-revue a établi que le mécanisme central d'ADR-KNOW-0006 n'était pas
implémenté, et qu'aucun risque ne le suivait — c'était le plus grand écart de
périmètre V1 et le seul absent du registre.

La remédiation a livré les règles 1, 2 et 4 (restrictions portables
exprimables et appliquées, UNCLASSIFIED refusé vers l'externe, override qui ne
peut que restreindre). **Restent non implémentées** :

- **§3 `DeclassificationGrant`** — aucun mécanisme one-shot lié au hash, à la
  destination et à un TTL. Conséquence : rien ne peut légitimement élargir un
  `deny` en V1, ce qui est fail-closed mais bloque le cas d'usage documenté
  du partage explicite consenti.
- **§3 héritage** — `mostRestrictive()` existe et est testé, mais aucun
  pipeline de transformation (résumé, traduction, re-chunking, embedding) ne
  l'appelle. Il n'y a pas encore de transformation en V1, donc rien n'est
  actuellement mal classé ; le jour où une arrive, elle doit passer par là.
- ~~**§6 audit `egress.decision`**~~ — **CLOS le 2026-08-30.**
  `policy/audit.ts` construit l'entrée (hash, destination qualifiée
  local/remote, décision, raison, version du guard, horodatage) et
  `InMemoryEgressAudit` l'émet sur le `DomainBus`. Le routeur et la façade
  l'appellent pour **chaque** décision, allow comme deny — une trace qui ne
  garderait que les refus ne dirait pas ce qui est réellement sorti.
  `decideEgress` reste pure : une fonction de décision qui journalise ne peut
  pas être testée sans sink. Le sink est câblé au point de composition et non
  laissé optionnel, faute de quoi il serait « déclaré et jamais présent »,
  exactement ce qui a produit ce défaut.
  **Reste** : la trace vit le temps de la composition ; la persister dans le
  control log Class C est la seconde moitié du §6.
- **Guard côté Rust** — ADR-KNOW-0006 annonce
  `crates/unifia-knowledge-core/src/port/transport.rs`. Ce module n'existe
  pas ; le crate n'a pas de répertoire `port/`.

**Pourquoi ce n'est pas une fuite aujourd'hui** : le sous-système ne contient
aucun code réseau. Le risque se matérialise au premier appel provider ajouté.

**Levée** : implémenter §3 et §6, ou amender à nouveau l'ADR pour les retirer
explicitement de V1.

## R-0013 — Aucun chemin d'écriture, aucun daemon MCP

**Sévérité** : moyenne (fonctionnelle, pas sécuritaire)
**Statut** : **CLOS** le 2026-08-30 (cartes C25 et C26)
**Ouvert le** : 2026-08-30, après la contre-revue production-readiness

Deux surfaces sont durcies mais non déployées :

- **Écriture Class A** — aucune implémentation de `MutationWriter` n'existe.
  `knowledge_propose` refuse par construction, honnêtement, mais V1 ne peut
  rien mémoriser. Une couche mémoire en lecture seule est utile ; elle n'est
  pas complète.
- **Transport MCP** — `composeMcpServer()` produit un serveur authentifié,
  scopé et borné, et `mcp-token session` le démontre de bout en bout. Rien ne
  l'expose cependant sur un transport, et le registre de tokens vit dans la
  mémoire du serveur : sans daemon, un token ne survit pas à son processus.

Les deux vont ensemble pour un usage réel : un serveur MCP sans écriture ne
peut pas servir `knowledge_propose`, et un writer sans daemon n'est
atteignable que depuis le processus qui le compose.

**Clôture** :

- **Écriture** — `VaultMutationWriter` écrit Class A pour de vrai : intent
  validé, confinement par chemins réels partagé avec le lecteur, refus des
  credentials, CAS sur le hash observé, WAL persistant avant que le fichier
  ne devienne visible, écriture atomique. `delete` reste refusé
  (ADR-KNOW-0009). Les écritures sont désactivées par défaut :
  `composeKnowledgeService({ writable: true })`.
- **Transport MCP** — `serveMcp()` sert les six capacités en JSON-RPC 2.0 sur
  un transport injecté, en réutilisant `@unifia/mcp-transport` plutôt qu'une
  seconde implémentation. `unifia knowledge mcp serve <workspace>` tient le
  registre pour la durée du processus : un token émis au démarrage reste
  valide, et une révocation prend effet immédiatement.

Vérifié de bout en bout : `propose` → fichier sur disque → entrée WAL →
retrouvé par `search` ; et une requête JSON-RPC sur stdin retourne les 11
notes du vault réel.

**Reste hors périmètre V1** : aucune persistance du registre de tokens entre
deux daemons (un redémarrage invalide les tokens en cours), et `knowledge_propose`
n'est pas accordé au token de session — l'écriture passe par la façade, pas
par MCP.
