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
Discovery SHALL derive its practice scope only from the current authenticated
patient session and SHALL expose a practice/service-local opaque practitioner
option rather than a tenant-global practitioner or workforce identifier.
Services, practitioner options, and slots SHALL use bounded deterministic
pagination with a maximum page size of 100.

Filtered availability SHALL require an appointment service and an explicit
`named` or `any` selection mode. Named selection SHALL require one eligible
practitioner option for that exact service; any-practitioner selection SHALL
forbid an option identifier and SHALL be available only when the service
explicitly permits it. A zero-filter request MAY retain the existing concrete
slot overview for additive client compatibility, but SHALL NOT be treated as an
implicit any-practitioner choice.

#### Scenario: Discover safe services and practitioner options

- **WHEN** a patient lists services and eligible practitioner options in the current selected practice context
- **THEN** the system returns only complete active synthetic chains in that exact practice and facility with approved labels and local opaque option identifiers, even when a valid option currently has no open slot

#### Scenario: Preserve the existing concrete-slot overview

- **WHEN** the existing patient client requests availability without provider filters
- **THEN** the system returns a bounded page of concrete provider-aware slots while preserving each legacy slot identifier and UTC start/end field

#### Scenario: Choose a named doctor

- **WHEN** a patient selects a practice, service, and active doctor
- **THEN** the portal lists only available concrete slots for that exact practice, facility, service, and practitioner

#### Scenario: Choose any available doctor

- **WHEN** a service permits “any available doctor” and the patient selects that option
- **THEN** the API returns available concrete slots with the assigned doctor's safe summary so the patient can confirm the actual practitioner before booking

#### Scenario: Reject incomplete or cross-scope discovery filters

- **WHEN** a patient omits the explicit selection mode, mixes named and any-practitioner inputs, guesses an inactive or sibling service/option, or uses an option for another service
- **THEN** the system returns a generic safe validation or unavailable response without echoing the target or disclosing any label

#### Scenario: Return an empty valid selection

- **WHEN** an active in-scope service and practitioner selection currently has no open future slot
- **THEN** the system returns a successful empty availability page without weakening the provider or practice filter

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
The booking command SHALL accept only a durable idempotency key and one opaque
concrete slot identifier. Every serializable attempt SHALL use one captured
server instant to revalidate the exact active persisted session and selected
context, future slot, complete active synthetic publication chain, and
facility-local 56-day publication horizon. A new booking response SHALL retain
the legacy appointment fields and add the concrete slot, safe service,
specialty, facility, facility timezone, and service-local practitioner option;
it SHALL be non-cacheable and SHALL exclude global practitioner, authentication,
contact, internal catalogue code, and sibling-assignment data.

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

#### Scenario: Reject replay from a rotated patient session

- **GIVEN** a patient booking command has a durable result
- **WHEN** the original patient session is revoked, expired, rotated to another context, or no longer belongs to an active patient identity and application user
- **THEN** a retry through that stale session is denied before replay without changing the appointment, command, slot, or audit evidence

### Requirement: Manage appointment request decisions

The system SHALL allow an authorized scheduler with current `scheduling.manage`
and `patients.read` permissions in the exact practice to review safe
patient-identifying appointment summaries and confirm or decline a requested
appointment. `requested` and `confirmed` appointments SHALL reserve provider
capacity; `declined` and `cancelled` appointments SHALL not.

The queue and decision SHALL be scoped to one required exact facility. The two
permissions SHALL resolve to the same active actor and direct practice
membership before appointment lookup or command replay. Responses MAY include
the patient's display name and safe scheduling labels but SHALL exclude patient
contact data, application-user and identity-provider identifiers, portal
profile or pending-relationship identifiers, sibling-practice data, provider
login data, and clinical information. Decisions SHALL require the current
version, a durable idempotency key, and a closed approved reason code without
free text.

#### Scenario: Review one facility request queue

- **WHEN** an authorized scheduler lists appointment requests for one exact practice facility
- **THEN** the system returns a bounded deterministic page of safe summaries, including requests whose provider chain is inactive or whose slot is pending withdrawal, without exposing another facility or practice

#### Scenario: Confirm an appointment request

