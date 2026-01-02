# TestSetup Structure

The test infrastructure provides isolated in-memory services.

## TestSetup Interface

```typescript
interface TestSetup {
  deps: {
    db: Database;
    pgLite: PGlite;
    authClient: Auth;
    logger: Logger;
    storage: StorageClient;
    redis: RedisSetup;
    queue: QueueClient;
    // ... your services
    userService, itemService, orderService
  };
  users: {
    authenticated: TestUser;
    unauthenticated: TestUser;
  };
  cleanup: () => Promise<void>;
  close: () => Promise<void>;
}
```

## In-Memory Infrastructure

| Service    | Implementation            | Package                                 |
| ---------- | ------------------------- | --------------------------------------- |
| PostgreSQL | PGlite (WASM-based)       | `@project/test-utils/pg-lite`           |
| Redis      | redis-memory-server       | `@project/test-utils/redis-test-server` |
| S3         | S3rver (local filesystem) | `@project/test-utils/s3-test-server`    |

All reset between test files. No network calls needed.

## Creating Test Users

```typescript
const userId = UserId.parse(testSetup.users.authenticated.id);
const token = testSetup.users.authenticated.token;

const user = await createTestUserWithBalance(testSetup, "Test User", "test@example.com", 100);
```

## Testing with Context

```typescript
const ctx = await createTestContext({ token: users.authenticated.token, testSetup });
expect(ctx.session?.user.id).toBe(users.authenticated.id);

const ctx = createUnauthenticatedContext(testSetup);
expect(ctx.session).toBeNull();
```

## Testing Services with neverthrow

```typescript
const result = await testSetup.deps.itemService.create(userId, input);

result.match(
  (data) => expect(data.id).toBeDefined(),
  (error) => fail(error.message)
);

expect(result.isOk()).toBe(true);
```
