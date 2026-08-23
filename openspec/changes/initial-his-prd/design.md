## Context

This repository is an empty product foundation with separate `web` and `api` directories. The initial OpenSpec proposal and capability specifications define a broad Hospital Information System spanning patient registration, scheduling, inpatient ADT, communications, sponsor contracts, pre-authorization, packages, billing, access control, audit, and external integrations.

The existing `/Users/niyazshafrina/Github/portal` application provides a proven local deployment reference:

- React is compiled into static assets.
- GitHub Actions builds the UI and securely copies the build output to a Linux host.
- Nginx terminates TLS, redirects HTTP to HTTPS, serves the SPA, and falls back to `index.html` for client-side routes.
- The API is built into a Docker image, deployed with Docker Compose, and reverse-proxied by Nginx to a container port.
- A separate worker/cron container runs asynchronous jobs.

The referenced `hairways.softdefine.conf` confirms the UI pattern. The named `api.hairways.softdefine.conf` was not present at the supplied location; `api.softdefine.conf` and `api.stage.portal.softdefine.conf` demonstrate the corresponding API reverse-proxy pattern and are used as the nearest references.

The HIS handles sensitive identity, clinical-administrative, insurance, and financial data. Therefore, the design reuses the operational shape of Portal where useful but does not copy its data architecture without evaluating transactional integrity, isolation, and audit requirements.

### Constraints

- The first release shall use React/Vite, NestJS with Express, PostgreSQL, Kysely, Amazon Cognito, and TypeScript.
- The application must support multiple facilities and organizational units without mixing data or permissions.
- Patient and financial operations require consistent transactions and durable audit evidence.
- External government, payer, messaging, and payment contracts are not yet available and must remain behind adapters.
- Production UAE health-data residency is decided; retention, uptime, recovery, customer jurisdiction, and regulatory certification requirements require confirmation before production.

### Stakeholders

- Product, clinical operations, registration, scheduling, inpatient operations, billing, finance, insurance, audit, compliance, security, engineering, and infrastructure teams
- Patients and approved third-party systems

## Goals / Non-Goals

**Goals:**

- Define the shared architecture and technical boundaries for incremental HIS delivery.
- Reuse the Portal-style deployment pattern for the initial UI and API while keeping a clear path to managed cloud hosting.
- Establish a modular, transactionally safe backend rather than prematurely splitting the domain into microservices.
- Define common identity, authorization, audit, workflow, integration, storage, and observability patterns.
- Allow capabilities to be implemented and released one bounded module at a time.

**Non-Goals:**

- Produce final screen designs, endpoint-by-endpoint API contracts, or physical database schemas.
- Implement all ten capabilities in this change.
- Select vendors or claim compliance certification before legal and regulatory review.
- Reproduce Portal's MongoDB/MySQL split or every library choice merely for consistency.
- Define clinical documentation, pharmacy inventory, diagnostic execution, claims adjudication, or general-ledger systems beyond current integration boundaries.

## Decisions

### 1. Use a TypeScript monorepo with independently deployable web and API applications

The repository SHALL retain `web` and `api` as separate applications and SHOULD add shared packages only for generated API types, validation primitives, UI design tokens, and non-domain utilities. Domain rules SHALL remain owned by the API and SHALL NOT be duplicated in the browser.

**Rationale:** This matches the team's existing repository and deployment familiarity while preserving independent builds and releases.

**Alternatives considered:**

- Separate repositories: stronger isolation but adds coordination and versioning overhead at the current stage.
- Full-stack framework in one deployable: simpler initially, but couples UI scaling and release cadence to API operations.

### 2. Build the web application as a React SPA

Use React with TypeScript. Use Vite for a new implementation unless an existing repository constraint requires Create React App. The SPA SHALL use route-level code splitting, an accessible component system, centralized API/session handling, and feature folders aligned with the OpenSpec capability names.

The browser SHALL never be treated as a trusted authorization boundary. It may hide unavailable actions for usability, but the API SHALL enforce every permission and business rule.

**Rationale:** React matches the supplied Portal reference and team experience. Vite provides a simpler maintained build path for a new application than the older `react-scripts` setup used by Portal.

**Alternatives considered:**

- Copy Portal's Create React App toolchain: familiar but aging and unnecessary for a greenfield build.
- Server-rendered React: useful for public SEO pages, but HIS workflows are authenticated applications and receive little benefit from SSR in the initial phase.

### 3. Serve the production React build from private S3 through CloudFront

