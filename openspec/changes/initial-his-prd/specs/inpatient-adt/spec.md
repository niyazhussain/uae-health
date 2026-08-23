## ADDED Requirements

### Requirement: Manage the inpatient movement lifecycle
The system SHALL manage admission, transfer, discharge, and bed allocation as a linked history for each inpatient encounter.

#### Scenario: Admit to an available bed
- **WHEN** an authorized user admits a registered inpatient to an available bed
- **THEN** the system creates the admission and active bed allocation and changes the bed to its configured occupied status

### Requirement: Support bed changes, retention, and bystander beds
The system SHALL allow authorized users to shift beds, retain or release a prior bed during a shift, allocate a bystander bed, and view beds by current status.

#### Scenario: Shift and retain a bed
- **WHEN** staff shift a patient to another bed and choose to retain the previous bed
- **THEN** the system starts the new allocation while keeping the previous bed allocated and chargeable

### Requirement: Generate configurable stay charges
The system SHALL post bed, duty-doctor, and nursing charges from the patient's stay using configured hourly, half-day, or full-day charging rules.

#### Scenario: Recalculate stay charges after transfer
- **WHEN** a bed transfer changes the chargeable accommodation during a billing period
- **THEN** the system allocates charges according to each bed's occupancy interval and the applicable configured rule

### Requirement: Enforce staged discharge clearance
The system SHALL track Initial, Clinical, Financial, and Physical Discharge states and SHALL identify pending clinical and billing activities that prevent physical clearance.

#### Scenario: Attempt physical discharge with pending items
- **WHEN** staff request Physical Discharge while required clinical or financial activities remain incomplete
- **THEN** the system blocks clearance and displays the unresolved activities
