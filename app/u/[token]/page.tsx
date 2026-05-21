import { createAdminClient } from "@/lib/supabase/server"
import {
  sha256Email,
  verifyUnsubToken,
} from "@/lib/email-compliance"

/**
 * /u/[token] — one-click unsubscribe handler.
 *
 * No login required (the recipient isn't a user). Verifies the HMAC
 * token, marks the recipient unsubscribed, and adds the email to the
 * sender's global suppression list so they never get another message
 * from this user's account. Renders a confirmation page.
 *
 * This is a page (not an API route) so the recipient sees a friendly
 * confirmation. The mutation runs server-side on render — acceptable
 * because the token is single-purpose and idempotent.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const parsed = verifyUnsubToken(token)

  let ok = false
  if (parsed) {
    const admin = createAdminClient()
    // Look up the recipient to get their email + confirm ownership chain.
    const { data: recipient } = await admin
      .from("campaign_recipients")
      .select("id,email,campaign_id")
      .eq("id", parsed.recipientId)
      .maybeSingle()

    if (recipient) {
      await admin
        .from("campaign_recipients")
        .update({ status: "unsubscribed" })
        .eq("id", recipient.id)

      await admin.from("suppressions").upsert(
        {
          user_id: parsed.userId,
          email_hash: sha256Email(recipient.email as string),
          reason: "unsubscribed",
        },
        { onConflict: "user_id,email_hash" },
      )

      await admin.from("email_events").insert({
        recipient_id: recipient.id,
        user_id: parsed.userId,
        event_type: "unsubscribed",
      })
      ok = true
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-3 bg-background text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">
        {ok ? "You're unsubscribed" : "Link invalid or expired"}
      </h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        {ok
          ? "You won't receive any more emails from this sender. It can take a few minutes to take full effect."
          : "We couldn't process that unsubscribe link. It may have already been used, or the link is malformed."}
      </p>
    </div>
  )
}
