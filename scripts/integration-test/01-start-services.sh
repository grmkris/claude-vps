#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Starting Test Services ==="
echo ""

# Load environment
source config/.env.test

# Start services
echo "Starting docker-compose stack..."
docker-compose -f config/docker-compose.test.yml up -d

echo ""
echo "Waiting for services to be healthy..."
echo "This may take 30-60 seconds..."

# Wait for all services to be healthy
MAX_WAIT=120
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  HEALTHY=$(docker-compose -f config/docker-compose.test.yml ps --format json | jq -r '.Health // "healthy"' | grep -c "healthy" || true)
  TOTAL=$(docker-compose -f config/docker-compose.test.yml ps --format json | wc -l | tr -d ' ')

  if [ "$HEALTHY" -eq "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
    echo "✓ All services are healthy!"
    break
  fi

  echo "Waiting... ($ELAPSED/$MAX_WAIT) - $HEALTHY/$TOTAL services healthy"
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "✗ Timeout waiting for services to become healthy"
  echo ""
  echo "Service status:"
  docker-compose -f config/docker-compose.test.yml ps
  exit 1
fi

echo ""
echo "=== Service Status ==="
docker-compose -f config/docker-compose.test.yml ps

echo ""
echo "=== Service URLs ==="
echo "Traefik Dashboard: http://localhost:$TEST_TRAEFIK_DASHBOARD_PORT/dashboard/"
echo "API Server:        http://localhost:$TEST_SERVER_PORT/health"
echo "Postgres:          localhost:$TEST_POSTGRES_PORT"
echo "Redis:             localhost:$TEST_REDIS_PORT"
echo "SSH Bastion:       localhost:$TEST_SSH_PORT"

echo ""
echo "=== Services Started ==="
echo ""
echo "Next step: Run ./02-create-box.sh to deploy a test box"
