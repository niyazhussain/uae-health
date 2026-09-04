## ADDED Requirements

### Requirement: Mutate Terraform infrastructure only through reviewed automation

Terraform state mutation and cloud resource changes SHALL run only through a manually dispatched infrastructure-repository GitHub Actions workflow using a reviewed, commit-pinned plan artifact. Local Terraform execution SHALL be limited to non-mutating formatting, validation, planning, plan display, and read-only state inspection.

#### Scenario: Engineer is ready to provision reviewed infrastructure

- **WHEN** Terraform source and its checks are ready for delivery
- **THEN** the engineer commits and pushes the reviewed source, runs the matching GitHub Actions plan workflow, reviews its immutable plan artifact, and supplies that plan run identifier to the apply workflow

#### Scenario: Local Terraform plan is available

- **WHEN** a developer or agent produces a local Terraform plan
- **THEN** the plan is treated as advisory and is not applied or used to mutate remote state from the local environment

### Requirement: Trace decisions and completed work

The repository SHALL use focused OpenSpec changes to record accepted design decisions, normative behavior, and implementation tasks. Newly discovered work SHALL receive a stable task identifier. After applicable verification passes, the task SHALL be presented to the user for review. It SHALL be marked complete, committed with its task identifier, and pushed to protected `main` only after explicit user approval for those operations. A push SHALL run verification only; environment promotion SHALL remain a separate manual, approval-gated action and SHALL not make `main` an implicit production deployment trigger.

#### Scenario: Discussion introduces additional implementation work

- **WHEN** the team accepts work that is not represented by an existing incomplete task
- **THEN** the focused change receives a new stable task and any affected design decision or normative requirement is updated before that work is declared complete

#### Scenario: A task is completed

- **WHEN** the implementation, documentation, and applicable checks for a task pass
- **THEN** the agent presents the diff and check results, asks for approval, and performs no commit or push until the user explicitly authorizes them

#### Scenario: User approves only a commit

- **WHEN** the user approves committing the reviewed task but does not approve pushing it
- **THEN** the agent creates the task-numbered commit but does not push until the user separately approves the push

### Requirement: Provide reproducible development environments

The platform SHALL provide documented commands and version-pinned dependencies for running the web application, API, worker, PostgreSQL, and required local service substitutes without production credentials or real patient data.

#### Scenario: Developer starts a clean environment

- **WHEN** a developer follows the documented setup from a clean supported workstation
- **THEN** the platform starts with its required local dependencies and passes the documented smoke checks

#### Scenario: Developer changes application source

- **WHEN** a developer edits frontend or API source while the root Docker Compose environment is running
- **THEN** Vite hot-updates the frontend and the NestJS development process recompiles and restarts without rebuilding the containers

#### Scenario: Developer enables local database administration

- **WHEN** a developer enables the optional `tools` Compose profile
- **THEN** pgAdmin is available only on the local loopback interface with the synthetic local PostgreSQL server pre-registered and the core application remains usable without that profile

#### Scenario: Developer stops the environment normally

- **WHEN** a developer runs the documented normal shutdown command and later starts the environment again
- **THEN** the named PostgreSQL volume and its synthetic development data are preserved

### Requirement: Verify changes continuously

Continuous integration SHALL run formatting, linting, type checks, unit tests, integration tests, contract checks, migration checks, security checks, and production builds applicable to each change.

#### Scenario: Required check fails

- **WHEN** a release-blocking continuous-integration check fails
- **THEN** the pipeline does not publish or deploy the affected release as successful

### Requirement: Build immutable deployable artifacts

The platform SHALL produce a versioned frontend artifact and API/worker container image associated with an immutable source revision.

#### Scenario: Build completes successfully

- **WHEN** the release pipeline completes its verified build
- **THEN** each artifact is identifiable by source revision and does not require source compilation on the production host

### Requirement: Promote reviewed revisions to an explicit environment

GitHub Actions SHALL verify pull requests and branch pushes without deploying them. A manually dispatched, approval-gated workflow MAY promote one exact successful artifact run from protected `main` to the synthetic-data `singapore-development` environment on the existing Singapore server using SSH. No workflow in this change SHALL deploy to AWS UAE production. Deployment credentials SHALL be supplied only as environment secrets.

