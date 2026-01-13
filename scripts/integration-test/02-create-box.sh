#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment
source config/.env.test

BOX_SUBDOMAIN="test-$(date +%s)"
BOX_NAME="test-box-${BOX_SUBDOMAIN}"

echo "=== Deploying Test Box ==="
echo ""
echo "Subdomain:  $BOX_SUBDOMAIN"
echo "Box Name:   $BOX_NAME"
echo "Password:   $DEFAULT_BOX_PASSWORD"
echo ""

# Create box-specific network
NETWORK_NAME="box-${BOX_SUBDOMAIN}-network"
echo "Creating network: $NETWORK_NAME"
docker network create "$NETWORK_NAME"

# Start container with Traefik labels and SSH
echo "Starting container..."
docker run -d \
  --name "$BOX_NAME" \
  --network "$NETWORK_NAME" \
  --hostname "$BOX_SUBDOMAIN" \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.${BOX_SUBDOMAIN}-web.rule=Host(\`${BOX_SUBDOMAIN}.${AGENTS_DOMAIN}\`)" \
  --label "traefik.http.routers.${BOX_SUBDOMAIN}-web.entrypoints=web" \
  --label "traefik.http.services.${BOX_SUBDOMAIN}-web.loadbalancer.server.port=8080" \
  -e "PASSWORD=$DEFAULT_BOX_PASSWORD" \
  -e "HOSTNAME=$BOX_NAME" \
  box-test-ssh:latest

# Connect to traefik-test network (for Traefik discovery and SSH bastion access)
echo "Connecting to traefik-test network..."
docker network connect traefik-test "$BOX_NAME"

# Wait for container to be healthy
echo ""
echo "Waiting for container to be healthy..."
MAX_WAIT=30
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$BOX_NAME" 2>/dev/null || echo "starting")
  if [ "$HEALTH" = "healthy" ]; then
    echo "✓ Container is healthy"
    break
  fi
  echo "Waiting... ($ELAPSED/$MAX_WAIT) - Status: $HEALTH"
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "✗ Container did not become healthy in time"
  echo "Logs:"
  docker logs "$BOX_NAME"
  exit 1
fi

echo ""
echo "=== Box Deployed Successfully ==="
echo ""
echo "Container:  $BOX_NAME"
echo "Subdomain:  $BOX_SUBDOMAIN"
echo "Networks:   $NETWORK_NAME, traefik-test"
echo "HTTP:       http://$BOX_SUBDOMAIN.$AGENTS_DOMAIN (via Traefik on port $TEST_TRAEFIK_HTTP_PORT)"
echo "SSH:        ssh $BOX_SUBDOMAIN@localhost -p $TEST_SSH_PORT"
echo ""
echo "Export these for next tests:"
echo "export TEST_BOX_NAME=$BOX_NAME"
echo "export TEST_BOX_SUBDOMAIN=$BOX_SUBDOMAIN"
