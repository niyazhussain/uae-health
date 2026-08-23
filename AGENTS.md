# Repository working agreement

## OpenSpec is the delivery source of truth

Before changing code, read the active change's `proposal.md`, `design.md`, capability specs, and `tasks.md` under `openspec/changes/`.

- `proposal.md` explains why the change exists and its intended scope.
- `design.md` records accepted architecture, security, data, deployment, and engineering decisions with their trade-offs.
- `specs/*/spec.md` contains normative requirements and testable scenarios.
- `tasks.md` is the ordered implementation checklist and completion record.

When discussion introduces work that is not already tracked, add a new task with a stable task ID before implementing it. Do not silently enlarge or reopen a completed task. When an accepted decision changes the implementation or its constraints, update `design.md` and any affected spec in the same task and commit. Keep the program roadmap high-level; track execution details in the focused change.

## Task completion and delivery

A task is ready for review only when its implementation and relevant documentation are finished and the applicable checks pass. Then:

1. Review the diff for secrets, credentials, real patient data, generated dependencies, build output, and unrelated user changes.
2. Show the user a concise summary of the changes, checks, and current diff, then explicitly ask for approval to commit and push.
3. Stop and wait. Do not commit or push until the user gives explicit approval after that review. Approval from an earlier task does not carry forward.
4. If the user approves only the commit, commit using `task <task-id>: <imperative summary>` and ask separately before pushing. If the user approves both, commit and push to the current non-production branch.
5. Mark the task checkbox complete only as part of the user-approved task commit.

Do not combine unrelated completed tasks in a commit after the initial repository baseline. Do not mark, commit, or push an incomplete or failing task. Never commit or push merely because checks passed or the implementation appears complete; explicit user approval is always required. Never force-push. Never commit `.env` files, credentials, real patient data, `node_modules`, build output, coverage output, or local database volumes.

`develop` is the integration branch and deploys synthetic data to staging. `main` is the protected production-release branch and deploys to AWS UAE. Work on `develop` or a feature branch; do not push ordinary development directly to `main`. A production release requires its documented review and environment approval.
