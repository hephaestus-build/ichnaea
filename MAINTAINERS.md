# Maintainers

| Name                | GitHub                                                 | Areas |
| ------------------- | ------------------------------------------------------ | ----- |
| Felix T.J. Dietrich | [@FelixTJDietrich](https://github.com/FelixTJDietrich) | All   |

Maintainers review and merge pull requests, cut releases and decide on the project's direction.

## The build branch

Until the first version is on npm, consumers pin a commit of the `build` branch (README § Before
the first npm release). [Decision 0019](docs/decisions/0019-built-package-on-a-build-branch.md)
describes it. It stays until those consumers move to npm, as
[decision 0021](docs/decisions/0021-npm-staged-publishing.md) states; a later change removes it.

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

A release is a version of `@tumaet/ichnaea` on npm, and a GitHub release with the same tarball.
[Decision 0021](docs/decisions/0021-npm-staged-publishing.md) gives the chain. No workflow
publishes: `.github/workflows/release.yml` stages each version, and a package owner approves it on
npmjs.com with two-factor authentication. Versions are 0.x semver, and the release notes are the
one change log.

### Set up once

1. Apply the repository settings of [Repository settings](#repository-settings), steps 8 and 10.
2. Bootstrap the package and its trusted publisher, as step 15 says. A trusted publisher needs a
   package that exists, so a scope owner publishes `0.0.0-bootstrap` by hand once.
3. The first real version, 0.1.0, waits until the record contracts are set, so that no record
   shape is frozen by accident.

### Cut a release

1. Choose the version. In 0.x, a breaking change since the last tag (`type!:` or a
   `BREAKING CHANGE:` footer) needs a new minor version; anything else may be a patch. A
   pre-release, `v0.<minor>.<patch>-rc.<n>`, goes to the dist-tag `next`, everything else to
   `latest`. `main` keeps `0.0.0`: the workflow stamps the tag's version.
2. Tag the commit on `main` and push the tag. Only the `maintainer` team may create a `v*` tag:

   ```sh
   git fetch origin main
   git tag -s v0.1.0 origin/main -m v0.1.0
   git push origin refs/tags/v0.1.0
   ```

3. `release.yml` checks that the commit is on `main`, that the tag is greater than every other
   `v*` tag and bumps the minor version on a breaking change, and runs `pnpm run check`. It packs
   the tarball once, runs the consumer test on it on Node 24.3.0 and 26, and stages it. A failed
   run stages nothing. Fix the cause on `main` and push the next version's tag: a `v*` tag never
   moves.
4. Approve the staged version on npmjs.com with two-factor authentication, or with
   `npm stage list @tumaet/ichnaea` and `npm stage approve <stage-id>`.
   Before you approve, check four facts:
   - the version is the tag's version;
   - the integrity is the `sha512-…` that the stage job prints;
   - the provenance links to the run of `release.yml` for the tag;
   - the commit that the provenance names is the tag's commit and is reachable from `main`:

     ```sh
     git fetch origin main --tags
     test "$(git rev-parse 'refs/tags/v0.1.0^{commit}')" = <commit in the provenance>
     git merge-base --is-ancestor <commit in the provenance> origin/main && echo on main
     ```

   Approve within 90 days, while the run's artifact exists. If any fact is wrong, reject the
   version with `npm stage reject <stage-id>`: nothing is published.

5. `.github/workflows/release-finish.yml` runs every day and finishes each approved version, each
   on its own: a version that fails its checks gets no GitHub release, and the others still do. To
   finish one at once, run it by hand:

   ```sh
   gh workflow run release-finish.yml --ref main -f tag=v0.1.0
   ```

   It runs the verifier from `main` and picks the tag's release run by the tag's commit.
   It checks that npm serves the staged tarball, with valid signatures and a provenance by
   `release.yml` at the tag, from the tag's commit on `main`. It checks that the bin prints the
   version and the README's example from that run succeeds. Then it hashes the tarball against npm's integrity and
   creates the GitHub release with the notes, the tarball, the SBOM and `SHA256SUMS`.
   If a check fails, read its cause. A network failure needs only another run. Otherwise the
   version is on npm but wrong, and it gets no GitHub release: deprecate it with
   `npm deprecate @tumaet/ichnaea@<version> "<reason>"` and release the next version.

### A version that cannot be finished

A `v*` tag cannot be deleted, so the way out of each case below is the next patch version.

- **The stage job failed after npm accepted the version.** A re-run of `release.yml` fails, because
  the version is staged already, and the finish workflow never finds a successful release run for
  the tag. Check the staged version with `npm stage list @tumaet/ichnaea`. Reject it with
  `npm stage reject <stage-id>`, so that nothing is published, and release the next patch version.

### A wrong tag

Nobody may move or delete a `v*` tag, so a wrong one stays.

- **A tag outside the 0.x line,** a typo such as `vnext` or a version such as `v1.0.0`: the tag
  check ignores it and names it in its log, so it blocks nothing. Its own release run fails at the
  tag check and stages nothing.
- **A 0.x version that is too high,** such as `v0.10.0` for `v0.1.0`: its run stages that version,
  so reject it on npm. The tag then blocks every lower version. Either release above it, or remove
  it. To remove it, an admin sets the ruleset `release tags: nobody moves or deletes them` to
  disabled, deletes the tag, and sets the ruleset to active again. Then read it back, as step 10
  of the repository settings shows:

  ```sh
  id="$(gh api repos/hephaestus-build/ichnaea/rulesets \
    --jq '.[] | select(.name == "release tags: nobody moves or deletes them") | .id')"
  gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$id" -f enforcement=disabled
  git push origin :refs/tags/v0.10.0
  gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$id" \
    --input .github/rulesets/release-tags-fixed.json
  ```

### From 1.0

Not built yet. From 1.0, a breaking change needs a major version, a released record shape never
changes within a major, and OpenSSF Scorecard is published. A new decision record changes the tag
check for 1.0.

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
   rules of step 10 let only the `maintainer` team create a release tag, and the `build` rulesets
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

3. **Public visibility, squash merges only, and no wiki or projects.** npm provenance and the free
   security features need a public repository.
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
   commits of Renovate. Tags are not branches, so a release tag is not affected. The tag names a
   squash commit on `main`, which GitHub signed.

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

8. **The `npm` environment.** Only `v*` tags may deploy to it. It has no reviewer and no secret:
   the package owner's approval on npm is the gate, and the trusted publisher of step 15 names this
   environment. Only the stage job of `.github/workflows/release.yml` names it, and a test fails if
   another workflow does. Delete the old `release` environment of the paused design:

   ```sh
   gh api --method PUT repos/hephaestus-build/ichnaea/environments/npm \
     --input .github/environments/npm.json
   gh api --method POST repos/hephaestus-build/ichnaea/environments/npm/deployment-branch-policies \
     -f name='v*' -f type=tag
   gh api --method DELETE repos/hephaestus-build/ichnaea/environments/release
   ```

9. **No release deploy key.** No workflow pushes a tag or holds a key for a release. The
   repository's only deploy key is the build branch's (step 13).

10. **The `v*` tags and the releases.** Only the `maintainer` team (team 19248737), the release
    team, may create a release tag. Nobody may move or delete one, and a published GitHub release
    cannot change. Both tag rulesets exist already. List them, update the creation
    ruleset in place by its id, and apply immutable releases:

    ```sh
    gh api repos/hephaestus-build/ichnaea/rulesets \
      --jq '.[] | select(.target == "tag") | {id, name}'
    gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/<id of the creation ruleset>" \
      --input .github/rulesets/release-tags-create.json
    gh api --method PUT repos/hephaestus-build/ichnaea/immutable-releases
    ```

    Each tag ruleset must equal its file. Each command prints nothing when it does:

    ```sh
    for file in release-tags-create release-tags-fixed; do
      name="$(jq -r .name ".github/rulesets/$file.json")"
      id="$(gh api repos/hephaestus-build/ichnaea/rulesets \
        --jq ".[] | select(.name == \"$name\") | .id")"
      diff <(jq -S . ".github/rulesets/$file.json") \
        <(gh api "repos/hephaestus-build/ichnaea/rulesets/$id" \
          | jq -S '{name, target, enforcement, conditions, rules, bypass_actors}')
    done
    ```

    A person outside the team cannot create a `v*` tag: ask one to push
    `refs/tags/v0.0.0-probe`, which must fail with a rule violation.

11. **Read back.** Read the settings of steps 3 to 10, 13, 14 and 15 back. Step 1 has its own
    read-back:

    ```sh
    gh api repos/hephaestus-build/ichnaea --jq '{visibility, has_wiki, has_projects,
      allow_merge_commit, allow_rebase_merge, allow_update_branch, squash_merge_commit_title,
      squash_merge_commit_message, security_and_analysis}'
    gh api repos/hephaestus-build/ichnaea/private-vulnerability-reporting
    gh api repos/hephaestus-build/ichnaea/automated-security-fixes # enabled: false
    gh api repos/hephaestus-build/ichnaea/actions/permissions/workflow
    gh api repos/hephaestus-build/ichnaea/actions/permissions/fork-pr-contributor-approval
    gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | .name'
    gh api repos/hephaestus-build/ichnaea/environments/npm
    gh api repos/hephaestus-build/ichnaea/environments/npm/deployment-branch-policies \
      --jq '.branch_policies[] | {name, type}' # only v*, as a tag
    gh api repos/hephaestus-build/ichnaea/environments/build-branch
    gh api repos/hephaestus-build/ichnaea/environments/build-branch/deployment-branch-policies \
      --jq '.branch_policies[] | {name, type}' # only main, as a branch
    gh api repos/hephaestus-build/ichnaea/environments/build-branch/secrets --jq '.secrets[].name'
    gh api repos/hephaestus-build/ichnaea/environments/npm/secrets --jq '.secrets[].name' # none
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
      id="$(gh api repos/hephaestus-build/ichnaea/rulesets \
        --jq ".[] | select(.name == \"$name\") | .id")"
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

15. **npm.** These settings live on npmjs.com, and only a scope owner of `@tumaet` can apply them.
    Run the commands with npm 11.15.0 or later, logged in as that owner, with two-factor
    authentication on the account. Bootstrap the package once, because a trusted publisher needs a
    package that exists. In a checkout of `main`, after `pnpm install --frozen-lockfile`:

    ```sh
    node scripts/build-package.ts "$PWD/bootstrap" --version 0.0.0-bootstrap
    (cd bootstrap && npm publish --access public --tag bootstrap)
    npm trust github @tumaet/ichnaea --repository hephaestus-build/ichnaea \
      --file release.yml --environment npm --allow-stage-publish
    npm deprecate @tumaet/ichnaea@0.0.0-bootstrap "Bootstrap version, not for use."
    rm -r bootstrap
    ```

    Never pass `--allow-publish`: the trusted publisher may stage, and only an owner publishes. Then
    open the package's settings on npmjs.com, and under "Publishing access" choose "Require
    two-factor authentication and disallow tokens". Read it back:

    ```sh
    npm trust list @tumaet/ichnaea # one GitHub publisher: release.yml, environment npm, stage only
    npm access get status @tumaet/ichnaea # public
    npm owner ls @tumaet/ichnaea # the package owners who approve versions
    ```

    Delete every granular access token of an owner that can bypass two-factor authentication.
