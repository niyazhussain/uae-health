## 0. Govern delivery and traceability

- [x] 0.1 Establish the OpenSpec document map, evolved-task tracking rule, and task-numbered commit-and-push workflow.
- [x] 0.1a Require explicit user review and approval before every task commit or push.
- [ ] 0.2 Configure protected `main` branch rules, required checks, and explicit development/production environment approvals; after adding a second trusted reviewer, disable environment self-review and administrator bypass without breaking the documented release flow.
- [x] 0.3 Re-scope the POC checklist to native workforce access plus basic patient identity and appointments, and move enterprise identity and real-data production work to the dedicated Phase 2 OpenSpec change.

## 1. Confirm and record the foundation

- [x] 1.1 Approve this PostgreSQL, Kysely, NestJS/Express, React/Vite, Cognito, and AWS UAE architecture.
- [ ] 1.3 Define the initial audit-event policy, event taxonomy, allowed JSONB snapshot fields, and retention periods.

## 2. Create local fake-data development

- [x] 2.1 Bootstrap `web` with React, Vite, TypeScript, and Tailwind CSS v4.
- [x] 2.1a Establish accessible design tokens and reusable shadcn/ui primitives using the installed `design-taste-frontend` skill; keep component source in the repository.
- [x] 2.1b Add a local frontend container with Vite hot-module reload and a root Docker Compose workflow that starts the web, API, and PostgreSQL services together; provide pgAdmin through an optional local-tools profile.
- [x] 2.1c Establish a feature-owned frontend page structure by moving routable menu screens from generic components into `web/src/pages/<module>/.../page.tsx`, while retaining shared controls and primitives in `web/src/components`.
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
- [x] 3.1c Implement a PostgreSQL-backed backend-for-frontend workforce session that exchanges one validated Cognito access token for a hashed opaque server session, uses a host-only HttpOnly cookie, session-bound CSRF protection, sliding idle and fixed absolute expiry, reload restoration, safe session audit outcomes, and server-side logout; clear all Cognito tokens from browser memory after exchange and do not use CloudFront or Lambda@Edge as the session authority.
- [ ] 3.2 Implement administrator-only native workforce user creation, invitation, update, suspension, first-login password setup, and required TOTP MFA through the HIS administration boundary.
- [x] 3.2a Implement the first authenticated Workforce Directory vertical slice across API and UI, resolving the Cognito subject to current HIS authorization and returning only practice-scoped membership and safe Cognito account status data.
- [x] 3.2b Implement the administrator-authorized native workforce invitation vertical slice across API and UI, creating or reusing Cognito identities by immutable subject, creating an active practice membership without email-based account merging, recording the audit event transactionally, and compensating a newly created Cognito user if HIS persistence fails.
- [x] 3.2c Implement administrator-authorized practice-membership suspension and restoration across API and UI, preserving the global user and other practice memberships, revoking the affected user's active server sessions, and recording the membership-state change transactionally without changing Cognito account status.
- [x] 3.2d Implement administrator-authorized practice-scoped assignment and revocation of safe global workforce roles across API and UI, enforcing current role-management scope and delegation constraints, preserving Cognito as authentication-only, and recording access-authority changes transactionally.
- [x] 3.2e Implement administrator-authorized tenant-local role creation and practice-scoped assignment/revocation across API and UI, limiting local roles to the global delegable permission catalogue, preserving Cognito as authentication-only, and recording role-definition and authority changes transactionally.
- [x] 3.2f Implement the authenticated application shell's compact top bar with responsive primary navigation, plus a separate, read-only tenant role catalogue across API and UI for authorized role managers, showing active global templates and current-tenant local roles, permissions, delegability, and current-practice assignment counts without exposing other-tenant authorization data or changing state.
- [x] 3.2g Establish the responsive top-level healthcare navigation skeleton (Dashboard, Patients, Scheduling, Clinical, Operations, Revenue, and Administration) with contextual sub-navigation and clear no-data, no-authorization-claim unavailable states for modules not yet implemented.
- [x] 3.2h Refine the read-only role catalogue into a compact, high-contrast, server-paginated role index with search and source filters plus a scoped selected-role details panel, preserving the current practice scope without changing access.
- [x] 3.2i Remove the duplicated non-interactive parent-module label from contextual sub-navigation, distinguish module and page selection patterns, and bound large submenus behind an accessible overflow disclosure.
- [ ] 3.3 Implement facility-scoped API authorization, confidential-record controls, approval limits, and access-denied auditing.
  - Deferred until the first clinical-record and revenue-approval endpoints exist. Task 3.3a already provides the fail-closed, provider-neutral decision service and safe denial-audit primitive; implementing endpoint enforcement now would require invented patient-record classifications, facility ownership, financial approval policies, and escalation workflows. Those business endpoints will invoke the established decision service when introduced.
