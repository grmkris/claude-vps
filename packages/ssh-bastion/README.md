# SSH Bastion

SSH reverse proxy using [sshpiper](https://github.com/tg123/sshpiper) for routing connections to box containers.

## Architecture

### The Problem

Boxes run as Docker containers via Docker Engine. Each has SSH on port 22, but:

- Containers don't have public IPs
- Can't expose port 22 for each box (port collision)
- Traefik proxy handles HTTP/HTTPS, not raw TCP/SSH

### The Solution: SSH Reverse Proxy

sshpiper is like nginx but for SSH. One entry point, routes to many backends.

```
                    INTERNET
                        │
                        ▼ port 22
┌───────────────────────────────────────────────────────┐
│               SSH BASTION (sshpiper)                  │
│                                                       │
│   User connects: ssh my-box-a1b2@ssh.grm.wtf         │
│                                                       │
│   sshpiper extracts username: "my-box-a1b2"          │
│   Looks in /workingdir/my-box-a1b2/sshpiper.yaml     │
│   Finds: route to container "my-box-a1b2-uuid:22"    │
│   Proxies the connection                              │
└───────────────────────┬───────────────────────────────┘
                        │
        Docker Network ("traefik-public" network)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │ box-a   │    │ box-b   │    │ box-c   │
   │ :22     │    │ :22     │    │ :22     │
   └─────────┘    └─────────┘    └─────────┘
```

### The Network

Docker Engine manages the network topology. When `connect_to_docker_network: true` is enabled:

```
┌─────────────────────────────────────────────────────┐
│           TRAEFIK DOCKER NETWORK                    │
│                                                     │
│   ┌──────────────┐  DNS: my-box-a1b2-uuid          │
│   │   Box A      │◄─────────────────────┐          │
│   │   :22        │                      │          │
│   └──────────────┘                      │          │
│                                         │          │
│   ┌──────────────┐                      │          │
│   │   Box B      │         ┌────────────┴───────┐  │
│   │   :22        │         │   SSH Bastion      │  │
│   └──────────────┘         │   (sshpiper)       │  │
│                            │                    │  │
│   ┌──────────────┐         │   Can reach any    │  │
│   │   Box C      │◄────────│   container by     │  │
│   │   :22        │         │   name:port        │  │
│   └──────────────┘         └────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Containers on the same Docker network can reach each other by name. The bastion does:

```
ssh connection → my-box-a1b2-uuid:22
```

Docker's internal DNS resolves the name to the container's IP.

### How sync.ts Works

The sync service is implemented in TypeScript/Bun (`src/sync.ts`).

```bash
# Every 30 seconds:
1. Call API: GET /platform/ssh/boxes
   Response: [
     { subdomain: "my-box-a1b2", containerName: "my-box-a1b2-uuid" },
     { subdomain: "other-box", containerName: "other-box-xyz" }
   ]

2. For each box, create directory + config:
   /workingdir/my-box-a1b2/sshpiper.yaml:

   to:
     host: "my-box-a1b2-uuid"
     port: 22
     username: "coder"

3. sshpiper reads these on each connection
```

## Deployment

### Step 1: Build the Docker Image

Build locally and push:

```bash
cd packages/ssh-bastion
docker build -t your-registry/ssh-bastion:latest .
docker push your-registry/ssh-bastion:latest
```

### Step 2: Deploy Container

**Environment Variables:**

```
API_URL=https://api.grm.wtf  (your server URL)
INTERNAL_API_KEY=<same key as in server .env>
SYNC_INTERVAL=30
```

**Network Settings (CRITICAL):**

Connect to the shared Traefik network where your boxes live:

```bash
docker network connect traefik-public ssh-bastion
```

**Port Configuration:**

Expose port 22 and map to host:

```bash
docker run -d \
  --name ssh-bastion \
  --network traefik-public \
  -p 22:22 \
  -e API_URL=https://api.grm.wtf \
  -e INTERNAL_API_KEY=your-key \
  your-registry/ssh-bastion:latest
```

### Step 3: DNS

Point `ssh.grm.wtf` A record → your Docker host IP

### Step 4: Firewall

Ensure port 22 (or your chosen port) is open on the server.

## Full Connection Flow

```
1. User: ssh my-box-a1b2@ssh.grm.wtf
              │
2. DNS resolves ssh.grm.wtf → Docker host IP
              │
3. TCP connection to server:22
              │
4. sshpiper receives, extracts username "my-box-a1b2"
              │
5. Reads /workingdir/my-box-a1b2/sshpiper.yaml
   (created by sync.ts from API data)
              │
6. Routes to: my-box-a1b2-uuid:22 (Docker network DNS)
              │
7. Box container's sshd receives connection
              │
8. User enters password (same as code-server PASSWORD)
              │
9. Authenticated → shell access as "coder" user
```

## Environment Variables

| Variable           | Description                    | Default                  |
| ------------------ | ------------------------------ | ------------------------ |
| `API_URL`          | VPS Claude API URL             | `http://localhost:33000` |
| `INTERNAL_API_KEY` | API key for internal endpoints | (required)               |
| `SYNC_INTERVAL`    | Seconds between box sync       | `30`                     |
