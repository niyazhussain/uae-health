## Context

Platform-foundation task 3.5a introduces a synthetic appointment boundary in
which a patient operates in one server-selected practice context and books a
generic practice slot. It already provides opaque patient sessions, explicit
pending relationships, PostgreSQL scope constraints, row locking, idempotent
commands, and safe audit evidence. It deliberately does not model doctors,
services, facilities, or workforce scheduling administration.

This change builds on that boundary. It is a synthetic POC and must not be
mistaken for a practitioner credentialing system, production scheduling
service, or clinical record. Patient, scheduler, practice administrator, and
doctor workflows have different data needs, but PostgreSQL remains the single
appointment system of record and the modular NestJS API remains the authority.

## Goals / Non-Goals

**Goals:**

- Represent a doctor or other bookable practitioner independently of a login.
- Let an authorized practice publish services and practitioner availability.
- Let a patient choose a service, a doctor or “any available doctor,” and a
  concrete future slot within one selected practice context.
- Persist one concrete practitioner, service, facility, and slot on every
  consultation appointment.
- Prevent cross-practice disclosure and concurrent double-booking in the
  database, not only in the UI.
- Give authorized scheduling staff safe request, confirmation, decline,
  cancellation, and rescheduling workflows with complete audit evidence.
- Retain accessible patient and workforce experiences using the existing design
  system and session boundaries.

**Non-Goals:**

- Practitioner licensing, regulator integration, credential verification, or a
  master provider index.
- Clinical notes, diagnoses, medical records, prescriptions, telemedicine,
  messaging, insurance eligibility, billing, or payments.
- Patient-provider matching recommendations, waitlists, referrals, recurring
  appointments, group visits, overbooking, or external-calendar synchronization.
- Rooms, equipment, imaging, laboratory, or other non-person resources in the
  first implementation. The schema leaves a resource seam, but only
  practitioners are bookable in this change.
- Cognito, IAM, DNS, CloudFront, or other identity/infrastructure changes.
- Production or real-patient deployment.

## Decisions

### 1. Tenant-owned practitioner profiles are separate from authentication

`practitioners` SHALL be tenant-owned professional display records. A record MAY
have an optional immutable link to one global `application_user`, but it SHALL
not require a workforce login and SHALL never be linked by matching email,
phone, or display name. A practitioner can have explicit assignments to several
practices and facilities inside the tenant. Patient responses expose only the
approved display name, professional title, specialty, and opaque identifiers;
login identity, contact details, membership, licence identifiers, and other
practice relationships remain private.

The application-user link is nullable when the practitioner is created and may
be set once through an explicit authorized workflow. Once set, neither the link
nor the practitioner tenant may be cleared or retargeted. The same global user
may link to at most one practitioner profile inside a tenant and may have a
separate practitioner profile in another tenant. The link is scheduling
metadata only and creates no identity, membership, role, permission, or
provider account.

This is preferred over treating the PHYSICIAN workforce role as the doctor
directory because authorization roles describe what a signed-in person may do,
not where or when a professional is bookable. It also supports practitioners
whose schedules are administered before they receive a portal login.

### 2. Services and specialties are explicit scheduling data

A practice-owned controlled specialty catalogue provides stable classification
without letting one practice change a sibling practice's scheduling
terminology. A practitioner-facility assignment first records that a
tenant-owned practitioner works at one exact practice facility, independently
of services or workforce roles. A separate service-eligibility assignment then
records which appointment services that practitioner may deliver there.

A practice-owned appointment service defines the patient-facing name, duration,
one facility, status, and whether patients may select “any available doctor.”
The POC represents an equivalent offering at another facility as a separate
service record.

The POC stores synthetic display metadata only. It does not claim verified
specialist credentials or encode clinical eligibility rules.

Task 2.2 enforces immutable ownership and reference integrity in PostgreSQL but
does not make status columns authorize publication by themselves. Task 3.1's
serializable catalogue mutations SHALL activate or publish a service only when
the specialty, practitioner, facility assignment, and service eligibility are
all active, and SHALL revalidate that chain for every mutation and discovery
query. Deactivation preserves durable assignment rows and stops new
publication rather than deleting scheduling evidence.

### 3. Weekly templates and exceptions materialize bounded UTC slots

Authorized schedulers manage weekly availability templates in the assigned
facility's IANA timezone plus dated exceptions for leave or closures. A
deterministic, idempotent materializer creates UTC slots for a bounded
eight-week horizon.
Templates are not queried dynamically during booking. Each slot pins its
practitioner assignment, service, facility, start, end, status, and generation
source.

Materialized slots make availability queries bounded and allow PostgreSQL
constraints and row locks to prevent double-booking. Storing only UTC timestamps
without the source timezone was rejected because it makes future schedule edits
and daylight-saving behavior ambiguous outside the UAE.

### 4. “Any available doctor” resolves to a concrete slot before booking

The patient may filter by one practitioner or request any available
practitioner for a service. In both cases the API returns concrete slots with a
safe practitioner summary. A booking command always supplies one opaque slot
identifier; the server revalidates the slot and persists its concrete
practitioner assignment. An appointment with no practitioner is invalid for the
consultation services covered by this change.

