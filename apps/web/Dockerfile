# syntax=docker/dockerfile:1

# ============================================
# Stage 1: Builder
# ============================================
FROM oven/bun:1.3.5 AS builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace configuration files
COPY package.json bun.lock turbo.json ./
COPY tsconfig.json ./

# Copy all package.json files for dependency resolution
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY apps/box-agent/package.json ./apps/box-agent/
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/logger/package.json ./packages/logger/
COPY packages/queue/package.json ./packages/queue/
COPY packages/redis/package.json ./packages/redis/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sprites/package.json ./packages/sprites/
COPY packages/storage/package.json ./packages/storage/
COPY packages/test-utils/package.json ./packages/test-utils/

# Install dependencies
RUN bun install --filter=web --frozen-lockfile

# Copy source code
COPY apps/web ./apps/web
COPY packages ./packages

# Build arguments for public environment variables
ARG NEXT_PUBLIC_ENV=prod

# Set build-time environment variables
ENV NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV

# Build Next.js application
WORKDIR /app/apps/web
RUN bun run build

# ============================================
# Stage 2: Runner
# ============================================
FROM oven/bun:1.3.5 AS runner

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    dumb-init \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

WORKDIR /app

# Copy standalone build from builder
COPY --from=builder --chown=nodejs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nodejs:nodejs /app/apps/web/public ./apps/web/public

# Set environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Preserve public environment variables
ARG NEXT_PUBLIC_ENV
ENV NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "apps/web/server.js"]
