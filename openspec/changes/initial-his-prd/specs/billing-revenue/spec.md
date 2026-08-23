## ADDED Requirements

### Requirement: Create controlled billable orders
The system SHALL allow authorized users to create orders from pending prescriptions, approved pre-authorizations, multi-visit packages, and direct entry, retaining the originating record where applicable.

#### Scenario: Order from approved authorization
- **WHEN** an authorized user orders approved items within authorization limits
- **THEN** the system creates billable order items linked to the authorization

### Requirement: Allocate billing responsibility
The system SHALL support cash and credit billing with no sponsor, one sponsor, or at most two sponsors and SHALL calculate and record patient and sponsor portions.

#### Scenario: Bill with two sponsors
- **WHEN** an encounter has two valid sponsors and coordination rules are configured
- **THEN** the system allocates covered amounts in configured priority order and records each party's responsibility

### Requirement: Manage bills, claims, and revenue states
The system SHALL maintain controlled bill and claim statuses sufficient for cash revenue, sponsor receivables, and inpatient revenue management.

#### Scenario: Finalize a sponsored bill
- **WHEN** all required validations pass and an authorized user finalizes a sponsored bill
- **THEN** the system locks ordinary edits, records the sponsor receivable, and advances the bill to its configured finalized state

### Requirement: Manage discounts and financial authority
The system SHALL apply default rates and discount plans, support provisional discounts, track all discounts, and enforce user-specific approval limits.

#### Scenario: Discount exceeds user limit
- **WHEN** a user submits a discount greater than their authorized limit
- **THEN** the system prevents final application and routes or marks it for the configured approval workflow

### Requirement: Manage deposits and collections
The system SHALL collect, track, set off, and refund deposits and SHALL accept configured payment modes including cash, credit card, debit card, digital wallet, cheque, and other configured modes.

#### Scenario: Apply deposit to a bill
- **WHEN** an authorized user applies an available patient deposit to an outstanding bill
- **THEN** the system reduces both the available deposit balance and bill balance by the applied amount

### Requirement: Support terminal-ready card payments
The system SHALL provide an integration boundary for Pinelabs EDC payment initiation, response matching, and reconciliation without treating readiness as proof of a certified production integration.

#### Scenario: Match terminal response
- **WHEN** a Pinelabs response contains a valid transaction correlation identifier
- **THEN** the system associates the response with the originating payment attempt and records its outcome

### Requirement: Reverse and adjust financial transactions
The system SHALL support controlled item cancellation, payment-mode-appropriate refunds, credit notes, and patient or sponsor write-offs.

#### Scenario: Refund a card payment
- **WHEN** an authorized user approves a refund against an eligible card payment
- **THEN** the system records the refund against the original payment and uses the configured card-refund workflow

### Requirement: Control inpatient financial discharge
The system SHALL prevent financial discharge of an inpatient encounter while configured billing prerequisites remain unresolved.

#### Scenario: Outstanding billing prevents discharge
- **WHEN** financial discharge is requested with unresolved required charges or balances
- **THEN** the system blocks financial clearance and lists the blocking items

### Requirement: Calculate and allocate charges
The system SHALL calculate bed charges by hourly, half-day, or full-day rules and SHALL support receipt-based charge allocation for reporting.

#### Scenario: Allocate a receipt
- **WHEN** a receipt is posted against eligible outstanding charges
- **THEN** the system records its allocation at the granularity required by configured reporting rules

### Requirement: Calculate provider payouts
The system SHALL calculate doctor and outhouse payouts through configurable, versioned rules and SHALL retain the inputs and rule version used.

#### Scenario: Calculate payout
- **WHEN** eligible revenue meets a configured payout rule
- **THEN** the system calculates the payout and retains a traceable calculation breakdown

### Requirement: Enforce configured cash compliance rules
The system SHALL support controls for India's applicable ₹2 lakh cash-collection constraint, with effective dating and jurisdiction applicability subject to legal confirmation.

#### Scenario: Cash collection reaches configured threshold
- **WHEN** a proposed cash receipt would breach an active applicable cash-collection rule
- **THEN** the system blocks or escalates the transaction according to approved compliance configuration

### Requirement: Produce financial documents and reports
The system SHALL generate configurable bills, receipts, and patient statements and SHALL report day-book, collection, revenue, and payout data for reconciliation.

#### Scenario: Reconcile daily collections
- **WHEN** an authorized user runs a day-end collection report
- **THEN** the report presents recorded collections and reversals by configured payment and organizational dimensions
