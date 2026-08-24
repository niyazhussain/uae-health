# Platform foundation

Establish the shared frontend, backend, data, security, storage, deployment, and engineering foundations for incremental HIS delivery.

## Document map

- [`proposal.md`](proposal.md) defines why this change exists and its boundaries.
- [`design.md`](design.md) records the accepted technical decisions and trade-offs.
- [`specs/`](specs/) defines the required platform behavior and scenarios.
- [`tasks.md`](tasks.md) is the authoritative execution checklist for this focused change.

The broader [`initial-his-prd`](../initial-his-prd/README.md) remains the program roadmap. Overlapping implementation progress is tracked here rather than duplicated in both checklists.

## Current status

The React, NestJS, local PostgreSQL/Kysely, global application-user, tenant hierarchy, scoped membership, role/permission, approval-request, identity-binding, and append-only audit schema foundations are running with synthetic data. Task `3.1` is the current implementation task: define one reusable Cognito workforce module, use one synthetic staging pool in AWS Mumbai for local/development/staging authentication, validate access tokens in the API, and verify administrator-created first login with TOTP. Task `3.1a` tracks the reviewed retirement of the empty local and development pools created before this simplification. The attempted UAE production pool creation returned an AWS Cognito internal error and the user deferred task `3.1b`; production remains disabled until it is explicitly resumed. Task `3.2` moves native user lifecycle operations behind the HIS administration boundary, beginning against the synthetic staging pool. Tenant SSO, SCIM, account linking, and custom domains remain deferred until separately prioritized.
