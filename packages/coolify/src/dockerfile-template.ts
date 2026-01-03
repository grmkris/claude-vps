// Base Dockerfile template with placeholders for per-client customization
// Placeholders:
// - {{ADDITIONAL_APT_PACKAGES}} - Space-separated apt packages
// - {{ADDITIONAL_NPM_PACKAGES}} - Space-separated npm packages
// - {{CLAUDE_MD_CONTENT}} - Client-specific CLAUDE.md content

export const DOCKERFILE_TEMPLATE = `FROM codercom/code-server:latest

# Switch to root to install packages
USER root

# Install Node.js, TypeScript, ripgrep, and comprehensive dev tools
RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
    wget \\
    git \\
    unzip \\
    zip \\
    p7zip-full \\
    ca-certificates \\
    sudo \\
    ripgrep \\
    jq \\
    lsof \\
    htop \\
    ncdu \\
    tree \\
    vim \\
    nano \\
    tmux \\
    net-tools \\
    iputils-ping \\
    dnsutils \\
    telnet \\
    nmap \\
    build-essential \\
    python3 \\
    python3-pip \\
    make \\
    zsh \\
    bat \\
    fd-find \\
    silversearcher-ag \\
    fzf \\
    rsync \\
    less \\
    {{ADDITIONAL_APT_PACKAGES}} \\
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
    && apt-get install -y nodejs \\
    && npm install -g typescript @anthropic-ai/claude-code {{ADDITIONAL_NPM_PACKAGES}} \\
    && npm install -g @ast-grep/cli --force \\
    && apt-get clean \\
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Add coder user to sudo group for permission fixes
RUN usermod -aG sudo coder \\
    && echo "coder ALL=(ALL) NOPASSWD: /bin/chown, /bin/mkdir, /bin/chmod" >> /etc/sudoers.d/coder \\
    && echo "coder ALL=(ALL) NOPASSWD: /usr/bin/chown, /usr/bin/mkdir, /usr/bin/chmod" >> /etc/sudoers.d/coder

# Create entrypoint script inline
RUN cat > /entrypoint.sh << 'ENTRYPOINT_EOF'
#!/bin/bash
set -e

echo "Setting up persistent directories..."

for dir in "/home/coder/workspace" "/home/coder/.config" "/home/coder/.local" "/home/coder/.cache"; do
    if [ ! -d "$dir" ]; then
        echo "Creating directory: $dir"
        sudo mkdir -p "$dir"
    fi
    echo "Setting ownership for: $dir"
    sudo chown -R coder:coder "$dir"
done

echo "Setting ownership for /home/coder"
sudo chown -R coder:coder /home/coder

if [ -d "/home/coder/workspace" ] && [ -z "$(ls -A /home/coder/workspace)" ]; then
    echo "Initializing workspace..."
    cat > /home/coder/workspace/README.md << 'README_EOF'
# Welcome to Your Development Environment

This workspace is persistent across container restarts!

## Available Tools
- **jq** - JSON processor
- **lsof** - List open files
- **htop** - Interactive process viewer
- **ncdu** - Disk usage analyzer
- **tree** - Directory tree viewer
- **tmux** - Terminal multiplexer
- **bat** - Better cat with syntax highlighting
- **fd** - Better find
- **ripgrep (rg)** - Fast text search
- **ast-grep (sg)** - AST-based code search
- **fzf** - Fuzzy finder

## Persistent Directories
- /home/coder/workspace - Your projects (this directory)
- /home/coder/.config - Configuration files
- /home/coder/.local - Local binaries and data
- /home/coder/.cache - Cache files
README_EOF
    sudo chown coder:coder /home/coder/workspace/README.md
fi

exec "$@"
ENTRYPOINT_EOF

RUN chmod +x /entrypoint.sh

# Create CLAUDE.md with client-specific content
RUN cat > /home/coder/CLAUDE.md << 'CLAUDE_EOF'
{{CLAUDE_MD_CONTENT}}
CLAUDE_EOF

RUN chown coder:coder /home/coder/CLAUDE.md

# Install Bun for the coder user
USER coder
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/coder/.bun/bin:\$PATH"

# Set working directory
WORKDIR /home/coder

# Define persistent volumes
VOLUME ["/home/coder/workspace"]
VOLUME ["/home/coder/.config"]
VOLUME ["/home/coder/.local"]
VOLUME ["/home/coder/.cache"]

# Expose port 8080 for code-server and 3000 for dev server
EXPOSE 8080 3000

# Set entrypoint and default command
ENTRYPOINT ["/entrypoint.sh"]
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "password"]
`;
