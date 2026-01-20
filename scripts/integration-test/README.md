# Integration Testing

Tests the full stack with Sprites (Fly.io) deployment.

## Overview

Production uses Sprites API for VM deployment. Local testing focuses on:

- API endpoints and authentication
- Service logic and workers
- Database operations

**Note:** Box deployment creates real Sprites VMs - test sparingly to avoid costs.

## Prerequisites

- Dev services running:
  - `bun run db:start` (Postgres + Redis)
  - `bun run dev` (API server)
- Valid `SPRITES_TOKEN` in `apps/server/.env`

## Quick Test

```bash
# 1. Start services
bun run db:start
bun run dev

# 2. Login via web UI at http://localhost:33001

# 3. Create a box via UI or API
# Box deploys to Sprites (real VM)

# 4. Access box at https://{subdomain}.sprites.dev
```

## API Testing

```bash
# Health check
curl http://localhost:33000/health

# With auth (get session token from browser devtools)
curl http://localhost:33000/rpc/box/list \
  -H 'Cookie: better-auth.session_token=YOUR_TOKEN'
```

## Architecture

```
Web UI (localhost:33001)
  ↓
API Server (localhost:33000)
  ↓ Queue job
BullMQ Worker
  ↓ Call Sprites API
Sprites (api.sprites.dev)
  ↓ Create VM
Box VM (subdomain.sprites.dev)
```

## Files

```
scripts/integration-test/
├── 00-setup.sh          # Verify prerequisites
├── 02-create-box.sh     # Create box via API
├── 05-cleanup.sh        # Cleanup instructions
└── README.md            # This file
```
