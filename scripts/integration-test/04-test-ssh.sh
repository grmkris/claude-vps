#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment
source config/.env.test

if [ -z "${TEST_BOX_SUBDOMAIN:-}" ]; then
  echo "✗ ERROR: TEST_BOX_SUBDOMAIN not set"
  echo ""
  echo "Run: export TEST_BOX_SUBDOMAIN=<subdomain>"
  exit 1
fi

if [ -z "${TEST_BOX_NAME:-}" ]; then
  echo "✗ ERROR: TEST_BOX_NAME not set"
  echo ""
  echo "Run: export TEST_BOX_NAME=<container-name>"
  exit 1
fi

echo "=== Testing SSH Routing via Bastion ==="
echo ""
echo "Subdomain:      $TEST_BOX_SUBDOMAIN"
echo "Container:      $TEST_BOX_NAME"
echo "SSH Port:       $TEST_SSH_PORT"
echo "Password:       $DEFAULT_BOX_PASSWORD"
echo ""

# Wait for SSH bastion to sync
echo "Waiting 10s for SSH bastion sync (interval: ${SYNC_INTERVAL_MS}ms)..."
sleep 10

# Check if sshpiper config exists
echo ""
echo "Checking sshpiper config..."
if docker exec test-vps-ssh-bastion ls /etc/sshpiper/workingdir/ 2>/dev/null | grep -q "$TEST_BOX_SUBDOMAIN"; then
  echo "✓ Config directory exists for: $TEST_BOX_SUBDOMAIN"

  echo ""
  echo "Config contents:"
  docker exec test-vps-ssh-bastion cat /etc/sshpiper/workingdir/${TEST_BOX_SUBDOMAIN}/sshpiper.yaml || echo "✗ Config file not found"
else
  echo "✗ No config found for subdomain: $TEST_BOX_SUBDOMAIN"
  echo ""
  echo "Available configs:"
  docker exec test-vps-ssh-bastion ls -la /etc/sshpiper/workingdir/ || echo "✗ Cannot list configs"
  echo ""
  echo "SSH bastion logs:"
  docker logs --tail 20 test-vps-ssh-bastion
  exit 1
fi

# Attempt SSH connection
echo ""
echo "Attempting SSH connection..."
echo "Command: ssh -o StrictHostKeyChecking=no -o BatchMode=no -p $TEST_SSH_PORT ${TEST_BOX_SUBDOMAIN}@localhost whoami"
echo ""

# Use sshpass if available for non-interactive password auth
if command -v sshpass >/dev/null 2>&1; then
  echo "Using sshpass for authentication..."
  RESULT=$(sshpass -p "$DEFAULT_BOX_PASSWORD" ssh -o StrictHostKeyChecking=no -o BatchMode=yes -p $TEST_SSH_PORT "${TEST_BOX_SUBDOMAIN}@localhost" whoami 2>&1 || true)
else
  echo "sshpass not found, trying interactive SSH (you'll need to enter password: $DEFAULT_BOX_PASSWORD)"
  RESULT=$(ssh -o StrictHostKeyChecking=no -p $TEST_SSH_PORT "${TEST_BOX_SUBDOMAIN}@localhost" whoami 2>&1 || true)
fi

echo "Result: $RESULT"
echo ""

if echo "$RESULT" | grep -q "coder"; then
  echo "✓ SSH routing works!"
  echo "✓ Successfully connected as: coder"
else
  echo "✗ SSH connection failed or unexpected result"
  echo ""
  echo "Debugging information:"
  echo "1. Check SSH bastion logs: docker logs test-vps-ssh-bastion"
  echo "2. Check container SSH: docker exec $TEST_BOX_NAME pgrep sshd"
  echo "3. Verify password: $DEFAULT_BOX_PASSWORD"
  exit 1
fi

echo ""
echo "=== SSH Test Passed ==="
echo ""
echo "Next step: Run ./05-cleanup.sh to clean up test environment"
