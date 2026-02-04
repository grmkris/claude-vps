#!/bin/bash
set -e

echo "=== Box Container Starting ==="

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  BINARY_SUFFIX="linux-arm64"
else
  BINARY_SUFFIX="linux-x64"
fi

echo "Architecture: $ARCH -> $BINARY_SUFFIX"

# Default URL for box-agent binary
BOX_AGENT_URL="${BOX_AGENT_BINARY_URL:-https://github.com/grmkris/claude-vps/releases/latest/download/box-agent-${BINARY_SUFFIX}}"

# Download box-agent if not present or if BOX_AGENT_BINARY_URL is set (force update)
if [ ! -f /usr/local/bin/box-agent ] || [ -n "$BOX_AGENT_BINARY_URL" ]; then
  echo "Downloading box-agent from $BOX_AGENT_URL..."
  if curl -fsSL "$BOX_AGENT_URL" -o /usr/local/bin/box-agent; then
    chmod +x /usr/local/bin/box-agent
    echo "box-agent installed successfully"
  else
    echo "WARNING: Failed to download box-agent, continuing without it"
  fi
fi

# Source environment file if it exists
if [ -f /home/box/.bashrc.env ]; then
  echo "Sourcing environment from /home/box/.bashrc.env"
  source /home/box/.bashrc.env
fi

# Ensure box user owns their home directory
chown -R box:box /home/box

echo "Starting supervisor..."
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
