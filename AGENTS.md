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
2. Show the user a concise summary of the changes, checks, and current diff, then ask the user to review the code. Stop and wait for that review.
3. After the user approves the code review, set up the local UI and API with the safe synthetic-data configuration needed for the user to test the task. Give concise testing steps and wait for the user's testing result.
4. Do not commit or push until the user confirms testing has passed and explicitly approves the commit and push. Approval from an earlier task does not carry forward.
5. If the user approves only the commit, commit using `task <task-id>: <imperative summary>` on `main` and ask separately before pushing. If the user approves both, commit and push to `main`.
6. Mark the task checkbox complete only as part of the user-approved task commit.

Do not combine unrelated completed tasks in a commit after the initial repository baseline. Do not mark, commit, or push an incomplete or failing task. Never commit or push merely because checks passed or the implementation appears complete; explicit user approval is always required. Never force-push. Never commit `.env` files, credentials, real patient data, `node_modules`, build output, coverage output, or local database volumes.

`main` is the only working and delivery branch. Do not create or use `develop` or feature branches. After the required code review, local testing, and explicit approval, commit and push work directly to `main`. A production release or infrastructure apply still requires its documented review and environment approval; being on `main` does not by itself authorize deployment.
