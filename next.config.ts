import path from "node:path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this project. A stray
  // package-lock.json in C:\Users\<user>\ was making Next pick the home
  // directory as the workspace root, which trips both file watchers and
  // module resolution.
  turbopack: {
    root: path.resolve(__dirname),
  },
}

export default nextConfig
