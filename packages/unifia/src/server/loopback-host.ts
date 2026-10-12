/* SPDX-License-Identifier: MIT */
/**
 * Whether a request is addressed to this machine's loopback interface, by its `Host` header.
 *
 * A server bound to loopback can be reached only from this machine. A web page can still make the
 * browser send requests to it under a host name the page controls (DNS rebinding): the request then
 * carries that host name in `Host`, and it is refused here. The check uses only the header's host
 * part, so the port is left to the listener.
 */

/** A dotted-quad IPv4 address: four octets 0-255, no leading zeros. */
const IPV4_ADDRESS = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** The loopback interface: `localhost`, 127.0.0.0/8, and IPv6 `::1`. */
export function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === "localhost" || normalized === "::1") return true
  return IPV4_ADDRESS.test(normalized) && normalized.startsWith("127.")
}

/** The address part of a `Host` header value, with or without a port. Null when the value is not a host. */
function hostAddress(host: string): string | null {
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/.exec(host)
  if (bracketed) return bracketed[1]!
  const plain = /^([A-Za-z0-9.-]+)(?::\d{1,5})?$/.exec(host)
  return plain ? plain[1]! : null
}

/** True when the `Host` header addresses the loopback interface, and nothing else. */
export function isLoopbackHostHeader(host: string | null): boolean {
  if (host === null) return false
  const address = hostAddress(host)
  return address !== null && isLoopbackAddress(address)
}
