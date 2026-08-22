# 🚀 LeadGenAI End-to-End Deployment — Step-by-Step

**Status**: Phase 2A - Supabase Setup  
**Time Estimate**: 45 minutes total  
**Prerequisites**: GitHub account (for repo), email for services

---

## PHASE 2A: Create Supabase Database (5 minutes)

### Step 1: Go to Supabase
- **URL**: https://supabase.com
- **Click**: "Sign Up" (top right)
- **Choose**: Sign up with GitHub (recommended) OR Email

### Step 2: Create Organization
- **Click**: "New Organization" on the dashboard
- **Organization Name**: LeadGenAI (or any name)
- **Billing**: Free tier (default)
- **Click**: "Create organization"

### Step 3: Create Project
- **Click**: "New Project" button
- **Project Name**: `leadgenai` or `ai-lead-gen`
- **Database Password**: Create a STRONG password like `Xk9@mP2$vL4#wQ8!nR5`
  - ⚠️ **SAVE THIS PASSWORD** — you'll need it if you ever connect via psql
- **Region**: 
  - 🇮🇳 India: Select "Mumbai" (ap-south-1)
  - 🇸🇪 Southeast Asia: Select "Singapore" (ap-southeast-1)
- **Pricing Plan**: Free (good for MVP testing)
- **Click**: "Create new project"

### Step 4: Wait for Initialization
- Database will initialize (takes 1-2 minutes)
- You'll see a progress bar
- Once complete, you'll be on the project dashboard

### Step 5: Copy Your API Keys
The keys are in **Settings → API → Project Settings**

1. **Go to**: Settings (gear icon, bottom left)
2. **Click**: "API" tab (left sidebar)
3. **Copy these 3 values** to a text file:

```
NEXT_PUBLIC_SUPABASE_URL = [Copy "Project URL" from the first field]

NEXT_PUBLIC_SUPABASE_ANON_KEY = [Copy "anon public" key under "Project API keys"]

SUPABASE_SERVICE_ROLE_KEY = [Copy "service_role" key (marked SECRET) under "Project API keys"]
```

**Example** (YOUR VALUES WILL DIFFER):
```
NEXT_PUBLIC_SUPABASE_URL=https://xyzzqwerty.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<long JWT starting with ey...>
SUPABASE_SERVICE_ROLE_KEY=<long JWT starting with ey... KEEP SECRET>
```

✅ **When done**: You should have 3 keys copied safely.

---

## PHASE 2B: Apply Database Migrations (5 minutes)

Migrations create all your database tables. The app provides a script to do this automatically.

### Step 6: Run Migration Script

Open your terminal/PowerShell and run:

```bash
# Navigate to project folder
cd "C:\Users\user\OneDrive\Desktop\Projects\ai agentic lead generator"

# First, authenticate with Supabase CLI
supabase login

# When prompted, open the link in browser
# Create an access token in Supabase dashboard
# Paste token back to terminal
# ✅ Should see "Logged in successfully"

# Now link your project
supabase link --project-ref YOUR_PROJECT_REF

# Where YOUR_PROJECT_REF is the part from your URL:
# https://YOUR_PROJECT_REF.supabase.co
# Example: supabase link --project-ref xyzzqwerty

# Finally, push migrations
npm run db:push

# ✅ Should see output like:
# "Applying migration 0001_init..."
# "Applying migration 0002_..."
# ... (16 migrations total)
# "✓ All migrations applied successfully"
```

### Step 7: Verify Migrations Applied

1. **Go back to Supabase dashboard**
2. **Click**: "SQL Editor" (left sidebar)
3. **You should see** these tables in the left panel:
   - users
   - chat_sessions
   - chat_messages
   - prospect_candidates
   - jobs
   - prospects
   - scrape_cache
   - credit_transactions
   - webhook_events
   - sequences
   - sequence_enrollments
   - campaign_recipients
   - reply_classifications
   - (+ more tables for automations, notifications, etc.)

✅ **If you see 16+ tables**: migrations worked!

---

## PHASE 2C: Enable Google OAuth (5 minutes)

Google OAuth lets users sign in with their Google account (and gives you `drive.file` scope for Google Sheets export).

### Step 8: Go to Supabase Auth Settings

1. **In Supabase dashboard**, click **"Authentication"** (left sidebar)
2. **Click**: "Providers" (left sidebar under Authentication)
3. **Look for**: "Google" (should be visible in provider list)
4. **Click**: Google provider

