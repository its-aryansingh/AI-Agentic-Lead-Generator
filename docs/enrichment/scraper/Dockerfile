# =====================================================================
# scraper/Dockerfile — Railway-targeted Playwright service
#
# Two changes vs the current file that both break a clean build today:
#
#   1. `npm ci` requires scraper/package-lock.json, which is NOT in the
#      repo. Generate and commit it (`cd scraper && npm install`) or this
#      image cannot build at all. The fallback below keeps CI green in
#      the meantime, but commit the lockfile — reproducible builds are
#      the whole point of `ci`.
#
#   2. The base image tag and the `playwright` package version must match
#      EXACTLY. package.json currently says "^1.48.0" while the old image
#      pinned v1.48.0-jammy, so any patch release installs a client that
#      speaks a different CDP protocol than the bundled browsers.
#      Pin both to the same version and bump them together.
#
# The official image ships Chromium plus every system dependency
# (libnss3, libatk, fonts, etc.), which is why we do NOT apt-get here.
# =====================================================================

FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_OPTIONS=--max-old-space-size=768 \
    PORT=8080

# ---- deps (cached layer) --------------------------------------------
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --include=dev; \
    else \
      echo "WARNING: no package-lock.json — falling back to npm install" >&2; \
      npm install --include=dev; \
    fi

# ---- build ----------------------------------------------------------
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

# ---- runtime --------------------------------------------------------
# The base image already provides a non-root `pwuser`. Chromium with
# --no-sandbox as root is a container-escape footgun; drop privileges.
USER pwuser

EXPOSE 8080

# Railway health check hits /health, which the Fastify onRequest hook
# already exempts from the x-scraper-key requirement.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
