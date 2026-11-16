# Maintainers

| Name                | GitHub                                                 | Areas |
| ------------------- | ------------------------------------------------------ | ----- |
| Felix T.J. Dietrich | [@FelixTJDietrich](https://github.com/FelixTJDietrich) | All   |

Maintainers review and merge pull requests, cut releases and decide on the project's direction.

## The build branch

Consumers pin a commit of the `build` branch (README § Use Ichnaea from a TypeScript project).
[Decision 0019](docs/decisions/0019-built-package-on-a-build-branch.md) gives the reasons.

`.github/workflows/build-branch.yml` writes it on every push to `main`. It builds the commit,
assembles the tree with `scripts/build-package.ts`, runs the consumer test on that tree, and
appends one commit to `build` whose tree is exactly the built tree. The message is
`build: <title of the main commit>` with a `Source-Commit: <main commit>` trailer. The commit is
not signed: it is written by the deploy key of the `build-branch` environment, and its integrity
comes from reproducibility. The verify job of the same workflow rebuilds the new build commit with
`scripts/verify-build.ts` and fails on any difference.

- **The first build.** When `build` does not exist, the publish job creates it with a commit that
  has no parent, so the history of `main` never enters `build`. Nothing is done by hand.
- **No new build commit.** A tree equal to the tree of the current build commit is not committed
  again. A pending run that a newer push replaces gets no build commit; the next build commit holds
  the newer source.
- **A failed verify job.** The build commit is already pushed, but it is not reproducible, so no
  consumer may pin it: their pin step runs the same verification and refuses it. Tell the consumer
  lanes the commit's SHA, so that nobody moves a pin to it. Find the cause from the first differing
  path that the job names and fix it on `main`. The next push writes a new build commit that
  supersedes it; `build` never moves back, so the bad commit stays in its history, unpinned.
- **Check a build commit by hand.** In a checkout, with the Node version that the commit's
  `build.json` records: `pnpm install --frozen-lockfile`, then `node scripts/verify-build.ts <sha>`.

## Releases

**Releases are paused until 1.0.** Consumers pin a commit of the `build` branch. At 1.0, the same
build tree is packed and published to npm with provenance, as decision 0019 states. The release
workflow fails in its first step. The procedure below is the paused design of
[decision 0013](docs/decisions/0013-release-attested-tarballs.md): pre-releases `v0.<minor>.<patch>`
as tarballs on a GitHub release, with build provenance and an SBOM attested by the release
workflow. A new decision record replaces it before 1.0.

The release deploy key and its secret are deleted. The release key returns at 1.0, and only
together with a protection of `build` that does not rely on "deploy keys only": the `build`
ruleset's bypass covers every write deploy key of the repository, so a second write key could
write `build` too.

### Set up once

[Repository settings](#repository-settings) has the settings that the release workflow relies on:
the `release` environment, the tag rulesets and immutable releases. At 1.0 it also needs a release
key, as step 9 says.

### Cut a release

1. On a branch, set the new version in `packages/ichnaea/package.json`. Open a pull request and
   merge it into `main`. The conventional commit titles on `main` since the last release are its
   change log.
2. Start the release on `main` with the new version:

   ```sh
   gh workflow run release.yml --ref main -f tag=v0.1.0
   ```

3. The build job checks that the commit is on `main` and that the package has the tag's version.
   It runs `pnpm check`, packs the tarball, and writes and checks the SBOM. When it passes, approve
   the `release` environment in the run.
4. The release job attests the tarball, creates the tag on the commit, and publishes the
   pre-release.

## Repository settings

These settings are not in the code, so no pull request can change or check them. Apply them in
this order when the repository becomes public, and read them back after a change. The JSON files
in `.github/rulesets/` and `.github/environments/` are the settings as they must be. Run the
commands from a checkout of `main`.

0. **History.** Everything in the repository becomes public, pull request refs included: GitHub
   keeps `refs/pull/<n>/head` after a merge. Scan every ref for secrets before the flip:

   ```sh
   git clone --mirror https://github.com/hephaestus-build/ichnaea.git ichnaea.git
   git clone ichnaea.git scan && cd scan
   git fetch origin '+refs/heads/*:refs/heads/*' '+refs/pull/*:refs/heads/pull/*' --update-head-ok
   docker run --rm -v "$PWD:/repo" ghcr.io/trufflesecurity/trufflehog:3.99.7@sha256:0d003fc3abc4e1565eca8462b992001314de51451e96e3c44de80d116794d5d1 \
     git file:///repo --results=verified,unknown --fail --no-update
   ```

   The scan of 15 November 2026 found 0 verified and 0 unknown secrets in 97 commits on 19 refs.
   The intermediate commits of the first pull requests cite internal review records by number in
   their messages. They carry no content of those records, and the maintainer accepted publishing
   the history as it is.

1. **People.** Everyone with write access or more either has a row in the table at the top, with
   an area, or cannot change `main` without a maintainer. Access comes from a direct collaborator
   role, a team, or an organisation role, so read all three back:

   ```sh
   gh api repos/hephaestus-build/ichnaea/collaborators --paginate \
     --jq '.[] | select(.role_name != "read" and .role_name != "triage") | .login'
   gh api repos/hephaestus-build/ichnaea/teams --paginate --jq '.[] | {slug, permission}'
   gh api orgs/hephaestus-build --jq .default_repository_permission # read or none
   # These two need a token with the admin:org scope:
   gh api orgs/hephaestus-build/organization-roles --jq '.roles[] | {id, name}'
   gh api orgs/hephaestus-build/organization-roles/<id>/teams --jq '.[].slug'
   ```

   The `maintainer` team (admin) holds the maintainers in the table. The `developer` team has write
   access through the organisation role `all_repo_write`, which covers every repository of the
   organisation, so it cannot be lowered for this repository alone. The maintainers keep that role.
   The protection is a rule, not a removal: the code owner ruleset of step 6 requires a code owner's
   approval for every change to `main`, and only the `maintainer` team may bypass it. The `v*` tag
   rules below let nobody create a release tag while releases are paused, and the `build` rulesets
   of step 13 let only the build workflow's deploy key write `build`.

   Remove a direct collaborator without a row with
   `gh api --method DELETE repos/hephaestus-build/ichnaea/collaborators/<login>`, then read the
   lists back. A team or role that gives write access, other than `maintainer` and `developer`, is
   either removed from the repository or covered by the same rule; record which in the table.

2. **Code owners.** `.github/CODEOWNERS` is on `main` and names only the maintainers in the table.
   The code owner ruleset of step 6 makes a code owner's approval required, so a pull request from
   anyone outside the table needs a maintainer's approval. With one maintainer, that maintainer's
   own pull request cannot get a code owner's review, so it merges by the bypass of step 6. Before
   step 6 applies the variant for two or more maintainers, every path has two owners.

3. **Public visibility, squash merges only, and no wiki or projects.** Attestations, the required
   reviewer of the `release` environment and the free security features need a public repository.
   A squash merge makes the pull request title and body the commit on `main`. CI lints the title
   and checks both for private records.
   The ruleset requires an up-to-date branch, so the button that updates a branch is on:

   ```sh
   gh api --method PATCH repos/hephaestus-build/ichnaea -f visibility=public -F has_wiki=false \
     -F has_projects=false -F allow_rebase_merge=false -F allow_merge_commit=false \
     -F allow_update_branch=true -f squash_merge_commit_title=PR_TITLE \
     -f squash_merge_commit_message=PR_BODY
   ```

4. **Security features.** Secret scanning with push protection, Dependabot alerts, and private
   vulnerability reporting, the channel that `SECURITY.md` gives. Dependabot security updates stay
   off: Renovate opens the pull requests for vulnerable dependencies. CodeQL runs as GitHub's
   default setup, which the organisation's security configuration turns on for every public
   repository and enforces, so the repository has no CodeQL workflow of its own: GitHub refuses the
   results of a CodeQL workflow while default setup is on. Read it back with
   `gh api repos/hephaestus-build/ichnaea/code-scanning/default-setup --jq .state`, which gives
   `configured`.

   ```sh
   gh api --method PATCH repos/hephaestus-build/ichnaea --input - <<'JSON'
   {"security_and_analysis": {"secret_scanning": {"status": "enabled"},
     "secret_scanning_push_protection": {"status": "enabled"}}}
   JSON
   gh api --method PUT repos/hephaestus-build/ichnaea/vulnerability-alerts
   gh api --method PUT repos/hephaestus-build/ichnaea/private-vulnerability-reporting
   ```

5. **Actions.** The workflow token is read-only by default, and a workflow cannot create or approve
   a pull request. A maintainer approves the workflow runs of every pull request from a fork by an
   outside contributor. The last setting exists only for a public repository:

   ```sh
   gh api --method PUT repos/hephaestus-build/ichnaea/actions/permissions/workflow \
     -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
   gh api --method PUT repos/hephaestus-build/ichnaea/actions/permissions/fork-pr-contributor-approval \
     -f approval_policy=all_external_contributors
   ```

6. **The `main` rulesets.** Squash merges only, linear history and resolved threads. The `main`
   ruleset requires three checks, all from GitHub Actions (integration 15368), so no other app or
   commit status of the same name can satisfy them: `ok` from `ci.yml`, `pull request text` from
   `pull-request.yml` and `dependency review` from `dependency-review.yml`. `dependency review` is
   the check of step 12: on a repository where it has not run yet, apply the files without it.
   CodeQL is not a required check (step 12). Nothing bypasses the `main` ruleset. Two
   variants:
   - **One maintainer:** the `main` ruleset of `.github/rulesets/main-one-maintainer.json`, with no
     required approval, and the code owner ruleset of `.github/rulesets/main-code-owner.json`. The
     code owner ruleset requires one approval and a code owner's review, and the `maintainer` team
     may bypass it. So a developer's pull request needs a maintainer's approval, and a maintainer's
     own pull request merges once every check has passed, with an explicit bypass of the review:
     `gh pr merge <n> --squash --admin`. The bypass skips only the review; the checks still apply,
     because nothing bypasses the `main` ruleset.
   - **Two or more maintainers:** the `main` ruleset of `.github/rulesets/main-two-maintainers.json`,
     with one approval and a code owner's review and no bypass. Add the second maintainer, or a
     team, as an owner of every path in `.github/CODEOWNERS` first; a team is an organisation
     setting. Then delete the code owner ruleset, because the `main` ruleset now does its work
     without a bypass.

   ```sh
   main="$(gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | select(.name == "main") | .id')"
   gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$main" \
     --input .github/rulesets/main-one-maintainer.json # or main-two-maintainers.json
   owner="$(gh api repos/hephaestus-build/ichnaea/rulesets \
     --jq '.[] | select(.name == "main: code owner review") | .id')"
   gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$owner" \
     --input .github/rulesets/main-code-owner.json # one maintainer only
   diff <(jq -S . .github/rulesets/main-one-maintainer.json) \
     <(gh api "repos/hephaestus-build/ichnaea/rulesets/$main" \
       | jq -S '{name, target, enforcement, conditions, rules, bypass_actors}')
   diff <(jq -S . .github/rulesets/main-code-owner.json) \
     <(gh api "repos/hephaestus-build/ichnaea/rulesets/$owner" \
       | jq -S '{name, target, enforcement, conditions, rules, bypass_actors}')
   ```

   Each `diff` prints nothing when the ruleset equals its file. Diff the `main` ruleset with the
   file of the variant that you applied.

   If the code owner ruleset does not exist yet, create it with
   `gh api --method POST repos/hephaestus-build/ichnaea/rulesets --input .github/rulesets/main-code-owner.json`.

7. **Signed commits.** Every commit pushed to a branch other than `build` must carry a verified
   signature. The build workflow's commits on `build` are not signed: the ruleset excludes
   `refs/heads/build`, and step 13 protects that branch. Before you apply this ruleset, each maintainer sets up commit signing, as
   [CONTRIBUTING.md](CONTRIBUTING.md#signed-commits) shows, and checks that GitHub shows their
   last commit as verified: the ruleset refuses a push of an unsigned commit to any other branch. GitHub
   signs the commits that it creates itself: the squash commit of a merged pull request, and the
   commits of Renovate. Tags are not branches, so the release workflow's tag push is not affected.
   The tag names a squash commit on `main`, which GitHub signed.

   ```sh
   gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
     --input .github/rulesets/signed-commits.json
   ```

   The ruleset exists already. To apply a change of its file, update it in place:

   ```sh
   id="$(gh api repos/hephaestus-build/ichnaea/rulesets \
     --jq '.[] | select(.name == "signed commits") | .id')"
   gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$id" \
     --input .github/rulesets/signed-commits.json
   ```

8. **The `release` environment.** Only `main` may deploy to it, and a maintainer approves each run:

   ```sh
   gh api --method PUT repos/hephaestus-build/ichnaea/environments/release \
     --input .github/environments/release.json
   gh api --method POST repos/hephaestus-build/ichnaea/environments/release/deployment-branch-policies \
     -f name=main -f type=branch
   ```

9. **The release deploy key, at 1.0 only.** The repository has no release key now: the old key and
   its secret, `RELEASE_DEPLOY_KEY`, are deleted, and the release workflow is paused. The key
   returns at 1.0 together with a protection of `build` that does not rely on "deploy keys only",
   because the `build` ruleset's bypass covers every write deploy key. Then the private key exists
   only as a secret of the `release` environment.

10. **The `v*` tags and the releases.** While releases are paused, nobody may create a release tag.
    Nobody may move or delete one, and a published release cannot change. Apply the tag rules in two
    parts, with a probe between them, so that a probe that creates a tag by mistake cannot leave a
    tag that nobody can delete:
    1. Apply the rule that nobody creates a release tag. Then list the tag rulesets: the list must
       have only this ruleset.

    ```sh
    gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
      --input .github/rulesets/release-tags-create.json
    gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | select(.target == "tag") | .name'
    ```

    2. Probe the rule. A person cannot create a release tag, so both commands must fail with a rule
       violation:

    ```sh
    git push origin "$(git rev-parse origin/main):refs/tags/v0.0.0-probe"
    gh api --method POST repos/hephaestus-build/ichnaea/git/refs \
      -f ref=refs/tags/v0.0.0-probe -f sha="$(git rev-parse origin/main)"
    ```

    If a command creates the tag, the rule is wrong. No rule forbids the deletion of a tag yet,
    so delete it with `git push origin :refs/tags/v0.0.0-probe`, correct the ruleset and probe
    again. Go on only when `git ls-remote origin refs/tags/v0.0.0-probe` prints nothing.

    3. Apply the rule that nobody moves or deletes a release tag, and immutable releases. Both tag
       rulesets exist already; to apply a change of a file, `PUT` it to the ruleset's id, as step 7
       shows for the signed commits ruleset.

    ```sh
    gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
      --input .github/rulesets/release-tags-fixed.json
    gh api --method PUT repos/hephaestus-build/ichnaea/immutable-releases
    ```

11. **Read back.** Read the settings of steps 3 to 10, 13 and 14 back. Step 1 has its own read-back:

    ```sh
    gh api repos/hephaestus-build/ichnaea --jq '{visibility, has_wiki, has_projects,
      allow_merge_commit, allow_rebase_merge, allow_update_branch, squash_merge_commit_title,
      squash_merge_commit_message, security_and_analysis}'
    gh api repos/hephaestus-build/ichnaea/private-vulnerability-reporting
    gh api repos/hephaestus-build/ichnaea/automated-security-fixes # enabled: false
    gh api repos/hephaestus-build/ichnaea/actions/permissions/workflow
    gh api repos/hephaestus-build/ichnaea/actions/permissions/fork-pr-contributor-approval
    gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | .name'
    gh api repos/hephaestus-build/ichnaea/environments/release
    gh api repos/hephaestus-build/ichnaea/environments/release/deployment-branch-policies \
      --jq '.branch_policies[] | {name, type}' # only main, as a branch
    gh api repos/hephaestus-build/ichnaea/environments/build-branch
    gh api repos/hephaestus-build/ichnaea/environments/build-branch/deployment-branch-policies \
      --jq '.branch_policies[] | {name, type}' # only main, as a branch
    gh api repos/hephaestus-build/ichnaea/environments/build-branch/secrets --jq '.secrets[].name'
    gh api repos/hephaestus-build/ichnaea/environments/release/secrets --jq '.secrets[].name' # none
    gh api repos/hephaestus-build/ichnaea/immutable-releases
    ```

    The repository has exactly one deploy key: the build branch's write key, titled
    `build-branch writer`. A second write key could write `build` too (step 13). The command
    prints nothing when the list is right:

    ```sh
    diff <(echo '[{"read_only": false, "title": "build-branch writer"}]' | jq -S .) \
      <(gh api repos/hephaestus-build/ichnaea/keys | jq -S '[.[] | {title, read_only}]')
    ```

    The signed commits ruleset must equal its file. The command prints nothing when it does:

    ```sh
    id="$(gh api repos/hephaestus-build/ichnaea/rulesets \
      --jq '.[] | select(.name == "signed commits") | .id')"
    diff <(jq -S . .github/rulesets/signed-commits.json) \
      <(gh api "repos/hephaestus-build/ichnaea/rulesets/$id" \
        | jq -S '{name, target, enforcement, conditions, rules, bypass_actors}')
    ```

12. **Security scan checks.** CodeQL (the organisation's default setup), dependency review and
    Scorecard run only on a public repository. After the flip, once dependency review has run on a
    pull request, make it a required check in the `main` ruleset. Do not do it before: a check that
    never runs blocks every pull request. Dependency review runs on every pull request, forks
    included.

    CodeQL is not a required check. Default setup scans every push to `main` and every pull request
    from a branch of this repository, but not a pull request from a fork. A required check that
    never reports would block every outside contribution, and nothing bypasses the `main` ruleset.
    Its alerts appear in the repository's Security tab, and a maintainer reads them before the
    merge of a fork's pull request. Scorecard runs on pushes to `main` and weekly, not on pull
    requests, so it is not a required check either. The Scorecard badge goes into the README in the
    pull request that follows the flip.

    ```sh
    id="$(gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | select(.name == "main") | .id')"
    gh api "repos/hephaestus-build/ichnaea/rulesets/$id" \
      | jq '{name, target, enforcement, conditions, bypass_actors, rules: [.rules[]
          | if .type == "required_status_checks" then .parameters.required_status_checks += [
              {context: "dependency review", integration_id: 15368}] else . end]}' \
      | gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$id" --input -
    ```

13. **The `build` branch.** The `build-branch` environment lets only `main` deploy, has no required
    reviewer, and holds one secret, `BUILD_BRANCH_DEPLOY_KEY`: the private key of the repository's
    only write deploy key, `build-branch writer`. Only the publish job of
    `.github/workflows/build-branch.yml` names the environment, and a test fails if another workflow
    does. A repository secret would reach the workflows of every branch, so the key is a secret of
    the environment only. Two rulesets protect `build`. `build.json` restricts its creation, updates
    and deletion, blocks force pushes, and lets only deploy keys bypass it, with no signature
    required. `build-no-force-push.json` blocks force pushes and the deletion of `build` with no
    bypass at all: a bypass skips every rule of its ruleset, so without the second ruleset the deploy
    key could force-push.

    The bypass covers every write deploy key. Keep the build key the only deploy key, as the
    read-back of step 11 checks. A release key at 1.0 needs a protection of `build` that does not
    rely on "deploy keys only" first.

    Apply the environment and the rulesets:

    ```sh
    gh api --method PUT repos/hephaestus-build/ichnaea/environments/build-branch \
      --input .github/environments/build-branch.json
    gh api --method POST repos/hephaestus-build/ichnaea/environments/build-branch/deployment-branch-policies \
      -f name=main -f type=branch
    ssh-keygen -t ed25519 -N "" -C "ichnaea build branch" -f build-key
    gh repo deploy-key add build-key.pub --repo hephaestus-build/ichnaea --allow-write \
      --title "build-branch writer"
    gh secret set BUILD_BRANCH_DEPLOY_KEY --repo hephaestus-build/ichnaea --env build-branch < build-key
    rm build-key build-key.pub
    gh api --method POST repos/hephaestus-build/ichnaea/rulesets --input .github/rulesets/build.json
    gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
      --input .github/rulesets/build-no-force-push.json
    ```

    Each ruleset must equal its file. Each command prints nothing when it does:

    ```sh
    for file in build build-no-force-push; do
      name="$(jq -r .name ".github/rulesets/$file.json")"
      id="$(gh api repos/hephaestus-build/ichnaea/rulesets --jq ".[] | select(.name == \"$name\") | .id")"
      diff <(jq -S . ".github/rulesets/$file.json") \
        <(gh api "repos/hephaestus-build/ichnaea/rulesets/$id" \
          | jq -S '{name, target, enforcement, conditions, rules, bypass_actors}')
    done
    ```

    The first run of the workflow on `main` creates `build`.

14. **GitHub Pages.** The docs site deploys from `.github/workflows/docs.yml`, from `main` only. Pages
    builds from a workflow, not from a branch, and serves HTTPS only. The `github-pages` environment
    lets only `main` deploy and has no secret:

    ```sh
    gh api --method POST repos/hephaestus-build/ichnaea/pages -f build_type=workflow
    gh api --method PUT repos/hephaestus-build/ichnaea/pages -F https_enforced=true
    gh api --method PUT repos/hephaestus-build/ichnaea/environments/github-pages \
      --input .github/environments/github-pages.json
    gh api --method POST repos/hephaestus-build/ichnaea/environments/github-pages/deployment-branch-policies \
      -f name=main -f type=branch
    ```

    Read it back:

    ```sh
    gh api repos/hephaestus-build/ichnaea/pages --jq '{build_type, https_enforced, html_url}'
    gh api repos/hephaestus-build/ichnaea/environments/github-pages/deployment-branch-policies \
      --jq '.branch_policies[] | {name, type}' # only main, as a branch
    ```
