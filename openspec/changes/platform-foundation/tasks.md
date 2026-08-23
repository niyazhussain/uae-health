## 0. Govern delivery and traceability

- [x] 0.1 Establish the OpenSpec document map, evolved-task tracking rule, and task-numbered commit-and-push workflow.
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
- [ ] 2.4 Implement application user, facility membership, permission, and append-only audit-event schemas.
- [ ] 2.5 Verify tests never use customer health data, production credentials, or production endpoints.
- [ ] 2.6 Document and test PostgreSQL backup, restore, and forward-compatible migration commands against synthetic data.
- [ ] 2.7 Add root workspace commands and consistent format, lint, type-check, unit, integration, migration, and production-build checks for `web` and `api`.
- [ ] 2.8 Add validated environment schemas and fail-safe configuration for local, staging, and production builds.

## 3. Establish authentication and authorization

- [ ] 3.1 Create a Cognito User Pool in AWS UAE for development and configure OIDC token validation in the API.
- [ ] 3.2 Implement administrator-only provider provisioning and required TOTP MFA.
- [ ] 3.3 Implement facility-scoped API authorization, confidential-record controls, approval limits, and access-denied auditing.
- [ ] 3.4 Define account-linking rules for future Entra ID, UAE PASS, and patient WhatsApp OTP flows.

## 4. Deploy a disposable fake-data demonstration

- [ ] 4.0 Add GitHub Actions verification for feature branches, `develop`, and `main`; build source-revision-tagged web and API artifacts without deploying feature branches.
- [ ] 4.1 Configure separate GitHub staging and production environments, least-privilege secrets, AWS OIDC for production, protected-branch rules, and explicit production approval.
- [ ] 4.2 Implement the Portal-style `develop` deployment to the existing Singapore Linux server using immutable artifacts, SSH, atomic activation, readiness checks, and rollback without compiling source on the server.
- [ ] 4.3 Run one self-managed NestJS API and synthetic PostgreSQL service on the Singapore server with private database networking and an encrypted persistent volume.
- [ ] 4.4 Publish the staging React artifact through its own CloudFront distribution, custom hostname and certificate, HTTPS-only delivery, SPA fallback, security headers, and safe cache policies.
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
