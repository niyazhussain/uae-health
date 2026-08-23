## ADDED Requirements

### Requirement: Trace decisions and completed work
The repository SHALL use focused OpenSpec changes to record accepted design decisions, normative behavior, and implementation tasks. Newly discovered work SHALL receive a stable task identifier. A task SHALL be marked complete only after applicable verification passes, then committed with its task identifier and pushed to the current non-production branch. `main` SHALL remain a protected production-release branch.

#### Scenario: Discussion introduces additional implementation work
- **WHEN** the team accepts work that is not represented by an existing incomplete task
- **THEN** the focused change receives a new stable task and any affected design decision or normative requirement is updated before that work is declared complete

#### Scenario: A task is completed
- **WHEN** the implementation, documentation, and applicable checks for a task pass
- **THEN** its checkbox is marked complete and its task-numbered commit is pushed without force to the current non-production branch

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

### Requirement: Deploy branches to their assigned environments
GitHub Actions SHALL deploy `develop` only to the synthetic-data staging environment on the existing Singapore server using SSH. It SHALL deploy `main` only to AWS UAE production resources. Feature branches SHALL run verification checks but SHALL NOT deploy automatically. Deployment credentials SHALL be supplied as repository or environment secrets; AWS production deployment SHALL use short-lived federated credentials where available.

#### Scenario: Develop branch is merged or pushed
- **WHEN** a verified commit is pushed to `develop`
- **THEN** GitHub Actions builds revision-tagged UI and API artifacts and deploys them to the Singapore staging environment, performs health checks, and does not access production resources

#### Scenario: Main branch is merged or pushed
- **WHEN** a verified commit is pushed to `main`
- **THEN** GitHub Actions deploys the revision-tagged artifacts to the approved AWS UAE production environment and does not deploy to the Singapore staging server

### Requirement: Serve the SPA securely
The production UI edge SHALL use a dedicated production CloudFront distribution to serve the static React application from a private S3 origin in AWS UAE. The synthetic staging UI MAY use a separate staging CloudFront distribution with a Singapore static origin. Each distribution SHALL have its own hostname, origin, cache namespace, and certificate binding. Both SHALL redirect HTTP to HTTPS, serve client-route fallback, apply approved security headers, cache fingerprinted assets immutably, and prevent stale long-lived caching of the application entry document. They SHALL NOT cache authenticated responses, API responses, sessions, or patient data.

#### Scenario: User opens a client-side route directly
- **WHEN** a user requests a valid SPA route that is not a physical file
- **THEN** the UI edge returns the application entry document and the client router displays the requested route

#### Scenario: Staging and production are released independently
- **WHEN** a staging deployment occurs
- **THEN** only the staging CloudFront distribution and hostname can expose the new synthetic-data UI release; the production distribution remains unchanged

### Requirement: Proxy API traffic securely
The API edge SHALL terminate TLS, forward trusted request context, propagate correlation, restrict request size and timeout according to endpoint policy, and route traffic only to the private API upstream.

#### Scenario: Upload exceeds endpoint limit
- **WHEN** a client submits a request larger than the configured endpoint allowance
- **THEN** the edge or API rejects it without forwarding or retaining an uncontrolled oversized payload

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
Development, staging, and production SHALL use separate hostnames, databases, object namespaces, credentials, provider environments, and runtime secrets. Production data SHALL NOT enter lower environments without an approved anonymization process.

#### Scenario: Staging application starts
- **WHEN** the staging release starts with its approved configuration
- **THEN** it connects only to staging-scoped data and provider resources

### Requirement: Back up and restore persistent data
The platform SHALL create encrypted backups of PostgreSQL and private object storage in the approved UAE location according to approved retention and SHALL verify restoration through scheduled recovery exercises.

#### Scenario: Recovery exercise is performed
- **WHEN** an authorized recovery test restores an approved backup into an isolated environment
- **THEN** integrity checks confirm the expected database and document versions and the result is recorded
