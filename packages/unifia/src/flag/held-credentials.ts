/* SPDX-License-Identifier: MIT */
/**
 * The server's credentials, held in memory once they have left the environment (see `withholdServerCredentials` in
 * flag.ts).
 *
 * This module imports nothing on purpose. `Flag` reads from it, and the logger depends on `Flag` in turn, so a dependency
 * from here onwards would close a cycle.
 */
export interface HeldCredentials {
  username?: string
  password?: string
  keychainToken?: string
  /** The Workbench IPC bearer of a headless start, held so that the bridge still reads it once the environment is withheld. */
  workbenchBearer?: string
}

let held: HeldCredentials = {}

/** The credentials this process holds. Empty until they have been withheld from the environment. */
export function heldCredentials(): Readonly<HeldCredentials> {
  return held
}

/** Replace the held credentials. Called once at start; tests call it to stand in for the host. */
export function holdCredentials(credentials: HeldCredentials): void {
  held = { ...credentials }
}
