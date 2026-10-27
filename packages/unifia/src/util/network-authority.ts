/* SPDX-License-Identifier: MIT */
// The Network Authority (ADR-023) checks every destination after resolving its
// name. Its default resolver is dns.lookup, i.e. getaddrinfo, which musl cannot
// serve on Android (no /etc/resolv.conf): every download would fail there with
// dns-failed. In the embedded mobile engine, names resolve through c-ares instead,
// which mobile-entry.ts already points at public servers with dns.setServers.
import { NetworkAuthority, type NetworkResolver } from "@unifia/network-authority"
import dns from "node:dns"

interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
}

export function caresResolver(resolver: DnsResolver = dns.promises): NetworkResolver {
  return async (hostname) => {
    const [v4, v6] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)])
    const addresses = [...(v4.status === "fulfilled" ? v4.value : []), ...(v6.status === "fulfilled" ? v6.value : [])]
    if (addresses.length > 0) return addresses
    throw v4.status === "rejected" ? v4.reason : new Error(`no address for ${hostname}`)
  }
}

export function networkAuthorityFor(env: NodeJS.ProcessEnv = process.env): NetworkAuthority {
  return env.UNIFIA_CLIENT === "mobile-embedded" ? new NetworkAuthority(caresResolver()) : new NetworkAuthority()
}
