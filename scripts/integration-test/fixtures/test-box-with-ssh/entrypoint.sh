#!/bin/bash
set -e

# Set password for coder user from PASSWORD env var
if [ -n "$PASSWORD" ]; then
  echo "coder:$PASSWORD" | chpasswd
  echo "Password set for coder user"
else
  echo "coder:test123" | chpasswd
  echo "Default password (test123) set for coder user"
fi

# Start SSH daemon
echo "Starting SSH daemon..."
/usr/sbin/sshd

# Start HTTP server
echo "Starting HTTP server on port 8080..."
exec node /usr/local/bin/server.js
