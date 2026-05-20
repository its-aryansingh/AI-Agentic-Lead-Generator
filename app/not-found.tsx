import Link from "next/link"

import { Button } from "@/components/ui/button"

/**
 * Project-wide 404. Used when Next can't match the URL OR when a
 * server component calls notFound().
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-4">
      <div className="text-xs text-muted-foreground tracking-wide uppercase">
        404
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        We couldn&rsquo;t find that page
      </h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        It may have moved, been deleted, or never existed. If you got here from
        a link inside the app, that&rsquo;s a bug — let us know.
      </p>
      <div className="flex items-center gap-2 mt-2">
        <Link href="/">
          <Button variant="outline" size="sm">
            Landing page
          </Button>
        </Link>
        <Link href="/app/chat">
          <Button size="sm">Back to chat</Button>
        </Link>
      </div>
    </div>
  )
}
