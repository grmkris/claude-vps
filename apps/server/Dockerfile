# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM oven/bun:1.3.5-slim AS builder

# Install build dependencies (required for native modules)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace configuration files
COPY package.json bun.lock turbo.json tsconfig.json ./

# Copy full source code FIRST (enables workspace resolution - fixes bun install hang)
COPY apps ./apps
COPY packages ./packages

# Install dependencies (now has full workspace context)
# Note: removed --frozen-lockfile due to "Failed to install 1 package" error
RUN bun install --filter=server

# =============================================================================
# Stage 2: Runner
# =============================================================================
FROM oven/bun:1.3.5-slim AS runner

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    dumb-init \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user
RUN groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs -m -d /home/nodejs

# Copy application and dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/apps/server ./apps/server
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/tsconfig.json ./

# Switch to non-root user
USER nodejs

# Set runtime environment
ENV NODE_ENV=production
ENV HOME=/home/nodejs
ENV PORT=33000

EXPOSE 33000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:33000/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Run directly from TypeScript (Bun handles it natively)
WORKDIR /app/apps/server
CMD ["bun", "run", "src/server.ts"]