- **WHEN** an in-scope authorized scheduler confirms a current requested appointment
- **THEN** the system records the confirmed state and version atomically without changing its patient, doctor, service, facility, or slot

#### Scenario: Confirm an invalidated live request explicitly

- **GIVEN** a requested appointment retains an available slot marked for deferred withdrawal
- **WHEN** an authorized scheduler confirms the request
- **THEN** the appointment remains the live capacity reservation and the pending marker remains for explicit follow-up

#### Scenario: Decline an appointment request

- **WHEN** an in-scope authorized scheduler declines a current requested appointment using an approved reason code
- **THEN** the system releases the slot, records safe audit evidence, and does not include clinical or free-text patient data

#### Scenario: Decline a request on a pending-withdrawal slot

- **WHEN** an authorized scheduler declines the only live request on a slot marked for deferred withdrawal
- **THEN** the same transaction re-evaluates current availability and either withdraws the invalid slot or restores it only when it is valid again

#### Scenario: Replay an equivalent appointment decision

- **WHEN** the same currently authorized actor retries one decision key and unchanged payload
- **THEN** the original safe result is returned without another state change or success audit event

#### Scenario: Reject a stale or changed appointment decision

- **WHEN** a decision uses a stale version, targets an appointment no longer requested, or reuses its key with another payload
- **THEN** the system returns a safe conflict without changing appointment, slot, command, or audit state

#### Scenario: Deny an unauthorized decision

- **WHEN** a workforce user lacks current `scheduling.manage`, `patients.read`, or exact organization scope
- **THEN** the system denies the appointment decision and records a privacy-safe authorization denial

#### Scenario: Preserve patient read compatibility

- **WHEN** a workforce decision changes an appointment to confirmed or declined
- **THEN** authenticated patient appointment reads represent the new state safely while new patient mutation rules remain deferred to the provider-aware patient-change task

### Requirement: Preserve provider integrity during patient changes

Patient cancellation and rescheduling SHALL use the current patient context,
optimistic version, idempotency key, serializable transaction, and safe audit
rules. A reschedule SHALL select another concrete provider-aware slot and SHALL
never silently assign or change a doctor. A future requested or confirmed
appointment MAY be cancelled. A replacement slot SHALL retain the same exact
facility and appointment service, MAY use another explicitly selected eligible
doctor, and SHALL change a confirmed appointment back to requested for a new
workforce decision. Declined, cancelled, and started appointments SHALL reject
patient cancellation or rescheduling without changing capacity or evidence.

#### Scenario: Cancel a confirmed appointment

- **WHEN** a patient cancels a future confirmed appointment using its current version
- **THEN** the system records cancellation, releases provider capacity, increments the version, and reconciles any deferred slot withdrawal atomically

#### Scenario: Reschedule a confirmed appointment

- **WHEN** a patient explicitly selects another eligible concrete slot for the same service and facility
- **THEN** the system moves the appointment to that slot, records its concrete provider bundle, increments the version, and returns the appointment to requested for workforce approval

#### Scenario: Reject a different-service or facility replacement

- **WHEN** a patient attempts to reschedule using a slot for another service or facility
- **THEN** the system returns a generic safe conflict without changing either capacity reservation or durable command evidence

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

#### Scenario: Manage one practice catalogue by keyboard

- **WHEN** an authorized scheduler opens the scheduling catalogue and uses only a keyboard
- **THEN** practice selection, practitioner creation, specialty and service lifecycle controls, facility affiliations, and practitioner eligibility remain labelled, ordered, and operable

#### Scenario: Switch scheduling practice safely

- **WHEN** a scheduler changes from one authorized practice context to another
- **THEN** the page clears the previous catalogue, loads only the selected practice, and never presents sibling-practice rows as cached results

#### Scenario: Show a conflicting catalogue command

- **WHEN** a catalogue command is stale, duplicated, invalid, or no longer authorized
- **THEN** the page preserves the submitted context where safe and presents an explicit validation, conflict, or permission-denied state without assuming the mutation succeeded

#### Scenario: Explain catalogue terminology and completed assignments

