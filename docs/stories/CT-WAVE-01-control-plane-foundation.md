# Story: CT Wave 01 - Control Plane Foundation

## Source stories

- [x] CT-001
- [x] CT-002
- [x] CT-003
- [x] CT-004
- [x] CT-005
- [x] CT-006
- [x] CT-007
- [x] CT-008
- [x] CT-009
- [x] CT-010
- [x] CT-011
- [x] CT-012
- [x] scaffolding for CT-013 to CT-037

## Acceptance criteria

- [x] The repo contains a CLI-first implementation skeleton for the control plane.
- [x] Metadata tables are defined in versioned SQL.
- [x] Provisioning is orchestrated as a single flow with rollback on failure.
- [x] Audit entries are produced for critical operations.
- [x] Initial tokens are hashed and classified by scope.
- [x] Deprovisioning requires explicit confirmation.
- [x] Tests cover success and rollback for provisioning.

## File list

- `package.json`
- `tsconfig.json`
- `scripts/lint.mjs`
- `bin/control-tower.ts`
- `packages/control-tower/sql/001_control_plane.sql`
- `packages/control-tower/src/index.ts`
- `packages/control-tower/src/story-map.ts`
- `packages/control-tower/src/types.ts`
- `packages/control-tower/src/store.ts`
- `packages/control-tower/src/services.ts`
- `tests/control-tower.test.ts`
- `docs/sprints/control-tower-wave-01.md`
- `docs/qa/control-tower-wave-01.md`
- `docs/review/control-tower-wave-01.md`
- `examples/project-manifest.json`
