## Why

The synthetic-data POC needs a focused delivery path: native workforce access, basic patient identity, and basic appointments. Enterprise provisioning, tenant branding, and real-data production controls are important but would slow and obscure that POC if they remain in the same delivery checklist.

## What Changes

- Move customer workforce OIDC/SAML federation and SCIM provisioning out of the POC into this Phase 2 change.
- Move advanced patient identity proofing, including phone and optional WhatsApp verification, out of the POC.
- Move tenant-owned application domains and branding, production Cognito, UAE production infrastructure, release controls, and real-data compliance work out of the POC.
- Preserve the POC's provider-neutral identity foundation and production-boundary decisions without implementing Phase 2 capabilities early.

## Capabilities

### New Capabilities

- `enterprise-identity-provisioning`: Tenant OIDC/SAML connections, federation, immutable identity linking, and SCIM provisioning without external group-based authorization.
- `advanced-patient-identity`: Optional phone and WhatsApp proof of phone control plus stronger patient-record linking workflows.
- `production-delivery-readiness`: Tenant domains and branding, UAE production identity and infrastructure, release controls, resilience, recovery, and real-data approval.

### Modified Capabilities

None.

## Impact

- Moves deferred roadmap work from `platform-foundation` to a dedicated Phase 2 OpenSpec change.
- Does not change the existing POC API, web application, database, Cognito staging pool, or synthetic-data deployment.
- Requires future approved customer identity-provider configuration, AWS UAE infrastructure, DNS, certificates, compliance decisions, and production credentials.
