#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Running All Integration Tests ==="
echo ""

./00-setup.sh
./01-start-local-services.sh
./02-create-box.sh
# Export from script output is manual for now
./03-test-http.sh
# 04-test-ssh.sh is optional
./05-cleanup.sh

echo ""
echo "=== All Tests Complete ==="
