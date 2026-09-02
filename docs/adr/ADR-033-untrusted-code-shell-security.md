<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-033 — Untrusted Code / Shell Security Review (LI-06)

> **Statut** : DECIDED
> **Date** : 2026-09-02
> **Source** : POST-M3-TRACKS-PLAN §2.2 (LI-06 RED), plan V2.3.1
>   §219, ADR-019 (untrusted code/shell impact, DECIDED),
>   ADR-024 (extension runtime trust isolation, DECIDED),
>   ADR-009 (policy authority, DECIDED),
>   `@unifia/contracts/src/connector.ts` (CO-01..07 livrés R2),
>   `docs/adr/0007-approval-broker.md`.
> **Cible** : profiles `Automate AI` (AI Compiler génère du code
>   shell), `Automate Desktop` (utilisateur peut écrire ses propres
>   scripts), et tous les profiles qui invoquent `tool.shell`.

## Status

DECIDED. ADR d'**impact architectural** (plan §197) avec **gate de
sécurité obligatoire**. **N'est PAS** bloqué par ADR-000 (les
contrats sont indépendants du substrate).

LI-06 reste RED au niveau runtime, mais le **contrat est décidé** et
peut être livré maintenant. L'implémentation runtime requiert :

- Un `code/shell` effector sécurisé (probablement wasmtime ou
  firecracker, hors scope V2.3.1).
- Une capability dédiée dans la Capability Authority (ADR-008).

## Contexte

LI-06 (Code/Shell) est la dernière carte RED du track Local
Integrations. Elle permet à un workflow d'exécuter du code arbitraire
(envoyé par l'utilisateur, généré par l'AI Compiler, ou extrait d'un
artefact). C'est le **risque #1 du Threat Model** : un acteur
malveillant peut compromettre le host entier si l'exécution shell
n'est pas correctement isolée.

Le contrat `@unifia/contracts/src/connector.ts` couvre déjà
`tool.http`, `openapi`, `oauth`, `mcp`, `sdk`. Il manque
`tool.shell` (ou `code.shell`), qui doit être :

- **Isolé** : pas d'accès au filesystem hôte, pas de network
  excepté via Network Authority (ADR-023).
- **Limité en ressources** : CPU, mémoire, disque, temps.
- **Audité** : chaque invocation est journalisée (ADR-009
  Policy).
- **Approuvé** : nécessite une `human.approval` par défaut
  (ADR-008 Capability Authority).

## Decision

### Approche : 3 modes de sandbox

- **`subprocess`** (default) : `child_process.spawn` avec
  `env: {}` filtré. Pas de network, pas de filesystem. Linux:
  `unshare(2)` + `chroot` (vide). macOS: `sandbox-exec`. Windows:
  `Job Object` + `AppContainer`.
- **`wasm`** : exécution WebAssembly via `wasmtime`. Le shell est
  compilé en WASM. Isolation forte mais limitée (pas de `fork`,
  pas de signals).
- **`firecracker`** : microVM. Isolation la plus forte. Coût de
  démarrage élevé (~125ms). Réservé aux executions longues
  (>1s).

**Default** : `subprocess` pour les shells courts (<1s) ou
simples, `wasm` pour les shells compilés, `firecracker` opt-in
par workflow.

### Contrats (extension de `@unifia/contracts/src/connector.ts`)

```typescript
export const ShellSandboxModeSchema = z.enum(["subprocess", "wasm", "firecracker"])
export const ShellResourceLimitsSchema = z.object({
  /** CPU time in ms. */
  cpuMs: z.number().int().min(100).max(600_000).default(30_000),
  /** Memory in MB. */
  memoryMb: z.number().int().min(16).max(8_192).default(256),
  /** Disk write in bytes. 0 = read-only. */
  diskBytes: z.number().int().min(0).max(1_073_741_824).default(0),
  /** Network access. False by default. */
  network: z.boolean().default(false),
  /** Wall clock in ms (max execution time). */
  wallClockMs: z.number().int().min(100).max(3_600_000).default(60_000),
})

export const ShellCommandSchema = z.object({
  /** The command to execute. For `wasm` mode, base64-encoded WASM. */
  command: z.string().min(1).max(65_536),
  /** Optional arguments. */
  args: z.array(z.string().max(1024)).readonly().default([]),
  /** Optional stdin. */
  stdin: z.string().max(1_048_576).optional(),
  /** Sandbox mode. */
  sandbox: ShellSandboxModeSchema.default("subprocess"),
  /** Resource limits. */
  limits: ShellResourceLimitsSchema.default({}),
  /** Whether human approval is required before execution. */
  requiresApproval: z.boolean().default(true),
  /** Working directory. MUST be in the extension workspace. */
  cwd: z.string().optional(),
})

export const ShellResultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string().max(10_485_760).default(""),
  stderr: z.string().max(10_485_760).default(""),
  /** Resource usage telemetry. */
  usage: z.object({
    cpuMs: z.number().nonnegative(),
    memoryMbPeak: z.number().nonnegative(),
    diskBytesWritten: z.number().nonnegative(),
    wallClockMs: z.number().nonnegative(),
  }),
  /** Audit trail. */
  auditId: z.string().min(1).max(128),
})

export const ShellExecutionErrorSchema = z.object({
  code: z.enum([
    "TIMEOUT",            // wall clock exceeded
    "OOM",                // memory exceeded
    "DISK_FULL",          // disk bytes exceeded
    "NETWORK_DENIED",     // network access but not authorized
    "APPROVAL_DENIED",    // human approval refused
    "SANDBOX_INIT_FAILED", // could not initialize sandbox
    "COMMAND_NOT_FOUND",  // command does not exist
    "PERMISSION_DENIED",  // OS permission denied
  ]),
  message: z.string().min(1).max(1024),
  auditId: z.string().min(1).max(128),
})
```

