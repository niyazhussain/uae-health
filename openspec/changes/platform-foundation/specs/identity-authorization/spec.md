## ADDED Requirements

### Requirement: Authenticate through an external identity boundary
The platform SHALL use Amazon Cognito User Pools in AWS UAE as its initial authentication boundary. It SHALL authenticate workforce users through Cognito or an approved federated OpenID Connect or SAML provider, and SHALL validate token issuer, audience, signature, expiry, and required authentication context.

#### Scenario: Valid user session is presented
- **WHEN** a request carries a valid session from the configured identity provider
- **THEN** the platform resolves the workforce identity and evaluates authorization for the requested operation

#### Scenario: Expired authentication is presented
- **WHEN** a request carries expired or otherwise invalid authentication
- **THEN** the platform rejects it without executing protected behavior

### Requirement: Provision and strongly authenticate workforce identities
Non-federated workforce users SHALL be invited or approved through an HIS administrator workflow and SHALL NOT publicly self-register. Approved federated connections MAY create and update a user and tenant membership just in time. Workforce users SHALL use required multi-factor authentication with an authenticator app until an approved stronger factor is available. The HIS SHALL NOT store workforce passwords.

#### Scenario: Provider attempts first sign-in
- **WHEN** an administrator-provisioned workforce user signs in for the first time
- **THEN** the identity service requires enrollment of the configured multi-factor authenticator before protected access is granted

#### Scenario: Federated user signs in for the first time
- **WHEN** a user authenticates through an approved tenant connection with JIT provisioning enabled
- **THEN** the platform creates or resolves the application user and tenant membership without granting any role solely because authentication succeeded

### Requirement: Support approved identity federation without replacing authorization
Cognito MAY broker approved tenant-specific OIDC or SAML workforce providers and UAE PASS after approved service-provider onboarding. Cognito SHALL provide authentication while the HIS retains the application user profile, identity bindings, tenant and facility memberships, roles, permissions, and approval limits. The HIS SHALL not grant access solely because an external identity is authenticated or because a token contains an external group claim.

#### Scenario: Federated identity signs in
- **WHEN** a user authenticates through an approved external identity provider
- **THEN** the platform links or resolves the identity using approved account-linking rules and applies its own authorization policy

### Requirement: Maintain one user with safe identity bindings
The platform SHALL represent one person with one global application-user record that MAY have multiple provider identity bindings and multiple practice memberships. Each identity binding SHALL be unique by its configured connection and immutable provider subject. The platform SHALL NOT automatically merge users based only on matching email addresses.

#### Scenario: Existing user accepts access to another practice
- **WHEN** a user accepts an authorized invitation to another practice while authenticated
- **THEN** the platform adds a separate scoped membership to the existing application user without creating a second password or implicitly sharing access between practices

#### Scenario: Federated email matches another user
- **WHEN** a new federated identity presents an email address already present on an application user but has not completed an approved linking flow
- **THEN** the platform does not automatically link the identity or expose the existing user's memberships

### Requirement: Support tenant and practice hierarchy without implicit data access
An independent customer SHALL be a tenant security boundary. A tenant MAY contain a parent organization or practice group, child practices, and facilities. Administrative authority over descendants SHALL require an explicit permission and scope. Parent membership alone SHALL NOT grant clinical or financial record access in child practices or facilities.

#### Scenario: Parent administrator provisions a child-practice user
- **WHEN** an administrator with descendant membership-management permission grants a user access to a child practice
- **THEN** the platform creates the explicit child-practice membership and only the approved role and facility assignments

#### Scenario: Parent member requests child patient data
- **WHEN** a parent-organization member lacks an explicit applicable child-practice or facility assignment
- **THEN** the platform denies access without revealing the protected record

### Requirement: Provide global and tenant-local roles
Site administrators SHALL control the permission catalogue and immutable, clonable global role templates. Authorized practice administrators MAY assign global roles and create tenant-local roles using only permissions within their delegation ceiling. Role assignments SHALL be scoped to an active membership and applicable organization or facility.

