import { describe, expect, test } from "bun:test";
import {
  ROLLBACK_STEPS,
  RollbackManager,
  RollbackProtectedBranchError,
  type RollbackOperations,
  type RollbackRequest,
} from "../../src/team/rollback-manager";

function request(overrides: Partial<RollbackRequest> = {}): RollbackRequest {
  return { branch: "c-G04/test", reason: "failed validation", ...overrides };
}

function operations(calls: string[], failingStep?: string): RollbackOperations {
  return Object.fromEntries(ROLLBACK_STEPS.map((step) => [step, () => {
    calls.push(step);
    if (step === failingStep) throw new Error(`${step} interrupted`);
  }])) as RollbackOperations;
}

describe("RollbackManager", () => {
  test("completes every rollback step in the declared order", async () => {
    const calls: string[] = [];
    const result = await new RollbackManager().execute(request(), operations(calls));

    expect(result).toEqual({ status: "COMPLETED", completedSteps: ROLLBACK_STEPS });
    expect(calls).toEqual(ROLLBACK_STEPS);
  });

  test("returns an interrupted report that can resume at the failed step", async () => {
    const calls: string[] = [];
    const first = await new RollbackManager().execute(request(), operations(calls, "restoreCheckpoint"));

    expect(first.status).toBe("INTERRUPTED");
    expect(first.completedSteps).toEqual(["discardWorktree", "revertCommits"]);
    expect(first.nextStep).toBe("restoreCheckpoint");
    expect(first.error).toContain("restoreCheckpoint");

    const resumedCalls: string[] = [];
    const resumed = await new RollbackManager().execute(
      request({ completedSteps: first.completedSteps }),
      operations(resumedCalls),
    );
    expect(resumed.status).toBe("COMPLETED");
    expect(resumedCalls).toEqual(["restoreCheckpoint", "compensateDatabase", "audit"]);
  });

  test("rejects protected branches before invoking any operation", async () => {
    const calls: string[] = [];
    await expect(new RollbackManager().execute(request({ branch: "DEV" }), operations(calls))).rejects.toBeInstanceOf(
      RollbackProtectedBranchError,
    );
    expect(calls).toEqual([]);
  });

  test("is idempotent when the checkpoint already records completed steps", async () => {
    const calls: string[] = [];
    const result = await new RollbackManager().execute(
      request({ completedSteps: ["discardWorktree", "discardWorktree", "revertCommits"] }),
      operations(calls),
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.completedSteps).toEqual(ROLLBACK_STEPS);
    expect(calls).toEqual(["restoreCheckpoint", "compensateDatabase", "audit"]);
  });

  test("rejects unknown checkpoint steps and invalid requests", async () => {
    const calls: string[] = [];
    expect(() => new RollbackManager().execute(request({ completedSteps: ["unknown" as never] }), operations(calls))).toThrow(
      "unknown completed rollback step",
    );
    expect(() => new RollbackManager().execute(request({ reason: " " }), operations(calls))).toThrow("reason");
  });
});
