## ADDED Requirements

### Requirement: Federate approved tenant workforce identity providers without replacing HIS authorization

The platform SHALL allow an approved tenant administrator to configure an OIDC or SAML workforce identity-provider connection. Federated authentication SHALL resolve a configured connection and immutable issuer/subject identity, while the HIS database remains the authority for account lifecycle, memberships, roles, permissions, scopes, approval limits, and sessions. The platform SHALL never automatically merge users or grant a role based solely on matching email, an external group, or an authentication claim.

#### Scenario: Federated workforce user signs in

- **WHEN** a user completes authentication through an approved tenant OIDC or SAML connection
- **THEN** the platform resolves or creates only the approved identity binding and applies current HIS authorization without trusting external groups as permissions

### Requirement: Migrate providers through explicit immutable linking

The platform SHALL support approved parallel identity-provider transitions using explicit immutable identity linking. It SHALL preserve the application user, memberships, and role assignments without copying passwords, password hashes, TOTP secrets, or MFA enrollment material between providers.

#### Scenario: Tenant changes workforce provider

- **WHEN** a tenant transitions from its current provider to another approved provider
- **THEN** both connections may operate during the approved transition and identities are linked only through the documented immutable-identity workflow

### Requirement: Provision through tenant-scoped SCIM without delegating authorization

The platform SHALL expose a protected tenant-scoped SCIM 2.0 service for approved connections. SCIM SHALL be idempotent for supported user and group operations, may create, update, suspend, or restore approved profile and membership data, and SHALL never create an active HIS permission or role assignment directly. A configured group mapping MAY create a pending role request where the role's policy allows it.

#### Scenario: Customer deactivates a federated user

- **WHEN** an approved SCIM connection marks a user inactive for one tenant
- **THEN** the platform suspends only that tenant membership and its active sessions without disabling unrelated memberships

#### Scenario: SCIM group maps to an approvable role

- **WHEN** a configured SCIM group matches a requestable role
- **THEN** the platform creates or updates a pending role request and does not activate the role before the required HIS approval
