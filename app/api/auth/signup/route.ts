import { NextResponse } from "next/server"
import { z } from "zod"
import { signUp } from "@/lib/db/auth"

export const runtime = "nodejs"
const Body = z.object({ email: z.string().email(), password: z.string().min(8) })

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and a password of at least 8 characters" }, { status: 400 })
  }
  const r = await signUp(parsed.data.email, parsed.data.password)
  if (!r.user || !r.cookie) return NextResponse.json({ error: r.error?.message ?? "Sign-up failed" }, { status: 400 })
  const res = NextResponse.json({ user: r.user })
  res.headers.set("Set-Cookie", r.cookie)
  return res
}