### Invariants

- **`requiresApproval = true` par défaut**. Un workflow peut
  passer `false` UNIQUEMENT si tous les inputs sont
  statiquement vérifiés (pas d'input utilisateur direct, pas
  d'output LLM dans la commande).
- **`network = false` par défaut**. Pour activer, il faut une
  capability `network.outbound` dans la Capability Authority.
- **`cwd` doit être dans l'extension workspace** (path traversal
  rejeté). Pas de `..`, pas de chemins absolus en dehors de
  l'workspace.
- **`command` est sérialisé en SHA-256** avant exécution et
  persisté dans l'audit log. Le SHA est comparé au moment de
  l'approbation humaine (l'utilisateur voit la commande réelle,
  pas un hash).
- **Resource limits sont obligatoires** (defaults appliqués si
  non spécifiés).
- **Pas d'execution en root** : si le process est root, l'erreur
  `SANDBOX_INIT_FAILED` est retournée sans tenter le sandbox.

### Audit (ADR-009 Policy)

Chaque invocation `ShellCommand` est journalisée avec :

- `auditId` (UUID v7)
- `workflowRunId`, `nodeId`
- `command` (SHA-256 + raw pour relecture humaine)
- `args`, `stdin` (truncated to 1KB)
- `sandbox`, `limits`
- `requiresApproval`, `approvedBy?` (user id), `approvedAt?`
- `result` (exit code, stdout/stderr truncated, usage)
- `error?` (ShellExecutionError)

Retention : 90 jours minimum (cf. ADR-016).

## Threat Model

Nouvelles entrées dans `THREAT_MODEL.md §1` :

- **TM-SH-01** : shell escape du sandbox. Mitigé par
  `subprocess` env filter, `wasm` isolation, `firecracker`
  microVM.
- **TM-SH-02** : command injection via `args`. Mitigé par
  `args: z.string().max(1024)` + caractère whitelist (pas de
  `;`, `|`, `&`, backticks, `$()` dans les args).
- **TM-SH-03** : path traversal via `cwd`. Mitigé par validation
  extension workspace.
- **TM-SH-04** : resource exhaustion (fork bomb, OOM). Mitigé
  par `ShellResourceLimits`.
- **TM-SH-05** : exfiltration via network. Mitigé par
  `network: false` default + Network Authority (ADR-023).
- **TM-SH-06** : privilege escalation. Mitigé par refus root +
  sandbox OS-level.

## Consequences

- **LI-06 contrats** : livrables dans
  `@unifia/contracts/src/connector.ts` (extension de CO-01..07)
  ou nouveau `shell.ts`.
- **`ShellCommand`** et **`ShellResult`** sont des nouvelles
  capabilities de la Capability Authority (ADR-008).
- **Approval Broker** (ADR-007) gère `requiresApproval` par
  défaut.
- **Threat Model** : 6 nouvelles entrées (TM-SH-01..06).
- **Cert gate** : nouvelle section `gates.yaml §18 shell_sandbox`
  à ajouter quand le runtime est prêt.
- **AI Compiler** (ADR-028) : les shells générés par l'AI sont
  marqués `requiresApproval = true` par défaut, et passent par
  un golden set de validation (cf. ADR-028 §6).

## Gating

- **LI-06 contrats** : peut être livré maintenant.
- **LI-06 runtime** : bloqué par ADR-000 (substrate) pour la
  partie wasmtime/firecracker, mais `subprocess` est
  implémentable dès maintenant.
- **Cert gate** : `shell_sandbox` à ajouter.

## Liens

- `packages/contracts/src/connector.ts` (CO-01..07 livrés R2)
- `docs/adr/ADR-007-side-effect-retry-semantics.md` (DECIDED)
- `docs/adr/ADR-008-scheduler-worker-time-authority.md` (DECIDED)
- `docs/adr/ADR-009-policy-authority.md` (DECIDED)
- `docs/adr/ADR-019-untrusted-code-shell-impact.md` (DECIDED)
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` (DECIDED)
- `docs/adr/ADR-016-history-retention-archival.md` (DECIDED)
- `docs/adr/ADR-028-llm-supply-chain-policy.md` (DECIDED)
- `docs/adr/ADR-031-distributed-server-ha-rolling-recovery.md`
  (DECIDED, pour audit)
- `docs/adr/0007-approval-broker.md` (DECIDED, approval flow)
- Plan V2.3.1 §219 (Code/Shell), §168 (AI security gates)
- THREAT_MODEL.md §1 (single authority, escape)

## Décisions de fond (rappel)

1. **3 modes de sandbox** : `subprocess` (default), `wasm`,
   `firecracker` (opt-in long-running).
2. **`requiresApproval = true` par défaut**, opt-out
   uniquement pour shells statiquement vérifiés.
3. **`network = false` par défaut**, opt-in via Capability
   Authority.
4. **Resource limits obligatoires** : CPU, mem, disk, wall clock.
5. **Audit SHA-256 + raw** de chaque command.
6. **Refus root** : pas d'exécution en root.
7. **Pas d'args avec caractères shell** : whitelist
   alphanumérique + path-safe.
