# Platform foundation

Establish the shared frontend, backend, data, security, storage, deployment, and engineering foundations for incremental HIS delivery.

## Document map

- [`proposal.md`](proposal.md) defines why this change exists and its boundaries.
- [`design.md`](design.md) records the accepted technical decisions and trade-offs.
- [`specs/`](specs/) defines the required platform behavior and scenarios.
- [`tasks.md`](tasks.md) is the authoritative execution checklist for this focused change.

The broader [`initial-his-prd`](../initial-his-prd/README.md) remains the program roadmap. Overlapping implementation progress is tracked here rather than duplicated in both checklists.

## Current status

The React, NestJS, and local PostgreSQL/Kysely foundations are running with synthetic data. The next implementation task is `2.1a`, the durable frontend design system and shadcn/ui foundation, unless an earlier unblocked task is deliberately prioritized and documented.
