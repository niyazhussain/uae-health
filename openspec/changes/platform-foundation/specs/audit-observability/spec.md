## ADDED Requirements

### Requirement: Record append-only business audit events
The platform SHALL record policy-selected business audit events in one append-only audit-event store. Each event SHALL contain actor, effective user where applicable, organization and facility, action, target entity type and opaque identifier, timestamp, outcome, correlation identifier, and required reason. It SHALL include safe before/after JSONB snapshots when the approved event policy requires them.

#### Scenario: Sensitive operation succeeds
- **WHEN** a user completes an operation designated as auditable
- **THEN** the platform commits an audit event that identifies the operation and affected business record

#### Scenario: Audited operation and audit write cannot both complete
- **WHEN** a required audit event cannot be durably recorded for a sensitive mutation
- **THEN** the platform does not report the sensitive mutation as successfully completed

#### Scenario: Approved field changes are audited
- **WHEN** a policy-selected sensitive record is changed
- **THEN** the event records the approved before and after field snapshots without storing prohibited data

#### Scenario: Access authority changes
- **WHEN** an identity is linked, a membership changes state, a role is requested or decided, or a role assignment changes
- **THEN** the platform records the actor, effective user, tenant and facility scope where applicable, action, target, outcome, correlation identifier, and required reason

#### Scenario: Workforce session is created or revoked
- **WHEN** a validated Cognito identity is exchanged for an application session or the session is explicitly revoked
- **THEN** the platform records safe session lifecycle evidence and correlation without recording the Cognito token, raw session identifier, CSRF value, password, TOTP value, or MFA secret

#### Scenario: Native workforce invitation is committed
- **WHEN** an authorized administrator creates practice access through a native workforce invitation
- **THEN** the application-user, identity-binding, active membership, and safe `identity.workforce_invited` audit evidence commit atomically without storing a password, temporary password, token, or MFA secret

#### Scenario: Workforce membership state changes
- **WHEN** an authorized administrator suspends or restores a workforce membership
- **THEN** the membership state, server-session revocation count where applicable, and safe access-authority audit evidence commit atomically without storing session identifiers, Cognito tokens, passwords, TOTP values, or MFA secrets

#### Scenario: Workforce role assignment changes
- **WHEN** an authorized administrator assigns or revokes a workforce role assignment
- **THEN** the assignment state and safe access-authority audit evidence commit atomically without storing Cognito tokens, session identifiers, passwords, TOTP values, or MFA secrets

### Requirement: Protect audit-event integrity
Ordinary application identities SHALL NOT update or delete committed audit events, and audit access SHALL itself be permission-controlled and auditable.

#### Scenario: Ordinary role attempts audit alteration
- **WHEN** an ordinary application role attempts to update or delete a committed audit event
- **THEN** the platform denies the change and preserves the original event

### Requirement: Correlate application activity
The platform SHALL assign or accept a valid correlation identifier for each request and SHALL propagate it through API handling, database diagnostics, background jobs, audit events, and supported external exchanges.

#### Scenario: Request creates background work
- **WHEN** an API request creates a durable background job
- **THEN** telemetry and audit data for both operations retain a traceable correlation relationship

### Requirement: Produce privacy-safe operational telemetry
The platform SHALL emit structured logs, metrics, and traces while redacting secrets, credentials, identity documents, message bodies, and patient data not explicitly approved for telemetry.

#### Scenario: Validation includes patient input
- **WHEN** patient-supplied data fails validation
- **THEN** operational telemetry records the safe error classification and correlation identifier without logging the prohibited field contents

### Requirement: Monitor service health and failure signals
The platform SHALL provide observable signals for availability, latency, error rate, database health, worker backlog, job failures, integration failures, storage failures, backup status, and certificate expiry.

#### Scenario: Worker backlog exceeds threshold
- **WHEN** pending durable work exceeds the configured threshold for the configured duration
- **THEN** the monitoring system raises an alert containing the environment, signal, and operational runbook reference

### Requirement: Identify deployed backend releases
API and worker telemetry SHALL include immutable application release identifiers and environment names without containing secrets.

#### Scenario: Compare an error to a deployment
- **WHEN** an operator inspects an API or worker failure
- **THEN** telemetry identifies the exact deployed release associated with the failure
