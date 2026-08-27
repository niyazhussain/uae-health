## ADDED Requirements

### Requirement: Authenticate the POC through a native identity boundary
The POC SHALL use Amazon Cognito User Pools as its native authentication boundary. One shared staging workforce pool in `ap-south-1` SHALL contain only synthetic identities and serve local, development, and staging. The API SHALL validate token issuer, applicable client identifier or audience, signature, expiry, token use, and required authentication context. Enterprise federation and production pools are deferred to the Phase 2 change.

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

#### Scenario: Lower environments share the synthetic staging identity boundary
- **WHEN** local, development, or staging enables workforce Cognito authentication
- **THEN** it uses the shared staging User Pool and app client in `ap-south-1`, contains only synthetic identities, and cannot accept a production access token

### Requirement: Provision and strongly authenticate workforce identities
Native workforce users SHALL be invited or approved through an HIS administrator workflow and SHALL NOT publicly self-register. Workforce users SHALL use required multi-factor authentication with an authenticator app until an approved stronger factor is available. The HIS SHALL NOT store workforce passwords.

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

#### Scenario: Authorized administrator opens the workforce directory
- **WHEN** an authenticated administrator with `tenant.memberships.manage` opens the workforce directory for an organization inside the assignment's active scope
- **THEN** the API returns only users with memberships in that organization and reconciles their HIS membership state with safe Cognito account status fields

#### Scenario: Cognito status lookup is temporarily unavailable
- **WHEN** an authorized administrator opens the workforce directory while Cognito account-status reconciliation cannot be completed
- **THEN** the API returns the database-authoritative memberships and role assignments, identifies Cognito status as unavailable, does not label an active membership as pending solely because of that unavailable lookup, and does not infer identity state or authorization from the failed lookup

#### Scenario: Caller asserts an unauthorized directory scope
- **WHEN** an authenticated caller requests a workforce directory outside their current database-backed permission and organization scope
- **THEN** the API denies the request without trusting the frontend selection or any Cognito group claim

#### Scenario: Authorized administrator invites a native workforce user
- **WHEN** an administrator with `tenant.memberships.manage` invites a native workforce user into an organization inside the assignment's active scope
- **THEN** the platform creates or reuses the Cognito account by immutable subject, creates an active practice membership with no implicit role, sends the initial Cognito email when the account is new, and records the access-authority change in the same database transaction

#### Scenario: Caller attempts an invitation outside authorized scope
- **WHEN** a caller submits a native workforce invitation for an organization outside their current database-backed permission and organization scope
- **THEN** the API denies the request before creating, changing, or deleting a Cognito account or HIS membership

#### Scenario: HIS persistence fails after Cognito account creation
- **WHEN** a native invitation creates a Cognito account but the application-user, identity-binding, membership, and audit transaction cannot commit
- **THEN** the platform reports no successful invitation and attempts best-effort deletion only for that newly created account when the failure is not a known concurrency or identity conflict and an immediate database check confirms the subject remains unbound

#### Scenario: Authorized administrator suspends a practice membership
- **WHEN** an administrator with `tenant.memberships.manage` suspends another user's active membership inside the administrator's current organization scope
- **THEN** the platform suspends only that membership, revokes the target user's active server sessions, records the access-authority change transactionally, and does not disable the global user, Cognito account, or memberships in other practices

#### Scenario: Authorized administrator restores a practice membership
- **WHEN** an administrator with `tenant.memberships.manage` restores another user's suspended membership inside the administrator's current organization scope
- **THEN** the platform restores only that membership and its still-valid pre-existing role assignments without creating a role or facility assignment

#### Scenario: Administrator changes own membership state
- **WHEN** an administrator attempts to suspend or restore their own membership through workforce administration
- **THEN** the platform rejects the change without altering the membership or session state

#### Scenario: Caller changes a membership outside current scope
- **WHEN** a caller attempts to suspend or restore a membership outside current database-backed permission and organization scope
- **THEN** the platform rejects the request without changing the membership, Cognito account, or server session state

#### Scenario: Authorized administrator assigns a safe global role
- **WHEN** an administrator with current `tenant.roles.manage` assigns an active global role whose permissions are all delegable to another active membership inside the administrator's current organization scope
- **THEN** the platform creates only that practice-scoped role assignment, evaluates it on subsequent HIS authorization decisions, and does not change Cognito groups, tokens, sessions, or the target's other memberships

#### Scenario: Authorized administrator revokes a role assignment
- **WHEN** an administrator with current `tenant.roles.manage` revokes another user's active role assignment inside the administrator's current organization scope
- **THEN** the platform revokes only that assignment and subsequent HIS authorization decisions no longer use it

#### Scenario: Administrator attempts unsafe role mutation
- **WHEN** an administrator attempts to assign or revoke their own role, assign a tenant-local or non-delegable global role, assign an inactive membership, duplicate an active assignment, or mutate a role assignment outside current scope
- **THEN** the platform rejects the request without changing Cognito, the target's membership, or any role assignment

