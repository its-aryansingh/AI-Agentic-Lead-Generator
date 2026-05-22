/**
 * User notifications — currently WhatsApp alerts for key events
 * (automation finished, hot reply). Gated on the user's opt-in
 * (notify_whatsapp) and a saved number; a no-op otherwise. Mock-safe via
 * the WhatsApp provider, so this never throws into a cron/agent path.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { sendWhatsApp } from "@/lib/providers/whatsapp"

export interface NotifyResult {
  sent: boolean
  mock?: boolean
  skipped?: string
}

export async function notifyWhatsApp(userId: string, text: string): Promise<NotifyResult> {
  try {
    const supabase = createAdminClient()
    const { data: u } = await supabase
      .from("users")
      .select("whatsapp_number, notify_whatsapp")
      .eq("id", userId)
      .maybeSingle()

    const number = (u?.whatsapp_number as string | null) ?? null
    const enabled = Boolean(u?.notify_whatsapp)
    if (!enabled || !number) return { sent: false, skipped: "alerts off or no number" }

    const res = await sendWhatsApp({ to: number, text })
    return { sent: !res.error, mock: res.mock }
  } catch {
    return { sent: false, skipped: "notify failed" }
  }
}
