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
eight-week horizon. Each command captures one server time and reconciles the
facility-local half-open date range `[today, today + 56 calendar days)`. It
emits only slot starts strictly after that captured instant; clients cannot
choose or extend the publication horizon. One reconciliation may consider at
most 10,000 desired occurrences and otherwise fails atomically. Templates use
ISO weekdays and minute-resolution,
same-local-day windows; an overnight schedule is represented as two templates.
The facility timezone is copied onto each immutable template as source
evidence. An edit deactivates and replaces a template rather than retargeting
the generation source.

The API uses a pinned Temporal implementation to construct every local
boundary in the locked facility IANA timezone with rejection semantics. It
rejects a gap or fold, verifies the exact local round trip, and verifies that
the elapsed UTC minutes equal the service duration for every candidate
boundary, including interior boundaries and minute `1440`. Calendar dates are
iterated as local dates rather than fixed elapsed 24-hour increments. Canonical
local exception evidence remains a minute-precision timezone-less string; it
is never parsed through the host process timezone.

The materializer divides a window into contiguous slots using the appointment
service's current `duration_minutes` and discards a trailing remainder shorter
than one service duration. It rejects ambiguous or nonexistent local-time
boundaries at an offset transition instead of silently choosing or shifting an
instant. A later service-duration change withdraws obsolete unbooked slots and
creates a new deterministic generation, while referenced slots retain their
original times. Duration changes lock affected slot rows before the service row
and reconcile every active template for that service in the same serializable
command.

Dated exceptions use immutable `[start, end)` boundaries and retain both the
validated local timestamp evidence and resolved UTC instants with the source
timezone. `facility_closed` applies only to the exact practice facility and all
its practitioners; `practitioner_unavailable` applies only to one exact
practitioner-facility affiliation and all services delivered there. Full-day
exceptions use local midnight to the following local midnight. Overlapping
active exceptions may coexist because their effective unavailability is the
union of those intervals; cancellation changes lifecycle state without deleting
evidence. An exception may cover only the current facility-local publication
horizon, although its start may be earlier on the current local date so an
emergency same-day closure can remove remaining future capacity. No free-text
or clinical reason is stored.

Templates are not queried dynamically during booking. Each materialized slot
pins its practitioner facility assignment, service eligibility, service,
facility, source template, source local date and timezone, UTC start/end,
status, deferred-withdrawal state, and deterministic SHA-256 generation key.
The generation key remains exactly
`sha256("uae-health:synthetic-provider-slot:v1|<template-id>|<local-date>|<start-epoch-seconds>|<end-epoch-seconds>")`
so migrated, seeded, and API-generated occurrences converge. Exact retries
reuse the same row only after every immutable scope and time field matches.
PostgreSQL exclusion constraints reject overlapping available slots for
the same tenant-owned practitioner across services, facilities, and practices,
while allowing different practitioners to work simultaneously. Adjacent
`[start, end)` intervals do not overlap.

Provider fields are added to existing generic appointment slots as one nullable
all-or-none bundle so task 2.3 remains additive. Task 2.4 backfills the existing
synthetic slots and appointments, validates the ownership chain, and only then
makes provider ownership mandatory. Appointments receive a matching nullable
provider-scope bundle and a composite reference to their chosen slot during the
same expand phase, so an appointment can never claim a provider different from
its slot. Task 2.4 backfills each referenced slot and appointment atomically and
updates the interim booking writer to copy the server-resolved slot scope before
provider-aware slots become bookable; task 4.2 then exposes the full
provider-aware booking contract. The legacy practice/start uniqueness is replaced with a partial
generic-slot index so multiple provider-aware slots can start at the same
practice and time without breaking the interim generic seed.

An `active` template is not publication authority by itself. Task 3.2 SHALL
validate IANA timezone inputs, the complete active catalogue chain, exceptions,
the eight-week bound, and materialized slots in one serializable transaction.
If overlap or materialization fails, template activation rolls back.

Template creation defaults to inactive. Activation and explicit reconciliation
materialize atomically. Editing an immutable definition is one command that
deactivates the old template and creates a replacement; an identical definition
reuses the existing row instead of creating a duplicate. Exception creation is
active and reconciles immediately. Cancelling an exception is terminal and
reconciles the union of all remaining active exceptions, so cancelling one of
several overlapping exceptions does not restore capacity.

