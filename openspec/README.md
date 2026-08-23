# OpenSpec delivery map

This directory holds the product roadmap and focused delivery changes.

| Change | Purpose | Tracking role |
| --- | --- | --- |
| [`initial-his-prd`](changes/initial-his-prd/README.md) | Overall HIS product requirements and program roadmap | High-level sequencing and product acceptance |
| [`platform-foundation`](changes/platform-foundation/README.md) | Current application, data, security, and delivery foundation | Active implementation checklist |

For each focused change, read the documents in this order:

1. `proposal.md` for the problem, scope, and intended outcome.
2. `design.md` for accepted technical decisions and constraints.
3. `specs/*/spec.md` for normative requirements and scenarios.
4. `tasks.md` for ordered implementation and completion status.

New work discovered during discussion belongs in the relevant focused `tasks.md`. An accepted decision that affects the implementation also belongs in that change's `design.md` and, when it changes required behavior, its capability spec.
