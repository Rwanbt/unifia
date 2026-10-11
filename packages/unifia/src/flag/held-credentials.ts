/* SPDX-License-Identifier: MIT */
/**
 * The credentials this process was given on its stdin, held in memory.
 *
 * This module imports nothing on purpose. `Flag` reads from it, and the logger and the stdin reader depend on `Flag` in
 * turn, so a dependency from here onwards would close a cycle. The reader is in server/sidecar-credentials.ts.
 */
export interface HeldCredentials {
  username?: string
  password?: string
  keychainToken?: string
  /** The Workbench IPC bearer of a headless start, held so that the bridge still reads it once the environment is withheld. */
  workbenchBearer?: string
}

let held: HeldCredentials = {}

/** The credentials this process holds. Empty until the credential line has been read. */
export function heldCredentials(): Readonly<HeldCredentials> {
  return held
}

/** Replace the held credentials. Called once at start by the reader; tests call it to stand in for the host. */
export function holdCredentials(credentials: HeldCredentials): void {
  held = { ...credentials }
}
