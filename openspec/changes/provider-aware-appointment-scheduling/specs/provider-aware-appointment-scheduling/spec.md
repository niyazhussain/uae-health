## ADDED Requirements

### Requirement: Maintain tenant-owned practitioner profiles

The system SHALL represent a bookable practitioner as a tenant-owned scheduling
record with explicit practice and facility assignments, independently of
workforce authentication. An optional application-user link SHALL use an
immutable identifier and SHALL NOT be inferred from email, phone, display name,
role, or other mutable attributes.

#### Scenario: Add a doctor without a workforce login

- **WHEN** an authorized scheduler creates a synthetic doctor for an in-scope practice and facility
- **THEN** the system creates an active practitioner and assignment without creating a Cognito account, workforce membership, role, or patient-data permission

#### Scenario: Link a practitioner to a workforce user

- **WHEN** an authorized workflow explicitly links a practitioner to one application user by immutable identifier
- **THEN** the link does not change either record's roles, memberships, authentication bindings, or scheduling authorization

#### Scenario: Reject a cross-practice practitioner mutation

- **WHEN** a scheduler attempts to create or change a practitioner assignment outside the scheduler's current organization scope
- **THEN** the system denies the mutation and records safe denial evidence without disclosing the other practice's practitioner data

### Requirement: Maintain specialties and appointment services

The system SHALL maintain practice-owned controlled specialties and active
practice-owned appointment services with a duration, facility, patient-facing
label, and an explicit set of eligible practitioner assignments. A consultation
service SHALL require a concrete practitioner when booked.

#### Scenario: Publish a consultation service

- **WHEN** an authorized scheduler publishes a synthetic consultation service with at least one eligible active doctor and facility
- **THEN** the service becomes discoverable only for that practice with its safe display metadata and configured duration

#### Scenario: Do not treat a workforce role as service eligibility

- **WHEN** a workforce user has the PHYSICIAN role but no active practitioner-service assignment
- **THEN** the system does not publish that person as a bookable doctor for the service

### Requirement: Materialize bounded practitioner availability

The system SHALL convert active weekly practitioner availability and dated
exceptions from the assigned facility's IANA timezone into deterministic UTC
slots for the server-owned facility-local half-open range `[today, today + 56
calendar days)`, emitting only starts after one captured command instant.
Regeneration SHALL be idempotent, SHALL
preserve booked slots, and SHALL withdraw obsolete unbooked slots instead of
deleting historical scheduling evidence. Template windows SHALL use ISO
weekdays, minute resolution, and same-local-day boundaries. Dated exceptions
SHALL apply to either one exact practice facility or one exact
practitioner-facility affiliation using `[start, end)` intervals and approved
exception kinds without free text.
One reconciliation SHALL fail atomically before exceeding 10,000 desired
occurrences. Every generated boundary SHALL reject ambiguous and nonexistent
local instants and SHALL preserve the configured elapsed service duration.

#### Scenario: Generate future doctor slots

- **WHEN** an authorized scheduler publishes weekly availability for an eligible practitioner-service assignment
- **THEN** the system creates non-overlapping future UTC slots that retain the source facility timezone, facility, service, and practitioner assignment

#### Scenario: Apply practitioner leave

- **WHEN** an authorized scheduler adds a dated leave exception
- **THEN** the system withdraws affected unbooked slots and preserves any already booked slot for explicit staff resolution

#### Scenario: Defer withdrawal of a live invalidated slot

- **GIVEN** a requested or confirmed appointment references a slot invalidated by a template, exception, or duration change
- **WHEN** the scheduler reconciles availability
- **THEN** the system retains the immutable slot and overlap reservation, marks it unavailable for discovery and new booking, and returns its opaque appointment identifier for resolution

#### Scenario: Release a deferred withdrawal

- **GIVEN** a live appointment's slot is marked for deferred withdrawal
- **WHEN** cancellation, rescheduling, or a workforce decision releases that appointment
- **THEN** the same transaction re-evaluates current templates and active exceptions and either withdraws the invalid slot or clears the marker only when the occurrence is valid again

#### Scenario: Regenerate the same horizon

- **WHEN** slot materialization is retried with unchanged templates and exceptions
- **THEN** the system produces the same effective slots without duplicates or changes to referenced appointment times

#### Scenario: Reject an invalid timezone boundary

- **WHEN** a weekly template or dated exception resolves to an ambiguous or nonexistent local boundary in the assigned facility timezone
- **THEN** publication is rejected without silently choosing or shifting a UTC instant

