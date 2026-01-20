#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

echo "=== Starting Local Services ==="
echo ""

# 1. Start Traefik container
echo "Starting Traefik..."
if docker ps --format '{{.Names}}' | grep -q "^traefik$"; then
  echo "✓ Traefik already running"
else
  docker run -d \
    --name traefik \
    --network traefik-public \
    -p 8090:80 \
    -p 8091:8080 \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    traefik:v3.0 \
    --api.insecure=true \
    --providers.docker=true \
    --providers.docker.network=traefik-public \
    --entrypoints.web.address=:80

  echo "✓ Traefik started"
  echo "  HTTP: http://localhost:8090"
  echo "  Dashboard: http://localhost:8091/dashboard/"
fi

# 2. Start local server (bun run dev)
echo ""
echo "Starting local server..."
echo "Running: bun run dev"
echo "(This starts the API server + BullMQ workers on port 33000)"
echo ""
echo "In a new terminal, run:"
echo "  cd /Users/kristjangrm/Code/github-com/vps-claude"
echo "  bun run dev"
echo ""
echo "Or run in background (requires manual kill later):"
echo "  bun run dev > /tmp/server.log 2>&1 &"
echo ""
read -p "Press ENTER once server is running and healthy..."

# 3. Wait for server to be healthy
echo ""
echo "Checking server health..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -sf http://localhost:33000/health > /dev/null 2>&1; then
    echo "✓ Server healthy: http://localhost:33000/health"
    break
  fi
  RETRY=$((RETRY + 1))
  if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "✗ Server not responding after 30s"
    exit 1
  fi
  sleep 1
done

echo ""
echo "=== Services Running ==="
echo ""
echo "✓ Traefik: http://localhost:8090 (dashboard: http://localhost:8091/dashboard/)"
echo "✓ Server: http://localhost:33000"
echo ""
echo "Next step: ./02-create-box.sh"
