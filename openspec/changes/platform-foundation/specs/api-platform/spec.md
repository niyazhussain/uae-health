## ADDED Requirements

### Requirement: Expose a versioned REST API
The API SHALL expose versioned JSON HTTP endpoints with consistent request validation, response serialization, pagination conventions, and media types.

#### Scenario: Client calls a supported API version
- **WHEN** a client submits a valid request to a supported API version
- **THEN** the API routes the request to the correct version and returns the documented response representation

### Requirement: Return structured errors
The API SHALL distinguish validation, authentication, authorization, not-found, business-conflict, rate-limit, and unexpected failures using stable error codes, safe messages, field details where applicable, and a correlation identifier.

#### Scenario: Request body is invalid
- **WHEN** a client submits a body that violates the endpoint contract
- **THEN** the API rejects the request with a validation error that identifies invalid fields and does not execute the business operation

#### Scenario: Unexpected error occurs
- **WHEN** an unhandled server error occurs
- **THEN** the API returns a safe generic response with a correlation identifier and records diagnostic details only in protected operational telemetry

### Requirement: Publish an API contract
The API SHALL publish a machine-readable OpenAPI contract for supported endpoints and SHALL detect incompatible contract changes during continuous integration.

#### Scenario: API contract is generated
- **WHEN** the API build completes
- **THEN** a versioned OpenAPI document can be generated and used to create the frontend client types

### Requirement: Support idempotent commands
Endpoints whose retry could duplicate a patient, booking, order, payment, message, or external submission SHALL support an idempotency key scoped to the authenticated caller and operation.

#### Scenario: Identical command is retried
- **WHEN** the same caller repeats a completed command with the same idempotency key and equivalent payload
- **THEN** the API returns the recorded result without applying the business effect again

#### Scenario: Key is reused with a different payload
- **WHEN** a caller reuses an idempotency key for a materially different payload
- **THEN** the API rejects the request as a conflict without applying the new payload

### Requirement: Provide safe health endpoints
The API SHALL provide liveness and readiness endpoints suitable for deployment automation without exposing secrets, patient data, connection strings, or unnecessary infrastructure details.

#### Scenario: Required dependency is unavailable
- **WHEN** a dependency required to accept traffic is unavailable
- **THEN** readiness reports unavailable while liveness reflects whether the process itself can continue

### Requirement: Preserve module boundaries
The API SHALL organize platform and future business capabilities into explicit modules with owned application services and persistence interfaces. Controllers SHALL delegate domain behavior rather than implement business rules directly.

#### Scenario: Module invokes another module
- **WHEN** one module requires behavior owned by another module
- **THEN** it uses an explicit exported service or durable event rather than directly modifying the other module's persistence records
