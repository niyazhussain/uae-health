## 0. Govern delivery and traceability

- [x] 0.1 Establish the OpenSpec document map, evolved-task tracking rule, and task-numbered commit-and-push workflow.
- [x] 0.1a Require explicit user review and approval before every task commit or push.
- [ ] 0.2 Configure protected `develop` and `main` branch rules, required checks, and production environment approval without bypassing the documented release flow.

## 1. Confirm and record the foundation

- [x] 1.1 Approve this PostgreSQL, Kysely, NestJS/Express, React/Vite, Cognito, and AWS UAE architecture.
- [ ] 1.2 Confirm the first customer jurisdiction, applicable health authority, and production compliance obligations before receiving real data.
- [ ] 1.3 Define the initial audit-event policy, event taxonomy, allowed JSONB snapshot fields, and retention periods.

## 2. Create local fake-data development

- [x] 2.1 Bootstrap `web` with React, Vite, TypeScript, and Tailwind CSS v4.
- [x] 2.1a Establish accessible design tokens and reusable shadcn/ui primitives using the installed `design-taste-frontend` skill; keep component source in the repository.
- [x] 2.1b Add a local frontend container with Vite hot-module reload and a root Docker Compose workflow that starts the web, API, and PostgreSQL services together; provide pgAdmin through an optional local-tools profile.
- [x] 2.2 Bootstrap `api` with NestJS, Express, TypeScript, validation, OpenAPI, health endpoints, and rate limiting.
- [x] 2.2a Run the local API image through a Docker-compatible desktop runtime and verify `/health` and `/docs`.
- [x] 2.3 Add local PostgreSQL through Docker with Kysely, `pg`, migration commands, and synthetic seed data.
- [x] 2.4 Implement the global application-user, identity-binding, tenant and practice hierarchy, scoped membership, global/local role, permission, role-request/approval, assignment, and append-only audit-event schemas.
- [ ] 2.5 Verify tests never use customer health data, production credentials, or production endpoints.
- [ ] 2.6 Document and test PostgreSQL backup, restore, and forward-compatible migration commands against synthetic data.
- [ ] 2.7 Add root workspace commands and consistent format, lint, type-check, unit, integration, migration, and production-build checks for `web` and `api`.
- [ ] 2.8 Add validated environment schemas and fail-safe configuration for local, staging, and production builds.

## 3. Establish authentication and authorization

- [x] 3.1 Define a reusable static Cognito/IAM workforce-identity module in `/Users/niyazshafrina/Github/infrastructure/terraform`, instantiate one synthetic staging identity boundary in `ap-south-1` for local/development/staging use, gate the production `me-central-1` instantiation behind production approval, document the service-managed encryption, account-level logging, and no-client-secret decisions, configure environment-aware API access-token validation, and verify a protected request against the staging pool with an ephemeral native test user.
- [ ] 3.1a Retire the empty local and development Cognito pools, clients, and administration policies through reviewed GitHub Actions plans by first disabling deletion protection and then removing those Terraform instances, leaving the staging identity boundary intact.
- [ ] 3.1b When explicitly resumed, create the production workforce Cognito pool, app client, and scoped administration policy in `me-central-1` through the regional Terraform state, without creating production application, data, patient-identity, or network resources; the first attempt failed with an AWS Cognito internal error and production is currently deferred.
- [x] 3.1c Implement a PostgreSQL-backed backend-for-frontend workforce session that exchanges one validated Cognito access token for a hashed opaque server session, uses a host-only HttpOnly cookie, session-bound CSRF protection, sliding idle and fixed absolute expiry, reload restoration, safe session audit outcomes, and server-side logout; clear all Cognito tokens from browser memory after exchange and do not use CloudFront or Lambda@Edge as the session authority.
- [ ] 3.2 Implement administrator-only native workforce user creation, invitation, update, suspension, first-login password setup, and required TOTP MFA through the HIS administration boundary.
- [x] 3.2a Implement the first authenticated Workforce Directory vertical slice across API and UI, resolving the Cognito subject to current HIS authorization and returning only practice-scoped membership and safe Cognito account status data.
- [x] 3.2b Implement the administrator-authorized native workforce invitation vertical slice across API and UI, creating or reusing Cognito identities by immutable subject, creating an active practice membership without email-based account merging, recording the audit event transactionally, and compensating a newly created Cognito user if HIS persistence fails.
- [x] 3.2c Implement administrator-authorized practice-membership suspension and restoration across API and UI, preserving the global user and other practice memberships, revoking the affected user's active server sessions, and recording the membership-state change transactionally without changing Cognito account status.
- [x] 3.2d Implement administrator-authorized practice-scoped assignment and revocation of safe global workforce roles across API and UI, enforcing current role-management scope and delegation constraints, preserving Cognito as authentication-only, and recording access-authority changes transactionally.
- [x] 3.2e Implement administrator-authorized tenant-local role creation and practice-scoped assignment/revocation across API and UI, limiting local roles to the global delegable permission catalogue, preserving Cognito as authentication-only, and recording role-definition and authority changes transactionally.
- [ ] 3.3 Implement facility-scoped API authorization, confidential-record controls, approval limits, and access-denied auditing.
- [ ] 3.4 Implement administrator-managed tenant OIDC/SAML connections, federated JIT provisioning, non-SSO invitation/approval, and immutable-issuer/subject account linking for Entra ID, Okta, and future approved providers without email-based automatic merging.
- [ ] 3.4a Implement an HIS-owned, tenant-scoped SCIM 2.0 user and group provisioning service with membership-specific suspension, idempotent synchronization, protected credentials, and no direct permission grant from SCIM claims.
- [x] 3.4b Refactor workforce authentication to a provider-neutral identity boundary with Cognito as the initial dedicated adapter, HIS-owned account lifecycle and persisted provider-sync status after backend-only lifecycle calls, approved parallel provider transitions and immutable-identity linking for Okta, Entra ID, and future providers, and documented password/MFA migration paths without copying credential material or merging by email.
- [x] 3.4c Change the default HIS workforce session sliding idle timeout to 30 minutes while retaining the fixed 8-hour absolute session limit and preserving explicit environment overrides.
- [ ] 3.5 Define and implement a separate patient Cognito identity boundary and an auditable patient-portal-account-to-clinical-record linking workflow, supporting real email or phone sign-in and optional WhatsApp phone-control verification without email-based workforce/patient merging.

