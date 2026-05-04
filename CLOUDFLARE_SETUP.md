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

## Step 7: Get Worker URLs

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
const firebaseWorkerUrl = 'https://ophelia-firebase-worker.norbertb-consulting.workers.dev';
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
