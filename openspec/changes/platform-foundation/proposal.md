## Why

The HIS capability modules depend on a consistent, secure, and deployable application foundation. Establishing that foundation first prevents registration, scheduling, inpatient, and billing modules from independently inventing incompatible patterns for identity, data access, audit, storage, APIs, and deployment.

## What Changes

- Establish a React, Vite, and TypeScript application shell for authenticated HIS workflows.
- Establish a NestJS and TypeScript REST API with generated OpenAPI contracts and frontend client types.
- Establish PostgreSQL persistence, Kysely query-builder, and migration conventions.
- Establish Cognito-based authentication in AWS UAE, facility-aware authorization, confidential-record controls, and financial approval limits.
- Establish append-only business audit events and privacy-safe operational observability.
- Establish private S3-compatible document storage and durable asynchronous job processing.
- Establish repeatable local development, automated testing, container builds, cost-aware AWS UAE deployment, versioned releases, and rollback.
- Establish module boundaries so later HIS capabilities can be delivered incrementally without premature microservices.

## Capabilities

### New Capabilities

- `web-application-shell`: React application bootstrap, navigation, session states, accessibility, localization foundations, error handling, and typed API access.
- `api-platform`: NestJS REST application bootstrap, module conventions, validation, errors, API versioning, OpenAPI generation, idempotency, and health endpoints.
- `data-platform`: PostgreSQL connectivity, Kysely conventions, migrations, transactions, concurrency controls, identifiers, dates, and monetary representations.
- `identity-authorization`: Cognito-based OpenID Connect authentication, optional identity federation, facility-aware permissions, confidential-record access, and approval-limit enforcement.
- `audit-observability`: Append-only business audit evidence, request correlation, privacy-safe logs, metrics, traces, monitoring, and alerting.
- `document-job-platform`: Private object storage, controlled document access, upload validation, malware quarantine boundary, transactional outbox, and durable workers.
- `delivery-platform`: Local fake-data environment, AWS UAE deployment, S3/CloudFront static delivery, cost controls, CI/CD, environment separation, immutable releases, backup verification, and rollback.

### Modified Capabilities

None. The archived OpenSpec baseline does not yet contain implementation capabilities.

## Impact

- Creates the initial implementation structure in the existing `web` and `api` directories.
- Adds Node.js/TypeScript workspace tooling and dependencies for React, Vite, NestJS with Express, Kysely, PostgreSQL, OpenAPI, validation, testing, and observability.
- Adds local PostgreSQL, object-storage substitutes, API, and worker development services.
- Introduces shared contracts used by every later HIS module.
- Records AWS Middle East (UAE) as the production location for health-data workloads, including PostgreSQL, object storage, backups, and health-data logs.
- Records Amazon Cognito as the initial authentication boundary; it can federate with workforce OIDC/SAML providers and UAE PASS after approved onboarding.
- Requires infrastructure decisions for hostnames, object storage, secrets, certificates, monitoring, backup, and deployment targets.
- Does not implement patient registration, scheduling, ADT, insurance, packages, billing, or communication business workflows.
