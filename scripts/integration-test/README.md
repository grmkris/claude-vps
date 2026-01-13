# Integration Testing: Traefik + SSH + Proxy

Manual testing scripts to verify that Traefik HTTP routing and SSH bastion routing work correctly with real Docker containers.

## Overview

This test suite validates the complete integration of:
- **Traefik** reverse proxy for HTTP routing
- **SSH bastion** (sshpiper) for SSH access
- **Docker Engine** container management
- **API Server** with BullMQ workers
- **PostgreSQL** and **Redis** dependencies

## Prerequisites

- Docker Engine 24+ installed and running
- docker-compose installed
- `jq` for JSON parsing: `brew install jq` (macOS) or `apt install jq` (Ubuntu)
- (Optional) `sshpass` for non-interactive SSH testing: `brew install sshpass` (macOS)
- At least 4GB free RAM
- Ports available: 54326, 63834, 33010, 8090, 8091, 2222

## Quick Start

### Run All Tests

```bash
cd scripts/integration-test
./test-all.sh
```

This will:
1. Setup environment and build images
2. Start all services (Postgres, Redis, Server, Traefik, SSH Bastion)
3. Deploy a test box
4. Test HTTP routing via Traefik
5. Test SSH routing via bastion
6. Leave environment running for inspection

### Manual Step-by-Step

```bash
# 1. One-time setup
./00-setup.sh

# 2. Start services
./01-start-services.sh

# 3. Deploy test box (save exports)
./02-create-box.sh
export TEST_BOX_SUBDOMAIN=test-1234567890
export TEST_BOX_NAME=test-box-test-1234567890

# 4. Test HTTP
./03-test-http.sh

# 5. Test SSH
./04-test-ssh.sh

# 6. Cleanup when done
./05-cleanup.sh
```

## Scripts Reference

### 00-setup.sh
**Purpose:** One-time setup for test environment

**Actions:**
- Creates `traefik-test` Docker network
- Builds `box-test-ssh:latest` image with SSH daemon
- Creates `/tmp/vps-test-boxes` directory

**Run once:** Before first test run or after cleanup

### 01-start-services.sh
**Purpose:** Start docker-compose stack

**Services Started:**
- PostgreSQL (port 54326)
- Redis (port 63834)
- API Server (port 33010)
- Traefik (ports 8090 HTTP, 8091 dashboard)
- SSH Bastion (port 2222)

**Wait Time:** 30-60 seconds for all services to become healthy

### 02-create-box.sh
**Purpose:** Deploy a test box container

**Creates:**
- Box-specific Docker network
- Container with SSH + HTTP server
- Traefik routing labels
- Connections to traefik-test network

**Outputs:** Environment variables to export for next tests

### 03-test-http.sh
**Purpose:** Verify HTTP routing through Traefik

**Tests:**
- Traefik receives request with Host header
- Routes to correct container
- Container responds with JSON

**Requires:** `TEST_BOX_SUBDOMAIN` environment variable

### 04-test-ssh.sh
**Purpose:** Verify SSH routing through bastion

**Tests:**
- SSH bastion polls API and generates config
- sshpiper config file exists
- SSH connection routes to container
- Authentication works

**Requires:** `TEST_BOX_SUBDOMAIN` and `TEST_BOX_NAME` environment variables

### 05-cleanup.sh
**Purpose:** Tear down test environment

**Removes:**
- docker-compose services and volumes
- Test box containers
- Test networks
- Test directories

**Optional:** Keep traefik-test network for next run

### test-all.sh
**Purpose:** Run complete test suite

**Executes:** All scripts in sequence with proper environment setup

## Test Ports

| Service | Dev Port | Test Port | Purpose |
|---------|----------|-----------|---------|
| Postgres | 54325 | 54326 | Database |
| Redis | 63833 | 63834 | Cache/Queue |
| API Server | 33000 | 33010 | Hono API |
| Traefik HTTP | - | 8090 | Reverse proxy |
| Traefik Dashboard | - | 8091 | Web UI |
| SSH Bastion | - | 2222 | SSH proxy |

## Configuration

All configuration is in `config/.env.test`:
- Test credentials: `test-password`, `test-internal-key-32-chars-minimum-length`
- Default SSH password: `test123`
- Test domain: `test.local`
- Base image: `box-test-ssh:latest`

## Expected Output

### HTTP Test Success
```bash
$ ./03-test-http.sh
=== Testing HTTP Routing via Traefik ===

Subdomain:      test-1234567890
Domain:         test.local
Traefik Port:   8090

Testing: curl -H 'Host: test-1234567890.test.local' http://localhost:8090/

Response:
{
  "status": "ok",
  "container": "test-box-1234567890",
  "path": "/",
  "headers": {
    "host": "test-1234567890.test.local"
  }
}

✓ HTTP routing works!
```

### SSH Test Success
```bash
$ ./04-test-ssh.sh
=== Testing SSH Routing via Bastion ===

Subdomain:      test-1234567890
Container:      test-box-1234567890
SSH Port:       2222

Waiting 10s for SSH bastion sync...
✓ Config directory exists for: test-1234567890

Attempting SSH connection...
Result: coder

✓ SSH routing works!
✓ Successfully connected as: coder
```

## Debugging

### Traefik Dashboard
View routing configuration and active routers:
```bash
open http://localhost:8091/dashboard/
```

