export const ROLLBACK_STEPS = [
  "discardWorktree",
  "revertCommits",
  "restoreCheckpoint",
  "compensateDatabase",
  "audit",
] as const;

export type RollbackStep = (typeof ROLLBACK_STEPS)[number];

export interface RollbackRequest {
  readonly branch: string;
  readonly reason: string;
  readonly checkpointId?: string;
  readonly protectedBranches?: readonly string[];
  readonly completedSteps?: readonly RollbackStep[];
}

export interface RollbackOperations {
  readonly [step in RollbackStep]: (request: RollbackRequest) => void | Promise<void>;
}

export interface RollbackReport {
  readonly status: "COMPLETED" | "INTERRUPTED";
  readonly completedSteps: readonly RollbackStep[];
  readonly nextStep?: RollbackStep;
  readonly error?: string;
}

const DEFAULT_PROTECTED_BRANCHES = new Set(["main", "master", "dev", "stable", "opti-ui", "Team"]);

export class RollbackProtectedBranchError extends Error {
  constructor(branch: string) {
    super(`rollback refused on protected branch ${branch}`);
    this.name = "RollbackProtectedBranchError";
  }
}

export class RollbackManager {
  async execute(request: RollbackRequest, operations: RollbackOperations): Promise<RollbackReport> {
    validateRequest(request, operations);
    const protectedBranches = new Set(
      [...DEFAULT_PROTECTED_BRANCHES, ...(request.protectedBranches ?? [])].map((branch) => branch.toLowerCase()),
    );
    if (protectedBranches.has(request.branch.toLowerCase())) {
      throw new RollbackProtectedBranchError(request.branch);
    }

    const completedSteps = uniqueSteps(request.completedSteps ?? []);
    const executedSteps = [...completedSteps];
    for (const step of ROLLBACK_STEPS) {
      if (completedSteps.includes(step)) continue;
      try {
        await operations[step](request);
        executedSteps.push(step);
      } catch (error) {
        return {
          status: "INTERRUPTED",
          completedSteps: executedSteps,
          nextStep: step,
          error: error instanceof Error ? error.message : "rollback step failed",
        };
      }
    }
    return { status: "COMPLETED", completedSteps: executedSteps };
  }
}

function validateRequest(request: RollbackRequest, operations: RollbackOperations): void {
  if (!request || request.branch.trim().length === 0) throw new TypeError("rollback branch must not be empty");
  if (request.reason.trim().length === 0) throw new TypeError("rollback reason must not be empty");
  for (const step of ROLLBACK_STEPS) {
    if (typeof operations[step] !== "function") throw new TypeError(`missing rollback operation ${step}`);
  }
}

function uniqueSteps(steps: readonly string[]): readonly RollbackStep[] {
  const seen = new Set<string>();
  const valid: RollbackStep[] = [];
  for (const step of steps) {
    if (!ROLLBACK_STEPS.includes(step as RollbackStep)) {
      throw new TypeError(`unknown completed rollback step ${step}`);
    }
    if (!seen.has(step)) {
      seen.add(step);
      valid.push(step as RollbackStep);
    }
  }
  return valid;
}
