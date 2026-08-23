This file is the program roadmap. Detailed completion is recorded in each focused change so work is not marked twice. Tasks are checked here only when the program-level outcome is complete.

## 1. Confirm Architecture and Product Decisions

- [ ] 1.1 Confirm first-release countries, regulators, currencies, languages, facility types, and timezone requirements with product and compliance stakeholders
- [ ] 1.2 Confirm whether the product is single-organization, multi-facility, or multi-tenant across independent hospital groups
- [ ] 1.3 Approve development, staging, and production UI and API hostnames, CloudFront/S3 static delivery, and AWS UAE production residency
- [ ] 1.4 Confirm Cognito, workforce TOTP MFA, session model, provider provisioning, and future federation/account-linking rules
- [ ] 1.5 Confirm PostgreSQL capacity, isolation, backup ownership, and approved private object-storage configuration in AWS UAE
- [ ] 1.6 Define production availability, performance, concurrency, backup, RPO, RTO, retention, data-residency, and legal-hold requirements
- [ ] 1.7 Resolve patient matching, MRN generation, unidentified-patient, duplicate detection, and merge policies
- [ ] 1.8 Obtain and document the applicable Nexus, Shafafiya, eClaimLink, SMTP/SMS, and Pinelabs interface versions and certification requirements

## 2. Create Focused OpenSpec Delivery Changes

- [x] 2.1 Create and validate a `platform-foundation` OpenSpec change for application shells, infrastructure, identity, audit, and observability
- [ ] 2.2 Create and validate a `patient-registration` OpenSpec change with detailed patient identity, document, registration, and conversion behavior
- [ ] 2.3 Create and validate a `resource-scheduling` OpenSpec change with slot concurrency, waitlist, recurrence, and appointment-status behavior
- [ ] 2.4 Create and validate a `sponsor-preauthorization` OpenSpec change with contract versioning and payer workflow details
- [ ] 2.5 Create and validate an `orders-packages-billing` OpenSpec change with monetary, entitlement, sponsor-allocation, and reconciliation rules
- [ ] 2.6 Create and validate an `inpatient-adt` OpenSpec change with bed, charge, transfer, and staged-discharge state transitions
- [ ] 2.7 Create and validate a `patient-communications` OpenSpec change with consent, DND, templates, bulk messaging, and delivery rules
- [ ] 2.8 Create and validate an `external-integrations` OpenSpec change after provider contracts and test environments are available

## 3. Establish Repository and Quality Foundations

- [ ] 3.1 Create root workspace configuration for independently buildable `web` and `api` TypeScript applications
- [ ] 3.2 Add shared packages only for generated API types, validation primitives, design tokens, and non-domain utilities
- [ ] 3.3 Configure consistent TypeScript, formatting, linting, import-boundary, and dependency policies
- [ ] 3.4 Configure unit, integration, component, and end-to-end test commands with deterministic CI execution
- [ ] 3.5 Add environment-variable schemas that fail startup or build when required configuration is invalid
- [ ] 3.6 Add dependency, secret, static-analysis, and container-image checks with an approved release-blocking policy
- [ ] 3.7 Document local development setup, repository conventions, module ownership, and release workflow

## 4. Build the React Frontend Foundation

- [ ] 4.1 Scaffold `web` with React, Vite, TypeScript, and supported browser targets
- [ ] 4.2 Configure client routing, route-level lazy loading, protected routes, error boundaries, and a not-found route
- [ ] 4.3 Establish the visual design direction and reusable design tokens using the installed `design-taste-frontend` skill
- [ ] 4.4 Implement the accessible application shell with facility context, primary navigation, page hierarchy, user controls, and responsive behavior
- [ ] 4.5 Implement reusable form, validation, table, filtering, status, empty, loading, error, confirmation, and notification patterns
- [ ] 4.6 Configure generated OpenAPI client types, centralized request handling, correlation IDs, authentication failure handling, and safe error presentation
- [ ] 4.7 Implement session handling without storing sensitive tokens in insecure browser persistence
- [ ] 4.8 Add localization foundations for language, direction, Gregorian/Hijri dates, facility timezone, number, and currency formatting
- [ ] 4.9 Add frontend accessibility checks, component tests, responsive checks, and representative end-to-end smoke tests
- [ ] 4.10 Configure production asset hashing, source-map handling, release identification, and cache-safe runtime configuration

