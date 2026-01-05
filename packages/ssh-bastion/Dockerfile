# SSH Bastion using sshpiper
# This routes SSH connections to the appropriate box container

FROM golang:1.22-alpine AS builder

# Install sshpiper
RUN go install github.com/tg123/sshpiper/cmd/sshpiperd@latest

FROM oven/bun:alpine AS runtime

# Install dependencies
RUN apk add --no-cache \
    bash \
    openssh-keygen

# Copy sshpiper binary
COPY --from=builder /go/bin/sshpiperd /usr/local/bin/sshpiperd

# Create directories
RUN mkdir -p /etc/sshpiper/workingdir /var/run/sshpiper /app

# Generate host keys
RUN ssh-keygen -t rsa -b 4096 -f /etc/sshpiper/ssh_host_rsa_key -N "" && \
    ssh-keygen -t ed25519 -f /etc/sshpiper/ssh_host_ed25519_key -N ""

# Copy app source
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY src ./src

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
