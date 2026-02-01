# Deployment Flow Improvements

## Goals
1. Add missing step labels to UI (quick fix)
2. Restructure deployment for parallelization (performance)

---

## Part 1: Add Missing Step Labels

**File:** `packages/api/src/services/deploy-step.service.ts`

Add to `SETUP_SUBSTEPS` array:
```typescript
{ key: "SETUP_EMAIL_SKILL", name: "Setting up email skill" },
{ key: "SETUP_INSTALL_CLAUDE", name: "Installing Claude CLI" },
{ key: "SETUP_TAILSCALE", name: "Setting up Tailscale" },
```

---

## Part 2: Parallel Deployment Architecture

### Current (Sequential) - ~6 min
```
step1 → step2 → step3 → ... → step14
```

### Proposed (Parallel Phases) - ~3 min

```
Phase 1 (parallel, no deps):     ~30s
├── SETUP_DOWNLOAD_AGENT
├── SETUP_CREATE_DIRS
├── SETUP_INSTALL_NGINX
└── SETUP_CLONE_AGENT_APP

Phase 2 (parallel, needs Phase 1): ~30s
├── SETUP_EMAIL_SKILL
├── SETUP_ENV_VARS
└── SETUP_TAILSCALE (optional)

Phase 3 (sequential chains):      ~90s
├── Chain A: ENV_FILE → CLAUDE → BOX_AGENT_SVC
└── Chain B: INSTALL_APP → APP_SVC

Phase 4 (parallel, needs Phase 3): ~30s
├── SETUP_NGINX_SERVICE
└── SETUP_MCP_SETTINGS
```

### Files to Modify

| File | Change |
|------|--------|
| `packages/api/src/services/deploy-step.service.ts` | Add missing labels |
| `packages/api/src/workers/deploy/flow-builder.ts` | Restructure DAG to phases |

### Flow Builder Changes

Replace single chain with phase-based structure using BullMQ gates:

```typescript
// Phase 1: Independent tasks (all parallel)
const phase1Jobs = [
  job("SETUP_DOWNLOAD_AGENT"),
  job("SETUP_CREATE_DIRS"),
  job("SETUP_INSTALL_NGINX"),
  job("SETUP_CLONE_AGENT_APP"),
];

// Phase 2: Directory-dependent (parallel, after Phase 1)
const phase2Jobs = [
  job("SETUP_EMAIL_SKILL"),
  job("SETUP_ENV_VARS"),
  job("SETUP_TAILSCALE", { failParentOnFailure: false }), // optional
];

// Phase 3: Sequential chains
const chainA = chain(["SETUP_CREATE_ENV_FILE", "SETUP_INSTALL_CLAUDE", "SETUP_BOX_AGENT_SERVICE"]);
const chainB = chain(["SETUP_INSTALL_AGENT_APP", "SETUP_AGENT_APP_SERVICE"]);

// Phase 4: Service setup (parallel)
const phase4Jobs = [
  job("SETUP_NGINX_SERVICE"),
  job("SETUP_MCP_SETTINGS"),
];

// Wire: phase1 → phase2 → [chainA, chainB] → phase4
```

---

## Risks
- apt-get lock contention (mitigated: only nginx install in parallel group)
- Resume/retry tracking needs updating for phases
- More complex debugging if step fails

## Verification
1. Deploy box, verify all 14 steps show with correct labels
2. Compare deployment time before/after (~50% reduction expected)
3. Test Tailscale skip when no auth key
4. Test deployment resume after failure

## Recommendation
**Phase approach:**
1. Part 1 first (add labels) - quick win, low risk
2. Part 2 in separate PR after labels ship
