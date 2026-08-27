## Why

The basic patient appointment POC proves identity, practice isolation, and safe
booking concurrency, but a consultation appointment is not meaningful unless it
is associated with an appropriate doctor or other schedulable care resource.
The next scheduling slice must let practices publish provider availability and
let patients choose a doctor—or explicitly request any suitable available
doctor—without weakening the existing one-practice patient boundary.

## What Changes

- Add tenant-owned practitioner profiles for doctors and other bookable care
  professionals, independently of whether the practitioner has a workforce
  login; explicit practice and facility assignments are managed separately.
- Add a controlled specialty and appointment-service catalogue, plus explicit
  practitioner, practice, facility, and service assignments.
- Add practice scheduling administration for recurring availability, bounded
  exceptions such as leave, and generated bookable slots protected by current
  database-backed `scheduling.manage` authorization.
- Extend patient appointment discovery to support practice, specialty/service,
  doctor, and time selection, including an explicit “any available doctor”
  choice where the practice permits it.
- Bind every consultation appointment to one practice, facility, service,
  schedulable resource, patient identity, and selected patient context, with
  idempotent booking and database-enforced double-booking prevention.
- Add safe workforce scheduling summaries and auditable scheduling
  mutations without introducing clinical notes, diagnoses, payments, messaging,
  insurance workflows, or medical-record access.
- Migrate the synthetic generic appointment windows introduced by platform
  foundation task 3.5a into deterministic provider-aware synthetic fixtures.

## Capabilities

### New Capabilities

- `provider-aware-appointment-scheduling`: Practice-managed practitioners,
  services, availability, provider-aware patient booking, and scoped scheduling
  operations.

### Modified Capabilities

None. The platform-foundation change is still active and has not produced an
archived baseline capability to modify; this focused change explicitly depends
on its patient identity, authorization, audit, and basic appointment contracts.

## Impact

- Adds PostgreSQL migrations and Kysely types for practitioners, specialties,
  services, practice/facility assignments, schedules, exceptions, and
  provider-aware slots.
- Extends the NestJS appointment module and adds authorized workforce scheduling
  administration endpoints.
- Extends the patient portal with provider/service discovery and booking, and
  adds workforce scheduling pages using the existing application shell.
- Reuses the existing server sessions, patient context rotation, authorization
  decision service, audit-event store, idempotency controls, and synthetic-only
  local environment.
- Does not require Cognito, IAM, CloudFront, DNS, or other AWS identity changes.
