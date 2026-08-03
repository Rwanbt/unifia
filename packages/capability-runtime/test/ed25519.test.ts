/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { generateKeyPairSync } from "node:crypto"
import { CapabilityRegistry } from "@unifia/contracts"
import { Ed25519ManifestVerifier, createSecureCapabilityRegistry, signCapabilityManifest } from "../src/index.ts"
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const manifest = { descriptor: { id: "prompt-pack/signed", name: "Signed", description: "signed", version: "1.0.0", author: "Unifia", license: "MIT", schema: {}, tags: ["signed"], trustLevel: "verified" as const }, digest: "sha256:ed25519", sourceRepo: "local", sourceCommit: "abc", license: "MIT" as const, remoteCode: false }
const signature = signCapabilityManifest(manifest, privateKey.export({ type: "pkcs8", format: "pem" }))
const registry = createSecureCapabilityRegistry(publicKey.export({ type: "spki", format: "pem" }))
registry.register({ ...manifest, signature }); assert.throws(() => registry.register({ ...manifest, digest: "sha256:tampered", signature })); assert.equal(registry.search({}).length, 1)
console.log("Ed25519ManifestVerifier: 3/3 passed")
