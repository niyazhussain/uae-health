## 1. Enterprise identity and provisioning

- [ ] 1.1 Implement administrator-managed tenant OIDC/SAML connections, federated JIT provisioning, non-SSO invitation/approval, and immutable issuer/subject account linking for Entra ID, Okta, and future providers without email-based automatic merging.
- [ ] 1.2 Implement an HIS-owned, tenant-scoped SCIM 2.0 user and group provisioning service with membership-specific suspension, idempotent synchronization, protected credentials, and no direct permission grant from SCIM claims.

## 2. Advanced patient identity

- [ ] 2.1 Implement optional patient phone and WhatsApp proof of phone control without treating it as clinical identity or workforce access.
- [ ] 2.2 Implement an approved, auditable patient-portal-account-to-clinical-record identity-proofing and linking workflow without automatic email or phone merging.

## 3. Tenant domains and production delivery

- [ ] 3.1 Implement verified tenant-owned application domains and constrained tenant branding through the administrator UI, including DNS ownership and TLS validation, safe hostname-to-tenant resolution, accessible logo/name/favicon/accent customization, and a shared identity-provider login domain.
- [ ] 3.2 Configure the production GitHub environment, least-privilege secrets, AWS OIDC, protected production release approval, and branch protections without bypassing the documented release flow.
- [ ] 3.3 Create the production workforce Cognito pool, app client, and scoped administration policy in `me-central-1` through the regional Terraform state after explicit production approval.
- [ ] 3.4 Provision UAE-resident PostgreSQL, private S3 storage, backups, audit logs, and monitoring as infrastructure as code.
- [ ] 3.5 Publish the production React build from private UAE S3 through a production-only CloudFront distribution with Origin Access Control, custom DNS, certificate, and cache-safe activation.
- [ ] 3.6 Implement the protected `main` deployment to AWS UAE using short-lived credentials, immutable artifacts, migration gates, health checks, and rollback.
- [ ] 3.7 Verify all production data stores, logs, snapshots, support access, and disaster-recovery locations against the approved residency plan.
- [ ] 3.8 Add production API edge/load balancing, WAF, private networking, multi-instance compute, Multi-AZ database resilience, and recovery exercises.
- [ ] 3.9 Complete security, privacy, identity, and health-authority compliance reviews before any real patient or provider data is processed.
- [ ] 3.10 Rehearse the self-managed-demo-to-production PostgreSQL migration, including backup, restore or logical replication, read-only cutover, row-count verification, and rollback decision points.
