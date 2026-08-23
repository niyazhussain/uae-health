## Context

The HIS is a React frontend in `web` and a Node.js backend in `api`. It will handle UAE health, identity, insurance, and financial information. The design must therefore support an inexpensive fake-data prototype without allowing a low-cost deployment to be mistaken for a production healthcare environment.

## Decisions

### 1. Application stack

- `web` SHALL use React, Vite, TypeScript, and Tailwind CSS v4. shadcn/ui components, when added, SHALL be committed into this repository and adapted through shared design tokens rather than treated as an opaque UI dependency.
- `api` SHALL use NestJS, TypeScript, and the default Express adapter.
- Local API development SHALL be runnable through Docker Compose. Docker is a development-only execution environment and SHALL use synthetic data only.
- The API SHALL be a modular REST API that publishes OpenAPI contracts. NestJS controllers delegate to application services; business rules do not live in controllers.

**Rationale:** NestJS with Express provides the least-surprising, well-supported foundation for a modular HIS. Fastify remains a later performance option, not an initial requirement.

#### Frontend design system

The frontend design read is an accessibility-critical regulated healthcare product for clinical and administrative users, with a calm, trust-first visual language. Its foundation dials are `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 2`, and `VISUAL_DENSITY: 5`. The installed `design-taste-frontend` skill applies to the visual foundation and public-facing surfaces; it does not replace the specialized interaction design needed for dense HIS workflows, data tables, or multi-step clinical forms.

The application SHALL use one customized shadcn/ui system with Radix primitives and Tailwind CSS v4. Generated component source SHALL live under `web/src/components/ui` and remain owned, reviewed, and adaptable in this repository. Feature modules SHALL consume these primitives and semantic tokens rather than copying generated components or introducing a second visual system. Headless utilities required for specialized controls, such as a future data-table engine, do not constitute another visual system when they render through the shared primitives and tokens.

The token contract SHALL use semantic names for background, surface, foreground, muted content, border, input, focus ring, primary action, destructive action, and operational status. Teal is the provisional product accent until approved brand guidance replaces it through the semantic token layer. Success, warning, information, and destructive colors are reserved for meaning and SHALL also include visible text or accessible labels. Feature code SHALL NOT encode meaning through color alone.

Light and dark palettes SHALL meet WCAG AA contrast for ordinary text and interactive labels. Theme selection MAY be stored locally because it is non-sensitive preference data. Motion SHALL be limited to feedback and state transitions and SHALL honor `prefers-reduced-motion`. The radius system SHALL use 8-pixel controls, 12-pixel surfaces, and pill shapes only for status or categorization.

Geist Variable and Noto Sans Arabic Variable SHALL be bundled with the frontend rather than fetched from an external font service. The component configuration SHALL be RTL-ready, use logical layout properties, and use Phosphor as its single icon family. A later localization task will provide translated content and change the document language and direction at runtime.

**Rationale:** Repository-owned primitives and semantic tokens make the design durable without freezing product workflows into a third-party theme. Self-hosted Latin and Arabic fonts, explicit focus states, predictable control sizes, and restrained motion support healthcare usability and future bilingual delivery.

### 2. PostgreSQL and Kysely

PostgreSQL SHALL be the transactional system of record. Local and initial production environments SHALL use the PostgreSQL 17 major-version family so Docker development, backup/restore rehearsal, and AWS RDS production remain compatible. The API SHALL use `pg` and Kysely for type-safe, explicit SQL. Each module SHALL own its data-access services; SQL SHALL not be placed in controllers. Migrations SHALL be reviewable, ordered, forward-compatible Kysely migrations. Synthetic seed commands SHALL be idempotent and SHALL refuse to run when `NODE_ENV=production`.

**Rationale:** Explicit PostgreSQL queries, constraints, transactions, row locking, JSONB audit snapshots, and reporting queries are more predictable for clinical and financial workflows than a general-purpose ORM abstraction.

### 3. Authentication and authorization

Amazon Cognito User Pools in AWS Middle East (UAE) SHALL be the initial authentication boundary. The HIS SHALL retain its own application user profile, organization/facility membership, permissions, and approval limits, but SHALL not store workforce passwords.

- Workforce accounts SHALL be administrator-provisioned; self-registration is prohibited.
- Workforce accounts SHALL require phishing-resistant authentication when approved or, initially, password plus TOTP authenticator-app MFA. SMS, WhatsApp, and email are not acceptable as the sole provider factor.
- Cognito MAY federate approved OIDC or SAML workforce providers such as Microsoft Entra ID.
- UAE PASS MAY be offered as an optional patient or provider identity provider only after service-provider onboarding and approval.
- Patient WhatsApp OTP is a convenience proof of phone control, not verified clinical identity. It SHALL NOT automatically link a person to a patient record or grant provider access.

### 4. Audit design

The platform SHALL use one append-only `audit_events` table for policy-selected clinical, financial, identity, and authorization operations rather than a history table for every business table. Required audit writes SHALL occur in the same database transaction as the corresponding sensitive mutation.

An audit event SHALL include actor, effective user, facility, entity type and opaque entity ID, action, outcome, occurred-at time, correlation ID, required reason, and safe `before_data` and `after_data` JSONB snapshots where policy permits. Database privileges and application roles SHALL prevent normal update or deletion of committed events.

### 5. UAE production residency

Production health-data workloads SHALL use AWS Middle East (UAE) (`me-central-1`). PostgreSQL primary instances, replicas, backups, snapshots, document storage, audit data, and health-data logs SHALL remain in the UAE. Production API and worker compute SHALL also run in the UAE because they process protected health information.

