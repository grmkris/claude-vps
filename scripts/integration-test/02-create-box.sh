#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

echo "=== Creating Box via SDK ==="
echo ""

# Run SDK script from packages/sdk
cd packages/sdk
BOX_INFO=$(API_URL=http://api.localhost:33000 bun run scripts/create-integration-box.ts 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "✗ Box creation failed"
  echo "$BOX_INFO"
  exit 1
fi

# Extract subdomain from output
TEST_BOX_SUBDOMAIN=$(echo "$BOX_INFO" | grep "Subdomain:" | awk '{print $2}')

if [ -z "$TEST_BOX_SUBDOMAIN" ]; then
  echo "✗ Could not extract subdomain"
  echo "$BOX_INFO"
  exit 1
fi

echo "$BOX_INFO"
echo ""
echo "To run HTTP test:"
echo "export TEST_BOX_SUBDOMAIN=$TEST_BOX_SUBDOMAIN"
echo "cd ../../scripts/integration-test && ./03-test-http.sh"