#### Scenario: Branch or pull request changes

- **WHEN** a commit is pushed or proposed for merge
- **THEN** GitHub Actions runs the required checks without opening an SSH session, changing infrastructure, or deploying an application release

#### Scenario: Reviewed Singapore development release is promoted

- **WHEN** an authorized operator manually selects a successful artifact run for an exact reviewed `main` commit and the `singapore-development` environment approval is granted
- **THEN** GitHub Actions deploys only those revision-tagged artifacts to the Singapore server, verifies health before activation, and does not access production resources

#### Scenario: Deployment loses readiness after activation

- **WHEN** the approved Singapore release is atomically activated but the public API readiness check or frontend release-identity check fails
- **THEN** the deployment workflow invokes the infrastructure-owned rollback command, retains the failed release evidence for diagnosis, publishes no successful deployment receipt, and exits unsuccessfully

#### Scenario: SSH server identity is not trusted

- **WHEN** the Singapore server does not present a host key contained in the environment-scoped known-hosts value
- **THEN** strict OpenSSH verification rejects the connection before any artifact is copied or remote command is invoked

#### Scenario: Selected artifact run is not eligible for promotion

- **WHEN** the selected run is unsuccessful, belongs to another workflow, repository, branch, event, or revision, or its artifact checksum or release metadata is invalid
- **THEN** the approval workflow fails without contacting the Singapore server or creating a successful promotion receipt

#### Scenario: Environment is configured before deployment credentials exist

- **WHEN** task 4.1 configures the `singapore-development` environment and approval workflow
- **THEN** the environment allows only protected `main`, requires its sole trusted collaborator to explicitly review the run, stores the public workforce pool and browser-client identifiers as non-secret repository variables, contains no deployment or runtime secret, and documents that administrator bypass is prohibited even while GitHub leaves it technically available until a second reviewer exists

### Requirement: Serve the SPA securely

The production UI edge SHALL use a dedicated production CloudFront distribution to serve the static React application from a private S3 origin in AWS UAE. The Singapore development UI SHALL instead use the existing shared Nginx edge with an immutable static release directory and atomic active-release pointer. Both patterns SHALL redirect HTTP to HTTPS, serve client-route fallback, apply approved security headers, cache fingerprinted assets immutably, and prevent stale long-lived caching of the application entry document. They SHALL NOT cache authenticated responses, API responses, sessions, or patient data.

Workforce and patient portal entry points SHALL use separate approved hostnames (`uae-health.com` and `patient.uae-health.com`, with staging equivalents). They MAY use the same immutable frontend artifact when host-aware routing is verified, but one hostname SHALL NOT render the other audience's application shell or reuse its authentication configuration.

#### Scenario: User opens a client-side route directly

- **WHEN** a user requests a valid SPA route that is not a physical file
- **THEN** the UI edge returns the application entry document and the client router displays the requested route

#### Scenario: Singapore development and production are released independently

- **WHEN** a Singapore development deployment occurs
- **THEN** only `uae-health.softdefine.com` can expose the new synthetic static release and no production distribution or hostname changes

#### Scenario: Workforce host receives a patient-portal route

- **WHEN** a browser requests `/patient-portal` or a descendant route from `uae-health.softdefine.com`
- **THEN** the Singapore edge returns not found instead of rendering either the patient portal or the workforce fallback document

#### Scenario: Static release caching follows content mutability

- **WHEN** the browser requests a fingerprinted asset, the application entry document, or release metadata
- **THEN** fingerprinted assets receive immutable long-lived caching while `index.html` and `release.json` receive no-store or revalidation-safe headers

### Requirement: Proxy API traffic securely

The API edge SHALL terminate TLS, forward trusted request context, propagate correlation, restrict request size and timeout according to endpoint policy, and route traffic only to the private API upstream.

#### Scenario: Upload exceeds endpoint limit

