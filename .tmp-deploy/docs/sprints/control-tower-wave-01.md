# Control Tower Wave 01

## Workflow alignment

- Sprint planning and assignment completed in this document.
- Database modeling and setup translated into SQL schema + adapters.
- Implementation executed CLI first.
- QA and review artifacts live in `docs/qa/` and `docs/review/`.

## Team lanes

- Team Alpha (`@dev`, `@qa`, `@ux-design-expert`)
  - CT-001 backup automation foundation
  - CT-003 metadata schema
  - CT-004 audit trail
  - CT-005 create database
  - CT-006 create roles
  - CT-009 initial tokens
  - CT-010 atomic provisioning
- Team Beta (`@dev`, `@qa`, `@ux-design-expert`)
  - CT-002 TLS strategy artifact
  - CT-007 auth instance abstraction
  - CT-008 route registry
  - CT-011 acceptance validation harness
  - CT-012 deprovision flow
  - scaffolding for CT-013 onward

## Definition of ready

- Story source: `prd/STORIES-control-tower.md`
- CLI first
- No hidden infra assumptions
- Tests for the provisioning path

## Exit target for wave 01

- Functional CLI development harness for the control plane
- Versioned metadata schema in SQL
- Atomic provisioning orchestration with rollback tests
- Story checklist and file list updated
