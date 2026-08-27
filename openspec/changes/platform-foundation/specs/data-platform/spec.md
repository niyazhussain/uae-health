## ADDED Requirements

### Requirement: Use a transactional relational system of record
The platform SHALL persist operational HIS records in PostgreSQL using relational constraints, explicit indexes, and transaction-safe writes. The API SHALL use Kysely and `pg` for type-safe, explicit SQL; controllers SHALL NOT contain SQL.

#### Scenario: Related write fails
- **WHEN** one required write in a multi-record business transaction fails
- **THEN** the entire transaction rolls back and no partial business result remains committed

### Requirement: Apply controlled schema migrations
The platform SHALL apply ordered, versioned, reviewable schema migrations and SHALL record which migrations have completed in each environment.

#### Scenario: Application starts with pending incompatible migration
- **WHEN** the deployed application cannot safely operate against the current schema version
- **THEN** readiness remains unavailable until the approved migration or compatible application version is present

#### Scenario: Migration fails
- **WHEN** a schema migration fails before completion
- **THEN** deployment stops, records the failure, and follows the migration's documented recovery or run-forward procedure

### Requirement: Evolve a persistent demonstration database safely
A persistent synthetic-data demonstration database SHALL use the same PostgreSQL version family, migration history, and backup/restore commands as production. Database upgrades SHALL use forward-compatible migrations; destructive schema synchronization and unverified volume replacement are prohibited.

#### Scenario: Demonstration database is promoted
- **WHEN** an approved persistent demonstration database is moved to a production PostgreSQL service
- **THEN** the team verifies a backup and restoration, rehearses the migration, performs a controlled cutover, verifies record counts and migration history, and retains rollback evidence

### Requirement: Keep production health data in the UAE
Production PostgreSQL primary instances, replicas, backups, snapshots, and health-data logs SHALL remain in an approved UAE location. Lower environments SHALL use synthetic or approved anonymized data only.

#### Scenario: Production database backup is configured
- **WHEN** a production database backup, replica, or snapshot is created
- **THEN** it remains in the approved UAE location and is covered by the approved retention and recovery plan

### Requirement: Represent identifiers consistently
Externally exposed records SHALL use opaque identifiers. Human-facing identifiers such as MRNs, bills, and receipts SHALL use separately defined facility-aware uniqueness rules.

#### Scenario: Create records concurrently
- **WHEN** multiple requests create records in the same identifier scope concurrently
- **THEN** the database prevents duplicate unique identifiers and each successful record receives one identifier

### Requirement: Represent money without floating-point loss
The platform SHALL represent monetary amounts using fixed-precision values or integer minor units and SHALL associate each amount with an explicit ISO currency.

#### Scenario: Sum bill amounts
- **WHEN** the system calculates a bill total from valid monetary line items
- **THEN** the stored and returned total is exact at the configured currency precision

### Requirement: Represent time and business dates consistently
The platform SHALL store instants in UTC, retain facility timezone context required for business rules, and preserve date-only values without converting them into unintended instants.

#### Scenario: Display an event in facility time
- **WHEN** a UTC event instant is presented for a facility
- **THEN** the system converts it using the facility's applicable timezone while retaining the original instant

### Requirement: Represent synthetic patient appointment access safely
The POC SHALL store opt-in synthetic bookable-practice configuration, UTC appointment windows, explicit pending appointment relationships, and patient appointment requests separately from clinical records and active portal-profile links. Each appointment SHALL belong to exactly one authenticated patient identity and exactly one active portal-profile context or pending appointment relationship. It SHALL not store symptoms, notes, provider details, service details, payments, insurance, or clinical-record identifiers.

#### Scenario: Patient starts an appointment relationship
- **WHEN** a restricted onboarding patient chooses an opt-in synthetic bookable practice
- **THEN** the platform records one explicit pending relationship scoped to that patient identity and practice without creating an active portal-profile link

#### Scenario: Appointment is queried in another context
- **WHEN** a request tries to retrieve or mutate an appointment outside the current server-stored practice or appointment-onboarding context
- **THEN** the database query returns no appointment and the API does not reveal the other practice's appointment data

### Requirement: Control concurrent business updates
The platform SHALL support unique constraints, optimistic concurrency, transactions, and explicit row locking for workflows where concurrent updates could double-book, double-consume, or corrupt balances.

#### Scenario: Concurrent updates use the same record version
- **WHEN** two commands attempt incompatible updates from the same original record version
- **THEN** at most one succeeds and the other receives a retriable or user-resolvable conflict

#### Scenario: Two appointment requests reserve the same window
- **WHEN** two serializable appointment-request transactions attempt to reserve one synthetic bookable window
- **THEN** a database constraint and row locking permit at most one active request and leave no partial relationship, appointment, idempotency, or audit record for the unsuccessful command

### Requirement: Recover from transient database conflicts safely
The platform SHALL classify deadlocks and other approved transient database failures and SHALL retry only operations that are safe and bounded to retry.

#### Scenario: Transaction is selected as a deadlock victim
- **WHEN** PostgreSQL aborts an idempotent transaction due to a deadlock or serialization failure
- **THEN** the platform retries it within the configured limit or returns a controlled retryable failure without duplicating effects
