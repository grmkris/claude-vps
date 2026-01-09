#!/bin/bash
set -e

echo "Starting SSH Bastion..."
echo "Host keys:"
ls -la /etc/sshpiper/

# Start the sync service in background
cd /app/packages/ssh-bastion && bun run src/sync.ts &

# Start sshpiper with workingdir plugin
# Users connect as: ssh subdomain@ssh.domain.com
# sshpiper looks up /etc/sshpiper/workingdir/{username}/sshpiper.yaml
exec /usr/local/bin/sshpiperd \
    --log-level debug \
    --server-key /etc/sshpiper/ssh_host_rsa_key \
    --server-key /etc/sshpiper/ssh_host_ed25519_key \
    workingdir \
    --root /etc/sshpiper/workingdir
