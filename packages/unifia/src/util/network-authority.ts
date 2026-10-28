/* SPDX-License-Identifier: MIT */
// The Network Authority (ADR-023) checks every destination after resolving its
// name. Its default resolver is dns.lookup, i.e. getaddrinfo, which musl cannot
// serve on Android (no /etc/resolv.conf): every download would fail there with
// dns-failed. In the embedded mobile engine, names resolve through c-ares instead,
// which mobile-entry.ts already points at public servers with dns.setServers.
import { NetworkAuthority, caresResolver } from "@unifia/network-authority"
import dns from "node:dns"

export function networkAuthorityFor(env: NodeJS.ProcessEnv = process.env): NetworkAuthority {
  return env.UNIFIA_CLIENT === "mobile-embedded" ? new NetworkAuthority(caresResolver(dns.promises)) : new NetworkAuthority()
}
