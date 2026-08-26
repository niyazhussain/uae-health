## ADDED Requirements

### Requirement: Use verified tenant domains and constrained tenant branding

The platform SHALL allow tenant-owned application domains and approved branding only after DNS ownership and TLS validation. It SHALL resolve a verified hostname to one tenant without exposing another tenant's configuration, and SHALL use a shared identity-provider login domain rather than one Cognito custom domain per tenant.

#### Scenario: Tenant domain is verified

- **WHEN** a tenant administrator completes the approved DNS and certificate validation flow
- **THEN** the platform activates only that verified hostname and its constrained accessible branding for the tenant

### Requirement: Gate real-data production on UAE-resident infrastructure and approval

Before processing real data, the platform SHALL provision and verify production identity boundaries, compute, PostgreSQL, private storage, backups, snapshots, audit data, health-data logs, network controls, monitoring, and recovery controls in AWS `me-central-1`. Production release SHALL require documented environment approval and use immutable artifacts with short-lived deployment credentials.

#### Scenario: Production release is requested

- **WHEN** a release is proposed for the production environment
- **THEN** the deployment verifies approved UAE-resident resources, a commit-pinned reviewed infrastructure plan where applicable, migration gates, readiness, rollback capability, and the required environment approval before activation

### Requirement: Complete production safety and compliance evidence before real data

The platform SHALL not process real patient or workforce data until the applicable customer jurisdiction, UAE health-authority obligations, security and privacy review, backup and restore evidence, recovery exercise, and residency verification are documented and approved.

#### Scenario: Real-data activation is requested without required evidence

- **WHEN** a team requests real-data activation without the required approval or recovery evidence
- **THEN** the platform remains in synthetic-data operation and the production activation is not approved