## 5. Build the API and Database Foundation

- [ ] 5.1 Scaffold the NestJS TypeScript API with versioned REST controllers, structured errors, DTO validation, health checks, and graceful shutdown
- [ ] 5.2 Create module boundaries for identity, patient registry, scheduling, ADT, sponsors, pre-authorization, packages, orders, billing, communications, audit, and integrations
- [ ] 5.3 Provision local PostgreSQL, configure Kysely migrations with forward-compatible migration checks, and seed only synthetic data
- [ ] 5.4 Define shared identifiers, timestamps, date-only values, facility scope, currency, monetary precision, and optimistic-concurrency conventions
- [ ] 5.5 Generate an initial OpenAPI contract from NestJS decorators and automate frontend client generation with compatibility checks
- [ ] 5.6 Implement request correlation, structured redacted logging, metrics, tracing hooks, and safe health/readiness responses
- [ ] 5.7 Implement idempotency-key persistence and replay behavior for mutation endpoints that can create duplicate business effects
- [ ] 5.8 Configure Kysely data-access services, naming conventions, explicit transaction helpers, and a rule prohibiting SQL in controllers
- [ ] 5.9 Verify PostgreSQL foreign keys, unique/check constraints, row-locking, transaction isolation, deadlock/serialization retry, decimal precision, timezone, and migration behavior with integration tests
- [ ] 5.10 Add API unit, database integration, migration, concurrency, contract, and authorization test harnesses

## 6. Implement Identity, Authorization, and Audit Foundations

- [ ] 6.1 Integrate the selected OpenID Connect provider and validate issuer, audience, signature, expiry, and session requirements
- [ ] 6.2 Define facility-aware roles, permissions, department scope, confidential-record access, and financial approval limits
- [ ] 6.3 Implement centralized API authorization policies and deny-by-default behavior for protected operations
- [ ] 6.4 Implement append-only audit events containing actor, facility, action, target, timestamp, correlation ID, outcome, and required reason
- [ ] 6.5 Audit sensitive record reads, denied access, order placement, discounts, billing, cancellations, refunds, credit notes, write-offs, and discharge clearance
- [ ] 6.6 Provide an access-controlled audit search interface and verify ordinary application roles cannot alter or delete audit events
- [ ] 6.7 Add automated authorization matrix and confidential-patient access tests

## 7. Implement Storage and Asynchronous Processing Foundations

- [ ] 7.1 Provision private S3-compatible object storage with environment isolation, encryption, and blocked public access
- [ ] 7.2 Implement document metadata, checksums, content-type validation, configurable size limits, and authorized short-lived access
- [ ] 7.3 Add malware-scanning workflow and quarantine behavior before uploaded documents become available
- [ ] 7.4 Implement a transactional outbox and idempotent worker claim, retry, dead-letter, and reconciliation behavior
- [ ] 7.5 Move email/SMS delivery, document generation, external submissions, and other long-running work to durable background jobs
- [ ] 7.6 Add worker backlog, retry, failure, and processing-duration metrics and operational alerts
- [ ] 7.7 Verify database and object-store backup creation, encryption, retention, and restoration in a non-production environment

## 8. Establish Deployment and Operations

