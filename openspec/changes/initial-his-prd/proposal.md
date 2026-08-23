## Why

Healthcare staff need one Hospital Information System (HIS) to coordinate patient access, outpatient and inpatient care, insurance authorization, billing, and patient communication without fragmented records or manual handoffs. This initial product definition turns the supplied business requirements into a shared, testable baseline for product, clinical, operational, finance, and engineering stakeholders.

## What Changes

- Introduce a longitudinal patient master with pre-registration, outpatient, inpatient, outside-patient, and incoming-sample registration workflows.
- Introduce appointment and resource scheduling with availability, waitlists, overbooking, recurring bookings, and Gregorian/Hijri date support.
- Introduce admission, discharge, transfer, bed-management, and automated stay-charge workflows.
- Introduce patient email and SMS communication, preferences, journey triggers, bulk messaging, and two-way appointment responses.
- Introduce sponsor and insurance contract configuration for rates, discounts, coverage, copays, deductibles, exclusions, limits, and billing models.
- Introduce manual and electronic pre-authorization workflows, including Shafafiya and eClaimLink integration boundaries.
- Introduce reusable and patient-specific healthcare packages, eligibility controls, consumption tracking, and coverage limits.
- Introduce order-to-cash billing for cash and sponsored encounters, including deposits, collections, refunds, credit notes, write-offs, payouts, documents, and reconciliation reporting.
- Introduce role-based access controls, confidentiality enforcement, and auditable sensitive actions across the HIS.
- Expose integration boundaries for government ID processing, self-registration, messaging, payer exchange, and payment terminals.

## Capabilities

### New Capabilities

- `patient-registration`: Patient identity, registration types, government ID intake, documents, classifications, follow-up determination, tokens, and OP-to-IP conversion.
- `resource-scheduling`: Appointment and resource availability, slot controls, waitlists, booking status, no-show history, and recurrence.
- `inpatient-adt`: Admission, discharge, transfer, bed lifecycle, clearance states, and stay-related charge generation.
- `patient-communications`: Communication preferences, transactional and promotional messaging, bulk messaging, two-way responses, and document delivery.
- `sponsor-contracts`: Sponsor and insurance plan contracts, pricing, patient-share rules, limits, exclusions, authorization rules, and billing models.
- `pre-authorization`: Creation, submission, approval, cancellation, resubmission, payer exchange, and conversion of authorizations into orders.
- `healthcare-packages`: Package definitions, patient customization, eligibility, visit and item consumption, coverage, limits, and exclusions.
- `billing-revenue`: Orders, bills, sponsor allocation, payments, deposits, discounts, refunds, credit notes, write-offs, payouts, financial controls, documents, and reports.
- `access-audit`: Role-based authorization, confidential-record controls, and immutable audit evidence for sensitive clinical and financial operations.
- `external-integrations`: Managed interfaces for Nexus, self-registration clients, SMTP/SMS providers, Shafafiya, eClaimLink, and Pinelabs EDC.

### Modified Capabilities

None. This is the initial OpenSpec baseline and no existing capabilities are present.

## Impact

- Establishes the initial product contract for the `web` and `api` applications; no implementation is included in this change.
- Introduces core domain records for patients, encounters, appointments, resources, admissions, beds, sponsors, authorizations, packages, orders, bills, payments, communications, and audit events.
- Requires future workflow, reporting, document, notification, and integration architecture decisions; the platform foundation records the initial API, data, identity/access, audit, and deployment decisions.
- Touches regulated clinical, identity, insurance, and financial data; security, privacy, retention, availability, localization, and regulatory requirements must be confirmed before production release. Production health-data residency is AWS UAE under the platform foundation.
- Depends on third-party protocols and credentials for Nexus, SMTP/SMS, Shafafiya, eClaimLink, and Pinelabs; detailed contracts remain subject to vendor and authority confirmation.

## Product Scope and Outcomes

### In scope

- The eight functional modules and cross-module workflows described in `Init-requirement.md`.
- Configurable business rules where the source explicitly requires configuration.
- Operational traceability and access controls for sensitive workflows.
- Integration-ready boundaries for the named external systems.

### Out of scope for this baseline

- Clinical documentation, electronic prescribing logic, laboratory/radiology execution, pharmacy inventory operations, claims adjudication, and general-ledger accounting beyond the interfaces implied by the source.
- Final UI designs, database schemas, endpoint contracts, detailed disaster-recovery targets, and vendor-specific protocol mappings.
- Requirements not yet supplied for performance, uptime, disaster recovery, retention, consent policy, localization, and statutory certification.

### Intended outcomes

- Staff can register and identify a patient once and use the same identity across outpatient, inpatient, diagnostic, pharmacy, insurance, billing, and communication journeys.
- Operations teams can schedule resources and manage beds with visible status and controlled exceptions.
- Finance teams can calculate patient and sponsor responsibility, collect and reverse money, and reconcile revenue with traceable controls.
- Patients receive timely, preference-aware communications and can respond to supported appointment messages.
- Authorized users can reconstruct who performed each sensitive action, when it occurred, and which business record was affected.

## Stakeholders

- Patients, guardians, and bystanders
- Registration, front-desk, scheduling, and call-center teams
- Doctors, nurses, diagnostics, pharmacy, and inpatient operations
- Bed-management and discharge teams
- Insurance, pre-authorization, claims, and sponsor-contract teams
- Cashiers, billing, finance, reconciliation, and payout teams
- Hospital administrators, compliance, audit, security, and IT operations
- External payers, regulators, identity providers, communication providers, and payment-terminal providers

## Assumptions and Open Decisions

- The deployment countries and facility types must be confirmed; the source combines UAE/GCC identity and payer integrations with an Indian cash-collection rule.
- Definitions and transition permissions for visit, appointment, authorization, admission, discharge, bill, and claim statuses require stakeholder approval.
- The authoritative patient-identity matching, duplicate resolution, and medical-record-number policies are not yet defined.
- Exact sponsor coordination-of-benefits behavior for two sponsors needs specification.
- Consent, DND exceptions, message templates, supported languages, and delivery-retention policies need specification.
- Regulatory, security, privacy, non-functional, reporting, and data-migration acceptance criteria require dedicated discovery.
