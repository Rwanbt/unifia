/* SPDX-License-Identifier: MIT */
import { sign, verify } from "node:crypto"
import { CapabilityRegistry, type CapabilityManifest, type ManifestVerifier } from "@unifia/contracts"
import { capabilitySignaturePayload } from "@unifia/contracts"

export class Ed25519ManifestVerifier implements ManifestVerifier {
  readonly #publicKey: string | Buffer
  constructor(publicKey: string | Buffer) { this.#publicKey = publicKey }
  verify(payload: string, signature: string): boolean { try { return verify(null, Buffer.from(payload), this.#publicKey, Buffer.from(signature, "base64")) } catch { return false } }
}
export function createSecureCapabilityRegistry(publicKey: string | Buffer): CapabilityRegistry { return new CapabilityRegistry(new Ed25519ManifestVerifier(publicKey)) }

export function signCapabilityManifest(manifest: CapabilityManifest, privateKey: string | Buffer): string { return sign(null, Buffer.from(capabilitySignaturePayload(manifest)), privateKey).toString("base64") }