An obsolete unbooked occurrence is retained and marked `withdrawn`. If it is
desired again by the same active immutable template, has no live appointment,
and no active exception covers it, reconciliation may reactivate that exact
row. An obsolete slot with a requested or confirmed appointment remains
`available` to preserve the practitioner overlap reservation but is marked
`withdrawal_pending`; patient discovery and new booking exclude pending slots.
When cancellation, rescheduling, or a later workforce decision releases the
live appointment, the same transaction re-evaluates the current template and
exception union and either clears the pending marker when the occurrence is
valid again or moves the slot to `withdrawn`. New generated intervals that
overlap a preserved live or pending slot are skipped and reported for explicit
staff resolution.

Task 3.2 availability mutations use the task 3.1 exact-practice/facility
authorization, durable command, optimistic concurrency, approved reason, and
audit machinery. They acquire transaction-scoped scheduling mutexes keyed by
tenant and practitioner, without a practice component, in stable practitioner
order so a shared doctor serializes across sibling practices. They reauthorize
before replay on every bounded serializable
attempt, lock slots deterministically, and commit catalogue state, slot state,
safe audit evidence, and the command result together. Responses report created,
reactivated, withdrawn, and preserved-live counts plus at most 100 opaque live
appointment identifiers from the authorized practice and an explicit
truncation flag. A live blocker in a sibling practice may increase only a
generic skipped count; its appointment identifier is never disclosed.

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

Task 4.1 adds only additive, context-scoped discovery reads. It introduces
`GET /v1/patient-appointments/services` and
`GET /v1/patient-appointments/practitioner-options?appointmentServiceId=<uuid>`,
and enriches the existing `GET /v1/patient-appointments/availability` response.
Every route derives the patient identity, tenant, practice, and bookable
practice from the current server-selected practice or appointment-onboarding
relationship. The browser never supplies those scope identifiers.

Patient-facing doctor selection uses a neutral `practitionerOptionId` backed by
the exact active practitioner-service assignment. It does not expose or accept
the tenant-global practitioner identifier, application-user link, facility
assignment identifier, or another service/practice assignment. The option is
therefore local to one exact practice, facility, and service and cannot be used
as a stable cross-practice correlation key. Booking continues to accept only a
concrete slot identifier.

A filtered availability request supplies an appointment service plus an
explicit `selectionMode=named|any`. `named` also requires one exact
`practitionerOptionId`; `any` forbids an option identifier and is available only
when the locked service permits any practitioner. Missing, mixed, inactive,
wrong-service, or sibling-scope targets fail generically without echoing a
label or identifier. A valid selection with no open capacity returns an empty
page. The zero-filter availability request remains as a temporary additive
compatibility view of concrete slots across the selected practice; it is not an
implicit any-doctor selection and may include named-only services.

Service discovery returns an active synthetic service and specialty only when
at least one complete active synthetic practitioner eligibility exists in the
same exact practice facility. Practitioner options remain visible while that
eligibility is active even if no slot is currently open, allowing an explicit
empty-availability state. Concrete slots additionally require a future,
available, synthetic, non-pending row with the exact provider bundle and no
`requested` or `confirmed` appointment. Materialized slot state remains the
availability authority; discovery does not dynamically reinterpret template
or exception state.

Responses use a strict allowlist. A service exposes its opaque identifier,
patient-facing name, duration, any-practitioner setting, safe specialty opaque
identifier and label, and exact facility opaque identifier, name, and timezone.
A practitioner option exposes only its local option identifier, display name,
and professional title. Every slot retains the
legacy `slotId`, `startsAt`, and `endsAt` fields and adds those safe service,
specialty, facility, and concrete-doctor summaries. Internal codes, statuses,
source template/generation evidence, patient or appointment identifiers,
login/contact/licence data, and sibling assignments are excluded. The legacy
top-level timezone remains temporarily for the existing client; each facility
timezone is authoritative for its offered service and slot.