- **WHEN** a scheduler needs clarification about affiliation, eligibility, publication, or doctor-selection behavior
- **THEN** visible guidance and keyboard-focusable information controls explain the term without resembling lifecycle actions
- **AND** lifecycle actions have visible button boundaries that distinguish them from information controls and plain labels
- **AND WHEN** every authorized facility or eligible practitioner is already assigned
- **THEN** the page labels that assignment complete and does not open an empty mutation dialog

#### Scenario: Review eligible practitioners as a list

- **WHEN** a scheduler reviews the practitioners eligible for one service
- **THEN** the page presents one practitioner per row with aligned eligibility status and lifecycle action
- **AND** narrow screens preserve the practitioner, status, and action reading order without a multi-column card grid

#### Scenario: Manage weekly availability in one facility

- **WHEN** an authorized scheduler selects one exact practice and facility and opens weekly schedules
- **THEN** the page groups templates by practitioner and lists service, facility-local weekday, time, effective dates, status, and labelled create, replace, publish, and deactivate actions without repeating provider details on every row
- **AND** each practitioner group can be expanded or collapsed with a labelled keyboard-operable chevron, while service and lifecycle-status filters constrain the server-paginated result
- **AND** one explained Regenerate slots action per displayed practitioner reconciles all of that practitioner's active definitions in the selected facility
- **AND** a newly created definition starts inactive until the scheduler explicitly publishes it

#### Scenario: Distinguish retained definitions from usable capacity

- **GIVEN** an upstream service, practitioner, facility affiliation, or service eligibility becomes inactive
- **WHEN** the scheduler reviews that practitioner's weekly schedules
- **THEN** active definitions that cannot publish are labelled blocked with the failed prerequisite and cannot be regenerated or replaced as usable capacity
- **AND** inactive definitions and inactive service settings are collapsed behind a labelled keyboard-operable disclosure as retained scheduling history rather than displayed like current bookable hours
- **AND** the scheduler may still deactivate an active blocked definition explicitly

#### Scenario: Scan availability actions and rows consistently

- **WHEN** a scheduler reviews weekly schedules, service durations, exceptions, or published slots
- **THEN** desktop lists use visible headers and stable service, time, status, and action columns while narrow screens preserve the same reading order with explicit field labels
- **AND** primary, secondary, warning, and lifecycle-removal actions have visible button boundaries, text labels, focus indicators, and distinct emphasis without relying on color alone
- **AND** contextual help appears beside the heading or label it explains rather than in an action column, while completed assignment states render as status rather than disabled actions with adjacent information controls

#### Scenario: Switch availability scope safely

- **WHEN** a scheduler changes the selected practice or facility
- **THEN** the page clears the previous templates, exceptions, slots, and mutation summary before loading the new exact scope

#### Scenario: Apply a local availability exception

- **WHEN** a scheduler creates a facility closure or practitioner unavailability period
- **THEN** the page labels the selected facility timezone, accepts either one all-day local date or explicit local minute boundaries, supplies the closed server-approved reason code, and never accepts free text
- **AND** applying the exception is confirmed as an immediate capacity-affecting reconciliation

#### Scenario: Preserve local schedule evidence in the browser

- **WHEN** a scheduler enters or reviews weekly hours or an exception
- **THEN** the page preserves canonical wall-clock values without parsing them through the browser timezone, labels next-day midnight and inclusive effective dates, and explains that overnight hours require two templates
- **AND** a returned historical row uses its immutable source timezone and flags a difference from the facility's current timezone
- **AND** replacing that row labels the facility's current timezone for the new definition without reinterpreting the historical evidence

#### Scenario: Review a bounded publication result

- **WHEN** publication, reconciliation, exception, or duration regeneration completes
- **THEN** the page shows the server-owned local horizon and created, reactivated, withdrawn, preserved-live, and skipped-overlap counts
- **AND** it shows only the bounded opaque affected appointment identifiers authorized for the current practice, with an explicit truncation message and no patient or sibling-practice data

#### Scenario: Inspect published slot state

- **WHEN** a scheduler opens published slots for the selected facility
- **THEN** the page presents a bounded deterministic list in the facility timezone and visibly distinguishes available, withdrawn, live-reserved, and deferred-withdrawal states
- **AND** the page explains that slots are retained as durable evidence and removed capacity is withdrawn rather than deleted