GitHub Actions SHALL create an immutable React build and publish it to a private S3 origin in AWS UAE. CloudFront SHALL terminate viewer TLS, redirect HTTP to HTTPS, use Origin Access Control, return `index.html` for SPA routes, apply security headers, and cache fingerprinted assets while preventing long-lived caching of `index.html`. CloudFront SHALL serve only public static assets and SHALL NOT cache API responses, sessions, authenticated HTML, or patient data.

Deployment SHALL activate a new immutable artifact only after verification. Rollback SHALL restore the previous verified artifact. CI SHALL not delete the active build before the replacement has been verified.

**Rationale:** CloudFront and private S3 provide a low-operations, cache-safe static application delivery path. The prototype remains inexpensive because CloudFront can serve a small static application without a continuously running web server.

**Alternatives considered:**

- Nginx static hosting: viable for local development and a self-managed server, but it adds host operations and is not the selected production static-delivery pattern.
- Serving UI assets from the API container: simpler topology but unnecessarily couples UI and API releases and resource use.

### 4. Deploy the API as a container behind a separate Nginx hostname

The API SHALL be packaged as an immutable container image and run on a private Docker network. Nginx SHALL terminate public TLS and proxy to the API container without directly exposing the application port publicly. Separate hostnames SHALL be used for UI and API, following the Portal/Hairways convention. Environment-specific names will be confirmed before infrastructure implementation.

Forwarded headers SHALL be set correctly, request IDs SHALL be propagated, upload limits SHALL be defined per endpoint rather than using the Portal reference's global 500 MB allowance, and API health/readiness endpoints SHALL not expose sensitive diagnostics.

**Rationale:** This preserves the proven operating model while improving isolation and deployability.

**Alternatives considered:**

- Same-origin `/api` proxying: reduces CORS complexity, but separate hostnames provide clearer routing and independent evolution. Same-origin remains viable if identity/session constraints favor it.
- Kubernetes: useful at larger scale, but premature until availability and scaling targets require the added operational complexity.

### 5. Start with a modular monolith and explicit domain boundaries

The API SHALL initially be one deployable application organized into modules matching the product capabilities. Each module SHALL own its application services and persistence access. Cross-module writes SHALL occur through explicit services within database transactions; asynchronous cross-module work SHALL use durable events.

Initial module boundaries are:

- Identity and access
- Patient registry and documents
- Scheduling and resources
- Inpatient ADT and beds
- Sponsors and contracts
- Pre-authorization
- Packages and orders
- Billing and payments
- Communications
- Audit and integrations

**Rationale:** Registration, coverage, orders, and billing have strong transactional relationships. A modular monolith provides simpler consistency and deployment while boundaries are still being learned.

**Alternatives considered:**

- Microservices per capability: allows independent scaling but creates distributed transactions, event ordering, observability, and operational overhead too early.
- Unstructured single application: initially fast but makes financial and clinical boundaries difficult to test and separate later.

### 6. Use PostgreSQL with Kysely as the transactional system of record

Use PostgreSQL tables for patients, encounters, schedules, admissions, contract versions, authorizations, package entitlements, orders, bills, payments, and audit metadata. The API SHALL use Kysely and `pg` for type-safe, explicit SQL. Monetary values SHALL use fixed-precision `NUMERIC` values or integer minor units with an explicit ISO currency. Mutable business records SHALL use optimistic concurrency, unique constraints, or explicit row locking where concurrent updates can cause double booking, double consumption, or incorrect balances.

All business tables SHALL use relational constraints and explicit indexes for enforceable invariants. Schema changes SHALL be forward-compatible, reviewable Kysely migrations executed through CI/CD with backups and rollback/run-forward procedures. Production identifiers SHALL use non-sequential opaque IDs externally; human-facing MRNs, bill numbers, and receipt numbers SHALL be generated under facility-aware uniqueness rules.

**Rationale:** HIS workflows require relational integrity, transactions, reporting joins, constraints, and controlled concurrency. PostgreSQL with explicit Kysely queries makes data access, locking, JSONB audit snapshots, and reporting behavior predictable without ORM lifecycle behavior.

**Alternatives considered:**

- MariaDB/TypeORM: no longer selected because the project needs PostgreSQL-native features and explicit query behavior.
- Copy Portal's MongoDB plus MySQL combination: increases synchronization and operational complexity without a demonstrated HIS requirement. The HIS SHALL use one PostgreSQL system of record initially.
- Document database as the main store: flexible, but weaker as the primary model for interconnected, transaction-heavy billing and encounter data.