- [ ] 8.1 Create a multi-stage API container build that runs as a non-root user and exposes controlled health checks
- [ ] 8.2 Create Docker Compose definitions for API and worker services on a private network with secrets supplied outside source control
- [ ] 8.3 Create private S3 and CloudFront configuration with Origin Access Control, TLS redirect, SPA fallback, security headers, immutable fingerprinted-asset caching, and non-cached `index.html`
- [ ] 8.4 Create the disposable demo API reverse proxy configuration and the production API edge/load-balancing configuration with TLS, correct forwarded headers, request IDs, controlled per-route upload limits, timeouts, and private upstream routing
- [ ] 8.5 Create CI pipelines that test and build immutable React artifacts and commit-addressed API container images
- [ ] 8.6 Deploy immutable frontend artifacts to S3 and activate them only after checksum and smoke-test verification
- [ ] 8.7 Deploy API and workers with migration gates, readiness verification, and automatic rollback to the prior compatible image on failure
- [ ] 8.8 Configure environment-specific DNS, certificates, CORS, CSP, secrets, databases, object namespaces, and provider endpoints
- [ ] 8.9 Add dashboards and alerts for UI/API availability, latency, errors, queue backlog, integrations, database health, storage, backups, and certificate expiry
- [ ] 8.10 Perform and document UI, API, database-migration, and disaster-restoration rollback exercises

## 9. Deliver Patient Registration and Scheduling

- [ ] 9.1 Implement patient master, demographics, configurable fields, MRN allocation, classifications, and duplicate-detection rules from the focused specification
- [ ] 9.2 Implement pre-registration, outpatient, inpatient, outside-patient, and incoming-sample registration commands and validation
- [ ] 9.3 Implement patient photo, identity, insurance-card, consent-signature, and document workflows using private object storage
- [ ] 9.4 Implement confidentiality enforcement, consultant tokens, follow-up determination, printable materials, and OP-to-IP conversion
- [ ] 9.5 Implement authenticated and idempotent third-party self-registration endpoints
- [ ] 9.6 Design and implement registration screens and workflows with accessibility, keyboard operation, responsive behavior, and representative user testing
- [ ] 9.7 Implement resources, availability, configurable durations, secondary-resource requirements, blocks, bulk overrides, and authorized overbooking
- [ ] 9.8 Implement appointment booking, recurrence, statuses, cancellation, no-show history, waitlists, and Gregorian/Hijri input
- [ ] 9.9 Prevent accidental double booking using database constraints or controlled locking and verify behavior under concurrent requests
- [ ] 9.10 Design and implement calendar and slot-based scheduling views with accessible alternatives and operational usability testing
- [ ] 9.11 Add end-to-end tests for patient creation, confidentiality, outside-patient registration, sample registration, OP-to-IP conversion, ordinary booking, overbooking, waitlisting, cancellation, and no-show workflows

## 10. Deliver Sponsor, Authorization, Package, and Billing Foundations

- [ ] 10.1 Implement effective-dated sponsor contracts, rates, discounts, coverage categories, billing models, and immutable contract-version references
- [ ] 10.2 Implement copay, minimum/maximum copay, deductible, exclusion, encounter-limit, episode-limit, and pre-authorization rule evaluation
- [ ] 10.3 Define and implement approved two-sponsor priority and coordination-of-benefits behavior
- [ ] 10.4 Implement manual and prescription-originated pre-authorization requests with submission-attempt and decision history
- [ ] 10.5 Implement approved-authorization validity, quantity, and value controls when converting approvals into orders
- [ ] 10.6 Implement one-time, multi-visit, patient-specific, inventory-inclusive, and surgical package definitions and assignments
- [ ] 10.7 Implement package eligibility, entitlement consumption, amount/quantity limits, exclusions, and concurrent-consumption protection
- [ ] 10.8 Implement orders from prescriptions, authorizations, packages, and direct entry with source traceability and permission enforcement
- [ ] 10.9 Implement bills and bill items with patient and up-to-two-sponsor responsibility, fixed-precision money, state transitions, and version control
- [ ] 10.10 Implement discounts and provisional discounts with user approval limits and complete audit history
- [ ] 10.11 Add rule-level, concurrency, authorization, and end-to-end tests for contract pricing, sponsor allocation, authorization conversion, package consumption, order creation, and billing

