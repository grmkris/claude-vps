# SSH Bastion using sshpiper
# Build context: monorepo root

FROM oven/bun:alpine AS runtime

RUN apk add --no-cache bash openssh-keygen curl

# Download pre-built sshpiper binary + plugins
RUN curl -fsSL https://github.com/tg123/sshpiper/releases/download/v1.5.1/sshpiperd_with_plugins_linux_x86_64.tar.gz \
    | tar -xz -C /tmp && \
    mv /tmp/sshpiperd /usr/local/bin/ && \
    mv /tmp/plugins/* /usr/local/bin/ && \
    rm -rf /tmp/plugins /tmp/LICENSE /tmp/README.md

RUN mkdir -p /etc/sshpiper/workingdir /var/run/sshpiper /app

RUN ssh-keygen -t rsa -b 4096 -f /etc/sshpiper/ssh_host_rsa_key -N "" && \
    ssh-keygen -t ed25519 -f /etc/sshpiper/ssh_host_ed25519_key -N ""

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock turbo.json ./

# Copy all package sources FIRST (enables workspace resolution - fixes bun install hang)
COPY packages ./packages

# Install deps (now has full workspace context)
RUN bun install --filter=@vps-claude/ssh-bastion --ignore-scripts

# Copy entrypoint
COPY packages/ssh-bastion/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/packages/ssh-bastion

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