All three lists use page-number pagination with deterministic opaque-ID
tie-breaks. Page size defaults to 25 and is capped at 100. Services order by
patient-facing name then service identifier; options order by display name,
professional title, then option identifier; slots order by UTC start, option
identifier, then slot identifier. Availability starts strictly after one
server-captured instant and can expose only rows inside the server-owned
materialized publication horizon.

Task 4.2 keeps the booking command deliberately small: `POST
/v1/patient-appointments` accepts an idempotency key and one concrete `slotId`
only. Each serializable attempt captures one server instant, locks and
revalidates the exact persisted patient session and selected profile or pending
relationship, then locks a slot through the same active-chain, future-time, and
facility-local 56-day publication predicate used by discovery. The appointment
copies the locked slot's complete provider bundle; no provider, facility,
service, tenant, practice, profile, or relationship identifier is accepted as
booking scope from the browser.

A new booking result retains the legacy appointment identifier, lifecycle,
UTC time, version, and change flags, and additively includes the concrete
`slotId`, safe service/specialty/facility summary, and service-local
`practitionerOption`. The durable result uses the same strict response allowlist
and is returned with `Cache-Control: no-store`. A command snapshot written
before task 4.2 remains replayable in its exact legacy form; a new or partially
expanded snapshot must contain the complete safe provider-aware response
bundle. Booking, durable command evidence, facility-scoped audit evidence, and
the provider reservation commit together.

### 5. Server session context remains the only patient scope authority

Patient discovery may run from restricted onboarding only for practices that
explicitly publish synthetic booking data. Practice-owned appointment reads and
mutations derive tenant, practice, patient identity, portal profile or pending
relationship exclusively from the current server session. Browser-supplied
tenant, organization, profile, or practitioner-practice scope is never trusted.
Every patient mutation attempt, including durable-command replay after a
concurrent race, re-locks the exact session row and verifies that it is
unrevoked, unexpired, bound to the same active patient identity and application
user, and still stores the exact selected profile or appointment relationship.
A rotated, revoked, expired, or identity-disabled session cannot replay a prior
command result.

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

Task 3.3 exposes a facility-scoped, bounded workforce request queue. Every queue
read and decision requires both `scheduling.manage` and `patients.read` for the
same active workforce actor, direct practice membership, exact practice, and
requested facility. The facility identifier is mandatory and is validated
before any appointment lookup or durable-command replay. A queue row may expose
the patient's approved display name; appointment, slot, practitioner, service,
and facility identifiers and safe labels; UTC timing; lifecycle state and
version; and creation/update timestamps. It excludes email, username,
application-user and identity-provider identifiers, portal profile or pending
relationship identifiers, other practice relationships, and clinical data.
Rows remain visible when a provider chain is inactive or the slot is pending
withdrawal because those are precisely the requests staff must resolve.
`GET /v1/admin/scheduling/appointments` orders by slot start and appointment
identifier, defaults to the live `requested|confirmed` states, accepts an exact
status plus practitioner or service filters, and returns at most 100 rows per
page. The single decision route is
`PATCH /v1/admin/scheduling/appointments/:appointmentId/status`.

One `requested -> confirmed|declined` status command requires the expected
version, a durable idempotency key, and a closed reason code. Confirmation uses
`appointment-request-confirmed`. Decline uses one of
`appointment-request-provider-unavailable`,
`appointment-request-service-unavailable`, or
`appointment-request-scheduling-conflict`; no free text is accepted. Current
dual authorization is evaluated inside every bounded-retry serializable attempt
before replay. An equivalent retry returns its original safe response, while a
changed payload, stale version, or already-decided appointment conflicts.
`updated_at` plus transactional audit evidence records the decision time and
actor; separate provider- or patient-identifying decision columns are not
stored. “Current requested appointment” means the locked status and optimistic
version are current; the POC permits staff to resolve an overdue request and
does not treat confirmation as attendance or clinical evidence.

Confirming preserves the exact patient/provider/slot bundle and live capacity,
including an existing `withdrawal_pending` marker for explicit follow-up.
Declining releases capacity and, in the same transaction, invokes the shared
deferred-slot resolver: an invalid pending slot becomes withdrawn, while a slot
that is valid again becomes available. Queue reads and decisions deliberately
do not require a currently active provider chain, so deactivation cannot hide a
live request. Task 3.3 expands patient read responses to represent confirmed and
declined states without defining new patient mutations; confirmed cancellation
or rescheduling behavior remains task 4.3.