This decision does not itself establish regulatory compliance. Before production release, the deployment, contract, support-access model, and applicable DHA/DoH/MOHAP requirements SHALL be reviewed and approved for the customer and emirate.

### 6. Staged deployment and cost control

The pre-customer environment SHALL use only synthetic data. Developers MAY run React, NestJS, and PostgreSQL locally with Docker. A public fake-data demonstration MAY use the existing self-managed Singapore server for one API instance and one PostgreSQL instance without an Application Load Balancer.

The root local Docker Compose workflow SHALL start the web application with Vite hot-module reload, the API with development reload, and PostgreSQL without requiring production credentials. pgAdmin MAY be enabled through an optional `tools` profile; it SHALL bind only to the local loopback interface, connect only to synthetic local databases, and SHALL NOT contain production endpoints or committed database passwords. The core application stack SHALL remain usable without pgAdmin.

The smallest persistent public-demo database MAY be a self-managed PostgreSQL container on the same Singapore demo server, using an encrypted persistent volume. It is a temporary, single-host pattern and SHALL contain synthetic data only. It SHALL use the same PostgreSQL version family, Kysely migration history, schemas, and backup/restore commands as the later production service.

Database evolution SHALL use forward-compatible, versioned migrations. When a real-data deployment is approved, the team SHALL provision the production PostgreSQL service in AWS UAE, take and verify a backup, rehearse the migration using a restore or logical replication, place the demo database into controlled read-only maintenance for cutover, verify row counts and migration history, and retain the old database until the approved rollback window ends. The team SHALL NOT replace a database volume or run destructive schema synchronization as an upgrade strategy.

The production web application SHALL be a static React build in a private S3 bucket in AWS UAE, delivered through CloudFront with Origin Access Control, HTTPS, a custom domain, and an ACM certificate. CloudFront SHALL serve only static public application assets; it SHALL NOT cache API responses, authenticated HTML, session data, or patient data.

The production API SHALL run behind a private origin and a production-grade TLS edge/load-balancing configuration. Load balancing, WAF, multi-instance compute, Multi-AZ PostgreSQL, backup verification, and active monitoring become mandatory before processing real customer health data.

GitHub Actions SHALL be the deployment control plane. A push to `develop` SHALL build and deploy only the synthetic-data staging environment to the existing Singapore Linux server using the Portal-style SSH deployment pattern. A push to `main` SHALL deploy the verified production release to AWS UAE. Feature branches SHALL run checks but SHALL NOT deploy automatically. Each deployment SHALL use a source-revision-tagged API image and a source-revision-tagged frontend build, run a health check before activation, and retain the prior compatible release for rollback.

Staging and production SHALL use the same CloudFront delivery pattern but SHALL NOT share a CloudFront distribution, origin, cache namespace, certificate binding, or hostname. The staging hostname (for example, `stage.example.com`) SHALL point to a staging distribution with only synthetic static content. The production hostname (for example, `app.example.com`) SHALL point to the production distribution with its private UAE S3 origin. CloudFront SHALL NOT proxy or cache API or patient data in either environment.

All infrastructure SHALL be defined as code. Disposable AWS test resources SHALL be controlled as follows:

- A stopped EC2 instance stops compute billing but can retain EBS-volume and allocated-IP charges.
- A stopped RDS PostgreSQL instance continues storage and backup billing and automatically starts after seven days.
- An Application Load Balancer cannot be stopped; it SHALL be deleted to stop its hourly and capacity-unit charges.
- Deleting a database requires an approved retained snapshot if its synthetic test data must be restored; retained snapshot storage remains billable.
- CloudFront and S3 have no server process to stop; their small inactive static-site usage is expected to remain low.

Disposable resources SHALL be destroyed when unused, except for deliberately retained storage or snapshots. Cost budgets and alerts SHALL detect unexpected remaining charges.

### 7. Engineering workflow and decision traceability

OpenSpec SHALL remain the repository source of truth for agreed scope and delivery. The program-level `initial-his-prd` change records the broad roadmap. A focused change such as `platform-foundation` owns the detailed implementation checklist so the same work is not independently tracked in multiple places.

Within a focused change:

- `proposal.md` records the problem, scope, and intended outcome.
- `design.md` records accepted technical decisions, constraints, rationale, and consequences.
- capability specs record normative requirements and testable scenarios.
- `tasks.md` records ordered implementation work and its verified completion.

If a discussion introduces additional implementation work, it SHALL be added as a new task with a stable identifier rather than silently folded into a completed task. If an accepted discussion changes architecture, security, data handling, deployment, or another implementation constraint, the design and any affected capability spec SHALL be updated with the implementation. Questions that do not produce an accepted decision do not require a design update.

A task SHALL be marked complete only after its code and documentation are complete and applicable verification passes. Each newly completed task after the initial repository baseline SHALL be committed as `task <task-id>: <imperative summary>` and pushed to the current non-production branch. Failed or incomplete work SHALL not be marked complete or pushed as a completed task. Force-pushes are prohibited.

The repository SHALL use `develop` as the integration branch that deploys synthetic data to staging and `main` as the protected production-release branch for AWS UAE. Ordinary development SHALL not be pushed directly to `main`. The initial uncommitted repository state MAY be captured in one task-numbered baseline commit; subsequent unrelated tasks SHALL use separate commits.

## Consequences

- The former MariaDB/TypeORM approach is superseded by PostgreSQL/Kysely.
- Cognito provides the initial low-operations identity service while preserving future OIDC/SAML and UAE PASS integration paths.
- CloudFront reduces static-site operations but does not proxy or cache protected API data.
- A public demo on the existing Singapore server is permitted only with fake data; it is not a healthcare production deployment.
- New decisions and evolved work remain traceable through focused OpenSpec design, specs, tasks, and task-numbered commits.
