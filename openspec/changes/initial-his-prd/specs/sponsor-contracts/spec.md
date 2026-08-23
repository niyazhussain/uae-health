## ADDED Requirements

### Requirement: Configure valid sponsor contracts
The system SHALL maintain effective-dated sponsor and insurance contracts with default rates, discounts, covered categories, and contract validity rules.

#### Scenario: Price within a valid contract
- **WHEN** a covered service is ordered during a contract's effective period
- **THEN** the system selects the applicable contracted rate and discount structure

### Requirement: Calculate patient and sponsor responsibility
The system SHALL calculate copay percentages, minimum and maximum copays, deductibles, and limits by visit and insurance category.

#### Scenario: Apply bounded copay
- **WHEN** a service has a percentage copay with configured minimum and maximum amounts
- **THEN** the system calculates the percentage and applies the configured lower and upper bounds

### Requirement: Enforce coverage rules
The system SHALL enforce configured exclusions, encounter-level limits, episode-level limits, and pre-authorization requirements before confirming sponsor coverage.

#### Scenario: Service requires authorization
- **WHEN** an order matches a contract rule requiring pre-authorization and no valid approval exists
- **THEN** the system does not confirm sponsor coverage and identifies the authorization requirement

### Requirement: Support sponsor billing models
The system SHALL represent Fee for Service, DRG, and Per Diem billing models as contract configuration and SHALL retain the model used for each sponsored bill.

#### Scenario: Select contract billing model
- **WHEN** a sponsored encounter is billed under an active contract
- **THEN** the system applies and records that contract's configured billing model