### Requirement: Maintain one user with safe identity bindings
The platform SHALL represent one person with one global application-user record that MAY have multiple provider identity bindings and multiple practice memberships. Each identity binding SHALL be unique by its configured connection and immutable provider subject. The platform SHALL NOT automatically merge users based only on matching email addresses.

#### Scenario: Existing user accepts access to another practice
- **WHEN** a user accepts an authorized invitation to another practice while authenticated
- **THEN** the platform adds a separate scoped membership to the existing application user without creating a second password or implicitly sharing access between practices

#### Scenario: Administrator invites an existing native identity to another practice
- **WHEN** an authorized administrator invites an email that resolves to an existing Cognito account whose immutable subject is already bound to one application user
- **THEN** the platform reuses that application user, adds the explicit practice membership without sending another initial-password invitation, and does not create a second password

#### Scenario: Invitation email matches an unbound application user
- **WHEN** an administrator invites a Cognito account whose email matches an application user but whose immutable subject is not bound to that user
- **THEN** the platform does not merge by email and creates a separately bound application user pending an approved account-linking workflow

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

#### Scenario: Practice administrator creates and assigns a tenant-local role
- **WHEN** an administrator with current `tenant.roles.manage` creates a uniquely named tenant-local role from one or more active delegable catalogue permissions and assigns it to another active membership in the current practice
- **THEN** the role exists only in that tenant, the assignment is practice-scoped without facility or descendant scope, and Cognito users, groups, tokens, and sessions are unchanged

#### Scenario: Administrator attempts an unsafe tenant-local role mutation
- **WHEN** an administrator attempts to create a local role with an undelegable or unknown permission, reuse a tenant-local role name, assign a different tenant's role, change their own role, assign an inactive membership, duplicate an active assignment, or request facility or descendant scope
- **THEN** the platform rejects the request without changing a role, membership, role assignment, or Cognito resource

#### Scenario: Role manager views the current tenant catalogue
- **WHEN** an administrator with current `tenant.roles.manage` opens the role catalogue for their current practice
- **THEN** the platform returns active global templates and only the current tenant's active local roles with their permissions, delegation status, and current-practice assignment counts, without changing authorization state

#### Scenario: Role manager browses a large catalogue
- **WHEN** an authorized administrator searches, filters, or moves between bounded pages of the role catalogue
- **THEN** the API returns only role summaries from the current practice scope and the requested page metadata; opening one summary returns only that role's full read-only permissions through the same authorization check

#### Scenario: Role manager requests another tenant's catalogue
- **WHEN** an administrator requests a role catalogue outside their current tenant and practice authority
- **THEN** the platform denies the request without disclosing roles, assignments, members, or counts from that tenant

### Requirement: Govern role requests and approvals
Roles SHALL declare whether they are requestable and whether approval is required. The platform SHALL record requests, decisions, decision reasons, validity periods, and resulting assignments. It SHALL prevent self-approval where the applicable policy requires separation of duties.

#### Scenario: User requests an approvable role
- **WHEN** a user requests a role marked as requestable for one of their memberships
- **THEN** the platform leaves the request pending until an appropriately scoped administrator approves or rejects it

#### Scenario: User requests a non-requestable role
- **WHEN** a user requests a role restricted to administrator assignment
- **THEN** the platform rejects the request without creating an active assignment

### Requirement: Keep workforce identity providers replaceable
Workforce authentication SHALL use a provider-neutral identity boundary. Each identity binding SHALL use a configured connection and immutable issuer/subject identifiers. The HIS database SHALL own account lifecycle and provider-sync status, while a backend-only adapter performs the corresponding external lifecycle command. Cognito is the initial adapter, but an approved Okta, Entra ID, or other provider connection SHALL not change the authorization model or require an email-based merge. Application modules outside the identity-provider module SHALL not depend on Cognito SDK types or Cognito-specific identity/status fields.

#### Scenario: Workforce authentication provider changes
- **WHEN** a tenant moves workforce authentication from one approved provider connection to another
- **THEN** the platform supports an approved parallel transition and explicit immutable-identity linking while preserving the application user, memberships, and roles without copying passwords or MFA secrets

#### Scenario: HIS lifecycle command reaches an external provider
- **WHEN** an authorized HIS lifecycle operation creates, activates, suspends, or otherwise changes a native workforce account
- **THEN** the backend calls the configured provider adapter, persists a safe provider-sync outcome on the identity binding, and continues to enforce only HIS lifecycle, membership, role, permission, scope, and session state

#### Scenario: Directory presents workforce account state
- **WHEN** an authorized administrator views the workforce directory
- **THEN** it returns HIS-managed lifecycle and provider-sync state without making a provider account-status read, exposing a provider SDK field, or allowing the frontend to call the provider

