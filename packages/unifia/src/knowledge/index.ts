/* SPDX-License-Identifier: MIT */
/**
 * Sovereign Knowledge Core — `packages/unifia` entry point.
 *
 * This module re-exports the public surface of the knowledge
 * subsystem for the rest of `packages/unifia` to consume. It
 * does NOT depend on UI, navigation, or store components; the
 * frontends (`packages/app`, `packages/desktop`,
 * `packages/mobile`) consume through `@unifia/contracts/knowledge`
 * + the runtime services this package will expose.
 */

export * from "./domain/errors.js"
export * from "./domain/note.js"
export * from "./parser/frontmatter.js"
export * from "./parser/wikilinks.js"
export * from "./parser/parser.js"
export * from "./policy/egress.js"
export * from "./context/router.js"
export * from "./context/inspector.js"
export * from "./context/dataflow.js"
export * from "./source/source.js"
export * from "./source/personal.js"
export * from "./source/project.js"
export * from "./source/external.js"
export * from "./source/session.js"
