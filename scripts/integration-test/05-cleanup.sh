#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Cleaning Up Integration Test ==="
echo ""

# 1. Stop and remove Traefik
echo "Stopping Traefik..."
docker stop traefik 2>/dev/null || true
docker rm traefik 2>/dev/null || true
echo "✓ Traefik removed"

# 2. Remove box containers
echo ""
echo "Removing box containers..."
BOX_CONTAINERS=$(docker ps -aq --filter "label=app=box" 2>/dev/null || true)
if [ -n "$BOX_CONTAINERS" ]; then
  echo "$BOX_CONTAINERS" | xargs docker rm -f
  echo "✓ Box containers removed"
else
  echo "✓ No box containers found"
fi

# 3. Note about stopping local server
echo ""
echo "⚠ Local server (bun run dev) still running"
echo "  Stop manually if needed: pkill -f 'bun.*apps/server'"

# 4. Clean storage (optional)
echo ""
read -p "Clean storage directory /mnt/devboxes? (y/N): " CLEAN_STORAGE
if [ "${CLEAN_STORAGE,,}" = "y" ]; then
  rm -rf /mnt/devboxes/*
  echo "✓ Storage cleaned"
else
  echo "✓ Storage preserved"
fi

echo ""
echo "=== Cleanup Complete ==="
