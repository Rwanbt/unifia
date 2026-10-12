/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { canStartRun, canStopRun, runBarState } from "./automate-run-state"

describe("runBarState", () => {
  test("NoStateNoError_IsIdle", () => expect(runBarState({})).toBe("idle"))
  test("Error_IsFailed", () => expect(runBarState({ error: "x", workflowState: "running" })).toBe("failed"))
  test("PendingApproval_IsWaitingApproval", () =>
    expect(runBarState({ approvalId: "a1", workflowState: "approval_required" })).toBe("waiting-approval"))
  test("RunningAndWaiting_AreRunning", () => {
    expect(runBarState({ workflowState: "running" })).toBe("running")
    expect(runBarState({ workflowState: "waiting" })).toBe("running")
  })
  test("CancelledVariants_AreCancelled", () => {
    expect(runBarState({ workflowState: "cancelled" })).toBe("cancelled")
    expect(runBarState({ workflowState: "cancelled_with_active_effect" })).toBe("cancelled")
    expect(runBarState({ workflowState: "cancelled_with_unknown_external_state" })).toBe("cancelled")
  })
  test("Completed_ReturnsToIdle", () => expect(runBarState({ workflowState: "completed" })).toBe("idle"))
  test("FailedRun_IsFailed", () => expect(runBarState({ workflowState: "failed" })).toBe("failed"))
  test("DeniedOrUnknown_ReturnsToIdle", () => {
    expect(runBarState({ workflowState: "deny" })).toBe("idle")
    expect(runBarState({ workflowState: "approval_required" })).toBe("idle")
  })
})

describe("run bar gates", () => {
  test("AfterCompleted_RunIsPossibleAgain", () => {
    expect(canStartRun(runBarState({ workflowState: "completed" }))).toBe(true)
  })
  test("WhileRunning_RunIsBlockedAndStopIsAvailable", () => {
    expect(canStartRun("running")).toBe(false)
    expect(canStopRun("running")).toBe(true)
  })
  test("AfterCancelOrFailure_RunIsPossibleAgain", () => {
    expect(canStartRun("cancelled")).toBe(true)
    expect(canStartRun("failed")).toBe(true)
  })
  test("Idle_StopIsDisabled", () => expect(canStopRun("idle")).toBe(false))
})
