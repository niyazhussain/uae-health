# Singapore development environment

`singapore-development` is a synthetic-data environment for external QA. It is
not a production healthcare environment and must not receive customer or
patient data.

## GitHub configuration

Create the repository environment in **Settings > Environments** with these
controls:

1. Name it exactly `singapore-development`.
2. Restrict deployment branches to the protected `main` branch.
3. Add `niyazhussain` as the required reviewer. Self-review remains available
   while this is the repository's only trusted collaborator; enable prevention
   of self-review after a second trusted reviewer is added.

GitHub currently leaves administrator bypass available to the repository's sole
administrator. It is not part of the approved release procedure and must not be
used. Task 0.2 will disable administrator bypass and self-review after a second
trusted reviewer is available, avoiding a configuration that no current
operator can approve.

The approval workflow records `https://uae-health.softdefine.com` as the
environment URL for its deployment record.

Configure these non-secret repository variables:

| Variable                                          | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `SINGAPORE_WORKFORCE_COGNITO_USER_POOL_ID`        | Public synthetic workforce pool ID in `ap-south-1` |
| `SINGAPORE_WORKFORCE_COGNITO_USER_POOL_CLIENT_ID` | Public browser client ID with no client secret     |

Task 4.2 adds only these environment-scoped deployment values:

| Name                        | Kind     | Purpose                                                     |
| --------------------------- | -------- | ----------------------------------------------------------- |
| `SINGAPORE_SSH_HOST`        | Variable | Singapore server DNS name or IP address                     |
| `SINGAPORE_SSH_PORT`        | Variable | SSH port                                                    |
| `SINGAPORE_SSH_USER`        | Variable | Restricted deployment account                               |
| `SINGAPORE_SSH_PRIVATE_KEY` | Secret   | Private key for that restricted account                     |
| `SINGAPORE_SSH_KNOWN_HOSTS` | Secret   | Pre-verified known-hosts line for strict server-key pinning |

Do not generate the known-hosts value inside the workflow with `ssh-keyscan`.
An operator must compare the server host-key fingerprint through a trusted
channel before storing it. The deployment account owns only the UAE Health
incoming directory, is not a member of the Docker group, and receives
passwordless sudo only for the root-owned infrastructure deployment command.
Database passwords, application secrets, certificates, and runtime environment
files remain server-side under infrastructure ownership.

## Deploy an approved artifact run

1. On `main`, manually run **Verify and build release artifacts** with
   `build_release_artifacts` enabled.
2. Wait for OpenSpec, web, API, and release-artifact jobs to succeed.
3. Record the workflow run ID and its exact 40-character commit SHA.
4. Manually run **Deploy Singapore development release** from `main` with
   those two values.
5. A configured environment reviewer approves the pending job.
6. Confirm the workflow validates both artifact checksums, stages only those
   archives, invokes the infrastructure-owned atomic deployment command, and
   verifies both public endpoints.
7. Confirm an `uae-health-singapore-promotion-<sha>` receipt exists only after
   the API reports database readiness and the frontend reports the exact
   approved release ID.

The server contract is
`/var/www/git/infrastructure/uae-health/bin/deploy-release`. Its `deploy`
command receives the exact revision and unique incoming directory, revalidates
the release, runs the infrastructure-owned gates, and atomically activates it.
If public post-activation verification fails, the workflow invokes
`rollback --failed-release <sha>` and publishes no successful receipt. Tasks
4.3 and 4.4 install and validate that server contract; do not dispatch this
workflow before those runtime and edge changes have been reviewed and applied.

## Failure expectations

The deployment must fail before SSH when the selected run is from another repository,
workflow, branch, event, revision, or unsuccessful run. It must also fail when
an artifact is missing, expired, renamed, corrupt, or has release metadata for
another environment or revision. SSH must fail closed when the presented host
key is not pinned. A readiness or release-identity failure after activation
must request rollback and must not produce a successful deployment receipt.
