#!/bin/bash
set -e

# Ensure directories exist with correct permissions
for dir in /home/coder/{workspace,.config,.local,.cache,.inbox}; do
    [ -d "$dir" ] || sudo mkdir -p "$dir"
    sudo chown -R coder:coder "$dir"
done
sudo chown -R coder:coder /home/coder

# Initialize workspace with README if empty
[ -d "/home/coder/workspace" ] && [ -z "$(ls -A /home/coder/workspace)" ] && \
    cp /home/coder/workspace-init/README.md /home/coder/workspace/ 2>/dev/null || true

# Set password from environment variable
[ -n "$PASSWORD" ] && echo "coder:$PASSWORD" | sudo chpasswd

# Install Takopi if needed (lazy installation)
/usr/local/bin/setup-takopi

# Start SSH daemon
sudo /usr/sbin/sshd

# Start box-agent in background
[ -f "/usr/local/bin/box-agent" ] && /usr/local/bin/box-agent &

# Start Takopi if configured
[ -n "$TAKOPI_BOT_TOKEN" ] && cd /home/coder/workspace && /home/coder/.local/bin/takopi &

# Start code-server
exec "$@"
