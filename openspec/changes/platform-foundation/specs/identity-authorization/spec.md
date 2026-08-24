## ADDED Requirements

### Requirement: Authenticate through an external identity boundary
The platform SHALL use Amazon Cognito User Pools as its initial authentication boundary. One shared staging pool in `ap-south-1` SHALL contain only synthetic identities and serve local, development, and staging. When production identity is resumed and approved, its separate pool SHALL reside in `me-central-1`; a failed production creation attempt SHALL NOT prevent staging-only application development. The platform SHALL authenticate workforce users through Cognito or an approved federated OpenID Connect or SAML provider, and SHALL validate token issuer, applicable client identifier or audience, signature, expiry, token use, and required authentication context.

#### Scenario: Production creation is deferred after a provider failure
- **WHEN** the production Cognito creation attempt fails and the user elects to continue staging development
- **THEN** reviewed Terraform disables the production caller, the staging pool remains the only active development identity boundary, and production is not retried until explicitly resumed

#### Scenario: Valid user session is presented
- **WHEN** a request carries a valid session from the configured identity provider
- **THEN** the platform resolves the workforce identity and evaluates authorization for the requested operation

#### Scenario: Expired authentication is presented
- **WHEN** a request carries expired or otherwise invalid authentication
- **THEN** the platform rejects it without executing protected behavior

#### Scenario: ID token is presented to a protected API
- **WHEN** a request presents a valid Cognito ID token instead of an access token
- **THEN** the API rejects it without executing protected behavior

#### Scenario: Access token targets another application client
- **WHEN** a validly signed Cognito access token was issued for an app client other than the configured HIS client
- **THEN** the API rejects it without executing protected behavior

#### Scenario: Production is configured with a non-UAE pool
- **WHEN** the production API is configured with a Cognito pool outside `me-central-1`
- **THEN** environment validation rejects the configuration before the API accepts traffic

#### Scenario: Lower environments share the synthetic staging identity boundary
- **WHEN** local, development, or staging enables workforce Cognito authentication
- **THEN** it uses the shared staging User Pool and app client in `ap-south-1`, contains only synthetic identities, and cannot accept a production access token

### Requirement: Provision and strongly authenticate workforce identities
Non-federated workforce users SHALL be invited or approved through an HIS administrator workflow and SHALL NOT publicly self-register. Approved federated connections MAY create and update a user and tenant membership just in time. Workforce users SHALL use required multi-factor authentication with an authenticator app until an approved stronger factor is available. The HIS SHALL NOT store workforce passwords.

Native workforce users SHALL sign in with real verified email addresses compared case-insensitively. Provider category, tenant, practice, facility, and authorization role SHALL NOT be encoded into the username.

#### Scenario: Provider attempts first sign-in
- **WHEN** an administrator-provisioned workforce user signs in for the first time
- **THEN** the identity service requires enrollment of the configured multi-factor authenticator before protected access is granted

#### Scenario: Public user attempts self-registration
- **WHEN** an unauthenticated caller attempts to register a native workforce account directly with Cognito
- **THEN** Cognito rejects the attempt because only administrators may create native users

#### Scenario: Administrator creates a workforce account
- **WHEN** an administrator provisions a native workforce user
- **THEN** the identity uses the user's real verified email sign-in without manufacturing a provider namespace or embedding authorization scope in the username

#### Scenario: Federated user signs in for the first time
- **WHEN** a user authenticates through an approved tenant connection with JIT provisioning enabled
- **THEN** the platform creates or resolves the application user and tenant membership without granting any role solely because authentication succeeded

#### Scenario: Authorized administrator opens the workforce directory
- **WHEN** an authenticated administrator with `tenant.memberships.manage` opens the workforce directory for an organization inside the assignment's active scope
- **THEN** the API returns only users with memberships in that organization and reconciles their HIS membership state with safe Cognito account status fields

#### Scenario: Caller asserts an unauthorized directory scope
- **WHEN** an authenticated caller requests a workforce directory outside their current database-backed permission and organization scope
- **THEN** the API denies the request without trusting the frontend selection or any Cognito group claim

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

### Requirement: Separate patient and workforce identity boundaries
Patient portal identities SHALL use a Cognito User Pool, app client, and trusted token issuer separate from workforce identities. The API SHALL determine whether a principal is a patient or workforce user from the validated issuer and immutable subject rather than from email, username format, or untrusted claims. Matching email addresses across the pools SHALL NOT automatically link the identities.

#### Scenario: Provider is also a patient
- **WHEN** a workforce user creates or receives access to a patient portal account using the same real email address
- **THEN** Cognito issues distinct subjects from distinct pools and neither identity inherits the other's sessions, roles, memberships, or record access

#### Scenario: Patient identity has not been linked to a clinical record
- **WHEN** a valid patient-pool principal requests clinical information before completing the approved record-linking workflow
- **THEN** the API denies access without searching for or linking a patient solely by email or phone number

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
Browser authentication SHALL use a backend-for-frontend session that prevents JavaScript from retaining Cognito tokens or reading reusable session credentials. After native Cognito SRP, password-change, software-token setup, and TOTP challenges complete in memory, the browser SHALL present the short-lived access token once to the API. The API SHALL validate and exchange it for a server-side session, then the browser SHALL clear every Cognito token. The API SHALL expose only a cryptographically random opaque session identifier in a host-only HttpOnly cookie and a non-secret session-bound CSRF value. The database SHALL store only hashes of both browser values plus the immutable principal and session lifecycle metadata. Cookie-authenticated mutations SHALL validate the allowed Origin and CSRF value. Session lookup, sliding idle expiry, fixed absolute expiry, revocation, and sign-out SHALL fail closed. Federated identity-provider authentication SHALL use standards-based redirects and SHALL NOT proxy customer identity-provider passwords through the HIS.

#### Scenario: User reloads an authenticated UI
- **WHEN** a workforce user reloads the application while the server-side session remains active
- **THEN** the browser presents only its HttpOnly session cookie, the API restores the immutable principal and returns a non-secret CSRF value, and no Cognito token is exposed to frontend JavaScript

#### Scenario: Cognito token is exchanged after native authentication
- **WHEN** the custom workforce UI completes Cognito authentication and presents the resulting access token to the session-exchange endpoint
- **THEN** the API validates the token, creates a hashed opaque server session, returns the HttpOnly cookie and non-secret CSRF value, and the browser clears all Cognito SDK tokens from memory

#### Scenario: Cookie-authenticated mutation lacks CSRF proof
- **WHEN** a request that can change state has a missing or invalid allowed Origin or session-bound CSRF value
- **THEN** the API rejects the request without executing the protected operation

#### Scenario: Session reaches its idle or absolute expiry
- **WHEN** a workforce session exceeds either configured expiry boundary
- **THEN** the API revokes or removes the server-side session, clears the cookie where applicable, and requires a new Cognito authentication

#### Scenario: Active use approaches idle expiry
- **WHEN** valid authenticated API activity occurs before idle expiry and before the fixed absolute expiry
- **THEN** the API may extend the server-side idle expiry and renew the cookie without extending the absolute expiry

#### Scenario: User signs out
- **WHEN** a user completes sign-out
- **THEN** the application revokes the server-side session, clears the browser cookie, and protected API calls no longer succeed with that session

#### Scenario: Static UI is delivered through CloudFront
- **WHEN** CloudFront serves the workforce application assets
- **THEN** session resolution and HIS authorization remain at the API backend and no Lambda@Edge function receives provider refresh credentials or grants application permissions
