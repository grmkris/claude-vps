#!/bin/bash
# Setup script for sprite services with agent-app support
#
# This script configures:
# - nginx as reverse proxy (port 8080)
# - box-agent HTTP server (port 9999)
# - agent-app Next.js server (port 3000)
# - mcp-agent-app MCP server (stdio, for Claude)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="/home/coder"
AGENT_APP_DIR="${HOME_DIR}/agent-app"

echo "Setting up sprite services..."

# Install nginx if not present
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    sudo apt-get update && sudo apt-get install -y nginx
fi

# Copy nginx config
echo "Configuring nginx..."
sudo cp "${SCRIPT_DIR}/agent-proxy.conf" /etc/nginx/nginx.conf

# Test nginx config
sudo nginx -t

# Create agent-app data directory
mkdir -p "${AGENT_APP_DIR}/data"

# Install MCP server binary
if [ -f "${HOME_DIR}/.local/bin/mcp-agent-app" ]; then
    echo "MCP server already installed"
else
    echo "Note: MCP server binary should be installed at ${HOME_DIR}/.local/bin/mcp-agent-app"
fi

# Configure Claude to use the MCP server
CLAUDE_SETTINGS="${HOME_DIR}/.claude/settings.json"
SPRITE_CONFIG_DIR="$(dirname "${SCRIPT_DIR}")/sprite"

if [ -f "${SPRITE_CONFIG_DIR}/claude-settings.json" ]; then
    echo "Installing Claude settings with MCP server..."
    mkdir -p "$(dirname "${CLAUDE_SETTINGS}")"
    cp "${SPRITE_CONFIG_DIR}/claude-settings.json" "${CLAUDE_SETTINGS}"
elif [ ! -f "${CLAUDE_SETTINGS}" ]; then
    echo "Creating Claude settings with MCP server..."
    mkdir -p "$(dirname "${CLAUDE_SETTINGS}")"
    cat > "${CLAUDE_SETTINGS}" << 'EOF'
{
  "mcpServers": {
    "agent-app": {
      "command": "/home/coder/.local/bin/mcp-agent-app",
      "env": {
        "AGENT_APP_DIR": "/home/coder/agent-app"
      }
    }
  }
}
EOF
fi

# Copy CLAUDE.md template to agent-app if it doesn't exist
AGENT_APP_CLAUDE="${AGENT_APP_DIR}/CLAUDE.md"
if [ ! -f "${AGENT_APP_CLAUDE}" ] && [ -f "${SPRITE_CONFIG_DIR}/agent-app-CLAUDE.md.template" ]; then
    echo "Installing CLAUDE.md template to agent-app..."
    cp "${SPRITE_CONFIG_DIR}/agent-app-CLAUDE.md.template" "${AGENT_APP_CLAUDE}"
fi

echo ""
echo "Setup complete!"
echo ""
echo "Services:"
echo "  - nginx: port 8080 (reverse proxy)"
echo "  - box-agent: port 9999 (agent HTTP API)"
echo "  - agent-app: port 3000 (Next.js app)"
echo ""
echo "URL routes:"
echo "  /          → agent-app (Next.js)"
echo "  /email/*   → box-agent (webhooks)"
echo "  /agent/*   → box-agent (API)"
echo "  /health    → box-agent (health check)"
echo ""
echo "MCP Server configured at: ${HOME_DIR}/.local/bin/mcp-agent-app"
echo ""
echo "To start services:"
echo "  sudo systemctl start nginx"
echo "  # or use sprite-env if available"
