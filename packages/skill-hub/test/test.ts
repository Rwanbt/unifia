/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { InMemorySkillRegistry, skillManifestPayload, type SkillManifest } from "../src/index.ts"
const digest = (char: string) => char.repeat(64)
const manifest = (version: string, trust: SkillManifest["trust"] = "untrusted"): SkillManifest => ({ name: "demo-skill", version, digest: digest(version === "1.0.0" ? "a" : "b"), trust, tags: ["demo"], capabilities: ["workflow.run"] })
const registry = new InMemorySkillRegistry(() => 123)
await registry.publish({ manifest: manifest("1.0.0") })
assert.equal((await registry.search({ query: "workflow" })).length, 1)
const installed = await registry.install(digest("a")); assert.equal(installed.installedAt, 123)
await assert.rejects(() => registry.publish({ manifest: { ...manifest("1.1.0", "verified"), signature: "bad" } }))
const signed = { ...manifest("1.1.0", "verified") }; const verifier = { verify: (payload: string, signature: string) => payload === skillManifestPayload(signed) && signature === "ok" }
const trusted = new InMemorySkillRegistry(() => 456, verifier); await trusted.publish({ manifest: { ...signed, signature: "ok" } }); await trusted.install(signed.digest); assert.equal((await trusted.update("demo-skill"))?.manifest.version, "1.1.0")
await trusted.rate(signed.digest, 5); await assert.rejects(() => trusted.rate(signed.digest, 6))
console.log("SkillHubRegistry: 5/5 passed")
