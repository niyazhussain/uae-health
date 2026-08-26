## ADDED Requirements

### Requirement: Treat patient phone and WhatsApp verification as limited proof

Patient phone verification, including an approved WhatsApp-delivered OTP, SHALL establish only control of the configured phone number. It SHALL not independently prove clinical identity, automatically link a patient portal account to a clinical record, or permit workforce access.

#### Scenario: Patient verifies a phone number

- **WHEN** a patient completes an approved phone or WhatsApp verification challenge
- **THEN** the platform records verified phone control and requires an approved identity-proofing workflow before linking a clinical record

### Requirement: Link advanced patient portal access through an auditable proofing workflow

The platform SHALL link a patient portal identity to a clinical record only through an approved and auditable identity-proofing workflow. Equal email addresses, equal phone numbers, and untrusted provider claims SHALL not create the link automatically.

#### Scenario: Patient identity is not yet clinically linked

- **WHEN** a valid patient portal identity requests protected clinical information before completing the approved linking workflow
- **THEN** the platform denies access without searching for or linking a clinical record solely by email or phone
