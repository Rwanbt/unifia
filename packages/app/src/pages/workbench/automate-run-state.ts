/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import type { RunBarState } from "./automate-studio-run-bar"

export type RunBarStateInput = {
  readonly error?: string
  readonly approvalId?: string
  readonly workflowState?: string
  /** Nodes of the live run that wait for a person (approval, wait, manual trigger). */
  readonly waitingNodes?: readonly { readonly nodeId: string; readonly family: string }[]
}

// Statuses of `WorkflowRunStatus` (contracts/workflow-run.ts) that still hold a
// live run: only these keep the bar in "running" and make Stop meaningful.
const LIVE_STATUSES: ReadonlySet<string> = new Set(["running", "waiting"])

export function runBarState(input: RunBarStateInput): RunBarState {
  if (input.error) return "failed"
  if (input.approvalId) return "waiting-approval"
  const status = input.workflowState
  if (!status) return "idle"
  // A live run parked on a node only a person can release is not "running":
  // showing a spinner there hides the one action that moves it on.
  if (LIVE_STATUSES.has(status)) return input.waitingNodes?.length ? "waiting-step" : "running"
  if (status.startsWith("cancelled")) return "cancelled"
  if (status === "failed") return "failed"
  return "idle"
}

/** Run may start again once nothing is live: idle, or the last run ended cancelled/failed. */
export function canStartRun(state: RunBarState): boolean {
  return state === "idle" || state === "cancelled" || state === "failed"
}

/** Stop applies to a pending approval and to a live run, parked or not. */
export function canStopRun(state: RunBarState): boolean {
  return state === "waiting-approval" || state === "running" || state === "waiting-step"
}

/** A run is in flight, and its state can change without this tab doing anything. */
export function isLiveRun(state: RunBarState): boolean {
  return state === "running" || state === "waiting-step"
}
