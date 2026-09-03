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

Task 4.1 requires no environment secrets. Do not add SSH credentials or runtime
configuration early. Task 4.2 will introduce only the SSH values consumed by
its reviewed deployment job. Database passwords and application secrets remain
server-side runtime configuration owned by the infrastructure repository and
must not be placed in the application repository.

## Approve an artifact run

1. On `main`, manually run **Verify and build release artifacts** with
   `build_release_artifacts` enabled.
2. Wait for OpenSpec, web, API, and release-artifact jobs to succeed.
3. Record the workflow run ID and its exact 40-character commit SHA.
4. Manually run **Approve Singapore development release** from `main` with
   those two values.
5. A configured environment reviewer approves the pending job.
6. Confirm the workflow validates both artifact checksums and publishes an
   `uae-health-singapore-promotion-<sha>` receipt.

The approval workflow deliberately performs no SSH connection, deployment,
service restart, DNS change, or infrastructure mutation. Task 4.2 will extend
the approved flow to deploy the same verified artifacts.

## Failure expectations

The approval must fail when the selected run is from another repository,
workflow, branch, event, revision, or unsuccessful run. It must also fail when
an artifact is missing, expired, renamed, corrupt, or has release metadata for
another environment or revision.
