/**
 * GET /api/extension/web-push-key
 *
 * Public endpoint — returns the VAPID public key the browser needs
 * for `serviceWorkerReg.pushManager.subscribe({applicationServerKey})`.
 * Auth-free because the public key is, by design, public. Clients
 * that aren't authorised to push are gated at the subscribe endpoint.
 *
 * Returns 200 with the key when configured, or 200 with
 * `{configured: false}` so the client can render a graceful "push
 * unavailable" state without treating it as an error.
 */

import { NextResponse } from "next/server"

import { getVapidPublicKey, isWebPushConfigured } from "@/lib/providers/web-push"

export const runtime = "nodejs"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export async function GET() {
  if (!isWebPushConfigured()) {
    return NextResponse.json(
      { configured: false },
      { headers: corsHeaders },
    )
  }
  return NextResponse.json(
    {
      configured: true,
      public_key: getVapidPublicKey(),
      subject: process.env.VAPID_SUBJECT,
    },
    { headers: corsHeaders },
  )
}
