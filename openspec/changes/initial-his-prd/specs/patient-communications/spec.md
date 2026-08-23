## ADDED Requirements

### Requirement: Honor patient communication preferences
The system SHALL maintain SMS, Email, Both, or Do Not Disturb preferences for each patient and SHALL apply them to patient communications, subject to future approved emergency or legal exceptions.

#### Scenario: Suppress communication for DND
- **WHEN** a non-exempt message is addressed to a patient whose preference is Do Not Disturb
- **THEN** the system does not send it and records the suppression reason

### Requirement: Send journey notifications
The system SHALL support configurable transactional notifications for appointment, registration, billing, payment, and discharge events through SMS and email.

#### Scenario: Send appointment confirmation
- **WHEN** an appointment event matches an enabled notification rule
- **THEN** the system renders the configured template and sends it through each permitted channel

### Requirement: Support bulk and two-way messaging
The system SHALL allow authorized users to send manual bulk messages to an eligible patient audience and SHALL process supported appointment confirmation or cancellation replies received through an SMS Web API.

#### Scenario: Patient cancels by SMS
- **WHEN** a valid inbound response maps to a cancellable appointment and requests cancellation
- **THEN** the system marks the appointment Cancelled and records the inbound message and resulting action

### Requirement: Deliver patient documents
The system SHALL support emailing bills and diagnostic reports to an eligible patient using access-controlled and auditable delivery.

#### Scenario: Email a bill
- **WHEN** an authorized user sends a finalized bill to a patient who permits email
- **THEN** the system delivers or securely links the correct bill and records delivery status

### Requirement: Configure messaging providers
The system SHALL support configurable SMTP and Web API provider settings and SHALL track send, delivery, and failure outcomes made available by each provider.

#### Scenario: Provider rejects a message
- **WHEN** the configured provider returns a send failure
- **THEN** the system records the failure without marking the message as delivered