### 7. Store files in private S3-compatible object storage, not in the web deployment bucket

Patient photos, scanned IDs, insurance cards, consent files, diagnostic reports, and generated documents SHALL be stored in private object storage. The database SHALL retain object identifiers, checksums, classification, ownership, version, and audit metadata. Access SHALL use short-lived signed URLs or authenticated streaming after authorization.

The file store SHALL be separate from any public/static frontend hosting bucket. Encryption, malware scanning, content-type validation, size limits, retention, legal hold, and deletion rules SHALL be configurable once policy is approved.

**Rationale:** Binary clinical and identity documents should not be stored in database rows, local container filesystems, or publicly addressable UI storage.

**Alternatives considered:**

- Local server filesystem: operationally simple but weak for scaling, backup, durability, and multi-host deployments.
- Database binary columns: transactional but expensive for large documents and backups.

### 8. Use NestJS with REST/OpenAPI and generated client types

Use NestJS with TypeScript and the default Express adapter as the API framework. Use decorator-based controllers, modules, dependency-injected services, guards, interceptors, and DTO validation. Use Kysely data-access services, explicit migrations, and explicit transaction boundaries for PostgreSQL persistence. Domain rules SHALL live in application/domain services rather than controllers or data-access hooks.

Expose versioned JSON REST endpoints for business commands and queries. Generate an OpenAPI contract from the NestJS application and generate frontend client types from that contract. Commands SHALL support request correlation and idempotency keys where retries could duplicate registrations, bookings, orders, payments, messages, or integration submissions.

Validation errors SHALL be structured and field-addressable. Business conflicts SHALL be distinct from authentication, authorization, and infrastructure failures. Dates/times SHALL be stored as UTC instants where applicable, with facility timezone retained for business interpretation; date-only clinical/business values SHALL remain date-only.

**Rationale:** NestJS with Express is a widely adopted, structured Node.js framework whose decorators reduce repeated routing, dependency-injection, validation, and OpenAPI wiring. Kysely preserves explicit PostgreSQL behavior while providing TypeScript query safety. REST/OpenAPI is broadly supported by the named external integration ecosystem and provides a straightforward generated contract for the React client.

**Alternatives considered:**

- TypeGraphQL/GraphQL as used by Portal: not required for NestJS or TypeORM. It is effective for flexible UI reads, but adds schema, resolver, query-cost, authorization, caching, and client-code complexity that is unnecessary for the initial command-heavy HIS API. It can be added later for a demonstrated query use case without changing the domain services.
- Plain Express or Fastify alone: has less framework surface, but requires more manual structure for modules, dependency injection, validation, authorization guards, OpenAPI generation, and consistent error handling.
- TypeORM: supports PostgreSQL but its entity and lifecycle abstractions are not selected for this audit- and transaction-heavy system.

### 9. Model workflow statuses as controlled state transitions

Appointment, authorization, admission, discharge, order, bill, claim, payment, and refund statuses SHALL have explicit allowed transitions, required permissions, preconditions, timestamps, actor identity, and reasons. Status changes SHALL occur through domain commands rather than direct record updates.

Long-running processes SHALL use persisted workflow state and retriable jobs, not in-memory timers. Financial and discharge transitions SHALL lock or validate the relevant record version before commit.

**Rationale:** The source defines many operational states whose meaning and transition history are essential to care coordination and auditability.

**Alternatives considered:**

- Generic configurable workflow engine initially: powerful but adds abstraction before workflows and regulatory rules are fully known.
- Free-form status updates: simple but cannot enforce safety or reconstruct valid history.

### 10. Centralize authentication and enforce facility-aware role permissions in the API

Use Amazon Cognito User Pools in AWS UAE as the initial OpenID Connect identity provider rather than implementing password storage in the HIS. Workforce accounts SHALL be administrator-provisioned and require TOTP authenticator-app MFA. Cognito MAY federate approved OIDC/SAML workforce providers such as Entra ID, and UAE PASS after approved onboarding. The API SHALL validate short-lived tokens and enforce permission policies using user role, facility/department scope, operation, record confidentiality, and financial approval limits.

The HIS SHALL retain application users, facility memberships, permissions, and approval limits; it SHALL not retain workforce passwords. Patient WhatsApp OTP proves phone control only and SHALL NOT automatically identify or link a patient record. Sessions and tokens SHALL not be stored in browser local storage when an HTTP-only secure cookie or backend-for-frontend session can meet the deployment constraints.

