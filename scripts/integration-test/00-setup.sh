#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Integration Test Setup ==="
echo ""

# Load environment
if [ -f config/.env.test ]; then
  source config/.env.test
  echo "✓ Loaded test environment"
else
  echo "✗ config/.env.test not found"
  exit 1
fi

# Create traefik-test network if doesn't exist
echo ""
echo "Checking traefik-test network..."
if ! docker network inspect traefik-test >/dev/null 2>&1; then
  echo "Creating traefik-test network..."
  docker network create traefik-test
  echo "✓ Network created"
else
  echo "✓ Network already exists"
fi

# Build test image with SSH
echo ""
echo "Building enhanced test image (box-test-ssh:latest)..."
docker build -t box-test-ssh:latest fixtures/test-box-with-ssh/
echo "✓ Test image built"

# Create test directories
echo ""
echo "Creating test directories..."
if mkdir -p "$BOX_BASE_DIR" 2>/dev/null; then
  echo "✓ Directory created: $BOX_BASE_DIR"
elif sudo -n mkdir -p "$BOX_BASE_DIR" 2>/dev/null; then
  sudo -n chown $(whoami):$(id -gn) "$BOX_BASE_DIR" 2>/dev/null || sudo -n chown $(whoami):staff "$BOX_BASE_DIR" 2>/dev/null || true
  echo "✓ Directory created: $BOX_BASE_DIR (with sudo)"
else
  echo "⚠ Could not create $BOX_BASE_DIR (no sudo access)"
  echo "  Please manually create: sudo mkdir -p $BOX_BASE_DIR && sudo chown $(whoami) $BOX_BASE_DIR"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next step: Run ./01-start-services.sh to start the test stack"