#### Scenario: Reject an invalid interior slot boundary

- **WHEN** a template endpoint is valid but a duration-derived interior boundary is ambiguous, nonexistent, or changes the configured elapsed duration
- **THEN** the complete publication command rolls back without partial slots or audit success evidence

#### Scenario: Apply a facility closure

- **WHEN** an authorized scheduler publishes an active closure for one exact practice facility
- **THEN** generated availability inside that interval is withdrawn for that facility only and sibling practices remain unchanged

#### Scenario: Cancel one overlapping exception

- **GIVEN** two active exceptions cover the same occurrence
- **WHEN** an authorized scheduler cancels one exception
- **THEN** the occurrence remains unavailable until no active exception covers it

#### Scenario: Change a service duration

- **WHEN** an authorized scheduler changes a service duration with the current optimistic version
- **THEN** obsolete unbooked occurrences are withdrawn, deterministic replacement occurrences are created, and live referenced slots retain their original identifiers, times, and provider scope

#### Scenario: Bound a publication command

- **WHEN** a requested publication would extend beyond 56 facility-local calendar dates or consider more than 10,000 desired occurrences
- **THEN** the command fails atomically without extending the horizon or persisting partial slot state

#### Scenario: Preserve a shared doctor's sibling-practice booking privately

- **GIVEN** the same tenant practitioner has a live overlapping appointment in a sibling practice
- **WHEN** an authorized scheduler reconciles availability in the current practice
- **THEN** the conflicting occurrence is skipped, the sibling appointment remains unchanged, and only a generic skipped count is returned without its appointment identifier or practice details

#### Scenario: Reject overlapping doctor availability

- **WHEN** a scheduler attempts to publish availability that overlaps another active window for the same practitioner
- **THEN** the system rejects the overlap without affecting other practitioners who work at the same time

#### Scenario: Deactivate a provider with existing requests

- **WHEN** an authorized scheduler deactivates a practitioner assignment or service that has live appointment requests
- **THEN** the system prevents new bookings, preserves those requests and their slots, and returns safe affected-request identifiers for explicit staff resolution

### Requirement: Backfill synthetic generic scheduling data safely

The system SHALL replace every existing synthetic generic consultation slot
and appointment with deterministic provider, service, facility, assignment,
template, and generation ownership without changing referenced slot identifiers
or appointment times. The backfill SHALL fail closed for non-synthetic or
ambiguous generic ownership, and subsequent seed runs SHALL append only
deterministic future provider-aware availability.

#### Scenario: Preserve a referenced synthetic appointment slot

- **WHEN** the provider backfill processes a generic synthetic slot referenced by an appointment
- **THEN** the same slot identifier, UTC start and end, status, appointment reference, and patient scope remain while the exact provider bundle is added to both rows

#### Scenario: Reject ambiguous facility ownership

- **WHEN** a synthetic bookable practice has several possible facilities and no deterministic fixture facility
- **THEN** the backfill aborts without selecting a facility by query order or partially updating scheduling data

#### Scenario: Reject contradictory legacy schedule evidence

- **WHEN** a selected facility timezone differs from its bookable-practice timezone, or one practice has mixed or fractional slot durations
- **THEN** the backfill aborts atomically without inventing a timezone, duration, provider scope, or partial fixture

#### Scenario: Rerun the provider-aware synthetic seed

- **WHEN** the local synthetic seed runs repeatedly across restarts
- **THEN** referenced slots remain unchanged, equivalent future occurrences are reused, and only new deterministic future occurrences are appended

### Requirement: Discover safe provider-aware availability

The patient portal SHALL let an authenticated patient discover a bookable
practice, appointment service, eligible practitioner, and concrete future slot
using safe human-readable labels. Discovery SHALL expose only actively published
synthetic data and SHALL never disclose practitioner login identifiers, contact
details, licence data, private assignments, or another patient's booking.
Every offered slot SHALL include its safe practitioner, specialty or service,
facility, facility timezone, and UTC appointment time for patient review.

#### Scenario: Choose a named doctor

- **WHEN** a patient selects a practice, service, and active doctor
- **THEN** the portal lists only available concrete slots for that exact practice, facility, service, and practitioner

#### Scenario: Choose any available doctor

- **WHEN** a service permits “any available doctor” and the patient selects that option
- **THEN** the API returns available concrete slots with the assigned doctor's safe summary so the patient can confirm the actual practitioner before booking

