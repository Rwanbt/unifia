# Unifia — Multi-Engine Inference (MEI)

> **Statut : PROPOSED / REVIEW — documentation et backlog seulement, aucun ADR ratifié, aucune implémentation qualifiée.**
>
> Branche de préparation : `feat/multi-engine-inference`, dérivée de `dev` (baseline 2026-11-14 : `02a0219b0e40f9837fd65a385a2044f71516e159`). PR draft vers `dev`, jamais `main`.

## Contexte et sources de vérité

Le socle applicatif existe dans `packages/unifia/src` (pas `packages/opencode/src`), avec `local-llm-server`, `provider/locality.ts`, `toolchain/*`, contrôle de routes dans `server/route-classes.ts`, Tauri Rust et Kotlin/JNI Android. La première étape est **une migration caractérisée**, pas un second EngineManager.

- Base originale A→E : [Plan-Magasin-moteurs-A-E-2026-11-14.md](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-Magasin-moteurs-A-E-2026-11-14.md).
- Delta normatif **v4.1** à appliquer par-dessus v4 : [Plan-MEI-v4.1-amendements-2026-11-14.md](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md).
- Le plan v4 avait 15 propositions ADR-MEI ; v4.1 crée ADR-MEI-16 et modifie 02/03/04/07, le budget d'admission, Android et l'ordre des gates.
- État réel et règles : `CLAUDE.md`, `AGENTS.md`, `docs/production/EXECUTION-STATE.md`, décisions propriétaires et ADR acceptés.
- Couverture existante **à réconcilier** : #628/#629/#630/#631/#632/#636, #941, #560, #581, #597, #598; aucune suppression ou duplication silencieuse.
- Pilotage : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148). Ce dépôt est la base de coordination GitHub ; le vault conserve le contexte et le delta de plan.

## Objectif produit

Permettre à un utilisateur de **connecter, installer sous contrôle, sélectionner, superviser et comparer** un moteur d'inférence approprié au modèle, au matériel et aux exigences de confidentialité, tout en conservant la capacité locale/offline et les workflows Chat/Voice/agents. Nouveaux moteurs HTTP compatibles par manifeste signé; nouvelle classe de protocole native nécessite adaptateur embarqué et revue.

## Gates dans l'ordre (version v4.1)

1. **P-1 :** baseline `dev` réelle, autorité des décisions, conflits, cartographie deux spawners et note JNI Android ; ratifier ou rejeter ADR-MEI-16 avant A1-03.
2. **P0 :** contrats, sécurité (manifestes, clés, routes), flag off, migration legacy, consentement, resource admission minimal, VRAM inconnu prudent, modèle catalogue SHA obligatoire.
3. **A1 :** desktop MVP ***une*** instance gérée et services externes, llama.cpp/Prism, archives vérifiées, GUI légère, Windows/Linux qualifiés. Le multi-instance n'est **pas** exigé ici.
4. **C1 :** compatibilité contextuelle, paramètres, sondes fonctionnelles, scheduler complet et multi-instance contrôlé, benchmark reproductible, Bonsai Q2_0/PQ2_0.
5. **D1 :** versions, rollback, journal, crash-loop, GC et qualification macOS/Windows.
6. **B / E :** autres familles d'engine et Android ARM64 qualifiés séparément. Prism Android reste optionnel si JNI non prouvé.
7. **F :** conformance intégrale, preuves SHA+OS+build+device+driver, review indépendante, décision propriétaire GO/NO-GO.

## Sécurité et gouvernance

- Le catalogue ne donne **jamais** de commande shell ou de flags libres; recettes et allowlist typée restent dans les adaptateurs revus.
- Rust/Tauri (desktop) et Rust/Kotlin (Android) sont proposés comme propriétaires uniques des processus; Bun est plan de contrôle. ADR-MEI-16 **à ratifier**.
- Hash, signatures, autorisation et consentement sont prérequis aux nouvelles installations, pas un hardening tardif.
- Hors ligne, un moteur déjà installé, non révoqué, reste utilisable même si métadonnées expirées; nouvelles installations/updates bloquées.
- `vramFree: unknown` => une seule instance gérée; pas de multi-instance avant scheduler C1.
- Le plan atteste les **limites**: aucun statut production ou tests GPU/Android passés n'est inféré d'une doc.
- Toutes les actions d'implémentation sont des issues distinctes; PR ciblées vers `dev`, jamais fusionnées ou publiées par un agent sans décision propriétaire; `.github/**` et P0 sont soumis aux règles spéciales de gouvernance existantes.

## Documentation

- [Matrice des lots et gates](./WORKBREAKDOWN.md)
- [Revue Fable 5.2 en budget court](./FABLE-REVIEW.md)
- 16 ADR proposés dans `docs/adr/MEI-01-*.md` à `MEI-16-*.md`; aucun ratifié par le seul fait de leur commit.