### Step 9: Enable Google Provider

1. **Toggle**: "Enable Google" (should turn green)
2. **You'll see two fields**:
   - `Client ID`
   - `Client Secret`
   - (Currently empty — we'll fill these next)

✅ **Don't set the keys yet** — we need to create them in Google Cloud first.

---

## PHASE 3A: Create Google OAuth Credentials (10 minutes)

### Step 10: Go to Google Cloud Console

1. **URL**: https://console.cloud.google.com
2. **Sign in** with your Google account
3. **Create new project**:
   - Click project dropdown (top left, near "Google Cloud")
   - Click "NEW PROJECT"
   - Name: `LeadGenAI` or `ai-lead-gen`
   - Click "CREATE"
   - Wait 30 seconds for project to initialize

### Step 11: Enable Required APIs

1. **Go to**: APIs & Services → Enabled APIs and Services (left sidebar)
2. **Click**: "+ ENABLE APIS AND SERVICES" (top)
3. **Search and enable these 4 APIs**:
   - `Google Sheets API` — Find it, click, then "ENABLE"
   - `Google Drive API` — Find it, click, then "ENABLE"
   - `Gmail API` — Find it, click, then "ENABLE"
   - `Google People API` — Find it, click, then "ENABLE"

### Step 12: Create OAuth 2.0 Credentials

1. **Go to**: APIs & Services → Credentials (left sidebar)
2. **Click**: "+ CREATE CREDENTIALS" (top)
3. **Choose**: "OAuth 2.0 Client ID"
4. **First time?** You'll see "Configure OAuth consent screen" → Click it
   - **User Type**: External
   - **Click**: "CREATE"
   - **App name**: LeadGenAI
   - **User support email**: Your email
   - **Developer contact**: Your email
   - **Click**: "SAVE AND CONTINUE"
   - **Click**: "SAVE AND CONTINUE" again (scopes page)
   - **Click**: "SAVE AND CONTINUE" again (test users page)
   - **Click**: "BACK TO DASHBOARD"

5. **Now create the OAuth Client**:
   - **Go back to**: Credentials page
   - **Click**: "+ CREATE CREDENTIALS"
   - **Choose**: OAuth 2.0 Client ID
   - **Application type**: Web application
   - **Name**: LeadGenAI
   - **Authorized redirect URIs** — Add these 2:
     ```
     http://localhost:3000/api/auth/callback
     http://localhost:3000/api/mailbox/callback
     ```
     (You'll add production URLs after we get your Vercel domain)
   - **Click**: "CREATE"

### Step 13: Copy Your Google OAuth Credentials

1. **You'll see a popup** with your credentials
2. **Copy these to your text file**:
   ```
   GOOGLE_CLIENT_ID=[Copy from popup]
   GOOGLE_CLIENT_SECRET=[Copy from popup]
   ```
3. **You can also find them later** in Credentials → OAuth 2.0 Client IDs → Click your app

✅ **Done with Google setup!**

---

## PHASE 3B: Get Anthropic API Key (2 minutes)

Claude AI powers the enrichment engine.

### Step 14: Get Anthropic Key

1. **Go to**: https://console.anthropic.com
2. **Sign up or log in**
3. **Click**: "API" (left sidebar)
4. **Click**: "Get API Key"
5. **Copy your API key** to text file:
   ```
   ANTHROPIC_API_KEY=[your-key]
   ```

✅ **Got your Anthropic key!**

---

## PHASE 3C: Get Brave Search API Key (2 minutes)

Brave Search finds prospect companies.

### Step 15: Get Brave Search Key

1. **Go to**: https://search.brave.com/search/api
2. **Sign up or log in**
3. **Copy your API key** to text file:
   ```
   BRAVE_SEARCH_KEY=[your-key]
   ```

✅ **Got your Brave Search key!**

---

## PHASE 4A: Create Vercel Project (10 minutes)

Vercel hosts your app.

### Step 16: Import Repository to Vercel

1. **Go to**: https://vercel.com
2. **Sign up or log in** (GitHub recommended)
3. **Click**: "Add New..." → "Project"
4. **Search for repo**: `AI-Agentic-Lead-Generator`
   - If not showing, click "Configure GitHub App" to give Vercel access
5. **Select the repo**: `its-aryansingh/AI-Agentic-Lead-Generator`
6. **Click**: "Import"

### Step 17: Configure Project

1. **Framework**: Next.js (auto-detected)
2. **Build Command**: `npm run build` (default, fine)
3. **Environment Variables**: ⚠️ **Skip for now** — we'll add them after
4. **Click**: "Deploy"

Your first deployment will fail (no env vars) — that's OK!

### Step 18: Copy Your Deployment URL

1. **When deployment finishes** (green checkmark ✅), you'll see a URL like:
   ```
   https://leadgenai.vercel.app
   ```
2. **Copy this** to your text file:
   ```
   VERCEL_DOMAIN=https://leadgenai.vercel.app
   ```

---

## PHASE 4B: Add Environment Variables (10 minutes)

Now we add all the API keys to Vercel so the app can use them.

### Step 19: Go to Project Settings

1. **In Vercel dashboard**, click your project
2. **Click**: "Settings" (top navigation)
3. **Click**: "Environment Variables" (left sidebar)

### Step 20: Add Each Variable

You'll add **required variables first**, then optional ones.

**REQUIRED** (must have):

| Variable | Value | Where to get |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | (from Step 5) | Supabase Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Step 5) | Supabase Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Step 5) | Supabase Settings → API |
| `ANTHROPIC_API_KEY` | (from Step 14) | Anthropic Console → API |
| `BRAVE_SEARCH_KEY` | (from Step 15) | Brave Search Dashboard |
| `GOOGLE_CLIENT_ID` | (from Step 13) | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | (from Step 13) | Google Cloud Console → Credentials |
| `CRON_SECRET` | Generate: `openssl rand -hex 32` | Run in terminal |
| `UNSUB_SECRET` | Generate: `openssl rand -hex 32` | Run in terminal |
| `MAILBOX_STATE_SECRET` | Generate: `openssl rand -hex 32` | Run in terminal |

