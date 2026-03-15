# Prism Server Deployment Guide

## Railway Deployment

### Prerequisites

1. [Railway account](https://railway.app/)
2. Railway CLI (optional): `npm install -g @railway/cli`
3. OpenAI API Key

### Quick Deploy via Railway Dashboard

1. **Create New Project**
   - Go to [Railway Dashboard](https://railway.app/dashboard)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your forked repository

2. **Configure Build**
   - Set root directory: `apps/prism-server`
   - Railway will auto-detect the Dockerfile

3. **Set Environment Variables**
   In the Railway service settings, add:

   | Variable | Value | Required |
   |----------|-------|----------|
   | `OPENAI_API_KEY` | `sk-...` | ✅ Yes |
   | `DATABASE_PATH` | `/app/data/prism.db` | ⚠️ Default |
   | `PORT` | Auto-set by Railway | - |
   | `HOST` | `0.0.0.0` | ⚠️ Default |
   | `NODE_ENV` | `production` | ⚠️ Default |

4. **Deploy**
   - Click "Deploy" or push to your connected branch
   - Wait for build to complete (~2-3 minutes)

5. **Get Public URL**
   - Go to Settings → Networking
   - Generate a public domain (e.g., `prism-server-xxx.up.railway.app`)

### CLI Deploy

```bash
# Login to Railway
railway login

# Initialize project (from apps/prism-server directory)
cd apps/prism-server
railway init

# Link to existing project or create new
railway link

# Set environment variables
railway variables set OPENAI_API_KEY=sk-...

# Deploy
railway up
```

### Verify Deployment

```bash
# Check health
curl https://your-prism-server.up.railway.app/health

# Test explore endpoint
curl -X POST https://your-prism-server.up.railway.app/explore \
  -H "Content-Type: application/json" \
  -d '{"word": "test"}'
```

## Configure Cognitive Arena

After deploying prism-server, update cognitive-arena's environment:

### Vercel Dashboard

1. Go to your Vercel project settings
2. Add environment variable:
   - Key: `NEXT_PUBLIC_PRISM_API_URL`
   - Value: `https://your-prism-server.up.railway.app`
3. Redeploy

### Local Development

Create `.env.local` in `apps/cognitive-arena/`:

```env
NEXT_PUBLIC_PRISM_API_URL=https://your-prism-server.up.railway.app
```

Or use local prism-server:

```env
NEXT_PUBLIC_PRISM_API_URL=http://localhost:3006
```

## Persistent Storage (Railway)

By default, Railway containers are ephemeral. To persist the SQLite database:

### Option 1: Volume Mount (Recommended)

1. In Railway Dashboard, go to your service
2. Click "Add Volume"
3. Mount path: `/app/data`
4. This persists `prism.db` across deploys

### Option 2: External Database

For production at scale, consider:
- Turso (SQLite on the edge)
- PlanetScale (MySQL)
- Supabase (PostgreSQL)

## Troubleshooting

### Build Fails

Check that `bun.lock` or `package-lock.json` exists:

```bash
cd apps/prism-server
bun install
```

### Health Check Fails

Ensure the `/health` endpoint is accessible:
- Check `HOST=0.0.0.0` is set
- Verify port configuration

### CORS Issues

The server allows CORS by default. If you need custom origins:

1. Add `ALLOWED_ORIGINS` environment variable
2. Format: comma-separated list of origins

```env
ALLOWED_ORIGINS=https://arena.example.com,https://magpie.example.com
```

## Architecture Overview

```
┌─────────────────────┐     ┌─────────────────────┐
│  Cognitive Arena    │     │   Prism Server      │
│  (Vercel)           │────▶│   (Railway)         │
│                     │     │                     │
│  - Next.js          │     │  - Fastify + Bun    │
│  - @prism/client    │     │  - SQLite           │
│  - Static hosting   │     │  - OpenAI API       │
└─────────────────────┘     └─────────────────────┘
```