- **WHEN** a client submits a request larger than the configured endpoint allowance
- **THEN** the edge or API rejects it without forwarding or retaining an uncontrolled oversized payload

### Requirement: Isolate the Singapore development database

The infrastructure repository SHALL define PostgreSQL 17 and the NestJS API for the Singapore synthetic environment. PostgreSQL SHALL use a persistent encrypted host volume, SHALL publish no host port, and SHALL accept application traffic only through a dedicated internal Docker network. The API SHALL join that network and the existing external reverse-proxy network; Nginx SHALL never join the database network.

#### Scenario: External client probes PostgreSQL

- **WHEN** an external or sibling reverse-proxy-network client attempts to reach the Singapore PostgreSQL service
- **THEN** no published database port or shared proxy-network route is available

#### Scenario: API release starts against persistent synthetic data

- **WHEN** a reviewed API release starts after its approved migration and synthetic seed jobs complete
- **THEN** it connects to the infrastructure-owned PostgreSQL volume without replacing or deleting that volume

#### Scenario: Runtime gate fails before activation

- **WHEN** the encrypted-volume preflight, database migration, synthetic seed, or private candidate API readiness check fails
- **THEN** deployment stops before changing the active API container or frontend release pointer and records no successful deployment receipt

### Requirement: Stage deployment by data classification

The platform SHALL permit a low-cost, disposable pre-customer environment on the existing Singapore server only when it contains synthetic data. It MAY use one self-managed API instance and PostgreSQL instance without a load balancer. Before any real customer health data is processed, the API and workers SHALL run in AWS UAE behind approved production-grade edge/load-balancing controls, and all health-data processing, storage, backups, and logs SHALL remain in the UAE.

#### Scenario: Public demonstration is deployed

- **WHEN** a public pre-customer demonstration is deployed
- **THEN** it uses only synthetic data and can be fully destroyed without affecting production data

#### Scenario: Customer health data is introduced

- **WHEN** a deployment is approved to process real customer health data
- **THEN** the production UAE residency, network, backup, monitoring, and load-balancing controls are verified before data processing begins

### Requirement: Control the cost of disposable AWS test resources

The platform SHALL define AWS test infrastructure as code and document its stop/delete behavior. It SHALL stop EC2 compute when unused, delete Application Load Balancers when unused, and account for remaining EBS, allocated-IP, RDS storage, backup, and retained-snapshot charges. It SHALL NOT assume that stopping an RDS instance is indefinite.

#### Scenario: AWS test environment is paused

- **WHEN** the team pauses a disposable AWS test environment
- **THEN** it stops EC2 compute, temporarily stops or snapshots RDS as appropriate, deletes unneeded ALBs, and verifies the expected remaining storage and snapshot resources against the cost budget

### Requirement: Deploy and roll back releases safely

Deployments SHALL verify artifacts and health before directing traffic to a new release and SHALL retain a documented method to restore the previous compatible UI and API releases.

#### Scenario: New frontend smoke test fails

- **WHEN** a newly copied versioned frontend release fails its pre-activation smoke test
- **THEN** the active release remains unchanged and users continue receiving the prior verified version

#### Scenario: New API does not become ready

- **WHEN** a deployed API release fails readiness within the approved deployment window
- **THEN** deployment stops and restores or retains the prior compatible API release

### Requirement: Separate environments and secrets

Development, staging, and production SHALL use separate hostnames, databases, object namespaces, credentials, provider environments, and runtime secrets, except that local, development, and staging MAY use the explicitly shared synthetic staging Cognito workforce boundary. Production data SHALL NOT enter lower environments without an approved anonymization process.

#### Scenario: Staging application starts

- **WHEN** the staging release starts with its approved configuration
- **THEN** it connects only to staging-scoped data and provider resources

### Requirement: Back up and restore persistent data

The platform SHALL create encrypted backups of PostgreSQL and private object storage in the approved UAE location according to approved retention and SHALL verify restoration through scheduled recovery exercises.

#### Scenario: Recovery exercise is performed

- **WHEN** an authorized recovery test restores an approved backup into an isolated environment
- **THEN** integrity checks confirm the expected database and document versions and the result is recorded
