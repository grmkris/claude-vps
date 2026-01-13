#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================"
echo "  Integration Test Suite - Full Run  "
echo "======================================"
echo ""

# Cleanup any previous runs
echo "Pre-cleanup..."
./05-cleanup.sh 2>/dev/null || true
echo ""

# Setup
echo "======================================"
echo "Step 1/5: Setup"
echo "======================================"
./00-setup.sh
echo ""

# Start services
echo "======================================"
echo "Step 2/5: Start Services"
echo "======================================"
./01-start-services.sh
echo ""

# Create test box and capture exports
echo "======================================"
echo "Step 3/5: Create Test Box"
echo "======================================"
BOX_OUTPUT=$(./02-create-box.sh)
echo "$BOX_OUTPUT"

# Extract subdomain and name from output
TEST_BOX_SUBDOMAIN=$(echo "$BOX_OUTPUT" | grep "^export TEST_BOX_SUBDOMAIN=" | cut -d'=' -f2)
TEST_BOX_NAME=$(echo "$BOX_OUTPUT" | grep "^export TEST_BOX_NAME=" | cut -d'=' -f2)

export TEST_BOX_SUBDOMAIN
export TEST_BOX_NAME

echo ""
echo "Exported:"
echo "  TEST_BOX_SUBDOMAIN=$TEST_BOX_SUBDOMAIN"
echo "  TEST_BOX_NAME=$TEST_BOX_NAME"
echo ""

# Test HTTP routing
echo "======================================"
echo "Step 4/5: Test HTTP Routing"
echo "======================================"
./03-test-http.sh
echo ""

# Test SSH routing
echo "======================================"
echo "Step 5/5: Test SSH Routing"
echo "======================================"
./04-test-ssh.sh
echo ""

# Success
echo "======================================"
echo "  ✓ All Tests Passed!  "
echo "======================================"
echo ""
echo "Test environment is still running."
echo "Run ./05-cleanup.sh when you're done."
echo ""
echo "Resources:"
echo "  - Traefik Dashboard: http://localhost:8091/dashboard/"
echo "  - Test Box HTTP: curl -H 'Host: ${TEST_BOX_SUBDOMAIN}.test.local' http://localhost:8090/"
echo "  - Test Box SSH: ssh ${TEST_BOX_SUBDOMAIN}@localhost -p 2222"
