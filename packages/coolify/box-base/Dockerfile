# syntax=docker/dockerfile:1
FROM codercom/code-server:latest

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git unzip zip p7zip-full ca-certificates sudo ripgrep jq lsof htop ncdu tree \
    vim nano tmux net-tools iputils-ping dnsutils telnet nmap build-essential python3 python3-pip \
    make zsh bat fd-find silversearcher-ag fzf rsync less openssh-server \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g typescript @anthropic-ai/claude-code \
    && npm install -g @ast-grep/cli --force \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv \
    && chmod +x /usr/local/bin/uv

RUN usermod -aG sudo coder \
    && echo "coder ALL=(ALL) NOPASSWD: /bin/chown, /bin/mkdir, /bin/chmod" >> /etc/sudoers.d/coder \
    && echo "coder ALL=(ALL) NOPASSWD: /usr/bin/chown, /usr/bin/mkdir, /usr/bin/chmod" >> /etc/sudoers.d/coder

RUN mkdir -p /var/run/sshd \
    && ssh-keygen -A \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config \
    && echo "AllowUsers coder" >> /etc/ssh/sshd_config

RUN mkdir -p /home/coder/workspace-init /home/coder/.inbox /home/coder/.inbox/.archive /home/coder/.box-agent

RUN curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && chmod +x /usr/local/bin/bun

# Copy workspace files needed for box-agent build
COPY package.json bun.lock /tmp/build/
COPY packages/config /tmp/build/packages/config
COPY apps/box-agent /tmp/build/apps/box-agent

# Build box-agent with workspace context
RUN cd /tmp/build \
    && bun install --filter=box-agent \
    && cd apps/box-agent \
    && bun build --compile --minify ./src/server.ts --outfile /usr/local/bin/box-agent \
    && chmod +x /usr/local/bin/box-agent \
    && rm -rf /tmp/build

COPY --chown=coder:coder <<EOF /home/coder/workspace-init/README.md
# Development Environment

Persistent workspace with Claude Code, ripgrep, ast-grep, jq, htop, tmux, fzf, and standard dev tools.

Volumes: ~/workspace, ~/.config, ~/.local, ~/.cache
EOF

COPY --chmod=755 <<'EOF' /usr/local/bin/setup-takopi
#!/bin/bash
# Installs Takopi (if needed) and generates config from environment variables

# Exit if no Telegram token configured
[ -z "$TAKOPI_BOT_TOKEN" ] && exit 0

# Install Takopi if not already installed (lazy installation)
if [ ! -f "/home/coder/.local/bin/takopi" ]; then
    echo "Installing Takopi (first run, ~30s)..."
    /usr/local/bin/uv python install 3.14
    /usr/local/bin/uv tool install -U takopi
fi

# Generate Takopi config
mkdir -p /home/coder/.takopi

cat > /home/coder/.takopi/takopi.toml <<TOML
default_engine = "claude"
watch_config = false
transport = "telegram"

[transports.telegram]
bot_token = "$TAKOPI_BOT_TOKEN"
chat_id = ${TAKOPI_CHAT_ID:-0}
voice_transcription = true

[transports.telegram.files]
enabled = true
auto_put = true

[claude]
model = "sonnet"
use_api_billing = false

[projects.workspace]
path = "/home/coder/workspace"
default_engine = "claude"
TOML

chown -R coder:coder /home/coder/.takopi /home/coder/.local
EOF

COPY --chmod=755 <<'EOF' /entrypoint.sh
#!/bin/bash
set -e

for dir in /home/coder/{workspace,.config,.local,.cache}; do
    [ -d "$dir" ] || sudo mkdir -p "$dir"
    sudo chown -R coder:coder "$dir"
done
sudo chown -R coder:coder /home/coder

[ -d "/home/coder/workspace" ] && [ -z "$(ls -A /home/coder/workspace)" ] && \
    cp /home/coder/workspace-init/README.md /home/coder/workspace/

[ -n "$PASSWORD" ] && echo "coder:$PASSWORD" | sudo chpasswd

# Install Takopi (if needed) and generate config
/usr/local/bin/setup-takopi

sudo /usr/sbin/sshd
[ -f "/usr/local/bin/box-agent" ] && /usr/local/bin/box-agent &

# Start Takopi if configured (PATH includes ~/.local/bin from setup-takopi)
[ -n "$TAKOPI_BOT_TOKEN" ] && cd /home/coder/workspace && /home/coder/.local/bin/takopi &

exec "$@"
EOF

USER coder
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/coder/.bun/bin:/home/coder/.local/bin:$PATH"

WORKDIR /home/coder

VOLUME ["/home/coder/workspace", "/home/coder/.config", "/home/coder/.local", "/home/coder/.cache"]

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:8080/healthz || exit 1

EXPOSE 22 8080 3000 9999

ENTRYPOINT ["/entrypoint.sh"]
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "password"]