#### Scenario: Practice administrator creates a local role
- **WHEN** an authorized practice administrator creates a local role from delegable permissions
- **THEN** the role is available only inside that tenant and cannot contain permissions outside the administrator's delegated ceiling

#### Scenario: Practice administrator attempts privilege escalation
- **WHEN** a practice administrator attempts to grant a permission or cross-tenant scope they are not authorized to delegate
- **THEN** the platform rejects the change and records the denied attempt according to audit policy

### Requirement: Govern role requests and approvals
Roles SHALL declare whether they are requestable and whether approval is required. The platform SHALL record requests, decisions, decision reasons, validity periods, and resulting assignments. It SHALL prevent self-approval where the applicable policy requires separation of duties.

#### Scenario: User requests an approvable role
- **WHEN** a user requests a role marked as requestable for one of their memberships
- **THEN** the platform leaves the request pending until an appropriately scoped administrator approves or rejects it

#### Scenario: User requests a non-requestable role
- **WHEN** a user requests a role restricted to administrator assignment
- **THEN** the platform rejects the request without creating an active assignment

### Requirement: Accept tenant-scoped SCIM provisioning without delegating authorization
The platform MAY expose a tenant-scoped SCIM 2.0 service for approved enterprise identity providers. SCIM MAY create, update, suspend, and restore application users and memberships using approved profile fields. SCIM users and groups SHALL NOT directly grant permissions or active role assignments; a configured mapping MAY create a pending role request.

#### Scenario: Customer deactivates a federated user
- **WHEN** an approved tenant SCIM connection sets a user to inactive
- **THEN** the platform disables that tenant membership and its sessions without disabling the global user or unrelated tenant memberships

#### Scenario: SCIM group maps to an approvable role
- **WHEN** an approved SCIM group mapping identifies a requestable role
- **THEN** the platform creates or updates a pending role request and does not activate the role until the required HIS approval completes

### Requirement: Treat patient phone OTP as limited proof
Patient phone verification, including WhatsApp-delivered OTP, SHALL be treated as proof of control of the configured phone number only. It SHALL NOT independently prove clinical identity, automatically link a patient record, or permit workforce access.

#### Scenario: Patient verifies a phone number
- **WHEN** a patient successfully completes a phone OTP challenge
- **THEN** the platform records verified phone control but requires approved identity-matching rules before linking a clinical record

### Requirement: Enforce authorization in the API
The API SHALL deny protected operations by default and SHALL enforce permissions independently of frontend navigation or visibility.

#### Scenario: Hidden frontend action is called directly
- **WHEN** a user without the required permission directly invokes a protected endpoint
- **THEN** the API denies the operation and records the denied attempt when required by audit policy

### Requirement: Scope access by organization and facility
Authorization SHALL evaluate the user's tenant, organization, practice, facility, department or service scope where applicable, operation, current membership state, and target record. A user MAY hold different roles in different memberships.

#### Scenario: User requests another facility's record
- **WHEN** a user lacks cross-facility authority for the requested record
- **THEN** the platform denies access without revealing protected record details

### Requirement: Enforce confidential-record access
The platform SHALL require an explicit permission and applicable scope before allowing access to a patient record classified as confidential.

#### Scenario: Authorized confidential-record access
- **WHEN** a properly scoped user with confidential-record permission accesses a confidential patient
- **THEN** the platform permits the authorized operation and records the access in the business audit trail

### Requirement: Enforce approval limits
The authorization platform SHALL support user or role approval limits for configured financial operations and SHALL distinguish initiation from approval where policy requires separation of duties.

#### Scenario: User exceeds approval limit
- **WHEN** a user attempts to approve an amount above their effective limit
- **THEN** the platform prevents approval and returns the operation to the configured escalation path

### Requirement: Protect browser sessions
Browser authentication SHALL use a session approach that prevents JavaScript from reading reusable long-lived credentials and SHALL apply secure transport, same-site, expiry, and sign-out controls appropriate to the chosen hostname architecture.

#### Scenario: User signs out
- **WHEN** a user completes sign-out
- **THEN** the application invalidates its session according to provider capabilities and protected API calls no longer succeed with that session
