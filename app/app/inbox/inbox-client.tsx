"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Mail, Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { markHandled } from "./page"
import { useFormStatus } from "react-dom"

export interface Reply {
  id: string
  category: string
  confidence: number | null
  snippet: string | null
  created_at: string
  email: string | null
}

const TABS = ["All", "Interested", "Question", "Objection"] as const
type Tab = typeof TABS[number]

export function InboxClient({ replies }: { replies: Reply[] }) {
  const [activeTab, setActiveTab] = React.useState<Tab>("All")
  const [optimisticHandled, setOptimisticHandled] = React.useState<Set<string>>(new Set())

  const filteredReplies = replies.filter((r) => {
    if (optimisticHandled.has(r.id)) return false
    if (activeTab === "All") return true
    return r.category.toLowerCase() === activeTab.toLowerCase()
  })

  const handleMarkHandled = async (formData: FormData) => {
    const id = String(formData.get("id") ?? "")
    if (!id) return
    
    // Optimistic update
    setOptimisticHandled((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    
    // Call server action
    await markHandled(formData)
  }

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case "interested": return "bg-[var(--chart-emerald)]"
      case "question": return "bg-[var(--chart-amber)]"
      case "objection": return "bg-[var(--chart-rose)]"
      default: return "bg-[var(--chart-sky)]"
    }
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Tabs */}
      <div className="flex gap-2 pb-2 overflow-x-auto border-b border-border hide-scrollbar">
        {TABS.map((tab) => {
          const count = replies.filter((r) => {
            if (optimisticHandled.has(r.id)) return false
            if (tab === "All") return true
            return r.category.toLowerCase() === tab.toLowerCase()
          }).length

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap",
                activeTab === tab
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {tab}
              <Badge
                variant={activeTab === tab ? "secondary" : "outline"}
                className={cn(
                  "ml-1 text-[10px] px-1.5 h-4 min-w-4 flex items-center justify-center rounded-full",
                  activeTab === tab ? "bg-primary-foreground/20 text-primary-foreground" : ""
                )}
              >
                {count}
              </Badge>
            </button>
          )
        })}
      </div>

      {/* Reply List */}
      <div className="flex flex-col gap-4 max-w-3xl pb-10">
        {filteredReplies.length === 0 ? (
          <EmptyState
            icon={<Mail className="w-8 h-8" />}
            title="No replies found"
            description={
              activeTab === "All"
                ? "You're all caught up! When a prospect responds with interest, a question, or an objection, it'll surface here."
                : `No ${activeTab.toLowerCase()} replies waiting on you.`
            }
          />
        ) : (
          filteredReplies.map((r, i) => (
            <ReplyCard
              key={r.id}
              reply={r}
              index={i}
              onHandle={handleMarkHandled}
              categoryColor={getCategoryColor(r.category)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function ReplyCard({
  reply,
  index,
  onHandle,
  categoryColor,
}: {
  reply: Reply
  index: number
  onHandle: (formData: FormData) => void
  categoryColor: string
}) {
  const [expanded, setExpanded] = React.useState(false)

  // Relative time formatter
  const timeAgo = (dateStr: string) => {
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
    const daysDifference = Math.round(
      (new Date(dateStr).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    )
    if (daysDifference === 0) {
      const hoursDifference = Math.round(
        (new Date(dateStr).getTime() - new Date().getTime()) / (1000 * 60 * 60)
      )
      if (hoursDifference === 0) return "just now"
      return rtf.format(hoursDifference, "hour")
    }
    return rtf.format(daysDifference, "day")
  }

  const initial = reply.email ? reply.email.charAt(0).toUpperCase() : "?"

  return (
    <Card 
      className={cn(
        "glass-card animate-slide-in-up overflow-hidden group transition-all hover:border-border/50",
      )}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="px-5 py-4 flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-medium text-sm">
              {initial}
            </div>
            <div 
              className={cn(
                "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-background",
                categoryColor
              )}
              title={reply.category}
            />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{reply.email || "(unknown sender)"}</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="capitalize">{reply.category}</span>
              <span>•</span>
              <span>{timeAgo(reply.created_at)}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="px-5 pb-4 pt-2 flex flex-col gap-3">
        <div 
          className={cn(
            "text-sm text-foreground/90 whitespace-pre-wrap transition-all cursor-pointer",
            !expanded && "line-clamp-2"
          )}
          onClick={() => setExpanded(!expanded)}
        >
          {reply.snippet ?? "(no preview)"}
        </div>
        
        {reply.snippet && reply.snippet.length > 100 && (
          <button 
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary self-start hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}

        <div className="flex items-center justify-end mt-2">
          <form action={onHandle}>
            <input type="hidden" name="id" value={reply.id} />
            <SubmitButton />
          </form>
        </div>
      </CardContent>
    </Card>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button 
      type="submit" 
      size="sm" 
      variant="outline" 
      disabled={pending}
      className="gap-2 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all"
    >
      {pending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Check className="w-4 h-4 opacity-70" />
      )}
      Mark handled
    </Button>
  )
}