**Rationale:** HIS authorization depends on more than a simple role and must be evaluated consistently on every server operation.

**Alternatives considered:**

- Application-owned usernames/passwords and JWTs: reduces dependencies but creates avoidable credential, MFA, revocation, and lifecycle responsibilities.

### 11. Maintain append-only audit evidence separate from application logs

Every policy-selected sensitive read or write SHALL create one append-only `audit_events` record containing actor, effective user, facility, entity type and opaque ID, action, target, timestamp, request/correlation identifier, outcome, and required reason. Approved events SHALL also contain safe `before_data` and `after_data` JSONB snapshots. Required audit writes SHALL occur in the same transaction as the sensitive mutation; ordinary application roles cannot update or delete committed events.

Operational logs SHALL use structured output and SHALL redact secrets, identity documents, message bodies, and unnecessary patient data. Audit records and logs SHALL have separately approved retention policies.

**Rationale:** Debug logs are mutable operational data and do not by themselves satisfy clinical or financial traceability.

**Alternatives considered:**

- Use ordinary logs as audit history: cheaper initially but unreliable for searchable, durable, business-level evidence.

### 12. Use a durable job queue and transactional outbox for asynchronous work

Email/SMS delivery, report and document generation, integration submissions, retries, payout calculations, and other long-running work SHALL run outside request handlers. Business transactions that cause asynchronous work SHALL write an outbox event in the same database transaction; workers SHALL claim and process events idempotently.

The initial queue may be PostgreSQL-backed through the transactional outbox to minimize infrastructure. Redis or a managed broker may be introduced when measured throughput, latency, or isolation needs justify it.

**Rationale:** This prevents lost messages between database commit and queue publication while keeping the first deployment manageable.

**Alternatives considered:**

- In-process cron only, as in the Portal topology: usable for scheduled maintenance but insufficient for durable per-transaction work.
- Introduce Kafka or RabbitMQ immediately: robust, but adds avoidable infrastructure before load characteristics are known.

### 13. Put every external system behind a provider adapter

Nexus, SMTP/SMS providers, Shafafiya, eClaimLink, and Pinelabs SHALL be accessed through internal interfaces with provider-specific adapters. Adapters SHALL implement timeout, retry classification, idempotency/duplicate handling, correlation, redacted logging, and circuit-breaking policies appropriate to the provider.

Inbound callbacks SHALL be authenticated, persisted before processing, and deduplicated. Integration payloads and statuses SHALL be traceable to the originating business record without exposing credentials.

**Rationale:** Provider contracts and regional rules are unresolved and will change independently of core workflows.

**Alternatives considered:**

- Call vendors directly from domain modules: faster for the first integration but couples provider schemas and failure behavior to core business logic.

### 14. Design for observability, backup, and recovery from the first deployable slice

UI and API releases SHALL carry a commit-based version. The API and workers SHALL emit structured logs, metrics, traces, and correlation IDs. Monitoring SHALL cover availability, latency, error rate, queue backlog, integration failures, database health, and certificate expiry without exposing patient information.

Database and object-store backups SHALL be encrypted and restoration SHALL be tested. Recovery point and recovery time objectives must be approved before production. Production deployments SHALL support health checks, migration gates, smoke tests, and rollback of application versions.

**Rationale:** Operational failure in registration, admission, and billing can stop hospital workflows; recovery cannot be deferred until after implementation.

## Deployment Topology

```text
Browser
  |
  | HTTPS
  v
CloudFront
  |-- private S3 origin in AWS UAE -> versioned React static build
  `-- API hostname -> API/worker compute in AWS UAE
                         |-- PostgreSQL
                         |-- Private S3-compatible object storage
                         |-- Durable worker/outbox processing
                         `-- External provider adapters
```

Development and staging SHALL use separate databases, object namespaces, credentials, hostnames, and external-provider environments. Production data SHALL not be copied into lower environments without an approved anonymization process.

## Security and Privacy Baseline

- TLS SHALL be required for browser, API, database, object-storage, and external-provider traffic where supported.
- Secrets SHALL be supplied through an approved secret-management mechanism and SHALL not be committed or embedded in frontend builds.
- Database, backup, and object-storage encryption at rest SHALL be enabled.
- CORS and content security policy SHALL allow only explicitly configured origins and resources.
- Patient data SHALL not be cached by shared proxies or stored in browser persistent storage unless explicitly reviewed.
- Export, print, document access, confidential-record access, refunds, discounts, write-offs, and discharge clearance SHALL be permission-controlled and audited.
- Dependency, container, and static analysis checks SHALL run in CI; critical findings SHALL block release under an approved policy.

