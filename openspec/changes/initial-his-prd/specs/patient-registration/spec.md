## ADDED Requirements

### Requirement: Maintain a unique patient identity
The system SHALL capture patient demographics during pre-registration and SHALL assign a unique patient identifier or medical record number. The system SHALL permit configurable additional fields and patient-referrer or marketing data.

#### Scenario: Pre-register a new patient
- **WHEN** an authorized user submits the required patient identity and demographic data
- **THEN** the system creates one patient record and returns its unique identifier

### Requirement: Register supported encounter types
The system SHALL support outpatient, inpatient, outside-patient, and incoming-sample registrations. Outpatient registration SHALL capture demographics, sponsor, photo, visit details, and orders; an incoming sample SHALL record ordered tests without requiring a conventional visit.

#### Scenario: Register an outside patient
- **WHEN** a patient presents only for pharmacy or diagnostic service with an external prescription
- **THEN** the system creates an outside-patient registration linked to the requested service and prescription information

#### Scenario: Register an incoming sample
- **WHEN** staff receive a diagnostic sample without a conventional patient visit
- **THEN** the system records the sample and all tests ordered against it

### Requirement: Support assisted identity and document capture
The system SHALL support Nexus-based government ID processing for configured UAE, Kuwait, and Bahrain identity cards, digital signatures for consent, and scanning or uploading insurance cards and patient documents.

#### Scenario: Read a supported government ID
- **WHEN** a supported government ID is processed successfully through Nexus
- **THEN** the system pre-populates mapped registration data and retains provenance of the imported values

### Requirement: Classify and protect patient records
The system SHALL support Emergency, Unidentified, Medico-legal, VIP, and Confidential classifications. Confidentiality classifications SHALL restrict medical-record access to authorized users.

#### Scenario: Open a confidential patient record
- **WHEN** a user without the required confidential-record permission requests the record
- **THEN** the system denies access and records the attempt in the audit trail

### Requirement: Automate registration operations
The system SHALL determine follow-up rules by doctor, department, and sponsor; assign consultant-wise tokens; and support printing barcode stickers and registration cards.

#### Scenario: Complete outpatient registration
- **WHEN** an outpatient registration is completed for a configured consultant
- **THEN** the system determines follow-up status, assigns the next applicable token, and makes configured registration materials available to print

### Requirement: Convert eligible requests to inpatient care
The system SHALL convert an outpatient case or an admission or surgery request into an inpatient registration and initiate admission and bed-management processing without creating a second patient identity.

#### Scenario: Convert outpatient to inpatient
- **WHEN** an authorized user converts an eligible outpatient encounter
- **THEN** the system creates a linked inpatient encounter and preserves the patient and source-encounter references

### Requirement: Provide self-registration interfaces
The system SHALL expose authenticated integration interfaces through which approved third parties can submit self-registration data and receive validation or registration results.

#### Scenario: Submit valid self-registration data
- **WHEN** an approved client submits all required self-registration fields
- **THEN** the system validates the data and returns the created or matched patient and registration identifiers
