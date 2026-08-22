# LeadGenAI Deployment — Quick Reference Checklist

**Print this or keep it open in another window while deploying.**

---

## Phase 2: Supabase Setup

### ☐ Supabase Project Created
- [ ] Go to https://supabase.com → Sign up
- [ ] Create project in Mumbai (India) or Singapore (SEA)
- [ ] Save DB password somewhere safe
- [ ] Wait for initialization (1-2 min)

### ☐ API Keys Copied
- [ ] Go to Settings → API → Copy Project URL
  ```
  NEXT_PUBLIC_SUPABASE_URL = _______________
  ```
- [ ] Copy "anon public" key
  ```
  NEXT_PUBLIC_SUPABASE_ANON_KEY = _______________
  ```
- [ ] Copy "service_role" key (SECRET)
  ```
  SUPABASE_SERVICE_ROLE_KEY = _______________
  ```

### ☐ Migrations Applied
- [ ] Run: `supabase login`
- [ ] Run: `supabase link --project-ref YOUR_REF`
- [ ] Run: `npm run db:push`
- [ ] Verify: 24 tables in SQL Editor

### ☐ Google OAuth Enabled in Supabase
- [ ] Authentication → Providers → Google
- [ ] Toggle "Enable Google" (green)
- [ ] (Keys will be added later)

---

## Phase 3: Credentials & Services

### ☐ Google OAuth Credentials
- [ ] Go to https://console.cloud.google.com
- [ ] Create project "LeadGenAI"
- [ ] Enable: Sheets API, Drive API, Gmail API, People API
- [ ] Create OAuth 2.0 Client ID (Web)
- [ ] Add redirect URIs:
  - `http://localhost:3000/api/auth/callback`
  - `http://localhost:3000/api/mailbox/callback`
  ```
  GOOGLE_CLIENT_ID = _______________
  GOOGLE_CLIENT_SECRET = _______________
  ```

### ☐ Anthropic API Key
- [ ] Go to https://console.anthropic.com
- [ ] Create/copy API key
  ```
  ANTHROPIC_API_KEY = _______________
  ```

### ☐ Brave Search API Key
- [ ] Go to https://search.brave.com/search/api
- [ ] Copy API key
  ```
  BRAVE_SEARCH_KEY = _______________
  ```

### ☐ Generate Random Secrets (Run in Terminal)
- [ ] `openssl rand -hex 32` → CRON_SECRET
  ```
  CRON_SECRET = _______________
  ```
- [ ] `openssl rand -hex 32` → UNSUB_SECRET
  ```
  UNSUB_SECRET = _______________
  ```
- [ ] `openssl rand -hex 32` → MAILBOX_STATE_SECRET
  ```
  MAILBOX_STATE_SECRET = _______________
  ```

---

## Phase 4: Vercel Deployment

