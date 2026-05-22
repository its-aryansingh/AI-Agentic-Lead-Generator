"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  MessageSquarePlus,
  Briefcase,
  Zap,
  Kanban,
  Inbox,
  Eye,
  BarChart3,
  Mic,
  Mail,
  Settings,
  CreditCard,
  Repeat,
  Bell,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { signOut } from "../actions"

export interface SidebarSession {
  id: string
  title: string | null
}

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  exactOnly?: boolean
  className?: string
}

type NavSection = {
  heading: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "CORE",
    items: [
      { href: "/app/chat", label: "+ New chat", icon: MessageSquarePlus, exactOnly: true, className: "font-medium" },
      { href: "/app/jobs", label: "Jobs", icon: Briefcase },
    ],
  },
  {
    heading: "OUTREACH",
    items: [
      { href: "/app/sequences", label: "Sequences", icon: Zap },
      { href: "/app/automations", label: "Automations", icon: Repeat },
      { href: "/app/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/app/inbox", label: "Reply inbox", icon: Inbox },
      { href: "/app/intent", label: "Intent", icon: Eye },
    ],
  },
  {
    heading: "INSIGHTS",
    items: [
      { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    heading: "SETTINGS",
    items: [
      { href: "/app/settings/voice", label: "Voice anchor", icon: Mic },
      { href: "/app/settings/mailboxes", label: "Mailboxes", icon: Mail },
      { href: "/app/settings/providers", label: "Providers", icon: Settings },
      { href: "/app/settings/notifications", label: "Notifications", icon: Bell },
      { href: "/app/settings/billing", label: "Billing & Plans", icon: CreditCard },
    ],
  },
]

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

        <nav className="px-3 py-3 flex flex-col gap-3 text-sm border-b border-border">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading} className="flex flex-col gap-0.5">
              <div className="px-3 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground select-none">
                {section.heading}
              </div>
              {section.items.map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  pathname={pathname}
                  onNavigate={close}
                  icon={item.icon}
                  exactOnly={item.exactOnly}
                  className={item.className}
                >
                  {item.label}
                </SidebarLink>
              ))}
            </div>
          ))}
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
  icon: Icon,
  exactOnly,
  className,
  title,
  children,
}: {
  href: string
  pathname: string
  onNavigate?: () => void
  icon?: React.ComponentType<{ className?: string }>
  exactOnly?: boolean
  className?: string
  title?: string
  children: React.ReactNode
}) {
  const active = exactOnly
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/")

  return (
    <Link
      href={href}
      title={title}
      onClick={onNavigate}
      className={cn(
        "px-3 py-2 rounded-md transition-colors flex items-center gap-2",
        active
          ? "bg-muted text-foreground border-l-3 border-l-primary"
          : "hover:bg-muted text-foreground",
        className,
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
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