This avoids a later asynchronous assignment race and gives the patient clear
information about the booked doctor. Automated provider reassignment is
deferred.

### 5. Server session context remains the only patient scope authority

Patient discovery may run from restricted onboarding only for practices that
explicitly publish synthetic booking data. Practice-owned appointment reads and
mutations derive tenant, practice, patient identity, portal profile or pending
relationship exclusively from the current server session. Browser-supplied
tenant, organization, profile, or practitioner-practice scope is never trusted.

The patient may see only practitioners and slots published for the one practice
being discovered or selected. Responses never aggregate private appointments
or practitioner assignments across practices.

### 6. Workforce scheduling administration uses database authorization

All workforce scheduling endpoints require a workforce server session and a
current database-backed `scheduling.manage` decision for the exact practice.
Any queue or response containing a patient-identifying appointment summary also
requires `patients.read` in that same scope. Practice administrators may
delegate those catalogue permissions through the existing local-role ceiling.
UI visibility does not grant access. Authorization is re-evaluated inside each
serializable mutation that changes a practitioner assignment, service,
availability, slot, or appointment state.

The initial doctor does not receive appointment access merely because a
practitioner record links to the same application user. A later clinical task
must define an explicit own-schedule read permission and its patient-data
contract.

### 7. Appointment state and concurrency remain explicit

Published slots accept one live appointment. `requested` and `confirmed` both
reserve capacity; `declined` and `cancelled` release it. Patient booking creates
a request. Authorized scheduling staff may confirm or decline it. Patient
cancellation and rescheduling use the existing version and idempotency model.
Rescheduling locks the old appointment and new slot, preserves history through
audit evidence, and never silently changes the practitioner.

Composite foreign keys SHALL prove that appointment, patient context, slot,
practitioner assignment, service, facility, tenant, and practice belong to one
scope. A partial unique index SHALL prevent more than one live appointment for a
slot. Command keys remain hashed and scoped by actor, operation, and request
fingerprint; equivalent concurrent retries replay the stored result.

### 8. Safe audit data is transactional

Practitioner/service publication, schedule changes, slot withdrawal, booking,
confirmation, decline, cancellation, rescheduling, and authorization denial
write append-only audit events in the same transaction as the state change.
Audit payloads contain opaque entity identifiers, state/version, scope, and
safe reason codes only. They exclude patient email, provider contact data,
free-text clinical reasons, credentials, session material, and invitation
tokens.

### 9. Existing synthetic appointments receive a synthetic provider

The migration creates one deterministic synthetic physician, specialty,
service, facility assignment, and provider assignment for each current
bookable synthetic practice, then backfills existing slots and appointments.
After validation, provider/service/facility ownership becomes required for
consultation slots. Seed reruns preserve referenced slots and create only
deterministic future synthetic availability.

The API transition is additive until the web client consumes provider-aware
responses. Removal of generic fields occurs only after compatibility tests pass.
Rollback before provider-aware writes may use the migration down path; after
such writes, recovery is forward-only to avoid discarding scheduling evidence.

## Risks / Trade-offs

- **Unverified professional labels could imply credentialing** → Restrict the
  POC to synthetic data, visibly mark fixtures, and do not store or display
  licence claims as verified facts.
- **Recurring-template edits can create large slot churn** → Materialize only an
  eight-week horizon, preserve booked slots, withdraw rather than delete, and
  regenerate with deterministic uniqueness keys.
- **Timezone conversion can produce ambiguous local times** → Persist IANA
  timezone plus local template values, materialize UTC instants server-side,
  and test offset transitions even though UAE practices normally do not observe
  daylight saving.
- **“Any available” may surprise a patient** → Show the concrete practitioner
  on every returned slot and require confirmation before the booking command.
- **Scheduler access can expose patient identity** → Return only the minimum
  safe appointment summary for this POC and defer clinical/contact data to a
  separately authorized capability.
- **Concurrent regeneration and booking can conflict** → Lock assignments and
  slots, use serializable bounded retries, and never withdraw a live booked
  slot inside regeneration.
- **Provider or service deactivation could orphan live requests** → Stop new
  publication immediately, preserve existing appointment evidence, and return
  affected request identifiers to authorized staff for explicit resolution;
  never silently cancel, reassign, or hide an appointment.

## Migration Plan

1. Complete and deliver platform-foundation task 3.5a.
2. Add practitioner/service/schedule tables, composite constraints, statuses,
   audit taxonomy, and reversible synthetic backfill.
3. Add authorized workforce scheduling APIs and slot materialization behind the
   existing module boundary.
4. Extend patient discovery and booking responses while retaining compatibility
   with the current client.
5. Ship workforce and patient UI slices, then remove compatibility fields after
   both clients and migration tests pass.
6. Verify synthetic backup/restore and rollback before any staging deployment.

## Open Questions

None block the synthetic POC. Real practitioner credentialing, own-schedule
doctor access, non-person resources, and production booking policy are deferred
and require separate product and compliance decisions.
