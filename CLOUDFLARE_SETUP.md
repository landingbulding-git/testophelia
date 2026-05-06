# Cloudflare Workers Setup Guide

This guide will help you set up Cloudflare Workers to securely handle API keys for your Chrome extension.

## Prerequisites

- Cloudflare account (free tier is sufficient)
- Node.js and npm installed
- Wrangler CLI installed: `npm install -g wrangler`

## Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

## Step 2: Login to Cloudflare

```bash
wrangler login
```

This will open a browser window to authenticate with Cloudflare.

## Step 3: Deploy Gemini Worker

Navigate to the Ophelia directory and deploy the Gemini worker:

```bash
cd /Users/mac/Documents/Ophelia
wrangler deploy cloudflare-worker-gemini.js
```

## Step 4: Set Environment Variables for Gemini Worker

1. Go to Cloudflare Dashboard → Workers & Pages
2. Find your Gemini worker (named "ophelia-gemini-worker")
3. Go to Settings → Variables and Secrets
4. Add the following environment variable:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** Your actual Gemini API key
   - **Environment:** Production

## Step 5: Deploy Firebase Worker

Deploy the Firebase worker:

```bash
wrangler deploy cloudflare-worker-firebase.js --name ophelia-firebase-worker
```

## Step 6: Set Environment Variables for Firebase Worker

1. Go to Cloudflare Dashboard → Workers & Pages
2. Find your Firebase worker (named "ophelia-firebase-worker")
3. Go to Settings → Variables and Secrets
4. Add the following environment variables:
   - **Name:** `FIREBASE_API_KEY`
   - **Value:** Your Firebase API key
   - **Name:** `FIREBASE_PROJECT_ID`
   - **Value:** `ophelia-bd2e0`
   - **Environment:** Production

## Step 7: Add Claude Sonnet Support (Ophelia Assistant)

The Ophelia Assistant planner now uses Claude Sonnet for better multi-step accuracy.

### 7a. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or log in
3. Go to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-…`)

### 7b. Add the secret to the existing Gemini worker

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select **ophelia-gemini-worker**
3. Go to **Settings → Variables and Secrets**
4. Add a new secret:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your `sk-ant-…` key
   - **Type:** Secret (encrypted)
5. Click **Save**

### 7c. Re-deploy the updated worker

The worker file now handles both `/` (Gemini tutor) and `/claude` (Claude planner):

```bash
cd /Users/mac/Documents/Ophelia
wrangler deploy cloudflare-worker-gemini.js
```

No changes to extension files needed — `assistant.js` already points to `/claude`.

---

## Step 8: Get Worker URLs

After deployment, Cloudflare will provide you with URLs like:
- Gemini Worker: `https://ophelia-gemini-worker.YOUR_SUBDOMAIN.workers.dev`
- Firebase Worker: `https://ophelia-firebase-worker.YOUR_SUBDOMAIN.workers.dev`

## Step 8: Update Extension Code

Update the worker URLs in your extension files:

**In `gemini-config.js`:**
```javascript
this.workerUrl = 'https://ophelia-gemini-worker.YOUR_SUBDOMAIN.workers.dev';
```

**In `content.js`:**
```javascript
const firebaseWorkerUrl = 'https://';
```

## Step 9: Test the Integration

1. Reload the Chrome extension
2. Test the Gemini Tutor (Ctrl+Shift+U)
3. Test session recording (Ctrl+Shift+F)
4. Check browser console for any errors

## Optional: Custom Domain

You can set up custom domains for your workers:

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your worker
3. Go to Settings → Triggers → Custom Domains
4. Add your custom domain (e.g., `gemini.ophelia.workers.org`)

## Security Benefits

✅ API keys stored securely in Cloudflare environment variables
✅ Users cannot extract your API keys from the extension
✅ Rate limiting and usage monitoring available
✅ Easy to rotate API keys without updating extension
✅ Free tier: 100,000 requests/day per worker

## Troubleshooting

**Worker not responding:**
- Check Cloudflare Dashboard → Workers → Analytics
- Verify environment variables are set correctly
- Check worker logs in Cloudflare Dashboard

**CORS errors:**
- Workers are configured with CORS headers
- If still having issues, check browser console for specific errors

**API key errors:**
- Verify environment variables are set in Production environment
- Check that API keys are valid and have proper permissions

## Cost

Cloudflare Workers Free Tier:
- 100,000 requests/day per worker
- 10ms CPU time per request
- Sufficient for most Chrome extension use cases

Paid plans available if you need higher limits.

---

## Step 10: MCP Gateway — YouTube to Notion “Brain”

The MCP gateway worker ([`workers/mcp-gateway.js`](workers/mcp-gateway.js)) exposes `POST /tutorial-to-guidance`, which:

1. Fetches YouTube metadata and transcript (shared module [`workers/youtube-fetch.js`](workers/youtube-fetch.js)).
2. Calls your existing **ophelia-gemini-worker** `POST /claude` (Anthropic) with the Brain prompt to produce JSON steps.
3. Creates a **Notion** child page under a configured parent, then an inline database (Name, Details, Category, Status), then one row per step ([`workers/notion-client.js`](workers/notion-client.js)).

### 10a. Create a Notion internal integration

1. Open [My integrations](https://www.notion.so/my-integrations) → **New integration**.
2. Type: **Internal**, associated with the workspace where plans should be created.
3. Copy the **Internal Integration Secret** (this is `NOTION_INTEGRATION_TOKEN`).

### 10b. Parent page

1. In Notion, create or pick a page (e.g. “Ophelia imports”).
2. Open it in the browser, copy the page ID from the URL (32 hex characters, with or without hyphens).
3. On that page: **…** → **Connections** → connect your new integration so it can add child pages.

Set `NOTION_PARENT_PAGE_ID` to that UUID (with hyphens, e.g. `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

### 10c. Gateway secrets and deploy

From the repo `workers` directory:

```bash
cd /Users/mac/Documents/Ophelia/workers
wrangler secret put NOTION_INTEGRATION_TOKEN --config mcp-gateway.wrangler.toml
wrangler secret put NOTION_PARENT_PAGE_ID --config mcp-gateway.wrangler.toml
wrangler deploy --config mcp-gateway.wrangler.toml
```

The **Gemini worker** must already have `ANTHROPIC_API_KEY` (see Step 7) so `/claude` works. Optionally set **Variable** `CLAUDE_WORKER_URL` on the MCP gateway to override the default Claude proxy URL.

### 10d. Board view and “one In Progress” rule

- **Board view:** The Notion Public API creates the database and rows but does **not** reliably create a board layout grouped by **Status**. After import, open the embedded database → **Layout** → **Board** → **Group** → **Status** once per database.
- **One In Progress:** Notion does not enforce this automatically. The Brain page includes a reminder; future automation could use webhooks or a small sync job.

### 10e. Extension behavior

With the active tab on a **YouTube** watch URL, Shorts, or `youtu.be`, press the assistant shortcut and say a phrase that includes both **tutorial** and **guidance** (e.g. “tutorial to guidance”). The background script calls `POST {MCP_GATEWAY}/tutorial-to-guidance` and shows the Notion page link in a toast.

**Rate limit:** the gateway allows up to **30** `tutorial-to-guidance` requests per client IP per day (KV-backed), in addition to normal MCP caching.
