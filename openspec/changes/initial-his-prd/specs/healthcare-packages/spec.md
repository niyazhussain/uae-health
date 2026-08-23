## ADDED Requirements

### Requirement: Define healthcare packages
The system SHALL define one-time health-check packages, order sets, multi-visit packages, and surgical inpatient credit-bill packages, including service and inventory items.

#### Scenario: Define a multi-visit package
- **WHEN** an authorized user publishes a package with multiple visits and included items
- **THEN** the system makes the versioned package available for eligible patient assignment

### Requirement: Control package eligibility
The system SHALL evaluate configurable package-ordering rules by center, department, age, gender, sponsor, and other configured criteria.

#### Scenario: Patient is not eligible
- **WHEN** a package is requested for a patient who fails a mandatory eligibility rule
- **THEN** the system prevents ordinary assignment and explains the failed criterion

### Requirement: Customize and track patient packages
The system SHALL permit authorized patient-specific package customization and SHALL track visits, services, and inventory consumption against the assigned package.

#### Scenario: Consume an included item
- **WHEN** an included item is fulfilled for a patient with an active package
- **THEN** the system records consumption against the package and updates its remaining entitlement

### Requirement: Enforce package financial controls
The system SHALL enforce cash or sponsor coverage rules and item-category exclusions and amount or quantity limits.

#### Scenario: Package quantity limit reached
- **WHEN** a new item would exceed its configured package-category quantity limit
- **THEN** the system excludes the excess from package coverage and identifies the resulting patient or sponsor responsibility