## 4. Deploy a disposable fake-data demonstration

- [ ] 4.0 Add GitHub Actions verification for feature branches, `develop`, and `main`; build source-revision-tagged web and API artifacts without deploying feature branches.
- [ ] 4.1 Configure separate GitHub staging and production environments, least-privilege secrets, AWS OIDC for production, protected-branch rules, and explicit production approval.
- [ ] 4.2 Implement the Portal-style `develop` deployment to the existing Singapore Linux server using immutable artifacts, SSH, atomic activation, readiness checks, and rollback without compiling source on the server.
- [ ] 4.3 Run one self-managed NestJS API and synthetic PostgreSQL service on the Singapore server with private database networking and an encrypted persistent volume.
- [ ] 4.4 Publish the staging React artifact through its own CloudFront distribution, custom hostname and certificate, HTTPS-only delivery, SPA fallback, security headers, and safe cache policies.
- [ ] 4.4a Implement verified tenant-owned application domains and constrained tenant branding through the administrator UI, including DNS ownership and TLS validation, safe hostname-to-tenant resolution, accessible logo/name/favicon/accent customization, and a shared Cognito login domain rather than one Cognito custom domain per tenant.
- [ ] 4.5 Document and verify staging database backup/restore, deployment rollback, and complete synthetic-environment recovery before public demonstration.
- [ ] 4.6 Configure cost budgets and alerts at $1, $3, and $5; document the remaining charges when EC2 or RDS is stopped and when ALBs, snapshots, EBS volumes, or allocated IPs remain.

## 5. Production readiness before real data

- [ ] 5.1 Provision UAE-resident PostgreSQL, private S3 storage, backups, audit logs, and monitoring as infrastructure as code.
- [ ] 5.2 Publish the production React build from private UAE S3 through a production-only CloudFront distribution with Origin Access Control, custom DNS, certificate, and cache-safe activation.
- [ ] 5.3 Implement the protected `main` deployment to AWS UAE using short-lived credentials, immutable artifacts, migration gates, health checks, and rollback.
- [ ] 5.4 Verify all production data stores, logs, snapshots, support access, and disaster-recovery locations against the approved residency plan.
- [ ] 5.5 Add production API edge/load balancing, WAF, private networking, multi-instance compute, Multi-AZ database resilience, and recovery exercises.
- [ ] 5.6 Complete security, privacy, identity, and health-authority compliance reviews before any real patient or provider data is processed.
- [ ] 5.7 Rehearse the self-managed-demo-to-production PostgreSQL migration, including backup, restore or logical replication, read-only cutover, row-count verification, and rollback decision points.