#### Scenario: Hide another practice assignment

- **WHEN** a practitioner also works for a different practice
- **THEN** discovery in the current practice does not reveal the other assignment, its schedule, or its appointments

### Requirement: Administer the scheduling catalogue in one exact practice

The system SHALL expose database-authorized workforce scheduling catalogue
commands for synthetic practitioners, specialties, services, facility
affiliations, and service eligibility. The server SHALL derive tenant ownership
from the selected organization, SHALL NOT inherit descendant access, and SHALL
re-evaluate `scheduling.manage` inside each serializable mutation. Facility-owned
commands SHALL additionally enforce the actor's facility membership and role
scope. Tenant-global practitioner profile changes SHALL not be available to an
exact-practice scheduler.

#### Scenario: Create a synthetic doctor for one facility

- **WHEN** an authorized scheduler creates a doctor in an exact synthetic practice facility
- **THEN** one active tenant practitioner and one active local facility affiliation commit without creating or changing authentication, membership, role, or patient-data access

#### Scenario: Link a local workforce member explicitly

- **WHEN** an authorized scheduler links an unshared unlinked practitioner to one active synthetic workforce member in the same tenant and practice
- **THEN** the immutable application-user link is set once without exposing email, identity-provider subject, or sibling-practice membership

#### Scenario: Reject inherited or sibling-practice authority

- **WHEN** a caller has only descendant scope, a sibling-practice grant, or a guessed practitioner identifier
- **THEN** the mutation is denied generically, changes no catalogue row, and records privacy-safe denial evidence whenever a valid audit scope can be resolved

#### Scenario: Publish only a complete active service chain

- **WHEN** an authorized scheduler activates a service
- **THEN** the transaction succeeds only when its specialty and at least one exact practitioner, facility affiliation, and service-eligibility chain are active

#### Scenario: Deactivate local provider eligibility

- **WHEN** an authorized scheduler deactivates a facility affiliation, service, or service eligibility with existing live requests
- **THEN** new discovery and booking stop immediately while slots and requests remain unchanged and the response contains a total count, a bounded set of opaque affected appointment identifiers, and an explicit truncation indicator

### Requirement: Make scheduling catalogue commands retry-safe

The system SHALL require a durable idempotency key and approved reason code for
every scheduling catalogue mutation. Updates SHALL also require the expected
last-updated value. Command keys and request payloads SHALL be hashed before
persistence, and current authorization SHALL be checked before command replay.

#### Scenario: Replay an equivalent catalogue command

- **WHEN** the same authorized actor retries one operation, idempotency key, and payload
- **THEN** the original safe result is returned without another catalogue change or success audit event

#### Scenario: Reject a changed idempotency payload

- **WHEN** the same actor reuses an idempotency key with a different scheduling payload
- **THEN** the system returns a conflict and changes no catalogue or audit state

#### Scenario: Reject a stale catalogue update

- **WHEN** a scheduler updates a row using an older `updated_at` value
- **THEN** the command returns a conflict without overwriting the newer lifecycle or configuration state

#### Scenario: Roll back when scheduling audit persistence fails

- **WHEN** a required scheduling success audit event cannot be stored
- **THEN** the catalogue mutation and durable command result both roll back

### Requirement: Bind consultations to one concrete provider and context

Every consultation appointment SHALL belong to one patient identity, one
selected portal profile or pending appointment relationship, one tenant, one
practice, one facility, one service, one practitioner assignment, and one slot.
The API SHALL derive patient scope from the authenticated server session and
SHALL revalidate all provider-aware ownership inside the booking transaction.

#### Scenario: Book a named doctor's slot

- **WHEN** a patient submits an idempotent booking command for a displayed available slot in the current context
- **THEN** the system creates one requested appointment pinned to that slot's concrete doctor, service, facility, practice, and patient scope

#### Scenario: Reject a mismatched provider scope

- **WHEN** a slot, practitioner assignment, service, facility, or patient context belongs to a different tenant or practice
- **THEN** database constraints or transactional validation reject the appointment without reserving capacity or exposing the mismatched record

#### Scenario: Prevent concurrent double booking

- **WHEN** two patients concurrently request the same provider slot
- **THEN** exactly one live appointment reserves it and the other request receives a safe conflict response

#### Scenario: Replay an equivalent booking retry

