import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { AppShell, type SidebarSession } from "./components/app-shell"

/**
 * Shell layout for the auth-gated portion of the app.
 *
 * The middleware (see /proxy.ts) already redirects un-authed users
 * away from /app/* to /login, but we double-check here so server
 * components inside this tree can rely on a real user being present.
 *
 * This layout stays a server component — it fetches sessions + user
 * and passes them as serialised props to the client-side AppShell
 * which owns the mobile-drawer state.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // belt + suspenders — middleware should have caught this already
    redirect("/login")
  }

  const { data: rows } = await supabase
    .from("chat_sessions")
    .select("id,title,last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(10)

  const sessions: SidebarSession[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    title: (r.title as string | null) ?? null,
  }))

  return (
    <AppShell email={user.email ?? ""} sessions={sessions}>
      {children}
    </AppShell>
  )
}
