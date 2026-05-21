"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Clock, Send, Eye, MessageSquare, AlertTriangle, UserX, LayoutDashboard } from "lucide-react"
import { cn } from "@/lib/utils"
import { updateRecipientStatus } from "../actions"
import { AnimatedCounter } from "@/components/ui/animated-counter"

export interface Recipient {
  id: string
  email: string
  subject: string | null
  status: string
  sent_at: string | null
  campaign_id: string | null
}

const COLUMNS = [
  { key: "scheduled", label: "Scheduled", icon: Clock, color: "var(--chart-sky)" },
  { key: "sent", label: "Sent", icon: Send, color: "var(--chart-violet)" },
  { key: "opened", label: "Opened", icon: Eye, color: "var(--chart-teal)" },
  { key: "replied", label: "Replied", icon: MessageSquare, color: "var(--chart-emerald)" },
  { key: "bounced", label: "Bounced", icon: AlertTriangle, color: "var(--chart-amber)" },
  { key: "unsubscribed", label: "Unsubscribed", icon: UserX, color: "var(--chart-rose)" },
]

export function PipelineClient({ initialRecipients }: { initialRecipients: Recipient[] }) {
  const [recipients, setRecipients] = React.useState(initialRecipients)
  const [draggedId, setDraggedId] = React.useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = React.useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id)
    // Required for Firefox
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", id)
  }

  const handleDragOver = (e: React.DragEvent, colKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (dragOverCol !== colKey) {
      setDragOverCol(colKey)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverCol(null)
  }

  const handleDrop = async (e: React.DragEvent, colKey: string) => {
    e.preventDefault()
    setDragOverCol(null)
    
    if (!draggedId) return
    const recipient = recipients.find(r => r.id === draggedId)
    if (!recipient || recipient.status === colKey) {
      setDraggedId(null)
      return
    }

    // Optimistic update
    const previousStatus = recipient.status
    setRecipients(prev => 
      prev.map(r => r.id === draggedId ? { ...r, status: colKey } : r)
    )
    setDraggedId(null)

    // Server action
    const res = await updateRecipientStatus(draggedId, colKey)
    if (res.error) {
      // Revert on error
      setRecipients(prev => 
        prev.map(r => r.id === draggedId ? { ...r, status: previousStatus } : r)
      )
      console.error(res.error)
    }
  }

  if (recipients.length === 0) {
    return (
      <EmptyState
        icon={<LayoutDashboard className="w-8 h-8" />}
        title="Pipeline empty"
        description="No campaign recipients yet. Build a sequence, connect a mailbox, and launch a campaign to populate the pipeline."
      />
    )
  }

  return (
    <div className="flex gap-4 min-w-max pb-10">
      {COLUMNS.map((col) => {
        const colItems = recipients.filter(r => r.status === col.key)
        const isDragOver = dragOverCol === col.key
        
        return (
          <div
            key={col.key}
            className="w-72 flex flex-col gap-3"
            onDragOver={(e) => handleDragOver(e, col.key)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.key)}
          >
            {/* Column Header */}
            <div 
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-card/50 border border-border relative overflow-hidden"
            >
              <div 
                className="absolute top-0 left-0 right-0 h-[3px]"
                style={{ backgroundColor: col.color }}
              />
              <div className="flex items-center gap-2 mt-1">
                <col.icon className="w-4 h-4 text-muted-foreground" style={{ color: col.color }} />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {col.label}
                </span>
              </div>
              <Badge variant="outline" className="mt-1">
                <AnimatedCounter value={colItems.length} />
              </Badge>
            </div>

            {/* Column Body */}
            <div 
              className={cn(
                "flex-1 flex flex-col gap-3 rounded-xl min-h-[150px] p-1 transition-all",
                isDragOver && "kanban-drop-active"
              )}
            >
              {colItems.length === 0 && !isDragOver && (
                <div className="h-full border-2 border-dashed border-border/50 rounded-lg flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">Drop here</span>
                </div>
              )}
              
              {colItems.slice(0, 30).map((r) => (
                <Card 
                  key={r.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, r.id)}
                  className={cn(
                    "glass-card cursor-grab active:cursor-grabbing relative overflow-hidden group hover:border-border/60 transition-all",
                    draggedId === r.id && "opacity-50 ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                >
                  <div 
                    className="absolute left-0 top-0 bottom-0 w-1"
                    style={{ backgroundColor: col.color }}
                  />
                  <CardHeader className="px-4 py-3 pb-1">
                    <CardTitle className="text-xs font-medium truncate pr-4">
                      {r.email ?? "(no email)"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <div className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {r.subject ?? "No subject"}
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {colItems.length > 30 && (
                <div className="text-center text-[10px] text-muted-foreground py-2 uppercase tracking-widest font-medium">
                  + {colItems.length - 30} more
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
