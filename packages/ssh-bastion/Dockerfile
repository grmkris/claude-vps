# SSH Bastion using sshpiper
# Build context: monorepo root

FROM oven/bun:alpine AS runtime

RUN apk add --no-cache bash openssh-keygen curl

# Download pre-built sshpiper binary (go install broken due to replace directives)
RUN curl -fsSL https://github.com/tg123/sshpiper/releases/download/v1.5.1/sshpiperd_with_plugins_linux_x86_64.tar.gz \
    | tar -xz -C /usr/local/bin sshpiperd

RUN mkdir -p /etc/sshpiper/workingdir /var/run/sshpiper /app

RUN ssh-keygen -t rsa -b 4096 -f /etc/sshpiper/ssh_host_rsa_key -N "" && \
    ssh-keygen -t ed25519 -f /etc/sshpiper/ssh_host_ed25519_key -N ""

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock turbo.json ./

# Copy ALL package.json files for workspace resolution
COPY packages/api/package.json ./packages/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/coolify/package.json ./packages/coolify/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/logger/package.json ./packages/logger/
COPY packages/queue/package.json ./packages/queue/
COPY packages/redis/package.json ./packages/redis/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ssh-bastion/package.json ./packages/ssh-bastion/

# Install deps
RUN bun install --frozen-lockfile

# Copy all package sources (needed for workspace deps)
COPY packages ./packages

# Copy entrypoint
COPY packages/ssh-bastion/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/packages/ssh-bastion

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
