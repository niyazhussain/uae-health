## ADDED Requirements

### Requirement: Manage authorization requests
The system SHALL create pre-authorization requests from prescriptions or by manual entry and SHALL track submission, approval, cancellation, and resubmission without losing prior decisions.

#### Scenario: Create from prescription
- **WHEN** an authorized user selects prescription items that require approval
- **THEN** the system creates a request linked to the patient, encounter, sponsor, and selected items

#### Scenario: Resubmit a request
- **WHEN** staff resubmit an eligible request with corrected or additional information
- **THEN** the system creates a new submission attempt while retaining the earlier request history

### Requirement: Exchange payer authorizations electronically
The system SHALL support configured Shafafiya and eClaimLink exchanges in accordance with the applicable HAAD or DHA interface standards.

#### Scenario: Receive payer response
- **WHEN** a payer response is successfully matched to a submitted request
- **THEN** the system records the response, item-level decision data when available, and resulting request status

### Requirement: Convert approvals into fulfillment
The system SHALL allow valid approved authorization items to be converted into billing or order-management workflows and SHALL prevent use beyond approved scope or validity.

#### Scenario: Create order from approval
- **WHEN** an authorized user converts an unused, valid approval
- **THEN** the system creates linked order items within the approved quantities, values, and validity period
