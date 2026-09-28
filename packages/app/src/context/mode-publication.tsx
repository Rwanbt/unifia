/* SPDX-License-Identifier: MIT */

import { createContext, useContext, type ParentProps } from "solid-js"
import { createModeRegistry, type ModeRegistry } from "./mode-registry"

// WHY the fallback: a surface rendered on its own (unit tests, isolated
// stories) has no shell around it. Publishing then does nothing and reading
// gives an empty list, which the consumers already render as an honest empty
// state; throwing would make every isolated surface test mount the shell.
const NO_REGISTRY: ModeRegistry<never> = { publish: () => undefined, read: () => [] }

/** One registry per kind of per-mode content (inspector cards, side-panel sections). */
export function createModePublication<T>() {
  const Context = createContext<ModeRegistry<T>>()
  return {
    Provider: (props: ParentProps) => <Context.Provider value={createModeRegistry<T>()}>{props.children}</Context.Provider>,
    use: (): ModeRegistry<T> => useContext(Context) ?? NO_REGISTRY,
  }
}
