#!/usr/bin/env bash
set -euo pipefail

if [ -z "${TEST_BOX_SUBDOMAIN:-}" ]; then
  echo "✗ TEST_BOX_SUBDOMAIN not set"
  echo "  Run: export TEST_BOX_SUBDOMAIN=your-subdomain"
  exit 1
fi

echo "=== Testing HTTP Routing via Traefik ==="
echo ""
echo "Subdomain: $TEST_BOX_SUBDOMAIN"
echo "Testing: curl http://${TEST_BOX_SUBDOMAIN}.agents.localhost:8090/"
echo ""

# Wait a few seconds for Traefik to discover the container
echo "Waiting 10s for Traefik discovery..."
sleep 10

# Test HTTP routing (using .localhost domain - no Host header needed!)
RESPONSE=$(curl -sL -w "\n%{http_code}" http://${TEST_BOX_SUBDOMAIN}.agents.localhost:8090/ 2>&1 || true)
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  echo "✓ HTTP routing works!"
  echo ""
  echo "Response preview:"
  echo "$BODY" | head -20
  echo ""
  echo "Access in browser: http://${TEST_BOX_SUBDOMAIN}.agents.localhost:8090"
  echo "Note: .localhost domains work automatically (RFC 6761)"
else
  echo "✗ HTTP routing failed"
  echo ""
  echo "Response:"
  echo "$BODY"
  echo ""
  echo "Debugging:"
  echo "1. Check Traefik dashboard: http://localhost:8091/dashboard/"
  echo "2. Check container labels: docker inspect \$(docker ps -q --filter label=subdomain=$TEST_BOX_SUBDOMAIN) | jq '.[0].Config.Labels'"
  echo "3. Check container is on traefik-public network"
  exit 1
fi
