## Context

The POC runs only with synthetic data and native Cognito workforce authentication in `ap-south-1`. Its authorization model is provider-neutral and database-backed, which intentionally allows future customer identity providers without making them a POC dependency. Basic patient identity and appointment access remain Phase 1 work; the Phase 2 scope starts where enterprise provisioning, stronger identity assurance, tenant branding, or real-data production controls are required.

## Goals / Non-Goals

**Goals:**

- Define the deferred enterprise identity, advanced patient identity, tenant-domain, and UAE production boundaries before they are implemented.
- Keep authorization, account lifecycle, and identity linking HIS-owned during every provider transition.
- Require explicit production approval, UAE residency, recovery, and compliance evidence before real data is processed.

**Non-Goals:**

- Implement OIDC, SAML, SCIM, phone or WhatsApp verification, patient clinical-record access, tenant branding, production Cognito, or UAE production resources during the POC.
- Move passwords, password hashes, TOTP secrets, or role permissions between identity providers.
- Treat an external IdP group or SCIM group as a direct HIS permission grant.

## Decisions

### 1. Keep the POC native while preserving a provider-neutral boundary

The POC uses native Cognito authentication only. Phase 2 adds tenant-configured OIDC/SAML connections and SCIM through the existing provider-neutral contracts, immutable provider issuer/subject identifiers, and explicit linking flows. This avoids delaying the POC while preventing a later provider migration from changing HIS memberships, roles, or permissions.

### 2. Treat enterprise provisioning as lifecycle input, never authorization

SCIM may create, update, suspend, and restore approved user and membership data. It may not create active role assignments or permissions. An approved group mapping may create a pending role request only. This keeps authorization current and auditable in the HIS database.

### 3. Keep advanced patient proofing separate from basic portal access

Phase 2 may add phone or WhatsApp proof of phone control and an approved identity-proofing workflow. Neither phone control, email equality, nor a provider claim can automatically link a patient portal account to a clinical record. Basic Phase 1 appointment access remains synthetic-data-only and separately scoped.

### 4. Treat production as a distinct deployment boundary

Production workforce and patient identity pools, databases, storage, logs, backups, network controls, and runtime compute remain in `me-central-1`. Tenant domains map safely to verified tenant configuration; each tenant does not receive a separate Cognito custom domain. Terraform state mutation remains restricted to reviewed, commit-pinned GitHub Actions plans and applies.

## Risks / Trade-offs

- [Enterprise customers need automated provisioning before Phase 2] → Use the POC administrator UI and native invitation flow until an approved enterprise onboarding is available.
- [A provider migration could incorrectly merge people] → Require approved immutable issuer/subject linking and run providers in parallel; never merge by email.
- [Phone ownership could be mistaken for clinical identity] → Record it only as phone control and require a separate audited linking workflow.
- [Production work could be started with incomplete controls] → Require the Phase 2 production checklist, environment approval, recovery evidence, and applicable UAE health-authority review before real data.

## Migration Plan

1. Complete the POC using synthetic data and native Cognito authentication only.
2. Obtain customer, DNS, identity-provider, residency, and compliance decisions.
3. Build Phase 2 connections and production resources through reviewed tasks and immutable GitHub Actions plans.
4. Run provider, recovery, deployment, and data-residency verification before enabling real data.
5. Roll back an unapproved provider transition by disabling the new connection and retaining the previously linked identity boundary; never copy credential material as a rollback mechanism.

## Open Questions

- Which customer identity providers, claim mappings, and SCIM schemas are required first?
- Which UAE health authority and customer contractual controls apply to the first real-data tenant?
- What proofing evidence is acceptable for a patient portal to link to clinical records?
- Which tenant branding fields and custom-domain verification method will be supported first?
