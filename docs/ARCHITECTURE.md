# VPS Claude Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL WORLD                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Users (Browser)    Email (Resend)    Fly.io (Sprites)    AI Providers      │
└────────┬────────────────┬─────────────────┬─────────────────┬───────────────┘
         │                │                 │                 │
         ▼                ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MAIN INFRASTRUCTURE                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Web App   │    │   Server    │    │  PostgreSQL │    │    Redis    │  │
│  │  (Next.js)  │◄──►│   (Hono)    │◄──►│  (Drizzle)  │    │  (BullMQ)   │  │
│  │  :33001     │    │   :33000    │◄──►│             │    │             │  │
│  └─────────────┘    └──────┬──────┘    └─────────────┘    └─────────────┘  │
│                            │                                                 │
│                            │ Deploy/Email/Cronjob                           │
│                            ▼                                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         SPRITES (Fly.io VMs)                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │  │
│  │  │   Box #1    │  │   Box #2    │  │   Box #3    │  ...              │  │
│  │  │ box-agent   │  │ box-agent   │  │ box-agent   │                   │  │
│  │  │ Claude AI   │  │ Claude AI   │  │ Claude AI   │                   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Package Dependencies

```
┌─────────────────────────────────────────────────────────────────────┐
│                              APPS                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐            │
│  │    server    │   │     web      │   │  box-agent   │            │
│  │   (Hono)     │   │  (Next.js)   │   │   (Hono)     │            │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘            │
└─────────┼──────────────────┼──────────────────┼────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           PACKAGES                                   │
│                                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │   api   │  │   db    │  │  auth   │  │  queue  │  │ sprites │  │
│  │ routers │  │ schema  │  │ better- │  │ BullMQ  │  │ Fly.io  │  │
│  │services │  │ Drizzle │  │  auth   │  │ client  │  │ client  │  │
│  │ workers │  │         │  │         │  │         │  │         │  │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  │
│       │            │            │            │            │        │
│  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐  │
│  │  email  │  │  redis  │  │ logger  │  │ shared  │  │ storage │  │
│  │ Resend  │  │ ioredis │  │  Pino   │  │ TypeIDs │  │         │  │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Authentication Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TWO-TIER AUTHENTICATION                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TIER 1: User Authentication (Session-based)                        │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Web Browser                                                    │ │
│  │       │                                                         │ │
│  │       ▼  Login (email/password)                                │ │
│  │  POST /api/auth/signin ───► better-auth ───► session table     │ │
│  │       │                                                         │ │
│  │       ▼  Authenticated requests                                │ │
│  │  GET /rpc/* ───► protectedProcedure ───► context.session.user  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  TIER 2: Box Authentication (Token-based)                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Box Agent (in Sprite VM)                                       │ │
│  │       │                                                         │ │
│  │       ▼  Per-box token (64-char hex)                           │ │
│  │  POST /box/* ───► boxProcedure ───► X-Box-Secret header        │ │
│  │       │                             ───► box_email_settings     │ │
│  │       ▼                                                         │ │
│  │  Validates: context.boxToken === agentSecret                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Box Deployment Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BOX DEPLOYMENT PIPELINE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User clicks "Create Box"                                           │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────┐                                                │
│  │ POST /rpc/box   │ ─► Generate subdomain ({slug}-{4chars})       │
│  │                 │ ─► Create box record (status: pending)         │
│  │                 │ ─► Queue DEPLOY_ORCHESTRATOR job               │
│  └────────┬────────┘                                                │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │              BullMQ FlowProducer (DAG-based)                    ││
│  │                                                                  ││
│  │  ┌─────────────┐                                                ││
│  │  │Orchestrator │ ─► Prepare env vars, fetch credentials         ││
│  │  └──────┬──────┘                                                ││
│  │         ▼                                                        ││
│  │  ┌─────────────┐                                                ││
│  │  │CreateSprite │ ─► Fly.io API: Create or resume VM             ││
│  │  └──────┬──────┘                                                ││
│  │         ▼                                                        ││
│  │  ┌─────────────┐                                                ││
│  │  │ SetupStep   │ ─► Install box-agent binary, configure env     ││
│  │  └──────┬──────┘                                                ││
│  │         ▼                                                        ││
│  │  ┌─────────────┐                                                ││
│  │  │HealthCheck  │ ─► Verify box-agent is responding              ││
│  │  └──────┬──────┘                                                ││
│  │         ▼                                                        ││
│  │  ┌─────────────┐                                                ││
│  │  │ SkillsGate  │ ─► Check if skills need installation           ││
│  │  └──────┬──────┘                                                ││
│  │         │                                                        ││
│  │    ┌────┴────┬────────┬────────┐                                ││
│  │    ▼         ▼        ▼        ▼                                ││
│  │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  (parallel)                ││
│  │  │Skill│  │Skill│  │Skill│  │ ... │                            ││
│  │  │ #1  │  │ #2  │  │ #3  │  │     │                            ││
│  │  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘                            ││
│  │     └────────┴────────┴────────┘                                ││
│  │              │                                                   ││
│  │              ▼                                                   ││
│  │  ┌─────────────┐                                                ││
│  │  │EnableAccess │ ─► Configure SSH, set password                 ││
│  │  └──────┬──────┘                                                ││
│  │         ▼                                                        ││
│  │  ┌─────────────┐                                                ││
│  │  │  Finalize   │ ─► Update status: running                      ││
│  │  └─────────────┘                                                ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Box Status: pending ─► deploying ─► running (or error)            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Email Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EMAIL SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  INBOUND EMAIL                                                       │
│  ─────────────                                                       │
│                                                                      │
│  External Sender                                                     │
│       │                                                              │
│       ▼  user@box-abc1.agents.example.com                           │
│  ┌─────────────┐                                                    │
│  │   Resend    │  (Email provider)                                  │
│  └──────┬──────┘                                                    │
│         │  Webhook                                                   │
│         ▼                                                            │
│  ┌─────────────────────────────────┐                                │
│  │ POST /webhooks/inbound-email    │                                │
│  │   ├─ Parse recipient address    │                                │
│  │   ├─ Extract subdomain (abc1)   │                                │
│  │   └─ emailService.processInbound│                                │
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ box_email table                 │                                │
│  │   status: received              │                                │
│  └──────────────┬──────────────────┘                                │
│                 │  Queue: deliverEmail                               │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ EmailDeliveryWorker             │                                │
│  │   POST {spriteUrl}/email/receive│                                │
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐    ┌─────────────────────────┐│
│  │ Box Agent (in Sprite)           │    │ ~/.inbox/{id}.json      ││
│  │   ├─ Save email to filesystem ──┼───►│ (email storage)         ││
│  │   └─ runWithSession()           │    └─────────────────────────┘│
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ Claude AI Session               │                                │
│  │   ├─ Reads email context        │                                │
│  │   ├─ Uses MCP tools             │                                │
│  │   └─ Responds autonomously      │                                │
│  └─────────────────────────────────┘                                │
│                                                                      │
│  ═══════════════════════════════════════════════════════════════════│
│                                                                      │
│  OUTBOUND EMAIL                                                      │
│  ──────────────                                                      │
│                                                                      │
│  Claude decides to send email                                        │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────┐                                │
│  │ MCP Tool: email_send            │                                │
│  │   { to, subject, body }         │                                │
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ POST /box/email/send            │                                │
│  │   Header: X-Box-Secret          │                                │
│  └──────────────┬──────────────────┘                                │
│                 │  Queue: sendEmail                                  │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ EmailSendWorker                 │                                │
│  │   ├─ renderAgentEmail() (MD→HTML)                               │
│  │   └─ Resend.sendRawEmail()      │                                │
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│            Recipient                                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Cronjob Execution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CRONJOB SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SETUP (on server startup)                                          │
│  ─────────────────────────                                          │
│                                                                      │
│  ┌─────────────────────────────────┐                                │
│  │ cronjobService.syncAllRepeatableJobs()                          │
│  │   ├─ Fetch all enabled cronjobs │                                │
│  │   └─ Create BullMQ repeatable   │                                │
│  │      jobs for each schedule     │                                │
│  └─────────────────────────────────┘                                │
│                                                                      │
│  Example: "0 9 * * *" = 9am daily                                   │
│                                                                      │
│  EXECUTION                                                           │
│  ─────────                                                           │
│                                                                      │
│       ┌─────────────────────────────────────────────────────┐       │
│       │              BullMQ Scheduler                        │       │
│       │  ┌─────────┐  ┌─────────┐  ┌─────────┐             │       │
│       │  │Cronjob 1│  │Cronjob 2│  │Cronjob 3│  ...        │       │
│       │  │ 9am     │  │ */5 min │  │ weekly  │             │       │
│       │  └────┬────┘  └────┬────┘  └────┬────┘             │       │
│       └───────┼────────────┼────────────┼───────────────────┘       │
│               │            │            │                            │
│               └────────────┼────────────┘                            │
│                            │  (when schedule matches)                │
│                            ▼                                         │
│  ┌─────────────────────────────────┐                                │
│  │ CronjobWorker                   │                                │
│  │   ├─ Create execution record    │                                │
│  │   ├─ Check if cronjob enabled   │                                │
│  │   ├─ Wake sprite if sleeping    │◄── Fly.io auto-sleep          │
│  │   └─ POST /cron/trigger         │                                │
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ Box Agent: /cron/trigger        │                                │
│  │   { cronjobId, name, prompt }   │                                │
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ runWithSession()                │                                │
│  │   contextType: "cron"           │                                │
│  │   contextId: cronjobId          │                                │
│  └──────────────┬──────────────────┘                                │
│                 │                                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────┐                                │
│  │ Claude AI Session               │                                │
│  │   ├─ Follows cronjob.prompt     │                                │
│  │   ├─ Uses MCP tools             │                                │
│  │   └─ Runs autonomously          │                                │
│  └─────────────────────────────────┘                                │
│                                                                      │
│  TRACKING                                                            │
│  ────────                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ box_cronjob_execution                                           ││
│  │   status: pending → waking_box → running → completed/failed     ││
│  │   startedAt, completedAt, durationMs, errorMessage              ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Box Agent Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BOX AGENT (Inside Sprite VM)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ /usr/local/bin/box-agent                                        │ │
│  │                                                                  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ HTTP Server (Hono) - Port 33002                            │  │ │
│  │  │                                                            │  │ │
│  │  │  ┌────────────────┐  ┌────────────────┐                   │  │ │
│  │  │  │ /email/*       │  │ /cron/*        │                   │  │ │
│  │  │  │  - receive     │  │  - trigger     │                   │  │ │
│  │  │  │  - send        │  │                │                   │  │ │
│  │  │  │  - list        │  └────────────────┘                   │  │ │
│  │  │  │  - read        │                                        │  │ │
│  │  │  └────────────────┘  ┌────────────────┐                   │  │ │
│  │  │                      │ /sessions/*    │                   │  │ │
│  │  │  ┌────────────────┐  │  - list        │                   │  │ │
│  │  │  │ /health        │  │  - send        │                   │  │ │
│  │  │  └────────────────┘  └────────────────┘                   │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │                                                                  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ MCP Server (stdio) - "box-agent mcp"                      │  │ │
│  │  │                                                            │  │ │
│  │  │  Tools exposed to Claude:                                  │  │ │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐            │  │ │
│  │  │  │ AI Tools   │ │Email Tools │ │Cronjob Tools│           │  │ │
│  │  │  │ ─────────  │ │ ────────── │ │ ──────────  │           │  │ │
│  │  │  │ generate_  │ │ email_send │ │ cronjob_    │           │  │ │
│  │  │  │   image    │ │ email_list │ │   list      │           │  │ │
│  │  │  │ text_to_   │ │ email_read │ │ cronjob_    │           │  │ │
│  │  │  │   speech   │ │            │ │   create    │           │  │ │
│  │  │  │ speech_to_ │ │            │ │ cronjob_    │           │  │ │
│  │  │  │   text     │ │            │ │   update    │           │  │ │
│  │  │  │            │ │            │ │ cronjob_    │           │  │ │
│  │  │  │            │ │            │ │   delete    │           │  │ │
│  │  │  │            │ │            │ │ cronjob_    │           │  │ │
│  │  │  │            │ │            │ │   toggle    │           │  │ │
│  │  │  └────────────┘ └────────────┘ └────────────┘            │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │                                                                  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ Session Manager (SQLite)                                  │  │ │
│  │  │   ~/.box-agent/sessions.db                                │  │ │
│  │  │                                                            │  │ │
│  │  │   ┌────────────────────────────────────────────────────┐  │  │ │
│  │  │   │ sessions table                                      │  │  │ │
│  │  │   │   contextType | contextId | sessionId | updatedAt   │  │  │ │
│  │  │   │   ───────────────────────────────────────────────   │  │  │ │
│  │  │   │   email       | msg-123   | sess-abc  | 2024-01-... │  │  │ │
│  │  │   │   cron        | cron-456  | sess-def  | 2024-01-... │  │  │ │
│  │  │   └────────────────────────────────────────────────────┘  │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │                                                                  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ Claude Agent (via @anthropic-ai/claude-agent-sdk)        │  │ │
│  │  │                                                            │  │ │
│  │  │   runWithSession({ prompt, contextType, contextId })      │  │ │
│  │  │       │                                                    │  │ │
│  │  │       ▼                                                    │  │ │
│  │  │   ┌──────────────────────────────────────────────────┐    │  │ │
│  │  │   │ Check sessions DB for existing session           │    │  │ │
│  │  │   │   ├─ Found? → unstable_v2_resumeSession()       │    │  │ │
│  │  │   │   └─ Not found? → unstable_v2_createSession()   │    │  │ │
│  │  │   └──────────────────────────────────────────────────┘    │  │ │
│  │  │       │                                                    │  │ │
│  │  │       ▼                                                    │  │ │
│  │  │   ┌──────────────────────────────────────────────────┐    │  │ │
│  │  │   │ Claude runs with MCP tools                        │    │  │ │
│  │  │   │   - Reads emails, sends emails                    │    │  │ │
│  │  │   │   - Generates images, TTS, STT                    │    │  │ │
│  │  │   │   - Manages cronjobs                              │    │  │ │
│  │  │   │   - Session persisted for thread continuity       │    │  │ │
│  │  │   └──────────────────────────────────────────────────┘    │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Filesystem                                                      │ │
│  │   ~/.inbox/              - Inbound emails (JSON)                │ │
│  │   ~/.inbox/.archive/     - Archived emails                      │ │
│  │   ~/.box-agent/          - Agent data                           │ │
│  │   ~/.box-agent/sessions.db - Session persistence                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Database Schema (ERD)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DATABASE SCHEMA                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐                                                │
│  │      user       │                                                │
│  │ ─────────────── │                                                │
│  │ id (PK)         │                                                │
│  │ email           │                                                │
│  │ name            │                                                │
│  │ password        │                                                │
│  └────────┬────────┘                                                │
│           │                                                          │
│     ┌─────┴─────┬──────────────┬──────────────┐                     │
│     │           │              │              │                      │
│     ▼           ▼              ▼              ▼                      │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐         │
│  │   box    │ │user_credential│ │  ai_usage  │ │ session  │         │
│  │ ──────── │ │ ───────────── │ │ ────────── │ │ ──────── │         │
│  │ id (PK)  │ │ id (PK)       │ │ id (PK)    │ │ id (PK)  │         │
│  │ userId   │ │ userId (FK)   │ │ userId (FK)│ │ userId   │         │
│  │ name     │ │ key           │ │ boxId (FK) │ │ token    │         │
│  │ subdomain│ │ value (enc)   │ │ provider   │ │ expiresAt│         │
│  │ status   │ └──────────────┘ │ capability │ └──────────┘         │
│  │ spriteName│                  │ costUsd    │                       │
│  │ spriteUrl │                  └────────────┘                       │
│  │ skills[] │                                                        │
│  └────┬─────┘                                                        │
│       │                                                              │
│  ┌────┴────┬────────────┬────────────┬────────────┬────────────┐   │
│  │         │            │            │            │            │    │
│  ▼         ▼            ▼            ▼            ▼            ▼    │
│ ┌────────┐┌───────────┐┌───────────┐┌───────────┐┌───────────┐┌───┐│
│ │box_    ││box_email_ ││box_       ││box_agent_ ││box_env_   ││box││
│ │email   ││settings   ││cronjob    ││config     ││var        ││_de││
│ │────────││───────────││───────────││───────────││───────────││plo││
│ │id (PK) ││id (PK)    ││id (PK)    ││id (PK)    ││id (PK)    ││y_ ││
│ │boxId   ││boxId (FK) ││boxId (FK) ││boxId (FK) ││boxId (FK) ││ste││
│ │from    ││agentSecret││name       ││triggerType││key        ││p  ││
│ │subject ││           ││schedule   ││model      ││type       │└───┘│
│ │body    │└───────────┘│prompt     ││systemPrompt│value      │     │
│ │status  │             │enabled    ││mcpServers │└───────────┘     │
│ └────────┘             └─────┬─────┘└───────────┘                   │
│                              │                                       │
│                              ▼                                       │
│                        ┌───────────────┐                            │
│                        │box_cronjob_   │                            │
│                        │execution      │                            │
│                        │───────────────│                            │
│                        │id (PK)        │                            │
│                        │cronjobId (FK) │                            │
│                        │status         │                            │
│                        │startedAt      │                            │
│                        │durationMs     │                            │
│                        └───────────────┘                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

LEGEND:
  PK = Primary Key
  FK = Foreign Key
  → = One-to-Many relationship
```

