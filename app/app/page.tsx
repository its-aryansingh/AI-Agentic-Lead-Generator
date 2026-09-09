import { redirect } from 'next/navigation'

export const dynamic = "force-dynamic"

/**
 * /app -> /app/chat
 * Chat is the primary surface so anyone landing on the bare /app
 * URL should bounce there.
 */
export default function AppRoot() {
  redirect('/app/chat')
}
