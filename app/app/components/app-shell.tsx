"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { signOut } from "../actions"

export interface SidebarSession {
  id: string
  title: string | null
}

/**
 * App shell with a mobile-drawer sidebar.
 *
 * On desktop (md+) the aside is permanently visible at 240px wide.
 * On mobile we hide it off-canvas and toggle with a hamburger button
 * in the top bar; clicking outside (the overlay) or any nav link
 * closes the drawer.
 *
 * The shell is a client component because it owns the open/closed
 * state; data (sessions + user email) is passed in by the server-side
 * layout so we don't have to call Supabase from the client.
 */
export function AppShell({
  email,
  sessions,
  children,
}: {
  email: string
  sessions: SidebarSession[]
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const pathname = usePathname()
  const close = React.useCallback(() => setOpen(false), [])

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar — hidden on md+ where the aside is always visible. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-card border-b border-border px-4 py-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="p-1.5 -m-1.5 rounded-md hover:bg-muted transition-colors"
        >
          <Hamburger />
        </button>
        <Link href="/app/chat" className="font-semibold tracking-tight">
          LeadGenAI
        </Link>
        <div className="w-7" />{/* keeps the title centered */}
      </div>

      {/* Off-canvas overlay on mobile. */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-foreground/30"
        />
      )}

      <aside
        className={cn(
          "w-60 border-r border-border bg-card flex flex-col",
          // Mobile: off-canvas drawer
          "fixed inset-y-0 left-0 z-50 transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: in-flow
          "md:static md:translate-x-0",
        )}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <Link href="/app/chat" className="font-semibold tracking-tight">
            LeadGenAI
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="md:hidden p-1 -m-1 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <nav className="px-3 py-3 flex flex-col gap-1 text-sm border-b border-border">
          <SidebarLink href="/app/chat" pathname={pathname} onNavigate={close} className="font-medium">
            + New chat
          </SidebarLink>
          <SidebarLink href="/app/jobs" pathname={pathname} onNavigate={close}>
            Jobs
          </SidebarLink>
          <SidebarLink href="/app/sequences" pathname={pathname} onNavigate={close}>
            Sequences
          </SidebarLink>
          <SidebarLink href="/app/pipeline" pathname={pathname} onNavigate={close}>
            Pipeline
          </SidebarLink>
          <SidebarLink href="/app/inbox" pathname={pathname} onNavigate={close}>
            Reply inbox
          </SidebarLink>
          <SidebarLink href="/app/intent" pathname={pathname} onNavigate={close}>
            Intent
          </SidebarLink>
          <SidebarLink href="/app/analytics" pathname={pathname} onNavigate={close}>
            Analytics
          </SidebarLink>
          <SidebarLink href="/app/settings/voice" pathname={pathname} onNavigate={close}>
            Voice anchor
          </SidebarLink>
          <SidebarLink href="/app/settings/mailboxes" pathname={pathname} onNavigate={close}>
            Mailboxes
          </SidebarLink>
          <SidebarLink href="/app/settings/providers" pathname={pathname} onNavigate={close}>
            Providers
          </SidebarLink>
        </nav>

        <div className="flex-1 px-3 py-3 overflow-y-auto flex flex-col gap-0.5">
          <div className="px-3 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Recent chats
          </div>
          {sessions.length === 0 && (
            <div className="px-3 text-xs text-muted-foreground">
              No chats yet.
            </div>
          )}
          {sessions.map((s) => (
            <SidebarLink
              key={s.id}
              href={`/app/chat/${s.id}`}
              pathname={pathname}
              onNavigate={close}
              className="text-xs truncate"
              title={s.title ?? "Untitled chat"}
            >
              {s.title || "Untitled chat"}
            </SidebarLink>
          ))}
        </div>

        <div className="px-3 py-4 border-t border-border flex flex-col gap-2 text-xs">
          <span className="px-3 text-muted-foreground truncate">{email}</span>
          <form action={signOut}>
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="w-full justify-start"
            >
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* Main content. Top padding on mobile accounts for the fixed top bar. */}
      <main className="flex-1 flex flex-col pt-12 md:pt-0">{children}</main>
    </div>
  )
}

function SidebarLink({
  href,
  pathname,
  onNavigate,
  className,
  title,
  children,
}: {
  href: string
  pathname: string
  onNavigate?: () => void
  className?: string
  title?: string
  children: React.ReactNode
}) {
  const active = pathname === href
  return (
    <Link
      href={href}
      title={title}
      onClick={onNavigate}
      className={cn(
        "px-3 py-2 rounded-md transition-colors",
        active ? "bg-muted text-foreground" : "hover:bg-muted text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  )
}

function Hamburger() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}