### Requirement: Separate patient and workforce identity boundaries
The POC SHALL use a Cognito User Pool, app client, trusted token issuer, provider-neutral global patient-identity binding, opaque server-session table, and host-only session cookie separate from workforce identities for basic patient email sign-in. The API SHALL determine whether a principal is a patient or workforce user from the validated issuer and immutable subject rather than from email, username format, or untrusted claims. A patient identity binding SHALL NOT inherit the tenant scope of a workforce identity connection. Matching email addresses across the pools SHALL NOT automatically link identities. A patient may have several explicitly linked portal profiles across independent practice tenants. A restricted onboarding session may have no selected practice but SHALL NOT access private practice data; every practice-owned operation SHALL operate in exactly one selected practice context. Clinical-record access and advanced proofing are deferred to Phase 2.

The POC SHALL support patient email self-registration and practice-issued invitations. Registration SHALL establish only the authentication identity and a restricted onboarding account; it SHALL NOT discover, merge, or grant access to a clinical record by matching email or phone. An approved portal-profile link SHALL be an explicit HIS mutation with safe audit evidence and SHALL not be inferred at session creation. Synthetic environments SHALL continue to prohibit real patient and clinical data.

#### Scenario: Provider is also a patient
- **WHEN** a workforce user creates or receives access to a patient portal account using the same real email address
- **THEN** Cognito issues distinct subjects from distinct pools and neither identity inherits the other's sessions, roles, memberships, or record access

#### Scenario: Patient identity is not linked to a portal profile
- **WHEN** a valid patient-pool principal has no explicit approved portal-profile link
- **THEN** the API may create a restricted onboarding session but denies private appointment or practice data without searching for or linking a profile solely by email or phone number

#### Scenario: Patient has access to multiple practices
- **WHEN** a valid patient-pool principal has active explicit portal-profile links for more than one practice
- **THEN** the API returns only those safe linked practice choices and requires one profile to be selected before creating or rotating to a practice-scoped patient session

#### Scenario: Patient switches active practice
- **WHEN** an authenticated patient selects another active linked practice
- **THEN** the API rotates the opaque server session, stores only the newly selected practice context, and does not combine the former and current practice data

#### Scenario: Patient attempts cross-practice aggregation
- **WHEN** a patient session selected for one practice requests appointments or a portal profile belonging to another practice
- **THEN** the API denies the request without returning the other practice's data or combining results across practices

#### Scenario: Wrong browser audience attempts a patient mutation
- **WHEN** a cookie-authenticated patient mutation originates from an approved workforce host rather than an approved patient host
- **THEN** the patient session guard rejects it even when the shared API transport accepts both origins

#### Scenario: Patient self-registers
- **WHEN** a patient completes the approved email-registration and verification flow
- **THEN** the system creates one patient authentication identity and a restricted onboarding account without creating or discovering a practice clinical record

#### Scenario: Practice invites an existing patient identity
- **WHEN** a practice sends an invitation to an address already used by a patient account and that authenticated patient accepts it
- **THEN** the system creates an explicit audited relationship for the inviting practice without revealing or merging the patient's relationships with other practices

#### Scenario: Patient books with a different practice
- **WHEN** an authenticated patient chooses a bookable practice for which no active relationship exists
- **THEN** the appointment workflow creates an explicit pending relationship for that practice and does not expose or merge another practice's data

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

#### Scenario: Facility-scoped operation is evaluated from current HIS assignments
- **WHEN** a protected operation identifies a tenant, organization, facility, permission, action, and opaque target identifier
- **THEN** the authorization service permits it only when the principal has an active membership-facility link and an active applicable role assignment with the required permission; it never trusts frontend scope or provider claims

### Requirement: Enforce confidential-record access
The platform SHALL require an explicit permission and applicable scope before allowing access to a patient record classified as confidential.

#### Scenario: Authorized confidential-record access
- **WHEN** a properly scoped user with confidential-record permission accesses a confidential patient
- **THEN** the platform permits the authorized operation and records the access in the business audit trail

#### Scenario: Confidential access lacks the additional permission
- **WHEN** a user has the operation permission but lacks `confidential-records.read` in the same applicable scope
- **THEN** the platform denies access without exposing record details and records safe denied-access evidence

### Requirement: Enforce approval limits
The authorization platform SHALL support user or role approval limits for configured financial operations and SHALL distinguish initiation from approval where policy requires separation of duties.

The POC currently provides the authorization-decision and safe denied-audit foundation only. Endpoint-level enforcement of facility scope, confidential-record controls, and approval limits is deferred until clinical-record and revenue-approval resources define their ownership, classification, amount, escalation, and separation-of-duties policies. The platform SHALL NOT represent those controls as implemented for resources that do not yet exist.

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

#### Scenario: Default idle session policy is applied
- **WHEN** an environment does not override the workforce idle-session setting
- **THEN** the server creates and renews sessions with a 30-minute sliding idle expiry and retains the fixed 8-hour absolute expiry

#### Scenario: User signs out
- **WHEN** a user completes sign-out
- **THEN** the application revokes the server-side session, clears the browser cookie, and protected API calls no longer succeed with that session

#### Scenario: Static UI is delivered through CloudFront
- **WHEN** CloudFront serves the workforce application assets
- **THEN** session resolution and HIS authorization remain at the API backend and no Lambda@Edge function receives provider refresh credentials or grants application permissions
