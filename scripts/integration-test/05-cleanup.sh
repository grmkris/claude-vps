#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment
source config/.env.test

echo "=== Cleaning Up Test Environment ==="
echo ""

# Stop and remove docker-compose services
echo "Stopping docker-compose services..."
docker-compose -f config/docker-compose.test.yml down -v
echo "✓ Services stopped"

# Remove test containers
echo ""
echo "Removing test containers..."
TEST_CONTAINERS=$(docker ps -aq --filter "name=test-box-" || true)
if [ -n "$TEST_CONTAINERS" ]; then
  echo "$TEST_CONTAINERS" | xargs docker rm -f
  echo "✓ Test containers removed"
else
  echo "✓ No test containers to remove"
fi

# Remove test networks
echo ""
echo "Removing test networks..."
TEST_NETWORKS=$(docker network ls --filter "name=box-test-" -q || true)
if [ -n "$TEST_NETWORKS" ]; then
  echo "$TEST_NETWORKS" | xargs docker network rm
  echo "✓ Test networks removed"
else
  echo "✓ No test networks to remove"
fi

# Optional: Remove traefik-test network
echo ""
read -p "Remove traefik-test network? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  docker network rm traefik-test 2>/dev/null && echo "✓ traefik-test network removed" || echo "✓ Network already removed"
fi

# Clean up test directories
echo ""
echo "Cleaning up test directories..."
if [ -d "$BOX_BASE_DIR" ]; then
  sudo rm -rf "$BOX_BASE_DIR"
  echo "✓ Removed: $BOX_BASE_DIR"
else
  echo "✓ Directory already clean"
fi

echo ""
echo "=== Cleanup Complete ==="
echo ""
echo "To run tests again, start with ./00-setup.sh"
