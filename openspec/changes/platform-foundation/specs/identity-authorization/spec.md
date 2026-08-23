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
Workforce users SHALL be administrator-provisioned. They SHALL NOT self-register and SHALL use required multi-factor authentication with an authenticator app until an approved stronger factor is available. The HIS SHALL NOT store workforce passwords.

#### Scenario: Provider attempts first sign-in
- **WHEN** an administrator-provisioned workforce user signs in for the first time
- **THEN** the identity service requires enrollment of the configured multi-factor authenticator before protected access is granted

### Requirement: Support approved identity federation without replacing authorization
Cognito MAY broker approved OIDC or SAML workforce providers and UAE PASS after approved service-provider onboarding. The HIS SHALL retain the application user profile, facility membership, permissions, and approval limits, and SHALL not grant access solely because an external identity is authenticated.

#### Scenario: Federated identity signs in
- **WHEN** a user authenticates through an approved external identity provider
- **THEN** the platform links or resolves the identity using approved account-linking rules and applies its own authorization policy

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
Authorization SHALL evaluate the user's organization, facility, department or service scope where applicable, operation, and target record.

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