## Delivery Sequence

The architecture should be implemented through smaller OpenSpec changes rather than one full-system implementation:

1. Platform foundation: repositories, CI/CD, environments, React shell, NestJS/Express API shell, PostgreSQL/Kysely, Cognito identity integration, audit, observability, and object storage.
2. Patient registry and document management.
3. Resource scheduling and appointment communication.
4. Sponsor contracts and pre-authorization.
5. Orders, packages, and billing foundation.
6. Inpatient ADT, beds, automated charges, and discharge controls.
7. Payment, refund, payout, reconciliation, and remaining external integrations.

Each phase SHALL create its own focused OpenSpec change with detailed specs, design decisions, tasks, test strategy, and rollout plan.

## Risks / Trade-offs

- **[A direct prototype API can be a single point of failure and DDoS target]** → Use only synthetic data, rate limits, budget alerts, and disposable infrastructure until production load balancing and WAF are approved.
- **[Broad HIS scope can produce a tightly coupled monolith]** → Enforce module ownership, explicit interfaces, architecture tests, and separate module-level OpenSpec changes.
- **[Concurrent booking, entitlement, and payment updates can cause double use]** → Use database constraints, transactions, record-version checks, idempotency keys, and concurrency tests.
- **[External providers may be unavailable or return duplicate/out-of-order messages]** → Persist exchanges, process idempotently, distinguish retryable errors, and provide reconciliation queues and operator visibility.
- **[Patient information can leak through logs, analytics, URLs, caches, or frontend state]** → Apply privacy-focused logging, CSP/cache rules, short-lived access, field classification, security testing, and audit reviews.
- **[Country requirements conflict or remain ambiguous]** → Make jurisdictional rules effective-dated and configuration-driven only after legal approval; do not assume the Indian cash rule applies to a UAE deployment.
- **[A modular monolith may later limit independent scaling]** → Instrument modules and extract a service only when ownership, load, or isolation evidence justifies the distributed-systems cost.
- **[Direct SCP deployment can cause inconsistent or partially copied UI releases]** → Deploy immutable archives to versioned directories, verify checksums, switch atomically, and retain rollback releases.
- **[Large uploads can exhaust application resources]** → Use per-document limits and consider pre-signed direct object-store upload after authorization instead of a global Nginx allowance.

## Migration Plan

This is a greenfield system, so the initial migration is an environment bootstrap rather than replacement of an existing HIS.

1. Confirm AWS UAE production residency, hostnames, Cognito/federation approach, facility model, and production availability/recovery requirements.
2. Provision isolated development and staging environments with API/worker runtime, PostgreSQL, private object storage, secrets, monitoring, and backups.
3. Establish CI checks and immutable versioned UI/API artifacts.
4. Deploy the application shells and validate TLS, SPA routing, API proxying, identity, audit, migrations, rollback, and restoration.
5. Deliver domain modules through the phased OpenSpec changes above, using feature flags and controlled pilot facilities.
6. Before production, perform security, privacy, performance, disaster-recovery, workflow, financial reconciliation, and user-acceptance testing.

For application rollback, restore the prior UI release pointer and prior API image. Database migrations SHALL prefer backward-compatible expand-and-contract changes; destructive migrations require a separate approved plan and verified backup. Financial or audit data SHALL never be rolled back by deleting committed business history; corrections SHALL use compensating transactions.

## Open Questions

- What UI and API domain names are required for development, staging, and production?
- Which country or countries, regulators, facilities, currencies, languages, and timezones are in the first release?
- Is the product single-organization, multi-facility, or multi-tenant across independent hospital groups?
- What are the approved patient-matching, MRN, duplicate-merge, and unidentified-patient policies?
- What are the required uptime, performance, concurrency, RPO, and RTO targets?
- What are the data-residency, retention, consent, deletion, and legal-hold requirements?
- Which object-storage provider and deployment region are approved for patient documents?
- Is there a demonstrated query requirement that would justify adding GraphQL later, or can REST/OpenAPI remain the only initial API contract?
- What are the exact Shafafiya, eClaimLink, Nexus, SMS, SMTP, and Pinelabs protocol versions and certification requirements?
- Which reports require real-time operational queries versus a separate analytics/reporting store?
