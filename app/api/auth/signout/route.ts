import { NextResponse } from "next/server"
import { buildLogoutCookie } from "@/lib/db/auth"

export const runtime = "nodejs"

export async function POST() {
  // Sessions are stateless JWTs, so this clears the cookie but cannot
  // revoke a token already copied elsewhere. That is why the TTL is a
  // week, not a year. A revocation list is the upgrade path if you need
  // real logout-everywhere.
  const res = NextResponse.json({ ok: true })
  res.headers.set("Set-Cookie", buildLogoutCookie())
  return res
}
