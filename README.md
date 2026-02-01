# VPS Claude

Deploy autonomous Claude AI agents in isolated VMs with email, cronjobs, and MCP tools.

## Architecture

```mermaid
flowchart TB
    subgraph External["External World"]
        Resend[Resend Email]
        User[Web UI]
        Scheduler[BullMQ Scheduler]
    end

    subgraph Server["Main Server :33000"]
        Webhook["/webhooks/inbound-email"]
        UserAPI["/rpc/* User API"]
        BoxAPI["/box/* Box API"]
        Workers[BullMQ Workers]
    end

    subgraph Sprite["Sprite VM"]
        subgraph BoxAgent["box-agent :33002"]
            HTTP["/rpc/* HTTP API"]
            MCP["MCP Server (stdio)"]
        end
        Claude[Claude AI Session]
    end

    Resend -->|webhook| Webhook
    User -->|session cookie| UserAPI
    Webhook --> Workers
    Scheduler --> Workers
    Workers -->|X-Box-Secret| HTTP
    Claude <-->|stdio| MCP
    MCP -->|local| HTTP
    MCP -->|X-Box-Secret| BoxAPI
    HTTP -->|X-Box-Secret| BoxAPI
```

## Quick Start

```bash
# Start dependencies
bun run db:start   # Postgres + Redis

# Start development servers
bun run dev        # Server (33000) + Web (33001)
```

## Communication Interfaces

### Session Triggers

All triggers converge at `runWithSession()` which fetches config, creates/resumes Claude session, and streams responses.

```mermaid
flowchart TB
    subgraph Triggers["Session Triggers"]
        EmailTrigger[Email Arrives]
        CronTrigger[Cron Fires]
        ManualTrigger[User Chat]
        WebhookTrigger[Webhook POST]
    end

    subgraph Processing["Processing"]
        RunSession[runWithSession]
        FetchConfig[Fetch agent-config]
        CreateResume[Create/Resume Session]
    end

    subgraph Claude["Claude Session"]
        MCPTools[MCP Tools Available]
        Response[Stream Response]
    end

    EmailTrigger -->|triggerType: email| RunSession
    CronTrigger -->|triggerType: cron| RunSession
    ManualTrigger -->|triggerType: manual| RunSession
    WebhookTrigger -->|triggerType: webhook| RunSession

    RunSession --> FetchConfig
    FetchConfig --> CreateResume
    CreateResume --> MCPTools
    MCPTools --> Response
```

| Trigger | Entry Point               | contextType | Status Tracking            |
| ------- | ------------------------- | ----------- | -------------------------- |
| Email   | Webhook → delivery worker | `email`     | box_email.status           |
| Cron    | BullMQ scheduler          | `cron`      | boxCronjobExecution.status |
| Manual  | UI → /rpc/sessions/send   | `chat`      | Session ID only            |
| Webhook | POST /rpc/webhook/trigger | `webhook`   | (future)                   |

### Email Inbound

```mermaid
sequenceDiagram
    participant Resend
    participant Server as Server :33000
    participant Queue as BullMQ
    participant Worker as email-delivery worker
    participant Agent as box-agent :33002
    participant Claude

    Resend->>Server: POST /webhooks/inbound-email
    Server->>Server: emailService.processInbound()
    Server->>Server: Insert box_email (status: received)
    Server->>Queue: queueDelivery(emailId)
    Queue->>Worker: Process job
    Worker->>Agent: POST /rpc/email/receive
    Agent->>Agent: Write ~/.inbox/{emailId}.json
    Agent->>Claude: runWithSession(triggerType: email)
    Claude-->>Agent: Stream response
```

### Email Outbound

```mermaid
sequenceDiagram
    participant Claude
    participant MCP as MCP Server
    participant Agent as box-agent :33002
    participant Server as Server :33000
    participant Queue as BullMQ
    participant Resend

    Claude->>MCP: email_send tool
    MCP->>Agent: POST /rpc/email/send
    Agent->>Server: POST /box/email/send (X-Box-Secret)
    Server->>Queue: queueSendEmail()
    Queue->>Resend: Send via API
    Resend-->>Queue: Success
```

### Cronjobs

```mermaid
sequenceDiagram
    participant Scheduler as BullMQ Scheduler
    participant Worker as cronjob worker
    participant Agent as box-agent :33002
    participant Claude

    Scheduler->>Worker: Cron fires
    Worker->>Worker: Update execution (waking_box)
    Worker->>Agent: GET /health (wake sprite)
    Worker->>Agent: POST /rpc/cron/trigger (X-Box-Secret)
    Agent->>Claude: runWithSession(triggerType: cron)
    Claude-->>Agent: Stream response
    Agent-->>Worker: Success
    Worker->>Worker: Update execution (completed)
```

### MCP Tool Routing

```mermaid
flowchart LR
    Claude[Claude AI] -->|stdio| MCP[MCP Server]

    subgraph Local["Local (box-agent)"]
        Email[email_send/list/read]
    end

    subgraph Remote["Remote (Server /box/*)"]
        AI[generate_image<br>text_to_speech<br>speech_to_text]
        Cron[cronjob_list/create<br>update/delete/toggle]
    end

    MCP --> Email
    MCP --> AI
    MCP --> Cron
```

| Category | Tools                                                | Target               |
| -------- | ---------------------------------------------------- | -------------------- |
| Email    | `email_send`, `email_list`, `email_read`             | Local box-agent      |
| AI       | `generate_image`, `text_to_speech`, `speech_to_text` | Server /box/ai/\*    |
| Cronjob  | `cronjob_list/create/update/delete/toggle`           | Server /box/cronjobs |

## API Layers

| Layer           | Location           | Port  | Auth           | Purpose               |
| --------------- | ------------------ | ----- | -------------- | --------------------- |
| MCP             | box-agent (stdio)  | N/A   | N/A            | Claude ↔ tools bridge |
| Box-Agent API   | box-agent `/rpc/*` | 33002 | X-Box-Secret   | External → box        |
| Server Box API  | server `/box/*`    | 33000 | X-Box-Secret   | Box → backend         |
| Server User API | server `/rpc/*`    | 33000 | Session cookie | User → backend        |

## API Documentation

OpenAPI docs via Scalar UI:

- **Server:** http://localhost:33000/
- **Box-agent:** http://localhost:33002/

## Project Structure

```
apps/
  server/       → Hono API on port 33000
  web/          → Next.js on port 33001
  box-agent/    → In-container agent (runs inside deployed boxes)

packages/
  api/          → ORPC routers, services, workers (BullMQ)
  auth/         → better-auth config
  db/           → Drizzle schema + client (PostgreSQL)
  sprites/      → Sprites (Fly.io) client for VM deployment
  queue/        → BullMQ queue definitions
  email/        → Email client (Resend)
  shared/       → TypeIDs, constants, schemas
```

## Development

See [CLAUDE.md](./CLAUDE.md) for detailed development reference.
