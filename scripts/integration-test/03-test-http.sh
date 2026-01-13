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
  echo "Or run 02-create-box.sh and use the exported values"
  exit 1
fi

echo "=== Testing HTTP Routing via Traefik ==="
echo ""
echo "Subdomain:      $TEST_BOX_SUBDOMAIN"
echo "Domain:         $AGENTS_DOMAIN"
echo "Traefik Port:   $TEST_TRAEFIK_HTTP_PORT"
echo ""

# Wait a bit for Traefik to discover the container
echo "Waiting 5s for Traefik discovery..."
sleep 5

# Test HTTP routing with Host header
echo ""
echo "Testing: curl -H 'Host: ${TEST_BOX_SUBDOMAIN}.${AGENTS_DOMAIN}' http://localhost:${TEST_TRAEFIK_HTTP_PORT}/"
echo ""

RESPONSE=$(curl -s -H "Host: ${TEST_BOX_SUBDOMAIN}.${AGENTS_DOMAIN}" http://localhost:${TEST_TRAEFIK_HTTP_PORT}/ || true)

if [ -z "$RESPONSE" ]; then
  echo "✗ No response from Traefik"
  echo ""
  echo "Debugging information:"
  echo "1. Check Traefik dashboard: http://localhost:$TEST_TRAEFIK_DASHBOARD_PORT/dashboard/"
  echo "2. Check container labels: docker inspect ${TEST_BOX_NAME:-test-box-*} | jq '.[0].Config.Labels'"
  echo "3. Check Traefik logs: docker logs test-vps-traefik"
  exit 1
fi

echo "Response:"
echo "$RESPONSE" | jq .

# Check if response contains expected fields
if echo "$RESPONSE" | jq -e '.status == "ok"' >/dev/null; then
  echo ""
  echo "✓ HTTP routing works!"
  echo ""
  echo "Response contains:"
  echo "  - status: ok"
  echo "  - container: $(echo "$RESPONSE" | jq -r '.container')"
  echo "  - path: $(echo "$RESPONSE" | jq -r '.path')"
else
  echo ""
  echo "✗ Unexpected response format"
  exit 1
fi

echo ""
echo "=== HTTP Test Passed ==="
echo ""
echo "Next step: Run ./04-test-ssh.sh to test SSH routing"
