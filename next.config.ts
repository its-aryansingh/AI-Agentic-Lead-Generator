import path from "node:path"
import type { NextConfig } from "next"

// When PYTHON_BACKEND_URL is set (e.g. http://localhost:8000), all /api/*
// requests are proxied to the Django backend. When unset, the Next.js
// route handlers in app/api/ handle requests (backward compatible).
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this project. A stray
  // package-lock.json in C:\Users\<user>\ was making Next pick the home
  // directory as the workspace root, which trips both file watchers and
  // module resolution.
  turbopack: {
    root: path.resolve(__dirname),
  },
  ...(PYTHON_BACKEND_URL
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${PYTHON_BACKEND_URL}/api/:path*`,
            },
          ]
        },
      }
    : {}),
}

export default nextConfig
