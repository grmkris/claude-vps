FROM ubuntu:22.04

ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    nginx \
    supervisor \
    sudo \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && chmod +x /usr/local/bin/bun

# Install Claude Code CLI (installs to ~/.local/bin/claude)
# Copy actual binary to accessible locations (symlinks won't work due to /root permissions)
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && mkdir -p /.sprite/bin \
    && cp -L /root/.local/bin/claude /usr/local/bin/claude \
    && cp -L /root/.local/bin/claude /.sprite/bin/claude \
    && chmod +x /usr/local/bin/claude /.sprite/bin/claude

# Create box user with sudo access
RUN useradd -m -s /bin/bash box \
    && echo "box ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Create required directories
RUN mkdir -p \
    /home/box/.inbox \
    /home/box/.box-agent \
    /home/box/.claude/skills \
    /home/box/.local/bin \
    /var/log/supervisor \
    /etc/supervisor/conf.d \
    && chown -R box:box /home/box

# Add box user's local bin to PATH
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/box/.bashrc

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default supervisor config with proper sections
RUN cat > /etc/supervisor/supervisord.conf << 'EOF'
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[unix_http_server]
file=/var/run/supervisor.sock

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[include]
files = /etc/supervisor/conf.d/*.conf
EOF

EXPOSE 8080
WORKDIR /home/box

ENTRYPOINT ["/entrypoint.sh"]