### ☐ Import to Vercel
- [ ] Go to https://vercel.com
- [ ] Click "Add New" → "Project"
- [ ] Search for "AI-Agentic-Lead-Generator"
- [ ] Select repo and click "Import"
- [ ] Click "Deploy" (will fail without env vars — that's OK)

### ☐ Copy Vercel Domain
```
VERCEL_DOMAIN = https://_______________
```

### ☐ Add Environment Variables (in Vercel Settings → Environment Variables)
- [ ] NEXT_PUBLIC_SUPABASE_URL
- [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY
- [ ] SUPABASE_SERVICE_ROLE_KEY
- [ ] ANTHROPIC_API_KEY
- [ ] BRAVE_SEARCH_KEY
- [ ] GOOGLE_CLIENT_ID
- [ ] GOOGLE_CLIENT_SECRET
- [ ] CRON_SECRET
- [ ] UNSUB_SECRET
- [ ] MAILBOX_STATE_SECRET

### ☐ Redeploy
- [ ] Deployments → Click ⋯ on latest → "Redeploy"
- [ ] Wait 2-3 minutes for build
- [ ] Check for ✅ "Successfully built"

### ☐ Update Google OAuth URIs
- [ ] Google Cloud Console → Credentials → Your OAuth Client
- [ ] Add to "Authorized redirect URIs":
  - `https://YOUR_VERCEL_DOMAIN/api/auth/callback`
  - `https://YOUR_VERCEL_DOMAIN/api/mailbox/callback`
- [ ] Click "SAVE"

### ☐ Update Supabase OAuth Settings
- [ ] Supabase Dashboard → Authentication → Providers → Google
- [ ] Paste Google Client ID
- [ ] Paste Google Client Secret
- [ ] Click "SAVE"

---

## Phase 5: Testing & Verification

### ☐ Landing Page
- [ ] Visit `https://YOUR_VERCEL_DOMAIN`
- [ ] See landing page with "Sign in with Google"
- [ ] No 500 errors

### ☐ Google Sign-In
- [ ] Click "Sign in with Google"
- [ ] Complete OAuth flow
- [ ] Redirected to chat interface

### ☐ Chat Interface
- [ ] Type: "Find me 5 CTOs at fintech startups in India"
- [ ] See AI thinking + tool calls
- [ ] See enriched prospects with emails

### ☐ Database Persistence
- [ ] Supabase Dashboard → Table Editor
- [ ] Check `chat_sessions` — should see your session
- [ ] Check `chat_messages` — should see your messages

### ☐ Cron Jobs Registered
- [ ] Vercel Dashboard → Deployments → Crons
- [ ] Should see 5 cron jobs listed:
  - send-due
  - detect-replies
  - poll-intent
  - advance-sequences
  - run-automations

---

## Optional: Advanced Setup

### ☐ Inngest (for bulk jobs >20 prospects)
- [ ] Go to https://app.inngest.com
- [ ] Create project
- [ ] Copy Event Key + Signing Key
- [ ] Add to Vercel env vars:
  - `INNGEST_EVENT_KEY`
  - `INNGEST_SIGNING_KEY`

### ☐ Razorpay (India billing)
- [ ] Go to https://razorpay.com
- [ ] Create account
- [ ] Get Key ID + Key Secret
- [ ] Add to Vercel env vars:
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`

### ☐ Stripe (International billing)
- [ ] Go to https://stripe.com
- [ ] Create account
- [ ] Get API keys
- [ ] Add to Vercel env vars:
  - `STRIPE_SECRET_KEY`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### ☐ Fly.io Scraper (optional)
- [ ] Install flyctl: `curl -L https://fly.io/install.sh | sh`
- [ ] Run: `flyctl auth login`
- [ ] Navigate: `cd scraper`
- [ ] Deploy: `fly deploy`
- [ ] Get URL and add to Vercel:
  - `SCRAPER_URL`
  - `SCRAPER_KEY`

---

## 🆘 Quick Troubleshooting

| Error | Solution |
|---|---|
| 500 on landing page | Check Vercel logs for missing env var. Add it to Settings → Environment Variables and redeploy. |
| Google sign-in fails | Verify redirect URIs in Google Cloud match your Vercel domain exactly. |
| Chat shows errors | Ensure `ANTHROPIC_API_KEY` is set (mock mode works without it). |
| Cron jobs don't appear | Redeploy once after adding `CRON_SECRET`. Crons auto-register during build. |
| Database empty | Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly. RLS policies use this. |

---

## ✅ Success Checklist

- [ ] All 3 Supabase keys copied
- [ ] All 18 migrations applied
- [ ] Google OAuth credentials created
- [ ] Anthropic + Brave keys obtained
- [ ] 3 random secrets generated
- [ ] Vercel project created with all env vars
- [ ] App redeployed successfully
- [ ] Landing page loads
- [ ] Google sign-in works
- [ ] Chat interface works
- [ ] AI responds to prompts
- [ ] Database has chat records
- [ ] 5 cron jobs registered

**When all ✅: You're live!**

---

## Estimated Time

- Supabase setup: 10 min
- Google OAuth: 10 min
- Vercel deployment: 10 min
- Testing: 10 min

**Total: ~40 minutes from zero to live**

---

## Support Resources

| Problem | Resource |
|---|---|
| Supabase help | https://supabase.com/docs |
| Google Cloud help | https://cloud.google.com/docs |
| Vercel help | https://vercel.com/docs |
| Project issues | GitHub: `its-aryansingh/AI-Agentic-Lead-Generator` |

