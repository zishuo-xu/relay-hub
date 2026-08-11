# RelayHub Working Agreement

## Discussion-to-document workflow

When a discussion with the user produces a durable project conclusion, update the most relevant document in this directory during the same turn.

Durable conclusions include:

- accepted product or architecture decisions;
- clarified component responsibilities or system boundaries;
- rejected alternatives and the reason for rejection;
- changes to roadmap order or acceptance criteria;
- implementation facts verified by code, tests, builds, or runtime checks;
- interview explanations that accurately reflect implemented behavior.

Do not copy the whole conversation into documentation. Distill it into concise project knowledge and label it as one of:

- `Accepted`: currently agreed direction;
- `Proposed`: useful idea that has not been implemented or approved;
- `Open question`: a decision still requiring evidence or user input;
- `Implemented`: verified in the current codebase.

Update existing topic documents before creating a new document. Add an ADR when a decision materially changes architecture, data ownership, security, cost, or project scope. Keep `docs/07-implementation-status.md` limited to verified implementation facts.

Documentation updates do not authorize unrelated code changes. If a discussion changes implementation scope materially, record the decision and ask for direction before expanding the build.

## Verification, commit, and GitHub push

After every RelayHub code or documentation change:

1. Run verification proportional to the change and report the result.
2. Commit the completed RelayHub change with a focused message.
3. Architect and Implementer share the same directory and `main` branch. The active role commits focused changes and pushes `origin/main` before handing the workspace to the other role.
4. Report both the commit SHA and push result to the user.

Do not leave submitted or completed RelayHub changes only in the local repository.

## Delegated development workflow

All work implemented by the sole delegated developer follows `docs/10-delegated-development-workflow.md` and must have a registered Work Item under `docs/work-items/`.

- The Architect is the only delegator, acceptance authority, and task-closing authority. The Architect owns major feature and architecture decisions, scope, invariants, acceptance criteria, `VERIFYING`, `ACCEPTED`, and `DONE`.
- There may be at most one Active Work Item. Do not start or register the next implementation plan until the current item is `DONE` or `CANCELLED`.
- The Implementer may choose the internal design, decomposition, algorithms, tests, and in-scope refactors as long as the frozen goal, invariants, contracts, and acceptance criteria remain intact.
- Architect and Implementer use the same workspace and `main` branch, strictly serially. Only the role responsible for the current Work Item state may modify files.
- Every role handoff requires focused commits, a successful push to `origin/main`, `HEAD == origin/main`, and a clean worktree. Never hand off uncommitted files.
- The Implementer records the starting HEAD as the Work Item baseline, owns `main` while implementing, and may mark only `IN_PROGRESS`, `BLOCKED`, and `SUBMITTED`.
- `SUBMITTED` means ready for independent verification; it never means accepted or complete.
- Any unresolved P1 or P2 finding requires `CHANGES_REQUESTED`.
- Only an accepted change that is integrated into `main`, verified, documented, pushed to GitHub, and leaves a clean worktree can be marked `DONE`.
- Implementer commits may already be present on `origin/main` when submitted. A push is transport and audit evidence, not acceptance; only the Architect can mark `ACCEPTED` or `DONE`.
