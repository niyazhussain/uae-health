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
slots for a bounded eight-week horizon. Regeneration SHALL be idempotent, SHALL
preserve booked slots, and SHALL withdraw obsolete unbooked slots instead of
deleting historical scheduling evidence. Template windows SHALL use ISO
weekdays, minute resolution, and same-local-day boundaries. Dated exceptions
SHALL apply to either one exact practice facility or one exact
practitioner-facility affiliation using `[start, end)` intervals and approved
exception kinds without free text.

#### Scenario: Generate future doctor slots

- **WHEN** an authorized scheduler publishes weekly availability for an eligible practitioner-service assignment
- **THEN** the system creates non-overlapping future UTC slots that retain the source facility timezone, facility, service, and practitioner assignment

#### Scenario: Apply practitioner leave

- **WHEN** an authorized scheduler adds a dated leave exception
- **THEN** the system withdraws affected unbooked slots and preserves any already booked slot for explicit staff resolution

#### Scenario: Regenerate the same horizon

- **WHEN** slot materialization is retried with unchanged templates and exceptions
- **THEN** the system produces the same effective slots without duplicates or changes to referenced appointment times

#### Scenario: Reject an invalid timezone boundary

- **WHEN** a weekly template or dated exception resolves to an ambiguous or nonexistent local boundary in the assigned facility timezone
- **THEN** publication is rejected without silently choosing or shifting a UTC instant

#### Scenario: Apply a facility closure

- **WHEN** an authorized scheduler publishes an active closure for one exact practice facility
- **THEN** generated availability inside that interval is withdrawn for that facility only and sibling practices remain unchanged

#### Scenario: Reject overlapping doctor availability

- **WHEN** a scheduler attempts to publish availability that overlaps another active window for the same practitioner
- **THEN** the system rejects the overlap without affecting other practitioners who work at the same time

#### Scenario: Deactivate a provider with existing requests

- **WHEN** an authorized scheduler deactivates a practitioner assignment or service that has live appointment requests
- **THEN** the system prevents new bookings, preserves those requests and their slots, and returns safe affected-request identifiers for explicit staff resolution

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
