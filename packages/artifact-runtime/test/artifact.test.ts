/* SPDX-License-Identifier: MIT */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ArtifactStore } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const rejects = async (run: () => Promise<unknown>, message: string): Promise<void> => {
  checks += 1
  try {
    await run()
  } catch {
    return
  }
  throw new Error(message)
}

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-artifact-"))
try {
  const store = new ArtifactStore(root, () => 4_000, 100)

  // --- A single revision ------------------------------------------------------
  const artifact = await store.create({ kind: "text", filename: "result.txt", content: "hello", metadata: { source: "test", secret: "do-not-export" } })
  check(artifact.version === 1, `first revision reported version ${artifact.version}`)
  check(artifact.sha256.length === 64 && !artifact.relativePath.includes(".."), "artifact manifest is invalid")
  check(new TextDecoder().decode(await store.read(artifact)) === "hello", "artifact read/hash validation failed")
  check((await store.pending()).length === 1, "artifact was not published to outbox")

  // --- Lineage ----------------------------------------------------------------
  const second = await store.create({ artifactId: artifact.artifactId, kind: "text", filename: "result.txt", content: "hello again" })
  check(second.version === 2, `second revision reported version ${second.version}`)
  check(second.artifactId === artifact.artifactId, "a revision started a new lineage instead of extending one")
  check(second.sha256 !== artifact.sha256, "the second revision reused the first hash")

  const history = await store.history(artifact.artifactId)
  check(history.length === 2 && history[0].version === 1 && history[1].version === 2, `history reported ${history.map((entry) => entry.version).join(",")}`)
  check((await store.latest(artifact.artifactId))?.version === 2, "latest did not return the head")

  // Both revisions remain readable: a new version must not destroy its predecessor.
  check(new TextDecoder().decode(await store.read(history[0])) === "hello", "the first revision was lost when the second was written")
  check(new TextDecoder().decode(await store.read(history[1])) === "hello again", "the second revision did not round trip")

  // Re-storing the head's content adds no revision.
  const unchanged = await store.create({ artifactId: artifact.artifactId, kind: "text", filename: "result.txt", content: "hello again" })
  check(unchanged.version === 2, `re-storing identical content created version ${unchanged.version}`)
  check((await store.history(artifact.artifactId)).length === 2, "re-storing identical content grew the history")

  // Identical content in a *different* lineage is legitimate and must be stored.
  const twin = await store.create({ kind: "text", filename: "result.txt", content: "hello" })
  check(twin.artifactId !== artifact.artifactId, "two distinct artefacts collided on the same id")
  check(twin.sha256 === artifact.sha256, "the twin artefact did not keep the same content hash")
  check(new TextDecoder().decode(await store.read(twin)) === "hello", "the twin artefact is not readable")

  await rejects(() => store.create({ artifactId: "artifact-000000000000000000000000", kind: "text", filename: "x.txt", content: "x" }), "a revision was accepted for an unknown lineage")
  await rejects(() => store.history("../escape"), "history accepted a traversal id")
  check((await store.history("artifact-000000000000000000000000")).length === 0, "history invented entries for an unknown lineage")

  // --- Export and metadata policy ---------------------------------------------
  const stripped = await store.export(artifact)
  check(Object.keys(stripped.metadata).length === 0, "the default export policy did not strip metadata")
  check(new TextDecoder().decode(await readFile(path.join(root, stripped.relativePath))) === "hello", "the exported file content is wrong")
  check(!stripped.relativePath.includes(".."), "the export path escaped the workspace")

  const kept = await store.export(artifact, { metadata: "keep" })
  check(kept.metadata.secret === "do-not-export", "the keep policy dropped metadata")

  const allowed = await store.export(artifact, { metadata: { allow: ["source"] } })
  check(allowed.metadata.source === "test" && allowed.metadata.secret === undefined, "the allowlist policy leaked a key outside the allowlist")

  await rejects(() => store.export(artifact, { outbox: "../escape" }), "the export accepted a traversal outbox name")

  // --- Safety -----------------------------------------------------------------
  await rejects(() => store.create({ kind: "text", filename: "../escape.txt", content: "no" }), "artifact traversal filename was accepted")
  await rejects(() => store.create({ kind: "text", filename: "large.txt", content: "x".repeat(101) }), "artifact quota was not enforced")

  console.log(`ArtifactStore: ${checks}/${checks} passed`)
} finally {
  await rm(root, { recursive: true, force: true })
}