## 11. Deliver Inpatient ADT and Financial Operations

- [ ] 11.1 Implement admission, bed allocation, bed status, transfer, prior-bed retention/release, and bystander-bed workflows
- [ ] 11.2 Implement hourly, half-day, and full-day stay-charge calculation with duty-doctor and nursing charge rules
- [ ] 11.3 Implement idempotent automated charge posting and charge recalculation controls for bed transfers and retained beds
- [ ] 11.4 Implement Initial, Clinical, Financial, and Physical Discharge state transitions with clinical and billing prerequisites
- [ ] 11.5 Design and implement inpatient census, bed board, transfer, pending-clearance, and discharge user experiences
- [ ] 11.6 Implement deposits, set-offs, payment modes, receipts, receipt allocation, balances, and reconciliation-safe transaction posting
- [ ] 11.7 Implement controlled item cancellation, original-payment-linked refunds, credit notes, and patient or sponsor write-offs
- [ ] 11.8 Implement versioned doctor and outhouse payout rules with traceable calculation breakdowns
- [ ] 11.9 Implement effective-dated jurisdictional cash-collection controls only after legal approval
- [ ] 11.10 Generate configurable bills, receipts, patient statements, and day-book, collection, revenue, and payout reconciliation reports
- [ ] 11.11 Add end-to-end and concurrency tests for bed transfer/retention, automated charging, discharge blocking, deposits, payments, refunds, write-offs, payouts, and reconciliation

## 12. Deliver Communications and External Integrations

- [ ] 12.1 Implement patient SMS, Email, Both, and DND preferences with approved legal or emergency exceptions
- [ ] 12.2 Implement versioned notification templates, eligibility evaluation, queued delivery, provider outcomes, suppression, and retry behavior
- [ ] 12.3 Implement appointment, registration, billing, payment, and discharge transactional triggers through the outbox
- [ ] 12.4 Implement authorized bulk-audience selection, preview, approval, rate limiting, and auditable dispatch
- [ ] 12.5 Implement authenticated and deduplicated inbound SMS confirmation and cancellation responses
- [ ] 12.6 Implement secure, preference-aware bill and diagnostic-report email delivery
- [ ] 12.7 Implement provider-adapter interfaces for Nexus, SMTP/SMS, Shafafiya, eClaimLink, and Pinelabs
- [ ] 12.8 Persist outbound requests and inbound callbacks with correlation, redaction, authentication results, duplicate detection, and reconciliation status
- [ ] 12.9 Complete vendor sandbox, failure, retry, duplicate, out-of-order, security, and certification tests for each enabled integration

## 13. Production Readiness and Acceptance

- [ ] 13.1 Trace every requirement and scenario in the capability specs to an automated test, approved manual test, or explicitly deferred follow-up change
- [ ] 13.2 Complete clinical, operational, finance, insurance, audit, security, privacy, accessibility, and infrastructure stakeholder reviews
- [ ] 13.3 Run representative load and concurrency tests for registration, scheduling, bed allocation, package consumption, billing, and payment workflows against approved targets
- [ ] 13.4 Complete threat modeling, penetration testing, dependency review, data-flow review, and remediation of release-blocking findings
- [ ] 13.5 Complete backup restoration, regional failure, provider outage, queue recovery, deployment rollback, and financial reconciliation exercises
- [ ] 13.6 Prepare role-based training, support runbooks, incident procedures, reconciliation procedures, and pilot-facility rollout materials
- [ ] 13.7 Conduct user acceptance testing with representative staff and record approvals and unresolved exceptions
- [ ] 13.8 Launch through controlled facility and capability flags with monitoring, rollback criteria, and named operational owners
- [ ] 13.9 Validate the implemented OpenSpec changes and archive each only after its requirements, design, tasks, and acceptance evidence are complete
