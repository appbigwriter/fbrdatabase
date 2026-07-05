# Control Tower Wave 02

## Workflow alignment

- Sprint planning completed for the real integration wave.
- Database modeling extended from schema-only to metadata persistence in Postgres.
- Implementation stays CLI first and adds real adapters behind environment-driven mode selection.
- QA and review artifacts for this wave live in `docs/qa/` and `docs/review/`.

## Team lanes

- Team Alpha (`@dev`, `@qa`, `@ux-design-expert`)
  - CT-003 metadata persistence in Postgres
  - CT-005 create database in super Postgres
  - CT-006 create roles in super Postgres
  - CT-010 atomic provisioning with real database rollback
  - CT-012 deprovision with real database cleanup
- Team Beta (`@dev`, `@qa`, `@ux-design-expert`)
  - CT-007 GoTrue runtime adapter through Docker Engine API
  - CT-008 route metadata registration in real mode
  - CT-011 migration command and acceptance scaffolding
  - environment configuration and secret material scaffolding

## Exit target for wave 02

- Explicit `dev` and `real` modes
- Metadata migration command
- Real Postgres metadata driver
- Real Postgres admin runtime
- Real Docker-based auth runtime
- Updated environment contract and tests
