#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

echo "=== Integration Test Setup ==="
echo ""

# 1. Verify dev services
echo "Verifying dev services..."
if nc -z localhost 54325 2>/dev/null; then
  echo "✓ Postgres accessible on port 54325"
else
  echo "⚠ Postgres not accessible on port 54325"
  echo "  Start with: bun run db:start"
fi

if nc -z localhost 63833 2>/dev/null; then
  echo "✓ Redis accessible on port 63833"
else
  echo "⚠ Redis not accessible on port 63833"
  echo "  Start with: bun run db:start"
fi

# 2. Check SPRITES_TOKEN
echo ""
echo "Checking environment..."
if [ -f apps/server/.env ]; then
  if grep -q "SPRITES_TOKEN=your-sprites-token-here" apps/server/.env 2>/dev/null; then
    echo "⚠ SPRITES_TOKEN not configured in apps/server/.env"
    echo "  Get a token from sprites.dev and add it"
  elif grep -q "SPRITES_TOKEN=" apps/server/.env 2>/dev/null; then
    echo "✓ SPRITES_TOKEN configured"
  else
    echo "⚠ SPRITES_TOKEN missing from apps/server/.env"
  fi
else
  echo "⚠ apps/server/.env not found"
  echo "  Copy from .env.example"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. bun run db:start"
echo "  2. bun run dev"
echo "  3. Create box via http://localhost:33001"
