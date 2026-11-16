# Maintainers

| Name                | GitHub                                                 | Areas |
| ------------------- | ------------------------------------------------------ | ----- |
| Felix T.J. Dietrich | [@FelixTJDietrich](https://github.com/FelixTJDietrich) | All   |

Maintainers review and merge pull requests, cut releases and decide on the project's direction.

## Releases

**Releases are paused.** Consumers pin a commit as a git submodule (README § Use Ichnaea from a
TypeScript project). The packages ship TypeScript sources, and Node does not run them from
`node_modules`, so the tarballs below no longer work. The release workflow fails in its first step.
The procedure below is the paused design.

Before 1.0, a release is a pre-release `v0.<minor>.<patch>`: tarballs on a GitHub release, with
build provenance and an SBOM attested by the release workflow. Nothing is published to npm.
[Decision 0013](docs/decisions/0013-release-attested-tarballs.md) gives the reasons.

### Set up once

[Repository settings](#repository-settings) has the settings that the release workflow relies on:
the `release` environment, its deploy key, the tag rulesets and immutable releases.

### Cut a release

1. On a branch, run `pnpm changeset version`. Every package moves to the same version. Open a pull
   request with the result and merge it into `main`.
2. Start the release on `main` with the new version:

   ```sh
   gh workflow run release.yml --ref main -f tag=v0.1.0
   ```

3. The build job checks that the commit is on `main` and that every package has the tag's
   version. It runs `pnpm check`, packs the tarballs, runs the example on them, and writes and
   checks the SBOM. When it passes, approve the `release` environment in the run.
4. The release job attests the tarballs, creates the tag on the commit, and publishes the
   pre-release. Download one tarball and verify it with the commands in the README.

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
   rules below let only the release deploy key create a release tag.

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

7. **Signed commits.** Every commit pushed to a branch must carry a verified signature. Before you
   apply this ruleset, each maintainer sets up commit signing, as
   [CONTRIBUTING.md](CONTRIBUTING.md#signed-commits) shows, and checks that GitHub shows their
   last commit as verified: the ruleset refuses a push of an unsigned commit to any branch. GitHub
   signs the commits that it creates itself: the squash commit of a merged pull request, and the
   commits of Renovate. Tags are not branches, so the release workflow's tag push is not affected.
   The tag names a squash commit on `main`, which GitHub signed.

   ```sh
   gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
     --input .github/rulesets/signed-commits.json
   ```

8. **The `release` environment.** Only `main` may deploy to it, and a maintainer approves each run:

   ```sh
   gh api --method PUT repos/hephaestus-build/ichnaea/environments/release \
     --input .github/environments/release.json
   gh api --method POST repos/hephaestus-build/ichnaea/environments/release/deployment-branch-policies \
     -f name=main -f type=branch
   ```

9. **The release deploy key.** The private key exists only as a secret of the environment. The
   organisation must allow deploy keys (`deploy_keys_enabled_for_repositories`, an organisation
   setting); otherwise `gh repo deploy-key add` fails with 422. Read it back with
   `gh api orgs/hephaestus-build --jq .deploy_keys_enabled_for_repositories`, which gives `true`:

   ```sh
   ssh-keygen -t ed25519 -N "" -C "ichnaea release tags" -f release-key
   gh repo deploy-key add release-key.pub --repo hephaestus-build/ichnaea --allow-write \
     --title "release tags"
   gh secret set RELEASE_DEPLOY_KEY --repo hephaestus-build/ichnaea --env release < release-key
   rm release-key release-key.pub
   ```

10. **The `v*` tags and the releases.** Only deploy keys may create a release tag, nobody may move
    or delete one, and a published release cannot change. Keep the release key the only deploy key
    of the repository. Apply the tag rules in two parts, with a probe between them, so that a probe
    that creates a tag by mistake cannot leave a tag that nobody can delete:
    1. Apply the rule that only deploy keys create a release tag. Then list the tag rulesets: the
       list must have only this ruleset.

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

    3. Apply the rule that nobody moves or deletes a release tag, and immutable releases:

    ```sh
    gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
      --input .github/rulesets/release-tags-fixed.json
    gh api --method PUT repos/hephaestus-build/ichnaea/immutable-releases
    ```

11. **Read back.** Read the settings of steps 3 to 10 back. Step 1 has its own read-back:

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
    gh api repos/hephaestus-build/ichnaea/keys --jq '.[] | {title, read_only}' # only the release key
    gh api repos/hephaestus-build/ichnaea/immutable-releases
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