**For each variable**:
1. **Click**: "+ Add New"
2. **Name**: (variable name from table above)
3. **Value**: (paste the value)
4. **Environments**: Select `Production` (or all)
5. **Click**: "Save"

**OPTIONAL** (have mock fallbacks, add later if needed):

- `INNGEST_EVENT_KEY` — for async bulk jobs (inngest.com)
- `INNGEST_SIGNING_KEY` — for async bulk jobs (inngest.com)
- `RAZORPAY_KEY_ID` — for Indian billing (razorpay.com)
- `RAZORPAY_KEY_SECRET` — for Indian billing (razorpay.com)
- `STRIPE_SECRET_KEY` — for international billing (stripe.com)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — for international billing (stripe.com)
- `STRIPE_WEBHOOK_SECRET` — for international billing (stripe.com)

---

## PHASE 4C: Redeploy with Environment Variables (5 minutes)

### Step 21: Trigger New Deployment

1. **In Vercel**, click "Deployments" (top)
2. **Click** the three dots (⋯) on the most recent deployment
3. **Click**: "Redeploy"
4. **Click**: "Redeploy" again (confirm)
5. **Wait** 2-3 minutes for build to complete

### Step 22: Verify Deployment

1. **When complete**, click the deployment to see logs
2. **Look for**: ✅ "Successfully built" at the bottom
3. **If you see** 🔴 errors, check "Build Logs" tab
4. **Once green**, click the deployment URL (top left)

---

## PHASE 5A: Update Google OAuth Redirect URIs (2 minutes)

Now that you have your Vercel domain, update Google to allow it.

### Step 23: Update Google Credentials

1. **Go to**: https://console.cloud.google.com
2. **Go to**: APIs & Services → Credentials
3. **Click**: Your OAuth 2.0 Client ID (name: LeadGenAI)
4. **Under "Authorized redirect URIs"**, add these:
   ```
   https://YOUR_VERCEL_DOMAIN/api/auth/callback
   https://YOUR_VERCEL_DOMAIN/api/mailbox/callback
   ```
   (Replace `YOUR_VERCEL_DOMAIN` with the Vercel URL from Step 18)
   
   Example:
   ```
   https://leadgenai.vercel.app/api/auth/callback
   https://leadgenai.vercel.app/api/mailbox/callback
   ```

5. **Click**: "SAVE"

### Step 24: Update Supabase OAuth Settings

1. **Go to**: Supabase Dashboard → Authentication → Providers
2. **Click**: Google
3. **Paste your Google Client ID** into the "Client ID" field
4. **Paste your Google Client Secret** into the "Client Secret" field
5. **Click**: "SAVE"

