import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { ChatClient } from "./components/chat-client"

/**
 * Chat page — server component that loads:
 *  - credit balance (for the header strip)
 *  - voice-anchor presence (so we can nudge first-runs to set one)
 *
 * Then delegates streaming chat to ChatClient.
 */
export default async function ChatPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let creditsRemaining = 25
  let hasVoiceAnchor = false
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("credits_remaining,voice_anchor_text")
      .eq("id", user.id)
      .maybeSingle()
    if (data) {
      if (data.credits_remaining !== undefined) {
        creditsRemaining = data.credits_remaining as number
      }
      hasVoiceAnchor =
        typeof data.voice_anchor_text === "string" &&
        data.voice_anchor_text.length > 0
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h1 className="text-base font-semibold">New chat</h1>
        <span className="text-xs text-muted-foreground">
          credits: {creditsRemaining} / free tier
        </span>
      </header>

      {!hasVoiceAnchor && (
        <div className="px-6 pt-4">
          <Card size="sm" className="bg-muted/40">
            <CardContent className="py-3 text-sm flex items-center justify-between gap-3 flex-wrap">
              <div>
                <span className="font-medium">One-time setup:</span>{" "}
                <span className="text-muted-foreground">
                  paste an example of your own outbound email so drafts match
                  your voice.
                </span>
              </div>
              <Link
                href="/app/settings/voice"
                className="text-xs underline underline-offset-2 shrink-0"
              >
                Set voice anchor →
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      <ChatClient />
    </div>
  )
}