### Service Logs
```bash
# API Server
docker logs test-vps-server

# Traefik
docker logs test-vps-traefik

# SSH Bastion
docker logs test-vps-ssh-bastion

# Test Box
docker logs test-box-<subdomain>
```

### Check Container Labels
```bash
docker inspect test-box-<subdomain> | jq '.[0].Config.Labels'
```

### Check Networks
```bash
docker network inspect traefik-test
```

### Check SSH Config
```bash
docker exec test-vps-ssh-bastion ls -la /etc/sshpiper/workingdir/
docker exec test-vps-ssh-bastion cat /etc/sshpiper/workingdir/<subdomain>/sshpiper.yaml
```

## Troubleshooting

### "No response from Traefik"
1. Check Traefik is running: `docker ps | grep traefik`
2. Verify container has labels: `docker inspect <container> | jq '.[0].Config.Labels'`
3. Check container is on traefik-test network: `docker network inspect traefik-test`
4. View Traefik logs: `docker logs test-vps-traefik`
5. Visit dashboard: http://localhost:8091/dashboard/

### "No SSH config found"
1. Wait longer (SSH bastion syncs every 5s)
2. Check SSH bastion logs: `docker logs test-vps-ssh-bastion`
3. Verify server is healthy: `curl http://localhost:33010/health`
4. Check API endpoint: `curl -H "Authorization: Bearer test-internal-key-32-chars-minimum-length" http://localhost:33010/rpc/platform/ssh/boxes`

### "SSH connection failed"
1. Verify SSH daemon running in container: `docker exec <container> pgrep sshd`
2. Check password is correct: `test123` (from .env.test)
3. Try with sshpass: `sshpass -p test123 ssh -p 2222 <subdomain>@localhost whoami`
4. Check container logs: `docker logs <container>`

### Port Already in Use
If ports are already allocated:
1. Check what's using the port: `lsof -i :8090`
2. Stop conflicting services
3. Or edit `config/.env.test` to use different ports

### Services Not Healthy
If services timeout waiting for health:
1. Check logs: `docker-compose -f config/docker-compose.test.yml logs`
2. Check resource usage: `docker stats`
3. Increase timeout in `01-start-services.sh`

### Cleanup Issues
If cleanup fails:
```bash
# Force remove all test containers
docker ps -a | grep test | awk '{print $1}' | xargs docker rm -f

# Force remove all test networks
docker network ls | grep test | awk '{print $1}' | xargs docker network rm

# Manual cleanup
sudo rm -rf /tmp/vps-test-boxes
```

## Architecture

### Network Topology
```
test-vps-internal (bridge)
  ├── postgres
  ├── redis
  ├── server
  └── ssh-bastion

traefik-test (bridge)
  ├── traefik
  ├── server (also on internal)
  ├── ssh-bastion (also on internal)
  └── box containers
```

### Traffic Flow: HTTP
```
curl with Host header → localhost:8090 (Traefik)
  → Traefik matches label: Host(`subdomain.test.local`)
  → Routes to container:8080
  → Simple HTTP server responds
```

### Traffic Flow: SSH
```
ssh subdomain@localhost:2222 → SSH Bastion (sshpiper)
  → Reads config: /etc/sshpiper/workingdir/subdomain/sshpiper.yaml
  → Routes to container-name:22 (Docker DNS)
  → Container sshd authenticates with password
  → Shell access as 'coder' user
```

## Next Steps

### Phase 2: Automated Tests
Convert these manual scripts to Bun integration tests:
- Start/stop docker-compose from tests
- Assertions instead of manual verification
- Run in CI/CD (GitHub Actions)

### Production Deployment
Use this test environment as reference for production:
- Replace test domain with real domain
- Add TLS/HTTPS (Let's Encrypt)
- Use production credentials
- Deploy on dedicated server

## Files

```
scripts/integration-test/
├── config/
│   ├── docker-compose.test.yml    # Service definitions
│   └── .env.test                  # Configuration
├── fixtures/
│   └── test-box-with-ssh/         # Enhanced test image
│       ├── Dockerfile
│       ├── entrypoint.sh
│       └── simple-server.js
├── 00-setup.sh                    # Setup
├── 01-start-services.sh           # Start stack
├── 02-create-box.sh               # Deploy box
├── 03-test-http.sh                # Test HTTP
├── 04-test-ssh.sh                 # Test SSH
├── 05-cleanup.sh                  # Cleanup
├── test-all.sh                    # Run all
└── README.md                      # This file
```

## FAQ

**Q: Can I run this alongside dev environment?**
A: Yes, all ports are offset to avoid conflicts.

**Q: Do I need to run migrations?**
A: No, the server container runs migrations automatically on startup.

**Q: Can I connect to test services?**
A: Yes, all services expose ports locally:
- Postgres: `psql -h localhost -p 54326 -U postgres vps-claude-test`
- Redis: `redis-cli -p 63834`
- API: `curl http://localhost:33010/health`

**Q: How long do tests take?**
A: ~2-3 minutes for full run (setup + tests).

**Q: Can I skip cleanup?**
A: Yes, environment persists for manual testing. Run cleanup when done.

**Q: What if I need to debug a test?**
A: Run scripts individually and use `docker logs` / `docker exec` to inspect.

## Support

Issues or questions:
- Check logs first: `docker-compose -f config/docker-compose.test.yml logs`
- Review Troubleshooting section above
- Check Traefik dashboard: http://localhost:8091/dashboard/
