FROM node:20-alpine

# Install SSH server and utilities
RUN apk add --no-cache \
    openssh-server \
    bash \
    curl \
    shadow

# Setup SSH
RUN ssh-keygen -A && \
    mkdir -p /run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

# Setup coder user (node:20-alpine already has uid:gid 1000:1000 as 'node' user)
# We'll rename 'node' user to 'coder' and setup its home directory
RUN deluser --remove-home node 2>/dev/null || true && \
    addgroup -g 1000 coder && \
    adduser -D -u 1000 -G coder -s /bin/bash -h /home/coder coder && \
    mkdir -p /home/coder/workspace && \
    chown -R coder:coder /home/coder

# Simple HTTP server
COPY simple-server.js /usr/local/bin/server.js

# Entrypoint sets password and starts services
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22 8080

HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
