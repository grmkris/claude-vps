# Add Tailscale as Optional Box Feature

## Overview

Add Tailscale as an optional installation during box deployment. User provides their Tailscale auth key, and the box joins their Tailscale network for SSH access (Cursor, etc.).

## Approach

Hybrid: UI toggle + env var injection + dedicated setup step.

## User Flow

1. User creates box → sees "Enable Tailscale" toggle
2. If enabled, enters Tailscale auth key (direct or from saved credential)
3. Auth key stored as env var `TAILSCALE_AUTHKEY`
4. Deployment includes `SETUP_TAILSCALE` step
5. Box joins user's Tailscale network on startup

## Changes

### 1. Add Setup Step Type

**File:** `packages/sprites/src/types.ts`

Add to `SETUP_STEP_KEYS` array:

```typescript
"SETUP_TAILSCALE";
```

### 2. Implement Setup Step

**File:** `packages/sprites/src/sprites-client.ts`

Add to `getStepCommand()` (NOT `runSetupStep` - keep it generic):

```typescript
SETUP_TAILSCALE: `
  set -euo pipefail

  # Skip if no auth key provided
  if [ -z "\${TAILSCALE_AUTHKEY:-}" ]; then
    echo "Skipping Tailscale: TAILSCALE_AUTHKEY not set"
    exit 0
  fi

  # Install via apt (safer than curl | sh)
  curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq tailscale

  # Start daemon
  sudo systemctl enable --now tailscaled

  # Join network (--reset for idempotency on redeploys)
  sudo tailscale up --authkey="\$TAILSCALE_AUTHKEY" --ssh --hostname="\$BOX_SUBDOMAIN" --reset

  echo "Tailscale connected: $(tailscale ip -4)"
`,
```

**Key improvements:**

- Uses apt package (not curl | sh) for supply chain safety
- Reads auth key from env var (never interpolated in script)
- `--reset` flag for idempotent redeploys
- `set -euo pipefail` for strict error handling
- Graceful skip if no auth key

### 3. Add Step to Flow Builder

**File:** `packages/api/src/workers/deploy/flow-builder.ts`

Insert `SETUP_TAILSCALE` step after `SETUP_ENV_VARS` (needs env vars loaded) and before health check.

### 4. Frontend - Box Creation Form

**File:** `apps/web/src/app/boxes/new/create-box-form.tsx`

Add toggle + auth key input with two options:

```tsx
<div className="space-y-3">
  <div className="flex items-center gap-2">
    <Switch checked={enableTailscale} onCheckedChange={setEnableTailscale} />
    <Label>Enable Tailscale SSH</Label>
  </div>

  {enableTailscale && (
    <div className="space-y-2 pl-6">
      <p className="text-xs text-muted-foreground">
        Get an auth key from{" "}
        <a
          href="https://login.tailscale.com/admin/settings/keys"
          target="_blank"
          className="underline"
        >
          Tailscale Admin Console
        </a>
        . Use reusable + ephemeral + pre-authorized.
      </p>

      <Select value={authKeySource} onValueChange={setAuthKeySource}>
        <SelectItem value="direct">Enter auth key</SelectItem>
        <SelectItem value="credential">Use saved credential</SelectItem>
      </Select>

      {authKeySource === "direct" ? (
        <Input
          type="password"
          placeholder="tskey-auth-..."
          value={tailscaleAuthKey}
          onChange={(e) => setTailscaleAuthKey(e.target.value)}
        />
      ) : (
        <CredentialSelect
          filter={(cred) => cred.key.includes("TAILSCALE")}
          value={selectedCredential}
          onChange={setSelectedCredential}
        />
      )}
    </div>
  )}
</div>
```

**Validation:**

- Auth key must start with `tskey-auth-` or `tskey-`
- Cannot be empty/whitespace if Tailscale enabled

When submitting, add to envVars:

- **Direct**: `{ TAILSCALE_AUTHKEY: enteredValue }` (literal)
- **Credential**: Reference via box-env-var system (credential_ref type)

## Files Summary

| File                                              | Change                                     |
| ------------------------------------------------- | ------------------------------------------ |
| `packages/sprites/src/types.ts`                   | Add `SETUP_TAILSCALE` to step keys         |
| `packages/sprites/src/sprites-client.ts`          | Add tailscale script to `getStepCommand()` |
| `packages/api/src/workers/deploy/flow-builder.ts` | Include step in deployment flow            |
| `apps/web/src/app/boxes/new/create-box-form.tsx`  | Add UI toggle + input                      |

## Security Considerations

- Auth key never interpolated in script (read from env var)
- Credential system encrypts stored keys
- Recommend ephemeral + pre-authorized keys (auto-cleanup, no admin approval)
- `--ssh` enables Tailscale SSH (governed by tailnet ACLs)
- Logger redaction should cover `TAILSCALE_AUTHKEY`

## Edge Cases

| Case                | Behavior                                 |
| ------------------- | ---------------------------------------- |
| No auth key         | Step skips gracefully (exit 0)           |
| Invalid/expired key | `tailscale up` fails, step marked failed |
| Redeploy            | `--reset` rejoins network cleanly        |
| Box deleted         | Ephemeral key auto-removes device        |
| Network issues      | Step fails with error, can retry         |

## Verification

1. Save `TAILSCALE_AUTHKEY` credential (Settings → Credentials)
2. Create box with Tailscale enabled, select credential
3. Wait for deployment to complete
4. Check `SETUP_TAILSCALE` step shows completed in deploy logs
5. Verify box appears in Tailscale admin console
6. SSH via Tailscale: `ssh coder@box-subdomain` or `ssh coder@100.x.x.x`

## Notes

- Auth key requirements: reusable (for redeploys), ephemeral (auto-cleanup), pre-authorized (no admin approval)
- `--ssh` flag enables Tailscale SSH - ACLs control who can connect
- `--hostname` uses `BOX_SUBDOMAIN` env var for device name
- Ubuntu jammy packages used (sprites base image)
