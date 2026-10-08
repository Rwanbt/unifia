/* SPDX-License-Identifier: MIT */
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
// Subpath: Node runs this inside the Browser host and cannot load the package root (`.js` specifiers over `.ts` sources).
import { BrowserEgressPolicySchema, type BrowserEgressPolicy } from "@unifia/contracts/browser"

export type NetworkResolver = (hostname: string) => Promise<readonly string[]>
export type AuthorizedBrowserDestination = { url: string; origin: string; hostname: string; addresses: readonly string[] }
const RESERVED_IPV6_GUA_START = BigInt("0x2e00") << 112n

export class NetworkPolicyError extends Error {
  readonly code: "invalid-url" | "origin-denied" | "dns-failed" | "address-denied" | "policy-invalid"
  constructor(code: NetworkPolicyError["code"], message: string) { super(message); this.name = "NetworkPolicyError"; this.code = code }
}

/**
 * Resolves and validates intent. ADR-023 executors must still pin one returned
 * address at connect time and repeat this check for every redirect/request.
 */
export class NetworkAuthority {
  readonly #resolve: NetworkResolver
  constructor(resolve: NetworkResolver = resolvePublicAddresses) { this.#resolve = resolve }

  async authorizeBrowserUrl(rawUrl: string, policyInput: BrowserEgressPolicy): Promise<AuthorizedBrowserDestination> {
    let policy: BrowserEgressPolicy
    try { policy = BrowserEgressPolicySchema.parse(policyInput) }
    catch (error) { throw new NetworkPolicyError("policy-invalid", error instanceof Error ? error.message : "invalid browser egress policy") }
    if (!policy.defaultDeny) throw new NetworkPolicyError("policy-invalid", "browser egress authority requires default-deny policy")
    const url = parseBrowserUrl(rawUrl)
    if (!policy.allowedOrigins.includes("*") && !policy.allowedOrigins.includes(url.origin)) {
      throw new NetworkPolicyError("origin-denied", "browser origin is not allowlisted")
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "")
    let addresses: readonly string[]
    if (isIP(hostname)) addresses = [hostname]
    else {
      try { addresses = await this.#resolve(hostname) }
      catch (error) { throw new NetworkPolicyError("dns-failed", error instanceof Error ? error.message : "browser DNS resolution failed") }
    }
    if (addresses.length === 0) throw new NetworkPolicyError("dns-failed", "browser hostname resolved to no addresses")
    if (addresses.some((address) => !isPublicAddress(address))) {
      throw new NetworkPolicyError("address-denied", "browser destination resolves to a non-public address")
    }
    return { url: url.href, origin: url.origin, hostname, addresses: [...new Set(addresses)] }
  }
}

export async function resolvePublicAddresses(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((answer) => answer.address)
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

function parseBrowserUrl(rawUrl: string): URL {
  try {
    const url = new URL(rawUrl)
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new Error()
    return url
  } catch {
    throw new NetworkPolicyError("invalid-url", "browser URL must be credential-free HTTP(S)")
  }
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [a, b, c] = octets as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 0 || b === 168)) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6Value(address)
  if (value === undefined) return false
  const mappedPrefix = BigInt("0xffff") << 32n
  if ((value >> 32n) === mappedPrefix) return isPublicIpv4(`${Number((value >> 24n) & 255n)}.${Number((value >> 16n) & 255n)}.${Number((value >> 8n) & 255n)}.${Number(value & 255n)}`)
  if (!inIpv6Range(value, "2000::", 3)) return false
  // The tail of the global-unicast block is reserved by IANA and is not public egress space.
  if (inIpv6Range(value, "2d00::", 8) || value >= RESERVED_IPV6_GUA_START) return false
  if (inIpv6Range(value, "2001::", 23) || inIpv6Range(value, "2001:db8::", 32) || inIpv6Range(value, "2002::", 16)) return false
  return true
}

function inIpv6Range(value: bigint, base: string, prefix: number): boolean {
  const network = ipv6Value(base)
  if (network === undefined) return false
  const shift = BigInt(128 - prefix)
  return value >> shift === network >> shift
}

function ipv6Value(address: string): bigint | undefined {
  const normalized = address.toLowerCase().split("%", 1)[0]
  if (!normalized) return undefined
  const halves = normalized.split("::")
  if (halves.length > 2) return undefined
  const parseSide = (side: string): string[] => side ? side.split(":") : []
  let left = parseSide(halves[0] ?? "")
  let right = parseSide(halves[1] ?? "")
  const tail = right.at(-1) ?? left.at(-1)
  if (tail?.includes(".")) {
    const octets = tail.split(".").map(Number)
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
    const groupA = ((octets[0]! << 8) | octets[1]!).toString(16)
    const groupB = ((octets[2]! << 8) | octets[3]!).toString(16)
    if (right.length) right = [...right.slice(0, -1), groupA, groupB]
    else left = [...left.slice(0, -1), groupA, groupB]
  }
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined
  const groups = [...left, ...Array(missing).fill("0"), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))) return undefined
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n)
}
