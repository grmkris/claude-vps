# Test Helper Functions

Import from `apps/server/test/test-helpers.ts`.

## Setup Helpers

| Helper                                    | Usage                            |
| ----------------------------------------- | -------------------------------- |
| `createTestSetup()`                       | Initialize full test environment |
| `createTestContext({ token, testSetup })` | Build authenticated context      |
| `createUnauthenticatedContext(testSetup)` | Build context without session    |

## Data Creation Helpers

Create helpers for each entity in your domain:

| Helper                                                       | Usage                      |
| ------------------------------------------------------------ | -------------------------- |
| `createTestItem(db, options)`                                | Create item with defaults  |
| `createTestOrder(db, options)`                               | Create order with defaults |
| `createTestUserWithBalance(testSetup, name, email, balance)` | Create user with balance   |
| `fundUser(userService, userId, amount)`                      | Add funds to user          |

## Async Helpers

| Helper                                                | Usage                   |
| ----------------------------------------------------- | ----------------------- |
| `waitForQueueJob(queue, queueName, jobId, maxWaitMs)` | Wait for async job      |
| `verifyDataIntegrity(db, expected)`                   | Verify data consistency |

## Generator Helpers

| Helper                    | Usage                |
| ------------------------- | -------------------- |
| `generateWalletAddress()` | Random 0x address    |
| `generateEmail()`         | Random email (faker) |
| `generateName()`          | Random name (faker)  |

## Usage Examples

```typescript
const item = await createTestItem(deps.db, {
  title: "Test Item",
  category: "default",
});
const expiredItem = await createExpiredTestItem(deps.db);
await fundUser(deps.userService, userId, 500);
const order = await createTestOrder({ db: deps.db, userId, itemId: item.id });
await waitForQueueJob(deps.queue, "order-processing", jobId, 30_000);
```

## Helper Pattern

```typescript
export async function createTestItem(
  db: Database,
  overrides: Partial<InsertItem> = {}
): Promise<SelectItem> {
  const defaults = {
    title: `Test Item ${Date.now()}`,
    status: "ACTIVE",
    createdAt: new Date(),
  };

  const [item] = await db
    .insert(DB_SCHEMA.item)
    .values({ ...defaults, ...overrides })
    .returning();

  return item;
}
```
