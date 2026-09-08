/**
 * Shared Chromium process.
 *
 * The existing company-site handler launches and closes a browser for
 * every request: ~700ms-1.5s of cold start and a CPU/memory spike per
 * lead. On a 1GB Railway instance that is the difference between four
 * concurrent crawls and an OOM kill.
 *
 * One process for the lifetime of the container; one BrowserContext per
 * job for isolation (cookies, storage, and cache never cross jobs).
 */

import { chromium, type Browser, type BrowserContext } from "playwright"

let browserPromise: Promise<Browser> | null = null

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",     // /dev/shm is small in containers
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-first-run",
  // Never let the renderer talk to the host network stack directly.
  "--host-resolver-rules=MAP localhost ~NOTFOUND, MAP *.local ~NOTFOUND",
]

/**
 * Chromium does NOT honour HTTPS_PROXY/HTTP_PROXY env vars the way fetch
 * and curl do — it needs an explicit --proxy-server. Without this, a
 * deploy behind an egress proxy (corporate network, restricted VPC, or a
 * sandboxed CI runner) silently returns zero pages with no error: every
 * navigation just fails and gets swallowed by the per-page catch.
 *
 * Unset in a normal Railway/Fly deploy, where egress is direct.
 */
function proxyConfig(): { server: string } | undefined {
  const server =
    process.env.SCRAPER_PROXY_SERVER ??
    process.env.HTTPS_PROXY ??
    process.env.https_proxy
  return server ? { server } : undefined
}

/**
 * The official Playwright image ships a Chromium build matched to the
 * exact `playwright` package version, so this is normally unset. Set it
 * when the runtime supplies its own browser (a base image with Chromium
 * preinstalled, a Nix/apt build, a CI cache) whose revision does not match
 * the package's expected build number — otherwise Playwright refuses to
 * launch with "Executable doesn't exist at .../chromium_headless_shell-<N>".
 */
function executablePath(): string | undefined {
  return process.env.CHROMIUM_EXECUTABLE_PATH || undefined
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: LAUNCH_ARGS,
        proxy: proxyConfig(),
        executablePath: executablePath(),
      })
      .then((browser) => {
        // If Chromium dies (OOM, crash), drop the cached promise so the
        // next request relaunches instead of using a dead handle.
        browser.on("disconnected", () => {
          browserPromise = null
        })
        return browser
      })
      .catch((err) => {
        browserPromise = null
        throw err
      })
  }
  return browserPromise
}

/**
 * A realistic desktop context. A plausible Chrome UA plus matching
 * Accept-Language / sec-ch-* headers gets past the majority of naive
 * bot heuristics; anything stricter than that we treat as a 403 and
 * skip, rather than escalating into evasion.
 */
export async function newJobContext(): Promise<BrowserContext> {
  const browser = await getBrowser()

  return browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    bypassCSP: false,
    serviceWorkers: "block",
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Chromium";v="139", "Not;A=Brand";v="24", "Google Chrome";v="139"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
  })
}

/** Graceful shutdown so Railway/Fly SIGTERM does not leave zombies. */
export async function closeBrowser(): Promise<void> {
  const p = browserPromise
  browserPromise = null
  if (!p) return
  try {
    const browser = await p
    await browser.close()
  } catch {
    // Already gone.
  }
}