- **WHEN** the same patient concurrently retries the same booking key and payload
- **THEN** the system returns the original stored result and does not create another appointment or audit success event

### Requirement: Manage appointment request decisions

The system SHALL allow an authorized scheduler with current `scheduling.manage`
and `patients.read` permissions in the exact practice to review safe
patient-identifying appointment summaries and confirm or decline a requested
appointment. `requested` and `confirmed` appointments SHALL reserve provider
capacity; `declined` and `cancelled` appointments SHALL not.

#### Scenario: Confirm an appointment request

- **WHEN** an in-scope authorized scheduler confirms a current requested appointment
- **THEN** the system records the confirmed state and version atomically without changing its patient, doctor, service, facility, or slot

#### Scenario: Decline an appointment request

- **WHEN** an in-scope authorized scheduler declines a current requested appointment using an approved reason code
- **THEN** the system releases the slot, records safe audit evidence, and does not include clinical or free-text patient data

#### Scenario: Deny an unauthorized decision

- **WHEN** a workforce user lacks current `scheduling.manage`, `patients.read`, or exact organization scope
- **THEN** the system denies the appointment decision and records a privacy-safe authorization denial

### Requirement: Preserve provider integrity during patient changes

Patient cancellation and rescheduling SHALL use the current patient context,
optimistic version, idempotency key, serializable transaction, and safe audit
rules. A reschedule SHALL select another concrete provider-aware slot and SHALL
never silently assign or change a doctor.

#### Scenario: Reschedule with the same doctor

- **WHEN** a patient chooses another available slot belonging to the same practitioner assignment
- **THEN** the appointment moves to that slot, increments its version, and releases the previous slot atomically

#### Scenario: Reschedule with a different doctor

- **WHEN** a patient explicitly chooses a concrete slot with a different eligible doctor and confirms that selection
- **THEN** the appointment records the new practitioner and slot with an audited version change

#### Scenario: Reject a stale reschedule

- **WHEN** the submitted appointment version or chosen slot is no longer current
- **THEN** the system returns a safe conflict without changing either slot reservation

### Requirement: Keep scheduling administration provider-neutral and database-authorized

Scheduling roles, permissions, practitioner records, and appointment states SHALL
remain HIS database data. Cognito or another identity provider SHALL authenticate
workforce and patient users only and SHALL NOT store practitioner assignments,
specialties, services, schedules, slots, or appointment authorization.

#### Scenario: Change identity provider without changing schedules

- **WHEN** a workforce or patient authentication binding moves to another approved identity provider
- **THEN** existing practitioner schedules and appointments remain associated through HIS immutable application identities and scoped records

#### Scenario: Do not grant access from a practitioner link

- **WHEN** an application user is linked to a practitioner profile
- **THEN** the link alone grants no scheduling, patient, clinical, or administrative permission

### Requirement: Record privacy-safe scheduling audit evidence

The system SHALL append transactional audit evidence for practitioner and service
publication, availability changes, slot withdrawal, appointment booking,
confirmation, decline, cancellation, rescheduling, and denied scheduling
operations. Audit data SHALL use opaque identifiers, scope, state/version, and
approved reason codes and SHALL exclude credentials, tokens, patient email,
provider contact data, and free-text clinical information.

#### Scenario: Commit a provider-aware booking audit event

- **WHEN** a patient appointment is successfully requested
- **THEN** the appointment and one safe success event commit together with identifiers for the patient context, practitioner assignment, service, facility, slot, and appointment version

#### Scenario: Roll back when audit persistence fails

- **WHEN** required audit evidence cannot be written during a scheduling mutation
- **THEN** the entire state change and slot reservation roll back

### Requirement: Provide accessible patient and workforce scheduling interfaces

The web application SHALL provide responsive, keyboard-operable scheduling
pages with explicit loading, empty, validation, conflict, confirmation, success,
and permission-denied states. Patient UI SHALL use patient-facing doctor and
service language; workforce UI SHALL use operational scheduling language and
SHALL not rely on frontend state for authorization.

#### Scenario: Patient selects doctor and time by keyboard

- **WHEN** a keyboard user navigates the patient booking flow
- **THEN** practice, service, doctor or any-doctor choice, concrete slot, and confirmation remain labelled, ordered, and operable without pointer input

#### Scenario: Scheduler has no permission

- **WHEN** a workforce user opens scheduling administration without current API authorization
- **THEN** the page presents a clear permission-denied state and does not display cached or placeholder practitioner schedules
