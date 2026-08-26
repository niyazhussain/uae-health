# Platform foundation

Establish the shared frontend, backend, data, security, storage, deployment, and engineering foundations for incremental HIS delivery.

## Document map

- [`proposal.md`](proposal.md) defines why this change exists and its boundaries.
- [`design.md`](design.md) records the accepted technical decisions and trade-offs.
- [`specs/`](specs/) defines the required platform behavior and scenarios.
- [`tasks.md`](tasks.md) is the authoritative execution checklist for this focused change.

The broader [`initial-his-prd`](../initial-his-prd/README.md) remains the program roadmap. Overlapping implementation progress is tracked here rather than duplicated in both checklists.

## Current status

The React, NestJS, local PostgreSQL/Kysely, global application-user, tenant hierarchy, scoped membership, role/permission, approval-request, identity-binding, and append-only audit schema foundations are running with synthetic data. The POC uses one shared native Cognito workforce pool in AWS Mumbai for local/development/staging, with administrator-managed access and TOTP MFA. The next POC identity work is basic patient email identity and appointment access. Enterprise SSO, SCIM, advanced patient proofing, tenant domains, UAE production resources, and real-data compliance are tracked in [`phase-2-identity-and-production`](../phase-2-identity-and-production/proposal.md).