## API Router Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                        API ENDPOINTS                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  USER-FACING (protectedProcedure - session auth)                    │
│  ────────────────────────────────────────────────                   │
│                                                                      │
│  /rpc/box                                                            │
│    ├─ GET    /             List user's boxes                        │
│    ├─ POST   /             Create box                               │
│    ├─ POST   /deploy       Redeploy box                             │
│    └─ DELETE /:id          Delete box                               │
│                                                                      │
│  /rpc/box/:boxId/cronjobs                                           │
│    ├─ GET    /             List cronjobs                            │
│    ├─ POST   /             Create cronjob                           │
│    ├─ PUT    /:id          Update cronjob                           │
│    ├─ DELETE /:id          Delete cronjob                           │
│    ├─ POST   /:id/toggle   Toggle enabled                           │
│    └─ GET    /:id/executions  List executions                       │
│                                                                      │
│  /rpc/credentials                                                    │
│    ├─ GET    /             List credentials                         │
│    ├─ POST   /             Create credential                        │
│    ├─ PUT    /:key         Update credential                        │
│    └─ DELETE /:key         Delete credential                        │
│                                                                      │
│  /rpc/box/:boxId/env                                                │
│    ├─ GET    /             List env vars                            │
│    ├─ POST   /             Create env var                           │
│    ├─ PUT    /:key         Update env var                           │
│    └─ DELETE /:key         Delete env var                           │
│                                                                      │
│  /rpc/box/:boxId/agent-config                                       │
│    ├─ GET    /             Get agent config                         │
│    └─ POST   /             Update agent config                      │
│                                                                      │
│  /rpc/box/:boxId/fs                                                 │
│    ├─ GET    /read         Read file                                │
│    ├─ POST   /write        Write file                               │
│    └─ GET    /list         List directory                           │
│                                                                      │
│  ═══════════════════════════════════════════════════════════════════│
│                                                                      │
│  BOX-FACING (boxProcedure - X-Box-Secret token auth)                │
│  ────────────────────────────────────────────────────                │
│                                                                      │
│  /box/agent-config                                                   │
│    └─ GET    /             Get agent config for trigger             │
│                                                                      │
│  /box/email                                                          │
│    └─ POST   /send         Queue email send                         │
│                                                                      │
│  /box/ai                                                             │
│    ├─ POST   /generate-image    Generate image                      │
│    ├─ POST   /text-to-speech    Text to speech                      │
│    └─ POST   /speech-to-text    Speech to text                      │
│                                                                      │
│  /box/cronjobs                                                       │
│    ├─ GET    /             List cronjobs                            │
│    ├─ POST   /             Create cronjob                           │
│    ├─ PUT    /:id          Update cronjob                           │
│    ├─ DELETE /:id          Delete cronjob                           │
│    └─ POST   /:id/toggle   Toggle cronjob                           │
│                                                                      │
│  ═══════════════════════════════════════════════════════════════════│
│                                                                      │
│  LOCAL BOX-AGENT (port 33002 - X-Box-Secret token auth)              │
│  ─────────────────────────────────────────────────────               │
│                                                                      │
│  /email                                                              │
│    ├─ POST   /receive      Receive inbound email (from server)      │
│    ├─ GET    /list         List inbox                               │
│    ├─ GET    /:id          Read email                               │
│    ├─ POST   /:id/read     Archive email                            │
│    └─ POST   /send         Send email (proxies to server)           │
│                                                                      │
│  /cron                                                               │
│    └─ POST   /trigger      Trigger cronjob execution                │
│                                                                      │
│  /sessions                                                           │
│    ├─ GET    /list         List sessions                            │
│    └─ POST   /send         Send message to session                  │
│                                                                      │
│  /health                                                             │
│    └─ GET    /             Health check                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Worker System

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BULLMQ WORKER SYSTEM                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                         REDIS                                    ││
│  │  ┌─────────────────────────────────────────────────────────────┐││
│  │  │ Queues                                                       │││
│  │  │                                                              │││
│  │  │  deploy:orchestrator ──┬── deploy:createSprite              │││
│  │  │                        ├── deploy:setupStep                 │││
│  │  │                        ├── deploy:healthCheck               │││
│  │  │                        ├── deploy:skillsGate                │││
│  │  │                        ├── deploy:installSkill              │││
│  │  │                        ├── deploy:enableAccess              │││
│  │  │                        └── deploy:finalize                  │││
│  │  │                                                              │││
│  │  │  deleteBox ─────────── Delete VM from Fly.io                │││
│  │  │  deliverEmail ──────── POST email to box-agent              │││
│  │  │  sendEmail ─────────── Send via Resend API                  │││
│  │  │  triggerCronjob ────── Execute scheduled task               │││
│  │  │                                                              │││
│  │  └─────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                        WORKERS                                   ││
│  │                                                                  ││
│  │  ┌──────────────────┐  ┌──────────────────┐                     ││
│  │  │ OrchestratorWorker│  │  DeleteWorker    │                     ││
│  │  │ Creates deploy    │  │ Removes Fly.io   │                     ││
│  │  │ flow (DAG)        │  │ VM + cascades    │                     ││
│  │  │ Timeout: 5min     │  │ Timeout: 1min    │                     ││
│  │  └──────────────────┘  └──────────────────┘                     ││
│  │                                                                  ││
│  │  ┌──────────────────┐  ┌──────────────────┐                     ││
│  │  │ EmailDelivery    │  │ EmailSend        │                     ││
│  │  │ Worker           │  │ Worker           │                     ││
│  │  │ POST to box-agent│  │ Render + Resend  │                     ││
│  │  │ Timeout: 30s     │  │ Timeout: 30s     │                     ││
│  │  └──────────────────┘  └──────────────────┘                     ││
│  │                                                                  ││
│  │  ┌──────────────────┐                                           ││
│  │  │ CronjobWorker    │                                           ││
│  │  │ Wake box + POST  │                                           ││
│  │  │ /cron/trigger    │                                           ││
│  │  │ Timeout: 5min    │                                           ││
│  │  └──────────────────┘                                           ││
│  │                                                                  ││
│  │  DEPLOY FLOW WORKERS (DAG)                                      ││
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        ││
│  │  │ Setup  │ │ Health │ │ Skills │ │Install │ │ Enable │        ││
│  │  │ Step   │ │ Check  │ │ Gate   │ │ Skill  │ │ Access │        ││
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        ││
│  │                         ┌────────┐                              ││
│  │                         │Finalize│                              ││
│  │                         └────────┘                              ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## External Services Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ FLY.IO (Sprites)                                                ││
│  │ ───────────────                                                 ││
│  │                                                                  ││
│  │ Purpose: Deploy isolated Linux VMs for Claude agents            ││
│  │                                                                  ││
│  │ Operations:                                                      ││
│  │   createSprite() ─► Deploy new VM with Docker image             ││
│  │   getSprite()    ─► Get VM status and URL                       ││
│  │   exec()         ─► Run command in VM                           ││
│  │   fs.write()     ─► Write file to VM                            ││
│  │   checkpoint()   ─► Save VM snapshot                            ││
│  │                                                                  ││
│  │ Result: box-abc1.sprites.dev (accessible VM)                    ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ RESEND (Email)                                                  ││
│  │ ─────────────                                                   ││
│  │                                                                  ││
│  │ Inbound: Webhook → /webhooks/inbound-email                      ││
│  │ Outbound: Resend.sendRawEmail() via EmailSendWorker             ││
│  │                                                                  ││
│  │ Email format: {subdomain}@{agentsDomain}                        ││
│  │ Example: my-box-abc1@agents.example.com                         ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ AI PROVIDERS                                                    ││
│  │ ────────────                                                    ││
│  │                                                                  ││
│  │ ┌──────────────────────────────────────────────────────────────┐││
│  │ │ Image Generation                                              │││
│  │ │   Primary:  Fal.ai (fal-ai/flux/dev)                         │││
│  │ │   Fallback: Replicate (flux-schnell)                         │││
│  │ └──────────────────────────────────────────────────────────────┘││
│  │                                                                  ││
│  │ ┌──────────────────────────────────────────────────────────────┐││
│  │ │ Text-to-Speech                                                │││
│  │ │   Primary:  ElevenLabs (eleven_multilingual_v2)              │││
│  │ │   Fallback: Replicate (xtts-v2)                              │││
│  │ └──────────────────────────────────────────────────────────────┘││
│  │                                                                  ││
│  │ ┌──────────────────────────────────────────────────────────────┐││
│  │ │ Speech-to-Text                                                │││
│  │ │   Primary:  Google Cloud Speech API                          │││
│  │ │   Fallback: Replicate (whisper)                              │││
│  │ └──────────────────────────────────────────────────────────────┘││
│  │                                                                  ││
│  │ Usage tracked in: ai_usage table                                ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ ANTHROPIC (Claude API)                                          ││
│  │ ───────────────────────                                         ││
│  │                                                                  ││
│  │ Used by: box-agent via @anthropic-ai/claude-agent-sdk           ││
│  │                                                                  ││
│  │ Features:                                                        ││
│  │   - unstable_v2_createSession()                                 ││
│  │   - unstable_v2_resumeSession()                                 ││
│  │   - MCP tool integration                                        ││
│  │   - Streaming responses                                         ││
│  │                                                                  ││
│  │ Model: claude-sonnet-4-5-20250929                               ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```
