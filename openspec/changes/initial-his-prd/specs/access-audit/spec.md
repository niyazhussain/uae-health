## ADDED Requirements

### Requirement: Authorize sensitive operations
The system SHALL enforce configurable permissions for order placement, discounts, billing, cancellation, refunds, credit notes, patient confidentiality, and financial discharge.

#### Scenario: User lacks refund permission
- **WHEN** a user without refund authority requests a refund
- **THEN** the system denies the operation and records the denied attempt

### Requirement: Record auditable actions
The system SHALL record the acting user, action, affected patient, encounter or bill, date and time, and reason or remarks where required for sensitive clinical, administrative, and financial actions.

#### Scenario: Sensitive action succeeds
- **WHEN** an authorized user completes a sensitive operation
- **THEN** the system creates an audit event containing the required actor, action, subject, timestamp, and contextual identifiers

### Requirement: Preserve audit integrity
Audit events SHALL be protected from ordinary update and deletion and SHALL be searchable by authorized audit users.

#### Scenario: Ordinary user attempts audit modification
- **WHEN** a user attempts to alter an existing audit event through an ordinary application interface
- **THEN** the system rejects the change and retains the original event
