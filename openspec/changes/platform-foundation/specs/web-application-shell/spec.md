## ADDED Requirements

### Requirement: Provide an owned and accessible design system
The web application SHALL use repository-owned shadcn/ui component source built on Radix primitives and Tailwind CSS v4 semantic tokens. Shared primitives SHALL provide visible keyboard focus, sufficient text and control contrast, disabled and invalid states, reduced-motion behavior, logical RTL-aware layout, and consistent control sizing. Status meaning SHALL NOT be communicated by color alone.

#### Scenario: Feature renders a shared control
- **WHEN** a feature renders an interactive control through the shared design system
- **THEN** the control uses semantic theme tokens, remains operable by keyboard, exposes its accessible name and state, and renders correctly in the supported light, dark, LTR, and RTL foundations

#### Scenario: Operational status is presented
- **WHEN** the interface presents a success, warning, information, destructive, or restricted status
- **THEN** it provides visible text or an accessible label in addition to the semantic status color

### Requirement: Provide an authenticated application shell
The web application SHALL provide a consistent shell for authenticated HIS modules, including the current authorized practice context, primary navigation, page hierarchy, current-user controls, and session state. When facility selection is implemented, the shell SHALL also show the active facility without using frontend navigation state to decide authorization.

#### Scenario: Authenticated user enters the application
- **WHEN** an authenticated user opens an authorized application route
- **THEN** the system displays the application shell, active authorized practice, user identity, primary navigation, and requested page

#### Scenario: Role manager opens the role catalogue
- **WHEN** an authenticated user opens the Roles route
- **THEN** the shell preserves the selected practice context and the page requests only the read-only catalogue that the API authorizes for that context

#### Scenario: User navigates from the top bar
- **WHEN** an authenticated user selects Workforce or Roles from the top-bar navigation
- **THEN** the shell changes the requested page while preserving the selected practice context and the API remains the authorization authority

#### Scenario: User opens a planned module
- **WHEN** an authenticated user selects a top-level module that has no authorized application capability yet
- **THEN** the shell presents a clear unavailable state without displaying placeholder clinical data, claiming access, or calling a protected module API

#### Scenario: Unauthenticated user opens a protected route
- **WHEN** a user without a valid session opens a protected application route
- **THEN** the system initiates the configured sign-in flow without rendering protected content

#### Scenario: Authenticated user reloads the application
- **WHEN** a user reloads the browser with an active backend session
- **THEN** the application restores the authenticated shell through a credentialed session request without reading or persisting a Cognito token in JavaScript storage

### Requirement: Enforce accessible and responsive interaction patterns
The web application SHALL support keyboard operation, visible focus, semantic structure, accessible names, sufficient status communication, and responsive layouts for supported viewport sizes.

#### Scenario: Operate primary navigation by keyboard
- **WHEN** a keyboard user moves through and activates primary navigation
- **THEN** focus order, focus visibility, labels, and route activation remain understandable without pointer input

#### Scenario: Use the shell on a supported small viewport
- **WHEN** the application is displayed at the minimum supported viewport width
- **THEN** primary actions and content remain available without unintended horizontal page scrolling

### Requirement: Provide shared page and form states
The web application SHALL provide reusable patterns for loading, empty, validation, permission-denied, recoverable-error, unrecoverable-error, confirmation, success, and unsaved-change states.

#### Scenario: Form validation fails
- **WHEN** a user submits a form containing invalid fields
- **THEN** the system preserves entered values, identifies each invalid field accessibly, and presents an actionable summary

#### Scenario: Request fails recoverably
- **WHEN** an API request fails with a recoverable error
- **THEN** the page preserves safe user context and offers an appropriate retry action without claiming success

### Requirement: Consume a typed API contract
The web application SHALL consume generated types from the published API contract and SHALL centralize authentication, correlation, error mapping, cancellation, and response handling.

#### Scenario: API returns a structured business conflict
- **WHEN** an API operation returns a documented business-conflict response
- **THEN** the web application presents the mapped business message and correlation reference without exposing internal error details

### Requirement: Support localization foundations
The web application SHALL support configurable language, text direction, facility timezone, Gregorian and Hijri date presentation, and locale-aware number and currency formatting without embedding localized display strings in domain logic.

#### Scenario: User selects a supported right-to-left language
- **WHEN** the active locale uses right-to-left direction
- **THEN** the application applies the correct direction while preserving data meaning and control usability

### Requirement: Identify deployed frontend releases
Each production frontend build SHALL have an immutable release identifier and SHALL load compatible runtime configuration without placing secrets in browser-delivered assets.

#### Scenario: Support investigates a frontend error
- **WHEN** an authorized support user inspects application diagnostics
- **THEN** the system exposes the frontend release identifier and environment name without exposing credentials or patient data
