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

sudo /usr/sbin/sshd
[ -f "/usr/local/bin/box-agent" ] && /usr/local/bin/box-agent &

exec "$@"
EOF

USER coder
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/coder/.bun/bin:$PATH"

WORKDIR /home/coder

VOLUME ["/home/coder/workspace", "/home/coder/.config", "/home/coder/.local", "/home/coder/.cache"]

EXPOSE 22 8080 3000 9999

ENTRYPOINT ["/entrypoint.sh"]
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "password"]
