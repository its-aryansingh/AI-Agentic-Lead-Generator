'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Server actions for the app shell.
 * Right now this is just sign-out, but more will land here.
 */

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function updateRecipientStatus(id: string, newStatus: string) {
  const validStatuses = ['scheduled', 'sent', 'opened', 'replied', 'bounced', 'unsubscribed']
  if (!validStatuses.includes(newStatus)) return { error: 'Invalid status' }
  
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  
  const { error } = await supabase
    .from('campaign_recipients')
    .update({ status: newStatus })
    .eq('id', id)
  
  if (error) return { error: error.message }
  return { success: true }
}
