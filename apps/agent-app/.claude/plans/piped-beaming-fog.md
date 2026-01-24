# Use tsgo for Typechecking

## Summary

Replace `tsc` with `tsgo` from `@typescript/native-preview` for faster typechecking.

## Changes

### 1. package.json

- Add `@typescript/native-preview` to devDependencies
- Change `typecheck` script: `tsc --noEmit` → `tsgo --noEmit`

## Verification

```bash
bun install
bun run typecheck
```
