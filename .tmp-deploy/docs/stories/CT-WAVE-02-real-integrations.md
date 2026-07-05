# Story: CT Wave 02 - Real Integrations

## Source stories

- [x] CT-003
- [x] CT-005
- [x] CT-006
- [x] CT-007
- [x] CT-008
- [x] CT-010
- [x] CT-012
- [x] metadata migration and runtime configuration support

## Acceptance criteria

- [x] The CLI supports explicit `dev` and `real` modes.
- [x] Metadata can be persisted in Postgres through a dedicated driver.
- [x] A metadata migration command exists for the SQL schema.
- [x] Real-mode provisioning can create databases and roles in super Postgres through a runtime adapter.
- [x] Real-mode auth provisioning can call the Docker Engine API and prepare GoTrue env/config.
- [x] Tests still pass in local development mode.

## File list

- `.env.example`
- `package.json`
- `tsconfig.json`
- `bin/control-tower.ts`
- `packages/control-tower/src/config.ts`
- `packages/control-tower/src/docker.ts`
- `packages/control-tower/src/postgres.ts`
- `packages/control-tower/src/services.ts`
- `packages/control-tower/src/store.ts`
- `packages/control-tower/src/index.ts`
- `tests/control-tower.test.ts`
- `types/pg.d.ts`
- `docs/sprints/control-tower-wave-02-real-integrations.md`
- `docs/qa/control-tower-wave-02-real-integrations.md`
- `docs/review/control-tower-wave-02-real-integrations.md`
