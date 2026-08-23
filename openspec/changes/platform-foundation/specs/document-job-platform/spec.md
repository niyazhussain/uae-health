## ADDED Requirements

### Requirement: Store documents privately
The platform SHALL store patient and business documents in private object storage and SHALL retain document ownership, classification, object identifier, checksum, media type, size, version, and lifecycle metadata in the system of record.

#### Scenario: Document is uploaded successfully
- **WHEN** an authorized user uploads a valid document
- **THEN** the platform stores it privately, verifies its recorded checksum, and links its metadata to the authorized business record

### Requirement: Validate and quarantine uploads
The platform SHALL enforce configured size and media-type rules and SHALL prevent unscanned or suspicious uploads from being downloaded through ordinary workflows.

#### Scenario: Malware scan reports a threat
- **WHEN** the configured scanner identifies a threat in an uploaded object
- **THEN** the platform quarantines the object, prevents ordinary access, and records the security outcome

### Requirement: Authorize every document access
The platform SHALL authorize document access against the requesting identity, facility scope, document classification, and owning business record before issuing a short-lived access mechanism or authenticated stream.

#### Scenario: Signed access expires
- **WHEN** a previously issued document-access URL or token passes its expiry
- **THEN** object storage refuses access and a new authorization decision is required

### Requirement: Create durable background work atomically
When a committed business transaction requires asynchronous work, the platform SHALL persist an outbox record in the same database transaction as the business change.

#### Scenario: Business transaction rolls back
- **WHEN** the transaction creating both a business change and its outbox record rolls back
- **THEN** neither the business change nor its background work becomes available for processing

### Requirement: Process jobs idempotently
Workers SHALL claim jobs safely, prevent concurrent duplicate execution, record attempts, apply bounded retry policies, and ensure repeated delivery does not duplicate a completed business effect.

#### Scenario: Worker stops during processing
- **WHEN** a worker loses its claim before recording successful completion
- **THEN** the job becomes eligible for controlled recovery and reprocessing without duplicating an already committed effect

### Requirement: Isolate terminal job failures
The platform SHALL move work that exhausts its retry policy to a failed-work state with an actionable error classification, audit/correlation context, and controlled replay mechanism.

#### Scenario: Job exhausts retry limit
- **WHEN** a retryable job continues to fail through its configured maximum attempts
- **THEN** the platform stops automatic retry, alerts or surfaces the failure, and retains it for authorized investigation and replay
