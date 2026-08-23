## ADDED Requirements

### Requirement: Schedule appointments against resources
The system SHALL schedule appointments for doctors, tests, services, surgeries, and generic resources and SHALL present calendar and slot-based day or week availability appropriate to each resource type.

#### Scenario: Book an available resource
- **WHEN** staff select an available slot for a patient and resource
- **THEN** the system creates a Booked appointment and reserves the required duration

### Requirement: Apply availability controls
The system SHALL support configurable durations, secondary-resource blocking, planned slot blocks, bulk slot overrides, and authorized overbooking.

#### Scenario: Resource availability changes
- **WHEN** an authorized user blocks a range of resource slots
- **THEN** the system prevents ordinary bookings in those slots and identifies affected existing appointments

#### Scenario: Authorized overbooking
- **WHEN** a user with overbooking permission books an occupied slot
- **THEN** the system records the appointment as an authorized overbook without removing existing bookings

### Requirement: Manage appointment demand
The system SHALL maintain waitlists, recurring appointments, and no-show history and SHALL support Booked, Confirmed, No-show, and Cancelled statuses.

#### Scenario: Fill a cancelled slot from a waitlist
- **WHEN** a booked appointment is cancelled and matching patients are waitlisted
- **THEN** the system makes the vacancy available to the waitlist workflow without automatically confirming a replacement patient

#### Scenario: Record no-show
- **WHEN** authorized staff mark an appointment as No-show
- **THEN** the system updates its status and appends the event to the patient's no-show history

### Requirement: Support first-contact and local calendar booking
The system SHALL capture a configurable minimum patient dataset for appointment-first contact and SHALL permit date selection using Gregorian calendar dates and Hijri date equivalents.

#### Scenario: Book before full registration
- **WHEN** staff enter the minimum required first-contact details and a valid Hijri or Gregorian date
- **THEN** the system creates the appointment and retains the patient details for later registration completion
