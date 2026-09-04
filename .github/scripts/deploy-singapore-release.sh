#!/usr/bin/env bash

set -euo pipefail

required_environment=(
  RELEASE_SHA
  ARTIFACT_RUN_ID
  APPROVAL_RUN_ID
  APPROVAL_RUN_ATTEMPT
  SINGAPORE_SSH_HOST
  SINGAPORE_SSH_PORT
  SINGAPORE_SSH_USER
  SSH_IDENTITY_FILE
  SSH_KNOWN_HOSTS_FILE
  WEB_ARTIFACT
  WEB_CHECKSUM
  API_ARTIFACT
  API_CHECKSUM
  RELEASE_MANIFEST
)

for name in "${required_environment[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Required environment value %s is missing.\n' "$name" >&2
    exit 2
  fi
done

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$ARTIFACT_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$APPROVAL_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$APPROVAL_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
[[ "$SINGAPORE_SSH_HOST" =~ ^[A-Za-z0-9.-]+$ ]]
[[ "$SINGAPORE_SSH_PORT" =~ ^[0-9]{1,5}$ ]]
[[ "$SINGAPORE_SSH_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]
((SINGAPORE_SSH_PORT >= 1 && SINGAPORE_SSH_PORT <= 65535))

for path in \
  "$SSH_KNOWN_HOSTS_FILE" \
  "$SSH_IDENTITY_FILE" \
  "$WEB_ARTIFACT" \
  "$WEB_CHECKSUM" \
  "$API_ARTIFACT" \
  "$API_CHECKSUM" \
  "$RELEASE_MANIFEST"; do
  test -f "$path"
done

remote="${SINGAPORE_SSH_USER}@${SINGAPORE_SSH_HOST}"
remote_root="/var/www/releases/uae-health"
staging_id="${RELEASE_SHA}-${APPROVAL_RUN_ID}-${APPROVAL_RUN_ATTEMPT}"
remote_staging="${remote_root}/incoming/${staging_id}"
deploy_command="/var/www/git/infrastructure/uae-health/bin/deploy-release"

ssh_options=(
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=${SSH_KNOWN_HOSTS_FILE}"
  -o ConnectTimeout=15
  -i "$SSH_IDENTITY_FILE"
  -p "$SINGAPORE_SSH_PORT"
)
scp_options=(
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=${SSH_KNOWN_HOSTS_FILE}"
  -o ConnectTimeout=15
  -i "$SSH_IDENTITY_FILE"
  -P "$SINGAPORE_SSH_PORT"
)

ssh "${ssh_options[@]}" "$remote" bash -s -- "$remote_staging" <<'REMOTE_PREPARE'
set -euo pipefail
remote_staging="$1"
umask 077
test ! -e "$remote_staging"
mkdir -p "$remote_staging"
REMOTE_PREPARE

scp "${scp_options[@]}" \
  "$WEB_ARTIFACT" \
  "$WEB_CHECKSUM" \
  "$API_ARTIFACT" \
  "$API_CHECKSUM" \
  "$RELEASE_MANIFEST" \
  "${remote}:${remote_staging}/"

rollback_required=true
rollback() {
  if [[ "$rollback_required" != true ]]; then
    return
  fi

  printf 'Deployment verification failed; requesting rollback of %s.\n' "$RELEASE_SHA" >&2
  ssh "${ssh_options[@]}" "$remote" bash -s -- \
    "$deploy_command" "$RELEASE_SHA" <<'REMOTE_ROLLBACK'
set -euo pipefail
deploy_command="$1"
release_sha="$2"
test -x "$deploy_command"
sudo -n -- "$deploy_command" rollback --failed-release "$release_sha"
REMOTE_ROLLBACK
}
trap rollback ERR INT TERM

ssh "${ssh_options[@]}" "$remote" bash -s -- \
  "$deploy_command" "$RELEASE_SHA" "$remote_staging" <<'REMOTE_DEPLOY'
set -euo pipefail
deploy_command="$1"
release_sha="$2"
remote_staging="$3"
test -x "$deploy_command"
sudo -n -- "$deploy_command" deploy \
  --release-sha "$release_sha" \
  --staging-directory "$remote_staging"
REMOTE_DEPLOY

for attempt in {1..12}; do
  if api_response="$(curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time 10 \
    -H 'Cache-Control: no-cache' \
    'https://api.uae-health.softdefine.com/health/ready')" &&
    jq --exit-status \
      '.status == "ok" and .database == "ready"' \
      <<<"$api_response" >/dev/null; then
    break
  fi

  if [[ "$attempt" == 12 ]]; then
    printf 'The public API did not become ready.\n' >&2
    false
  fi
  sleep 5
done

for attempt in {1..12}; do
  if web_response="$(curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time 10 \
    -H 'Cache-Control: no-cache' \
    'https://uae-health.softdefine.com/release.json')" &&
    jq --exit-status \
      --arg release_sha "$RELEASE_SHA" \
      '.environment == "singapore-development" and .releaseId == $release_sha' \
      <<<"$web_response" >/dev/null; then
    break
  fi

  if [[ "$attempt" == 12 ]]; then
    printf 'The public web release identity did not match the approved revision.\n' >&2
    false
  fi
  sleep 5
done

rollback_required=false
trap - ERR INT TERM
printf 'Singapore development release %s is ready.\n' "$RELEASE_SHA"
