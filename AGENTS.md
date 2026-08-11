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
3. If acting as Architect/integrator, push the accepted change to `origin/main` in `zishuo-xu/relay-hub`. A delegated Implementer pushes only the assigned topic branch and records that branch in the Work Item.
4. Report both the commit SHA and push result to the user.

Do not leave submitted or completed RelayHub changes only in the local repository.

## Delegated development workflow

All work implemented by a delegated developer follows `docs/10-delegated-development-workflow.md` and must have a registered Work Item under `docs/work-items/`.

- The Architect owns scope, invariants, acceptance criteria, `VERIFYING`, `ACCEPTED`, main-branch integration, and `DONE`.
- The Implementer owns the topic branch and may mark only `IN_PROGRESS`, `BLOCKED`, and `SUBMITTED` for implementation progress.
- `SUBMITTED` means ready for independent verification; it never means accepted or complete.
- Any unresolved P1 or P2 finding requires `CHANGES_REQUESTED`.
- Only an accepted change that is integrated into `main`, verified, documented, pushed to GitHub, and leaves a clean worktree can be marked `DONE`.
- Delegated developers push topic branches. The Architect is the only role that integrates accepted delegated work into `origin/main`.
