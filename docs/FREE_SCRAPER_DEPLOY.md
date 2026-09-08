# Free Scraper Deployment Guide (Zero-Cost Alternatives)

If you hit the free plan limit on Railway when deploying the scraper service, you can deploy the scraper microservice on a **100% free Docker hosting provider** and connect it back to your Next.js application on Railway.

Because Playwright with headless Chromium requires ~1 GB RAM to operate reliably, standard 512MB free tiers may crash with out-of-memory (OOM) errors. Below are the two best free options:

---

## Option 1: Hugging Face Spaces (Recommended)
- **RAM**: **16 GB RAM** (Free forever)
- **vCPU**: 2 vCPU
- **Credit Card Required?**: **NO**
- **Spin-down**: Stays alive or auto-wakes seamlessly on incoming HTTP requests.

### Steps to Deploy:

1. **Create a Hugging Face Account**:
   - Go to [huggingface.co](https://huggingface.co) and sign up / log in.

2. **Create a New Space**:
   - Go to [huggingface.co/new-space](https://huggingface.co/new-space)
   - **Space Name**: `leadgen-scraper` (or any name you prefer)
   - **License**: `mit`
   - **Space SDK**: Select **Docker** -> **Blank**
   - **Space Hardware**: **CPU basic · 2 vCPU · 16 GB RAM · Free**
   - **Visibility**: **Public** *(Note: Your API is secured by your `x-scraper-key` header, so unauthorized users cannot scrape with it)*
   - Click **Create Space**.

3. **Push the Scraper Code to your Space**:
   Hugging Face provides a Git repository for your Space (`https://huggingface.co/spaces/<your-username>/leadgen-scraper`).

   **Method A: Using Git Subtree (Run from your project root)**:
   ```bash
   git subtree push --prefix scraper https://huggingface.co/spaces/<your-username>/leadgen-scraper main
   ```

   **Method B: Clone and Copy**:
   ```bash
   # In a separate terminal or directory:
   git clone https://huggingface.co/spaces/<your-username>/leadgen-scraper hf-scraper
   cd hf-scraper

   # Copy all files from the `scraper/` folder of this project into `hf-scraper`
   # (Dockerfile, package.json, package-lock.json, tsconfig.json, src/)

   git add -A
   git commit -m "deploy scraper to hugging face spaces"
   git push origin main
   ```

4. **Configure Secrets & Port in Hugging Face**:
   - In your Hugging Face Space, click **Settings** (top right tab).
   - Scroll down to **Variables and secrets**.
   - Under **Secrets**, click **New secret**:
     - Key: `SCRAPER_KEY`
     - Value: `<your-strong-secret-token>`
   - Under **Variables**, click **New variable**:
     - Key: `PORT`
     - Value: `7860`

5. **Get your Scraper URL**:
   Once built, your Space URL will be:
   ```
   https://<your-username>-leadgen-scraper.hf.space
   ```
   You can verify it in your terminal:
   ```bash
   curl https://<your-username>-leadgen-scraper.hf.space/health
   # Should return: {"status":"ok","playwright":true,...}
   ```

6. **Connect to your Next.js App on Railway**:
   - Open Railway -> select your **Next.js App service** -> **Variables** tab.
   - Set:
     - `SCRAPER_URL` = `https://<your-username>-leadgen-scraper.hf.space`
     - `SCRAPER_KEY` = `<your-strong-secret-token>`
   - Railway will redeploy the app and now enrichment crawls will execute against your 16GB free Hugging Face Space!

---

## Option 2: Fly.io
- **RAM**: Up to 1 GB RAM per machine
- **Credit Card Required?**: Yes (for verification, but includes free tier usage)
- **Config**: Pre-configured in `scraper/fly.toml`

### Steps to Deploy:
1. **Install flyctl**:
   - On Windows (PowerShell):
     ```powershell
     iwr https://fly.io/install.ps1 -useb | iex
     ```
   - On macOS / Linux:
     ```bash
     curl -L https://fly.io/install.sh | sh
     ```
2. **Authenticate**:
   ```bash
   fly auth login
   ```
3. **Deploy from the `scraper/` directory**:
   ```bash
   cd scraper
   fly launch --copy-config
   fly secrets set SCRAPER_KEY="<your-strong-secret-token>"
   fly deploy
   ```
4. **Get the URL & Set in Railway**:
   - Your Fly URL is `https://<app-name>.fly.dev`.
   - In Railway's Next.js app Variables tab, set:
     - `SCRAPER_URL` = `https://<app-name>.fly.dev`
     - `SCRAPER_KEY` = `<your-strong-secret-token>`

---

## Option 3: Run Zero-Cost Mock Mode (No deployment needed)
If you just want to test your core platform, chat, discovery, and campaigns on Railway:
- **Do not set** `SCRAPER_URL` or `SCRAPER_KEY` in Railway.
- The platform automatically falls back to deterministic mock scraping.
- This lets you use the app end-to-end at **$0 cost** without needing any scraper service.
