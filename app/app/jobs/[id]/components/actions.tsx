"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Top-of-page buttons: open Google Sheet (if it exists) and download CSV.
 */
export function JobDetailActions({
  jobId,
  sheetUrl,
}: {
  jobId: string
  sheetUrl: string | null
}) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      {sheetUrl && (
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium",
            "border border-border hover:bg-muted transition-colors",
          )}
        >
          Open Sheet
        </a>
      )}
      <a
        href={`/api/export/csv?jobId=${jobId}`}
        className={cn(
          "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium",
          "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
        )}
      >
        Download CSV
      </a>
    </div>
  )
}

/**
 * Per-prospect copy buttons in the card header. Keeps the parent
 * server component pure-RSC and isolates client interactivity here.
 */
export function ProspectActions({
  fullEmail,
  subject,
  body,
}: {
  fullEmail: string
  subject: string
  body: string
}) {
  return (
    <div className="ml-auto flex items-center gap-1">
      {fullEmail && <Copy text={fullEmail} label="Copy" />}
      {subject && <Copy text={subject} label="Subject" />}
      {body && <Copy text={body} label="Body" />}
    </div>
  )
}

function Copy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked — fail silently */
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  )
}