#### Scenario: Block one published time safely

- **WHEN** a scheduler confirms Block this time on an available practitioner slot
- **THEN** the page creates an exact practitioner-facility unavailability exception for that interval using the facility's current timezone and approved reason code
- **AND** overlapping unbooked capacity may be withdrawn while live referenced evidence is preserved and reported without deleting the slot row

#### Scenario: Show an availability conflict without assuming success

- **WHEN** a template, exception, duration, or materialization command is stale, overlaps another provider window, exceeds a bound, or loses authorization
- **THEN** the page presents an explicit validation, conflict, or permission-denied state and never presents an optimistic success
- **AND** a stale conflict preserves the safe draft, reloads the latest server version, and requires explicit reconfirmation

#### Scenario: Retry an uncertain availability command safely

- **WHEN** an unchanged availability command is still in flight or its transport outcome is uncertain
- **THEN** the browser retains the same idempotency key for retry and rotates it only after a definitive outcome or payload change

#### Scenario: Keep affected-request details in the dual-permission queue

- **WHEN** an availability reconciliation reports affected live requests
- **THEN** this page shows only the bounded opaque identifiers, total, truncation state, and generic slot reservation state
- **AND** patient-identifying summaries and request resolution remain in the task 5.3 queue requiring both scheduling and patient-read permissions

#### Scenario: Open one exact-facility appointment queue

- **WHEN** a workforce user selects one exact practice and authorized facility on the Appointments page
- **THEN** the page requests a bounded server-ordered queue and labels its default `requested|confirmed` result as Live reservations rather than all history
- **AND** exact requested, confirmed, declined, and cancelled filters and server pagination remain keyboard operable

#### Scenario: Deny patient-identifying queue access safely

- **WHEN** the selected scheduling context lacks current `patients.read`, current `scheduling.manage`, matching direct membership, or exact-facility scope
- **THEN** the page clears every patient-identifying row and decision result and presents an explicit dual-permission denied state without placeholder or cached appointment data

#### Scenario: Switch appointment queue scope safely

- **WHEN** a scheduler changes the selected practice or facility while queue requests or a decision dialog are active
- **THEN** the page immediately clears the previous rows, filters, pagination, dialog, and result and ignores any late response from the previous scope

#### Scenario: Review the minimum workforce appointment summary

- **WHEN** an authorized scheduler reviews one queue row
- **THEN** the page shows only the approved patient display name, opaque appointment reference, service and specialty, practitioner display summary, facility-local time and timezone, lifecycle/version timestamps, and deferred-withdrawal state
- **AND** it does not request or infer patient contact, login, portal context, clinical data, provider login, or sibling-practice data

#### Scenario: Confirm a requested appointment explicitly

- **WHEN** a scheduler confirms a current requested row from its labelled confirmation dialog
- **THEN** the page submits the displayed optimistic version, fixed confirmation reason, and one durable idempotency key without changing the patient, practitioner, service, facility, or slot
- **AND** an existing deferred-withdrawal warning remains visible because confirmation preserves that follow-up state

#### Scenario: Decline with one closed operational reason

- **WHEN** a scheduler declines a current requested row
- **THEN** the dialog requires provider unavailable, service unavailable, or scheduling conflict without accepting free text and explains that capacity and any pending slot are resolved transactionally
- **AND** changing the selected reason creates a new semantic attempt while an unchanged uncertain retry reuses its idempotency key

#### Scenario: Resolve a stale workforce decision visibly

- **WHEN** a decision conflicts because its version or requested state is no longer current
- **THEN** the page never presents success, closes the stale decision, retains a privacy-safe conflict summary, reloads the current facility page, and requires a new explicit decision

#### Scenario: Operate the appointment queue accessibly

- **WHEN** a keyboard or assistive-technology user reviews and decides requests at a narrow viewport, browser zoom, or right-to-left document direction
- **THEN** scope controls, filters, pagination, rows, and dialogs preserve labelled reading and focus order, announce loading, denied, conflict, uncertain, and success states, and use logical layout without relying on color or pointer input
