# Platform foundation

Establish the shared frontend, backend, data, security, storage, deployment, and engineering foundations for incremental HIS delivery.

## Document map

- [`proposal.md`](proposal.md) defines why this change exists and its boundaries.
- [`design.md`](design.md) records the accepted technical decisions and trade-offs.
- [`specs/`](specs/) defines the required platform behavior and scenarios.
- [`tasks.md`](tasks.md) is the authoritative execution checklist for this focused change.

The broader [`initial-his-prd`](../initial-his-prd/README.md) remains the program roadmap. Overlapping implementation progress is tracked here rather than duplicated in both checklists.

## Current status

The React, NestJS, and local PostgreSQL/Kysely foundations are running with synthetic data. Task `2.4`, the global application-user, tenant hierarchy, scoped membership, role/permission, approval-request, identity-binding, and append-only audit schema foundation, is the current implementation task. After its approved delivery, native non-SSO Cognito tasks `3.1` and `3.2` are deliberately prioritized to verify administrator-created users, first login, TOTP enrollment, token validation, and protected API access. Tenant SSO, SCIM, account linking, and custom domains remain deferred until separately prioritized.
