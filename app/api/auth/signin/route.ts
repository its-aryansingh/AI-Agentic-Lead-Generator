import { NextResponse } from "next/server"
import { z } from "zod"
import { signInWithPassword } from "@/lib/db/auth"

export const runtime = "nodejs"
const Body = z.object({ email: z.string().email(), password: z.string().min(1) })

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  // Deliberately the same message as a failed sign-in: a 400 that says
  // "invalid email format" still tells an attacker something.
  if (!parsed.success) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })

  const r = await signInWithPassword(parsed.data.email, parsed.data.password)
  if (!r.user || !r.cookie) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })

  const res = NextResponse.json({ user: r.user })
  res.headers.set("Set-Cookie", r.cookie)
  return res
}