Task 4.3 permits a patient to cancel a future `requested` or `confirmed`
appointment in the current locked patient session and context. Cancellation
retains the immutable appointment and provider evidence, moves the appointment
to `cancelled`, increments its optimistic version, releases capacity, and
reconciles a deferred-withdrawal slot in the same serializable transaction.
`declined`, `cancelled`, and started appointments are terminal for patient
changes.

Patient rescheduling accepts only an opaque concrete replacement slot and the
current appointment version. The replacement must belong to the same exact
practice, facility, and appointment service as the current appointment; it may
belong to another active eligible practitioner only because the patient chose
that concrete slot. A current `requested` appointment remains `requested`; a
current `confirmed` appointment returns to `requested` so workforce staff must
approve the new time and provider. The old and new provider bundles, patient
context identifiers, version transition, and released-slot disposition are
recorded as privacy-safe opaque audit evidence. Every cancellation and
reschedule re-locks the exact patient session and stored context before replay,
uses one captured server time, and returns a no-store response.

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

Fixture identifiers are namespace-derived from the opaque bookable-practice
identifier rather than database discovery order. The backfill uses the
deterministic synthetic facility when it already exists; otherwise it may use
the practice's one existing synthetic facility or create the deterministic
facility when none exists. It fails closed when only non-synthetic facilities
exist or several non-deterministic synthetic facilities make the choice
ambiguous. It never selects the first facility returned by a query.

The generated facility code derives from the namespace-derived facility
identifier rather than a truncated structured practice identifier. An existing
facility's IANA timezone must match the legacy bookable-practice timezone;
otherwise the migration aborts instead of choosing between contradictory local
schedule interpretations. The service duration is the practice's one distinct
positive whole-minute legacy slot duration, or 30 minutes only when it has no
slots. Mixed durations fail closed, and seed reruns retain the persisted
duration and exact facility chain.

Each legacy slot receives the template matching its source local weekday,
window, and facility timezone. The migration and seed use the same deterministic
template identifier and SHA-256 occurrence key, so a later seed retry reuses the
backfilled slot instead of moving or duplicating it. Slot and appointment
provider bundles are populated in one transaction before every provider column
becomes required. The interim booking and rescheduling writer copies those
values only from the locked server-resolved slot. A slot may end at exact local
midnight, represented as template minute 1440; other cross-day legacy windows
remain unsupported and abort the backfill.

The migration records the exact rows it backfilled for a safe pre-write down
path. Rollback refuses when provider-aware rows created after the backfill are
present; after the provider-aware seed or application writes new rows, recovery
is forward-only. Unsupported non-synthetic or ambiguous generic fixtures abort
the up migration without partially changing scheduling data.

The API transition is additive until the web client consumes provider-aware
responses. Removal of generic fields occurs only after compatibility tests pass.
Rollback before provider-aware writes may use the migration down path; after
such writes, recovery is forward-only to avoid discarding scheduling evidence.

### 10. Catalogue administration is exact-practice, idempotent, and local in scope

Task 3.1 exposes provider-neutral workforce scheduling APIs under
`/v1/admin/scheduling`. The browser supplies an opaque organization identifier
and, for facility-owned operations, an opaque facility identifier. The API
derives the tenant from PostgreSQL, requires one active workforce identity, an
active direct membership, and a current database-backed `scheduling.manage`
assignment for that exact practice. Descendant grants are not inherited.
Practice-wide catalogue mutations require an organization-wide assignment;
facility-owned mutations may use either that organization-wide assignment or a
matching facility-scoped assignment and facility membership. Authorization is
re-evaluated inside every bounded-retry serializable mutation.