---

## PHASE 5B: Apply Database Migrations in Production (3 minutes)

Your Supabase project in production needs the same migrations as local.

### Step 25: Push to Production

Since you've already run `npm run db:push` locally, your Supabase database **already has the migrations applied**.

To verify:
1. **Go to Supabase Dashboard**
2. **Click**: SQL Editor
3. **Verify** you see all 16+ tables (from Step 7)

✅ **Migrations are already applied!**

---

## PHASE 6: Test End-to-End (10 minutes)

### Step 26: Visit Your App

1. **Go to**: `https://YOUR_VERCEL_DOMAIN` (from Step 18)
2. **You should see**: LeadGenAI landing page with "Sign in with Google" button
3. **Click**: "Sign in with Google"
4. **Complete Google login** (you'll be redirected)
5. **Should see**: Chat interface

### Step 27: Test Chat

1. **In the chat**, type:
   ```
   Find me 5 CTOs at fintech startups in India with Series A funding
   ```

2. **You should see**:
   - AI thinking indicator (⚡)
   - Tool calls appearing (web_search, enrich_prospect, etc.)
   - Prospect names with emails and talking points
   - (Uses mock data if `BRAVE_SEARCH_KEY` not real)

### Step 28: Verify Database Works

1. **Go to** Supabase Dashboard → Table Editor
2. **Click** `chat_sessions` table
3. **You should see** your session with timestamp
4. **Click** `chat_messages` table
5. **You should see** your message + AI response

✅ **Database is working!**

### Step 29: Test Cron Jobs

1. **In Vercel**, go to project → Deployments → Crons
2. **You should see 5 cron jobs**:
   - `POST /api/cron/send-due` (every 15 min)
   - `POST /api/cron/detect-replies` (every 20 min)
   - `POST /api/cron/poll-intent` (every hour)
   - `POST /api/cron/advance-sequences` (every hour)
   - `POST /api/cron/run-automations` (every hour)

✅ **Crons are registered!**

---

## 🎉 DEPLOYMENT COMPLETE!

Your LeadGenAI app is **now live** at your Vercel domain.

### What's Working:

✅ Landing page  
✅ Google OAuth sign-in  
✅ Chat with AI (7 tools with mock fallbacks)  
✅ Database persistence  
✅ Email export (CSV + Google Sheets)  
✅ Gmail sending (when you connect mailbox)  
✅ Cron jobs (send-due, detect-replies, poll-intent, sequences, automations)  
✅ Billing hooks (Stripe + Razorpay)  

### Next Steps (Optional):

1. **Connect Gmail** → Settings → Mailboxes → Authorize Gmail
2. **Add Razorpay** (India billing) — add keys to Vercel env vars
3. **Add Slack** → Settings → Notifications → Slack webhook
4. **Monitor Costs** → Vercel Dashboard + Anthropic Console
5. **Test Full Flow** → CSV upload → Enrich → Send → Track replies

---

## 🆘 Troubleshooting

**Problem**: Landing page shows "500 Internal Server Error"

**Solution**:
1. Check Vercel Logs → click deployment → Logs
2. Look for missing env var (will say which one)
3. Add missing var to Settings → Environment Variables
4. Redeploy (click ⋯ → Redeploy)

**Problem**: Google sign-in fails

**Solution**:
1. Verify redirect URIs in Google Cloud (Step 23)
2. Verify OAuth credentials in Supabase (Step 24)
3. Clear browser cookies and try again

**Problem**: Chat shows errors

**Solution**:
1. Check that `ANTHROPIC_API_KEY` is set in Vercel env vars
2. If empty, it will use mock data (still works!)
3. For real responses, add real API key and redeploy

---

## Final Checklist

- [ ] Supabase project created with 3 API keys copied
- [ ] Migrations applied (`npm run db:push` ran successfully)
- [ ] Google OAuth credentials created
- [ ] Anthropic API key obtained
- [ ] Brave Search API key obtained
- [ ] Vercel project created and imported repo
- [ ] All required env vars added to Vercel
- [ ] App redeployed with env vars
- [ ] Landing page loads at Vercel domain
- [ ] Google sign-in works
- [ ] Chat interface works + AI responds
- [ ] Database tables visible in Supabase
- [ ] Cron jobs visible in Vercel

✅ **When ALL boxes checked: You're deployed!**
