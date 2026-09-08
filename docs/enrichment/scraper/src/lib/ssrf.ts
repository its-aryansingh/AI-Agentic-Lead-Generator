/**
 * SSRF guard for the crawler.
 *
 * The scrape endpoints accept a caller-supplied domain and then follow
 * redirects and sub-resource requests. Without this, a caller could point
 * the browser at 169.254.169.254 (cloud metadata), 127.0.0.1 (the Fastify
 * server itself), or a private RFC1918 host inside the deploy network.
 *
 * Three layers, all required:
 *   1. assertPublicHostname()  — before navigation: scheme, port, DNS.
 *   2. route interception      — every request the page makes, including
 *                                redirects and sub-resources.
 *   3. post-navigation recheck — the final URL after redirect chains.
 */

import dns from "node:dns/promises"
import net from "node:net"

export class SsrfBlockedError extends Error {
  readonly code = "SSRF_BLOCKED"
  constructor(reason: string) {
    super(`Blocked by SSRF policy: ${reason}`)
    this.name = "SsrfBlockedError"
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"])

/** Hostnames that must never be resolved, regardless of DNS answer. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
])

const BLOCKED_TLDS = [".local", ".internal", ".localdomain", ".home.arpa", ".onion"]

/**
 * True for any address that must not be reachable from the crawler:
 * loopback, private, link-local (incl. 169.254.169.254), CGNAT,
 * multicast, reserved, and the IPv6 equivalents including v4-mapped.
 */
export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 0) return true

  if (version === 4) return isBlockedIPv4(ip)
  return isBlockedIPv6(ip)
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts as [number, number, number, number]

  if (a === 0) return true                       // 0.0.0.0/8   this network
  if (a === 10) return true                      // 10/8        private
  if (a === 127) return true                     // 127/8       loopback
  if (a === 169 && b === 254) return true        // 169.254/16  link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 private
  if (a === 192 && b === 0) return true          // 192.0.0/24  IETF protocol
  if (a === 192 && b === 168) return true        // 192.168/16  private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true                      // multicast + reserved + broadcast

  return false
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()

  if (lower === "::" || lower === "::1") return true

  // v4-mapped / v4-compatible: ::ffff:169.254.169.254 must not slip past.
  const mapped = /^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower)
  if (mapped) return isBlockedIPv4(mapped[1])

  if (lower.startsWith("fe80")) return true      // link-local
  if (/^f[cd]/.test(lower)) return true          // fc00::/7 unique-local
  if (lower.startsWith("ff")) return true        // multicast
  if (lower.startsWith("2001:db8")) return true  // documentation
  if (lower.startsWith("64:ff9b")) return true   // NAT64

  return false
}

/** Strip scheme/path/credentials and lower-case a caller-supplied domain. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) throw new SsrfBlockedError("empty domain")

  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new SsrfBlockedError(`unparseable domain "${input}"`)
  }

  if (url.username || url.password) {
    throw new SsrfBlockedError("credentials in URL")
  }

  const host = url.hostname.replace(/^www\./, "").replace(/\.$/, "")
  if (!host || host.length > 253) throw new SsrfBlockedError("invalid host length")

  // Reject bare IPs as input: enrichment targets are named companies.
  if (net.isIP(host) !== 0) throw new SsrfBlockedError("IP literal is not a company domain")

  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) {
    throw new SsrfBlockedError(`not a valid hostname: "${host}"`)
  }

  return host
}

/**
 * Resolve the hostname and reject if ANY answer is a blocked address.
 * Rejecting on *any* answer (not just the first) closes the DNS
 * round-robin rebinding window.
 */
export async function assertPublicHostname(hostname: string): Promise<string[]> {
  const host = hostname.toLowerCase().replace(/\.$/, "")

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`hostname "${host}" is blocklisted`)
  }
  if (BLOCKED_TLDS.some((tld) => host.endsWith(tld))) {
    throw new SsrfBlockedError(`hostname "${host}" uses a private TLD`)
  }

  let addresses: string[]
  try {
    const answers = await dns.lookup(host, { all: true, verbatim: true })
    addresses = answers.map((a) => a.address)
  } catch (err) {
    throw new SsrfBlockedError(`DNS lookup failed for "${host}": ${(err as Error).message}`)
  }

  if (addresses.length === 0) throw new SsrfBlockedError(`no DNS answer for "${host}"`)

  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      throw new SsrfBlockedError(`"${host}" resolves to non-public address ${addr}`)
    }
  }

  return addresses
}

/** Synchronous pre-flight for every URL the browser is about to request. */
export function isUrlStructurallyAllowed(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false
  if (!ALLOWED_PORTS.has(url.port)) return false
  if (url.username || url.password) return false

  const host = url.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) return false
  if (BLOCKED_TLDS.some((tld) => host.endsWith(tld))) return false

  // Direct IP navigation (e.g. a redirect to http://169.254.169.254/).
  if (net.isIP(host) !== 0 && isBlockedAddress(host)) return false

  return true
}

/**
 * Full async check used on redirects and on the final landed URL.
 * `allowedHosts` keeps the crawl on the target company's own domain
 * (apex + subdomains) so a redirect cannot walk us onto a third party.
 */
export async function assertNavigationAllowed(
  rawUrl: string,
  allowedApex: string,
): Promise<void> {
  if (!isUrlStructurallyAllowed(rawUrl)) {
    throw new SsrfBlockedError(`URL rejected by structural policy: ${rawUrl}`)
  }

  const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "")
  const apex = allowedApex.toLowerCase()

  if (host !== apex && !host.endsWith(`.${apex}`)) {
    throw new SsrfBlockedError(`off-domain navigation to "${host}" (expected ${apex})`)
  }

  await assertPublicHostname(host)
}
