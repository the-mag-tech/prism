# Prism Server Dockerfile
# Railway: Set "Root Directory" to "/" (repo root) in service settings
# Dockerfile Path: apps/prism-server/Dockerfile

FROM oven/bun:1

WORKDIR /app

# Copy package files from monorepo structure
COPY apps/prism-server/package.json ./apps/prism-server/
COPY packages/prism-contract/package.json ./packages/prism-contract/

# Install dependencies for prism-server
WORKDIR /app/apps/prism-server
RUN bun install --production

# Copy source code
WORKDIR /app
COPY apps/prism-server/src ./apps/prism-server/src
COPY packages/prism-contract/src ./packages/prism-contract/src

# Create data directory for SQLite
RUN mkdir -p /data

# Set working directory to prism-server
WORKDIR /app/apps/prism-server

# Environment variables
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/prism.db
ENV HOST=0.0.0.0
ENV PORT=3001

# Note: Mount a Railway Volume to /data for data persistence

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun --eval "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1))" || exit 1

# Start the server
CMD ["bun", "run", "src/server.ts"]
