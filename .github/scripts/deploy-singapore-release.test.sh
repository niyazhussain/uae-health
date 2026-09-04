#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
client="${repository_root}/.github/scripts/deploy-singapore-release.sh"
test_root="$(mktemp -d)"
cleanup() {
  status=$?
  rm -rf "$test_root"
  exit "$status"
}
trap cleanup EXIT

mock_bin="${test_root}/bin"
mkdir -p "$mock_bin" "${test_root}/artifacts"

cat > "${mock_bin}/ssh" <<'MOCK_SSH'
#!/usr/bin/env bash
set -euo pipefail
printf 'ssh %s\n' "$*" >> "$MOCK_LOG"
cat >> "$MOCK_LOG"
MOCK_SSH

cat > "${mock_bin}/scp" <<'MOCK_SCP'
#!/usr/bin/env bash
set -euo pipefail
printf 'scp %s\n' "$*" >> "$MOCK_LOG"
MOCK_SCP

cat > "${mock_bin}/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "$MOCK_LOG"
if [[ "${MOCK_CURL_FAIL:-false}" == true ]]; then
  exit 22
fi
if [[ "$*" == *'/health/ready'* ]]; then
  printf '{"status":"ok","database":"ready"}\n'
else
  printf '{"environment":"singapore-development","releaseId":"%s"}\n' "$RELEASE_SHA"
fi
MOCK_CURL

cat > "${mock_bin}/sleep" <<'MOCK_SLEEP'
#!/usr/bin/env bash
exit 0
MOCK_SLEEP

chmod +x "${mock_bin}/ssh" "${mock_bin}/scp" "${mock_bin}/curl" "${mock_bin}/sleep"

release_sha="0123456789abcdef0123456789abcdef01234567"
for file in web.tar.gz web.tar.gz.sha256 api.tar api.tar.sha256 release.json known_hosts identity; do
  printf 'fixture\n' > "${test_root}/artifacts/${file}"
done

run_client() {
  env \
    PATH="${mock_bin}:$PATH" \
    MOCK_LOG="${test_root}/calls.log" \
    RELEASE_SHA="$release_sha" \
    ARTIFACT_RUN_ID=123 \
    APPROVAL_RUN_ID=456 \
    APPROVAL_RUN_ATTEMPT=1 \
    SINGAPORE_SSH_HOST=203.0.113.10 \
    SINGAPORE_SSH_PORT=22 \
    SINGAPORE_SSH_USER=deploy \
    SSH_IDENTITY_FILE="${test_root}/artifacts/identity" \
    SSH_KNOWN_HOSTS_FILE="${test_root}/artifacts/known_hosts" \
    WEB_ARTIFACT="${test_root}/artifacts/web.tar.gz" \
    WEB_CHECKSUM="${test_root}/artifacts/web.tar.gz.sha256" \
    API_ARTIFACT="${test_root}/artifacts/api.tar" \
    API_CHECKSUM="${test_root}/artifacts/api.tar.sha256" \
    RELEASE_MANIFEST="${test_root}/artifacts/release.json" \
    "$@" \
    bash "$client"
}

: > "${test_root}/calls.log"
run_client env
# The assertion intentionally matches the literal remote heredoc body.
# shellcheck disable=SC2016
grep -q '"$deploy_command" deploy' "${test_root}/calls.log"
grep -q 'scp .*web.tar.gz.*api.tar.*release.json' "${test_root}/calls.log"
if grep -q 'rollback --failed-release' "${test_root}/calls.log"; then
  printf 'Success path unexpectedly requested rollback.\n' >&2
  exit 1
fi

: > "${test_root}/calls.log"
if run_client env MOCK_CURL_FAIL=true; then
  printf 'Failed readiness unexpectedly returned success.\n' >&2
  exit 1
fi
grep -q 'rollback --failed-release' "${test_root}/calls.log"

printf 'Singapore release client tests passed.\n'