The POC APIs operate only on active synthetic tenants and on existing synthetic
practices and facilities; practices and facilities do not yet have separate
lifecycle columns. The server owns every `is_synthetic` value. A scheduler
may create a tenant practitioner together with its first active exact-practice
facility affiliation, but task 3.1 does not expose tenant-global practitioner
display, title, or lifecycle edits. A one-time application-user link is allowed
only while all practitioner affiliations belong to the requesting practice and
the target is one unambiguous active synthetic workforce member of that same
tenant and practice. An existing linked practitioner may gain an affiliation in
another practice only when that linked user is an active member there. These
rules support an explicit shared doctor without making a guessed practitioner
identifier an authority or exposing sibling-practice assignments.

Specialties are created active and may be renamed or terminally retired after
all dependent services are inactive. Services are created inactive. Service
eligibility may be activated while its service is still inactive after the
practitioner, specialty, and facility affiliation are revalidated; service
activation then requires at least one complete active eligibility chain.
Affiliations and eligibility rows are deactivated rather than deleted.
Deactivating an affiliation also deactivates its local service eligibility and
does not silently restore it later. Deactivation preserves slots and live
appointments and returns the total affected count, at most 100 opaque affected
appointment identifiers, and an explicit truncation flag. Task 3.3's scoped
work queue provides the paginated resolution path when that bounded evidence is
truncated.
Service duration is selected at creation and is not mutable through task 3.1;
task 3.2 owns duration changes together with slot withdrawal and regeneration.

Every scheduling mutation requires an `Idempotency-Key`, an approved closed
reason code, and, for updates, the expected `updated_at` value. PostgreSQL stores
only hashes of the command key and request fingerprint plus the safe response
snapshot, scoped to the immutable application user, operation, tenant, and
practice. Current authorization is checked before replay. An equivalent retry
returns the original result, a changed payload under the same key conflicts,
and a stale update conflicts without overwriting a newer decision. Approved
reason codes map server-side to canonical audit prose; raw free text is never
stored. Success audit evidence and the durable command result commit in the
same transaction. A lost authorization commits no domain change and writes a
separate privacy-safe denial event before returning a generic forbidden result.

All catalogue reads and patient availability/booking queries revalidate the
complete active practitioner, specialty, facility-affiliation, service, and
service-eligibility chain. Consequently a local deactivation immediately stops
new discovery and booking while existing requests and their immutable provider
evidence remain available for explicit staff resolution.

Task 5.1 adds `/scheduling/catalogue` to the existing workforce application
shell. One exact-practice context drives four keyboard-operable views for
practitioners, specialties, services, and facilities. The facility view is a
read-only scheduling context summary because facility creation and ownership
remain an operations responsibility; scheduling mutations manage practitioner
affiliations and service eligibility against those existing facilities.

The catalogue UI never derives authority from visible controls. It loads the
authorized scheduling contexts from the API, clears stale catalogue data when
the practice changes, and presents explicit loading, empty, denied, validation,
conflict, and success states. Create and lifecycle commands generate a fresh
idempotency key, use one approved closed reason code selected by the workflow,
and send the current optimistic `updatedAt` value for status changes. It does
not ask for or persist free-text audit reasons, practitioner login data,
credentials, patient data, or sibling-practice assignments.

Catalogue terminology is explained with visible contextual guidance and
keyboard-focusable information tooltips. Information icons remain visually
distinct from pause and play lifecycle icons, and lifecycle actions use visible
button boundaries rather than appearing as informational labels. When every
authorized facility or eligible practitioner is already assigned, the
corresponding action is disabled and labelled as complete instead of opening an
empty dialog. Eligible practitioners within a service are presented as one
vertically aligned list with separate practitioner, eligibility-status, and
lifecycle-action columns; narrow screens stack each row without changing its
reading order.

## Risks / Trade-offs

- **Unverified professional labels could imply credentialing** → Restrict the
  POC to synthetic data, visibly mark fixtures, and do not store or display
  licence claims as verified facts.
- **Recurring-template edits can create large slot churn** → Materialize only an
  eight-week horizon, preserve booked slots, withdraw rather than delete, and
  regenerate with deterministic uniqueness keys.
- **Timezone conversion can produce ambiguous local times** → Persist IANA
  timezone plus local template values, materialize UTC instants server-side,
  reject ambiguous or nonexistent boundaries, and test offset transitions even
  though UAE practices normally do not observe daylight saving.
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
