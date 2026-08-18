/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"

export { SKILL_MODES, SKILL_SCENARIOS, buildDesignSkillContext, canSkillRun, parseDesignSkillManifest, type DesignSkillFrontmatter, type DesignSkillManifest, type SkillMode, type SkillScenario } from "./skill-manifest.js"

export type SkillTrust = "untrusted" | "verified" | "official"
export type SkillManifest = { name: string; version: string; digest: string; trust: SkillTrust; tags: readonly string[]; capabilities: readonly string[]; readmeDigest?: string; signature?: string }
export type SkillPackage = { manifest: SkillManifest; artifact: Uint8Array; readme?: string }
export type InstalledSkill = { manifest: SkillManifest; installedAt: number }
export type SkillVerifier = { verify(payload: string, signature: string): boolean }
export type SkillRegistry = { publish(skill: SkillPackage): Promise<SkillManifest>; search(input: { query?: string; tags?: readonly string[]; trust?: SkillTrust }): Promise<readonly SkillManifest[]>; install(digest: string): Promise<InstalledSkill>; update(name: string): Promise<InstalledSkill | undefined>; rate(digest: string, rating: number): Promise<void> }

const DIGEST = /^[a-f0-9]{64}$/
const NAME = /^[a-z][a-z0-9-]{2,63}$/
const VERSION = /^\d+\.\d+\.\d+$/
const TRUST: readonly SkillTrust[] = ["untrusted", "verified", "official"]
const TRUST_RANK: Readonly<Record<SkillTrust, number>> = { untrusted: 0, verified: 1, official: 2 }
const hash = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex")

export function skillManifestPayload(manifest: SkillManifest): string {
  return `unifia.skill-manifest.v1\n${JSON.stringify({ name: manifest.name, version: manifest.version, digest: manifest.digest, trust: manifest.trust, readmeDigest: manifest.readmeDigest ?? null, tags: [...manifest.tags].sort(), capabilities: [...manifest.capabilities].sort() })}`
}

export function validateSkillManifest(manifest: SkillManifest, verifier?: SkillVerifier): void {
  if (!NAME.test(manifest.name) || !VERSION.test(manifest.version) || !DIGEST.test(manifest.digest) || (manifest.readmeDigest !== undefined && !DIGEST.test(manifest.readmeDigest)) || !TRUST.includes(manifest.trust) || manifest.tags.some((tag) => !/^[a-z0-9-]{1,32}$/.test(tag)) || manifest.capabilities.some((capability) => !/^[a-z][a-z0-9._-]{1,63}$/.test(capability))) throw new Error("invalid skill manifest")
  if (manifest.trust !== "untrusted" && (!manifest.signature || !verifier?.verify(skillManifestPayload(manifest), manifest.signature))) throw new Error("trusted skill signature required")
}

const cloneManifest = (manifest: SkillManifest): SkillManifest => Object.freeze({ ...manifest, tags: Object.freeze([...manifest.tags]), capabilities: Object.freeze([...manifest.capabilities]) })
const clonePackage = (skill: SkillPackage): SkillPackage => ({ manifest: cloneManifest(skill.manifest), artifact: new Uint8Array(skill.artifact), readme: skill.readme })

export class InMemorySkillRegistry implements SkillRegistry {
  readonly #skills = new Map<string, SkillPackage>()
  readonly #installed = new Map<string, InstalledSkill>()
  readonly #ratings = new Map<string, number[]>()
  readonly #now: () => number
  readonly #verifier?: SkillVerifier
  constructor(now: () => number = Date.now, verifier?: SkillVerifier) { this.#now = now; this.#verifier = verifier }
  async publish(skill: SkillPackage): Promise<SkillManifest> {
    const readmeDigest = skill.readme === undefined ? skill.manifest.readmeDigest : hash(skill.readme)
    if (skill.readme !== undefined && skill.manifest.readmeDigest !== readmeDigest) throw new Error("readme digest does not match")
    if (hash(skill.artifact) !== skill.manifest.digest) throw new Error("skill digest does not match artifact")
    const manifest = { ...skill.manifest, readmeDigest }
    validateSkillManifest(manifest, this.#verifier)
    if (this.#skills.has(manifest.digest)) throw new Error("skill digest already published")
    const sameName = [...this.#skills.values()].map((entry) => entry.manifest).filter((entry) => entry.name === manifest.name)
    if (sameName.some((entry) => TRUST_RANK[entry.trust] > TRUST_RANK[manifest.trust])) throw new Error("skill trust downgrade is not publishable")
    this.#skills.set(manifest.digest, clonePackage({ ...skill, manifest }))
    return cloneManifest(manifest)
  }
  async search(input: { query?: string; tags?: readonly string[]; trust?: SkillTrust }): Promise<readonly SkillManifest[]> {
    const query = input.query?.toLowerCase()
    return [...this.#skills.values()].map((skill) => skill.manifest).filter((manifest) => (!query || `${manifest.name} ${manifest.tags.join(" ")} ${manifest.capabilities.join(" ")}`.toLowerCase().includes(query)) && (!input.trust || manifest.trust === input.trust) && (!input.tags || input.tags.every((tag) => manifest.tags.includes(tag)))).map(cloneManifest)
  }
  async install(digest: string): Promise<InstalledSkill> { const skill = this.#skills.get(digest); if (!skill) throw new Error("skill not found"); const installed = { manifest: cloneManifest(skill.manifest), installedAt: this.#now() }; this.#installed.set(skill.manifest.name, installed); return { manifest: cloneManifest(installed.manifest), installedAt: installed.installedAt } }
  async update(name: string): Promise<InstalledSkill | undefined> {
    const installed = this.#installed.get(name)
    const candidates = (await this.search({ query: name })).filter((skill) => skill.name === name && (!installed || TRUST_RANK[skill.trust] >= TRUST_RANK[installed.manifest.trust])).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    const latest = candidates[0]
    if (!latest || (installed && latest.version <= installed.manifest.version)) return installed ? { manifest: cloneManifest(installed.manifest), installedAt: installed.installedAt } : undefined
    validateSkillManifest(latest, this.#verifier)
    return this.install(latest.digest)
  }
  async rate(digest: string, rating: number): Promise<void> { if (!this.#skills.has(digest) || !Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("invalid skill rating"); const ratings = this.#ratings.get(digest) ?? []; ratings.push(rating); this.#ratings.set(digest, ratings) }
}