- [x] 3.3a Establish the provider-neutral, database-backed authorization decision foundation for facility-scoped and confidential operations, including safe auditable denials, without exposing a generic authorization-probe endpoint or adding patient or billing data endpoints.
- [x] 3.3b Record the reason endpoint-level facility, confidentiality, and approval-limit enforcement is deferred, without representing the controls as live for resources that do not yet exist.
- [x] 3.4b Refactor workforce authentication to a provider-neutral identity boundary with Cognito as the initial dedicated adapter, HIS-owned account lifecycle and persisted provider-sync status after backend-only lifecycle calls, approved parallel provider transitions and immutable-identity linking for Okta, Entra ID, and future providers, and documented password/MFA migration paths without copying credential material or merging by email.
- [x] 3.4d Align the database migration integration fixture with the provider-neutral workforce identity contract so the suite exercises the same issuer/protocol seam as production code.
- [x] 3.4c Change the default HIS workforce session sliding idle timeout to 30 minutes while retaining the fixed 8-hour absolute session limit and preserving explicit environment overrides.
- [x] 3.5 Implement a POC patient identity boundary separate from workforce identities, using a separate synthetic staging pool/client Terraform module, native email sign-in, a provider-neutral global patient binding, auditable explicit portal-profile links, a restricted no-practice onboarding session, and one explicitly selected practice context for every practice-owned operation, with session rotation on practice changes and no automatic email or phone merging, cross-practice aggregation, clinical-record access, or unrelated workforce lifecycle changes in the reviewed infrastructure plan.
- [x] 3.5b Implement patient email self-registration plus practice-issued invitation and authenticated acceptance flows, including the backend identity-provider adapter and least-privilege pool-scoped IAM policy, creating one restricted patient onboarding identity and explicit audited per-practice relationships without email/phone-based record discovery, automatic account merging, or disclosure of other practice relationships.
- [x] 3.5c Establish a visibly distinct patient-facing sign-in, onboarding, and signed-in portal experience from workforce/provider UI, using patient-specific purpose, language, and navigation while retaining shared accessible primitives and never relying on visual state for authorization.
- [x] 3.5a Implement a synthetic-data basic patient appointment portal where a patient can discover a bookable practice, create an explicit pending relationship when needed, and view, request, cancel, or reschedule only their own appointments in one selected practice context without clinical, payment, messaging, or advanced identity-proofing features.

## 4. Deploy a disposable fake-data demonstration

- [x] 4.0 Add GitHub Actions verification for pull requests and branch pushes, plus a manual source-revision-tagged web/API artifact build that performs no deployment.
- [x] 4.1 Configure the synthetic `singapore-development` GitHub environment, least-privilege environment secrets and public variables, protected manual promotion from an exact reviewed `main` artifact run, and review gates without production credentials or an automatic deployment.
- [x] 4.2 Implement the Portal-style deployment to the existing Singapore Linux server using immutable artifacts, SSH, atomic activation, readiness checks, and rollback without compiling source on the server.
- [x] 4.3 Define the Singapore NestJS API and synthetic PostgreSQL 17 runtime in `/Users/niyazshafrina/Github/infrastructure`, with no database host port, a dedicated internal database network, an encrypted persistent host volume, and migration/seed gates.
- [x] 4.4 Publish the revision-tagged React artifact at `uae-health.softdefine.com` through the existing Singapore Nginx edge with HTTPS-only delivery, atomic activation, SPA fallback, security headers, and safe cache policies; proxy the API separately at `api.uae-health.softdefine.com` without caching it.
- [ ] 4.4a Publish workforce and patient portal entry points on separate approved hosts (`uae-health.com` and `patient.uae-health.com`, with staging equivalents), route both to the shared API through separate endpoint namespaces and session boundaries, and reject cross-entry authentication context.
- [ ] 4.4b Configure and verify the API's explicit trusted-proxy policy before enabling public patient registration outside local synthetic QA, so IP-based abuse limits use a verified client address and never trust client-supplied forwarding headers by default.
- [ ] 4.5 Document and verify staging database backup/restore, deployment rollback, and complete synthetic-environment recovery before public demonstration.
- [ ] 4.6 Configure cost budgets and alerts at $1, $3, and $5; document the remaining charges when EC2 or RDS is stopped and when ALBs, snapshots, EBS volumes, or allocated IPs remain.

Phase 2 enterprise identity, advanced patient proofing, tenant domains, and real-data production tasks are tracked in [`phase-2-identity-and-production`](../phase-2-identity-and-production/tasks.md).
