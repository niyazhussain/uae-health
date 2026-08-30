## 1. Dependency and contract baseline

- [x] 1.1 Deliver platform-foundation task 3.5a and verify its patient session, practice isolation, idempotency, audit, and appointment migration contracts on `main`.
- [x] 1.2 Review and approve the provider, service, facility, availability, appointment-state, and synthetic-data boundaries documented by this change before implementation begins.

## 2. Provider scheduling data model

- [x] 2.1 Add reversible migrations and Kysely types for tenant-owned practitioner profiles and optional explicit immutable application-user links that grant no access; practice and facility assignments remain task 2.2.
- [x] 2.2 Add practice-owned specialties and appointment services, reuse scoped facilities, and add separate practitioner-facility affiliations plus practitioner-service eligibility with tenant and practice ownership constraints.
- [x] 2.3 Add weekly availability templates, dated exceptions, provider-aware materialized slots, non-overlap protection, and composite scope constraints.
- [x] 2.4 Backfill the generic synthetic appointment fixtures with deterministic synthetic practitioners and services, atomically copy exact slot scope into existing appointments, update interim booking persistence, and preserve referenced slot times and restart-safe seed behavior.

## 3. Workforce scheduling API

- [x] 3.1 Implement exact-practice, database-authorized, durably idempotent practitioner, specialty, service, and assignment management APIs protected by `scheduling.manage`, with optimistic concurrency and active-chain booking enforcement.
- [x] 3.2 Implement authorized availability-template, exception, service-duration, and bounded eight-week slot-materialization APIs with DST-rejecting idempotent regeneration, deferred live-slot withdrawal, and booked-slot preservation.
- [x] 3.3 Implement exact-facility workforce appointment queues and versioned idempotent confirm and decline commands requiring both `scheduling.manage` and `patients.read`, closed reason codes, transactional audit evidence, deferred-slot release, and patient read compatibility.

## 4. Patient provider-aware API

- [x] 4.1 Extend safe patient discovery with practice services, eligible practitioner summaries, named-doctor filtering, any-available-doctor selection, and concrete provider-aware slots.
- [ ] 4.2 Extend booking to persist a concrete practitioner, service, facility, and slot while retaining session-derived practice scope, durable idempotency replay, and double-booking protection.
- [ ] 4.3 Extend patient cancellation and rescheduling so an explicit concrete replacement slot controls any provider change and stale versions fail safely.

## 5. Scheduling interfaces

- [ ] 5.1 Add workforce scheduling catalogue pages for practitioners, specialties, services, facilities, and eligible assignments with explicit loading, empty, denied, validation, and success states.
- [ ] 5.2 Add workforce availability pages for weekly templates, exceptions, affected live requests, and bounded slot publication.
- [ ] 5.3 Add the scoped workforce appointment queue with confirm and decline controls, conflict handling, and permission-denied states.
- [ ] 5.4 Upgrade the patient booking journey to practice, service, doctor or any-doctor, concrete time, and confirmation steps while keeping one selected practice context at a time.
- [ ] 5.5 Verify responsive keyboard operation, labels, focus management, status announcements, and patient-versus-workforce terminology across the new scheduling pages.

## 6. Assurance and delivery

- [ ] 6.1 Add migration and database integration tests for composite scope constraints, backfill safety, regeneration idempotency, booked-slot preservation, and rollback behavior.
- [ ] 6.2 Add API tests for exact-practice dual-permission authorization, provider privacy, status transitions, safe audit payloads, concurrent booking, and equivalent idempotency replay.
- [ ] 6.3 Run API lint, build, unit, and database suites; run web lint and build; validate this OpenSpec strictly; then complete synthetic local QA before requesting commit and push approval.
