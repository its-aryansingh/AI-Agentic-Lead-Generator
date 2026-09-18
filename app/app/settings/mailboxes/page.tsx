import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { warmupCap, revokeGmailCredential, sendGmail, verifyGmailCredential, classifyGmailError } from "@/lib/providers/gmail"
import { decryptCredential } from "@/lib/credential-crypto"


// Kept from the pre-port version: every page under /app reads the
// session cookie and cannot be statically prerendered.
export const dynamic = "force-dynamic"

/**
 * /app/settings/mailboxes — connect a sending Gmail + see warm-up status.
 *
 * Connect kicks off the dedicated Gmail OAuth dance (gmail.send +
 * gmail.readonly). Sending is throttled by the warm-up curve; this page
 * shows the current cap so users understand why early sends are slow.
 */

async function savePhysicalAddress(formData: FormData) {
  "use server"
  const id = String(formData.get("mailbox_id") ?? "")
  const addr = String(formData.get("physical_address") ?? "").trim()
  if (!id) return
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const {error}=await supabase
    .from("mailboxes")
    .update({ physical_address: addr || null })
    .eq("id", id)
    .eq("user_id", user.id)
  if(error)redirect(`/app/settings/mailboxes?error=address_save_failed`)
  redirect("/app/settings/mailboxes?saved=1")
}

async function disconnect(formData: FormData) {
  "use server"
  const id = String(formData.get("mailbox_id") ?? "")
  if (!id) return
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const {data:mailbox}=await supabase.from("mailboxes").select("oauth_refresh_token_encrypted").eq("id",id).eq("user_id",user.id).maybeSingle()
  if(mailbox?.oauth_refresh_token_encrypted){
    try{await revokeGmailCredential(decryptCredential(mailbox.oauth_refresh_token_encrypted as string))}catch{/* Always finish the local disconnect. */}
  }
  await supabase
    .from("mailboxes")
    .update({ status: "disconnected", oauth_refresh_token_encrypted: null, oauth_refresh_token: null, disconnected_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
  redirect("/app/settings/mailboxes")
}

async function testMailbox(formData: FormData) {
  "use server"
  const id=String(formData.get("mailbox_id")??"")
  const supabase=await createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)redirect("/login")
  const {data:mailbox}=await supabase.from("mailboxes").select("email_address,oauth_refresh_token_encrypted").eq("id",id).eq("user_id",user.id).maybeSingle()
  if(!mailbox?.oauth_refresh_token_encrypted)redirect("/app/settings/mailboxes?error=reconnect_required")
  try {
    const token=decryptCredential(mailbox.oauth_refresh_token_encrypted as string)
    const email=await verifyGmailCredential(token)
    if(email.toLowerCase()!==String(mailbox.email_address).toLowerCase())throw new Error("MAILBOX_MISMATCH")
    await sendGmail({refreshToken:token,from:email,to:email,subject:"SalesEngAI mailbox verification",body:"Your Gmail connection is working. This controlled message was sent only to your connected mailbox."})
    await supabase.from("mailboxes").update({status:"active",last_verified_at:new Date().toISOString(),last_error_code:null,last_error_message:null}).eq("id",id).eq("user_id",user.id)
  } catch(error) {
    const code=classifyGmailError(error)
    await supabase.from("mailboxes").update({status:code==="auth"?"reconnect_required":"error",last_error_code:code,last_error_message:"Mailbox verification failed"}).eq("id",id).eq("user_id",user.id)
    redirect(`/app/settings/mailboxes?error=${code}`)
  }
  redirect("/app/settings/mailboxes?tested=1")
}

export default async function MailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; saved?: string; tested?: string }>
}) {
  const supabase = await createClient()
  const { data: mailboxes } = await supabase
    .from("mailboxes")
    .select(
      "id,email_address,status,daily_sent,daily_send_limit,warmup_started_at,physical_address",
    )
    .order("created_at", { ascending: false })

  const { connected, error, tested, saved } = await searchParams

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Sending mailboxes</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {connected && (
            <Card size="sm" className="bg-emerald-50 dark:bg-emerald-950/30">
              <CardContent className="py-3 text-sm">
                Mailbox connected. Warm-up has started — early sends are capped
                low to protect your domain reputation.
              </CardContent>
            </Card>
          )}
          {tested && <Card size="sm" className="bg-emerald-50 dark:bg-emerald-950/30"><CardContent className="py-3 text-sm">Mailbox verified and a controlled test email was sent to itself.</CardContent></Card>}
          {saved && <Card size="sm" className="bg-emerald-50 dark:bg-emerald-950/30"><CardContent className="py-3 text-sm">Physical address saved. Gmail authorization was not changed.</CardContent></Card>}
          {error && (
            <Card size="sm">
              <CardContent className="py-3 text-sm text-destructive">
                {error === "google_not_configured"
                  ? "Google OAuth isn't configured on this deployment. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET."
                  : `Connection error: ${error}`}
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Connect a mailbox</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Connect a Gmail account to send sequences from. We request{" "}
                <code className="font-mono text-xs">gmail.send</code> +{" "}
                <code className="font-mono text-xs">gmail.readonly</code> — the
                latter is needed to detect replies and stop emailing people who
                respond. Use a dedicated outbound inbox, not your primary one.
              </p>
              <a href="/api/mailbox/connect">
                <Button size="sm">Connect Gmail</Button>
              </a>
            </CardContent>
          </Card>

          {(mailboxes ?? []).map((m) => {
            const cap = warmupCap(new Date(m.warmup_started_at as string))
            const effectiveCap = Math.min(
              cap,
              (m.daily_send_limit as number) ?? 10,
            )
            return (
              <Card key={m.id as string} size="sm">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center gap-2">
                    {m.email_address as string}
                    <Badge
                      variant={
                        m.status === "active" ? "default" : "secondary"
                      }
                    >
                      {String(m.status)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Today&apos;s sends</span>
                    <span className="font-medium">
                      {(m.daily_sent as number) ?? 0} / {effectiveCap} (warm-up cap)
                    </span>
                  </div>
                  <form action={savePhysicalAddress} className="flex items-end gap-2">
                    <input type="hidden" name="mailbox_id" value={m.id as string} />
                    <div className="flex-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
                        Physical address (required for CAN-SPAM footer)
                      </label>
                      <Input
                        name="physical_address"
                        defaultValue={(m.physical_address as string | null) ?? ""}
                        placeholder="123 MG Road, Bengaluru, KA 560001, India"
                      />
                    </div>
                    <Button type="submit" size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                  {m.status === "active" && (
                    <form action={testMailbox} className="self-end"><input type="hidden" name="mailbox_id" value={m.id as string} /><Button type="submit" size="xs" variant="outline">Verify &amp; send test</Button></form>
                  )}
                  {m.status === "active" && (
                    <form action={disconnect} className="self-end">
                      <input type="hidden" name="mailbox_id" value={m.id as string} />
                      <Button type="submit" size="xs" variant="ghost">
                        Disconnect
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}
