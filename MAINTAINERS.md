# Maintainers

| Name                | GitHub                                                 | Areas |
| ------------------- | ------------------------------------------------------ | ----- |
| Felix T.J. Dietrich | [@FelixTJDietrich](https://github.com/FelixTJDietrich) | All   |

Maintainers review and merge pull requests, cut releases and decide on the project's direction.

## Releases

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

1. **People.** Everyone with write access or more has a row in the table at the top, with an area.
   Nothing with write access or more stays outside the table. Access comes from a direct
   collaborator role or from a team, so list both. The first list includes the members of each
   team, with the role that the team gives them:

   ```sh
   gh api repos/hephaestus-build/ichnaea/collaborators --paginate \
     --jq '.[] | select(.role_name != "read" and .role_name != "triage") | .login'
   gh api repos/hephaestus-build/ichnaea/teams --paginate \
     --jq '.[] | select(.permission != "pull" and .permission != "triage") | .slug'
   gh api orgs/hephaestus-build --jq .default_repository_permission # read or none
   ```

   A team keeps write access or more only if every member has a row. List the members with
   `gh api orgs/hephaestus-build/teams/<team>/members --paginate --jq '.[].login'`. For each other
   team, the maintainers choose one of two options, and decide on the accounts that have write
   access and no row at the same time:
   - **Remove the team from the repository.** Its members keep only the organisation's base
     permission:

     ```sh
     gh api --method DELETE orgs/hephaestus-build/teams/<team>/repos/hephaestus-build/ichnaea
     ```

   - **Lower the team to triage.** Its members can still label, assign and close issues and pull
     requests, but cannot push or merge:

     ```sh
     gh api --method PUT orgs/hephaestus-build/teams/<team>/repos/hephaestus-build/ichnaea \
       -f permission=triage
     ```

   Remove a direct collaborator without a row with
   `gh api --method DELETE repos/hephaestus-build/ichnaea/collaborators/<login>`. Then run the
   first two commands again. The first list must equal the GitHub column of the table, and every
   team in the second list must have only members with a row.

2. **Code owners.** `.github/CODEOWNERS` is on `main` and names the maintainers in the table. With
   one maintainer it only routes review requests. Before step 6 applies variant A, every path has
   two owners: a pull request whose author is the only owner of a path cannot get a code owner's
   review.

3. **Public visibility, squash merges only, and no wiki or projects.** Attestations, the required
   reviewer of the `release` environment and the free security features need a public repository.
   A squash merge makes the pull request title the commit on `main`, and CI checks that title. The
   ruleset requires an up-to-date branch, so the button that updates a branch is on:

   ```sh
   gh api --method PATCH repos/hephaestus-build/ichnaea -f visibility=public -F has_wiki=false \
     -F has_projects=false -F allow_rebase_merge=false -F allow_merge_commit=false \
     -F allow_update_branch=true
   ```

4. **Security features.** Secret scanning with push protection, Dependabot alerts, and private
   vulnerability reporting, the channel that `SECURITY.md` gives. Dependabot security updates stay
   off: Renovate opens the pull requests for vulnerable dependencies.

   ```sh
   gh api --method PATCH repos/hephaestus-build/ichnaea --input - <<'JSON'
   {"security_and_analysis": {"secret_scanning": {"status": "enabled"},
     "secret_scanning_push_protection": {"status": "enabled"}}}
   JSON
   gh api --method PUT repos/hephaestus-build/ichnaea/vulnerability-alerts
   gh api --method PUT repos/hephaestus-build/ichnaea/private-vulnerability-reporting
   ```

5. **Actions.** The workflow token is read-only by default, and a workflow cannot create or approve
   a pull request:

   ```sh
   gh api --method PUT repos/hephaestus-build/ichnaea/actions/permissions/workflow \
     -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
   ```

6. **The `main` ruleset.** Squash merges only, linear history and resolved threads. It requires
   two checks: `ok` from `ci.yml` and `pull request text` from `pull-request.yml`. Each is bound to
   GitHub Actions (integration 15368), so no other app or commit status of the same name can
   satisfy it. The ruleset comes in one of two variants:
   - **Variant B, one maintainer:** no approval and no code owner's review, because the only
     maintainer cannot approve their own pull request. File:
     `.github/rulesets/main-one-maintainer.json`.
   - **Variant A, two or more maintainers:** one approval and a code owner's review. Add the second
     maintainer, or a team, as an owner of every path in `.github/CODEOWNERS` first. A team is an
     organisation setting. File: `.github/rulesets/main-two-maintainers.json`.

   ```sh
   file=.github/rulesets/main-one-maintainer.json # or main-two-maintainers.json
   id="$(gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | select(.name == "main") | .id')"
   gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$id" --input "$file"
   ```

7. **The `release` environment.** Only `main` may deploy to it, and a maintainer approves each run:

   ```sh
   gh api --method PUT repos/hephaestus-build/ichnaea/environments/release \
     --input .github/environments/release.json
   gh api --method POST repos/hephaestus-build/ichnaea/environments/release/deployment-branch-policies \
     -f name=main -f type=branch
   ```

8. **The release deploy key.** The private key exists only as a secret of the environment:

   ```sh
   ssh-keygen -t ed25519 -N "" -C "ichnaea release tags" -f release-key
   gh repo deploy-key add release-key.pub --repo hephaestus-build/ichnaea --allow-write \
     --title "release tags"
   gh secret set RELEASE_DEPLOY_KEY --repo hephaestus-build/ichnaea --env release < release-key
   rm release-key release-key.pub
   ```

9. **The `v*` tags and the releases.** Only deploy keys may create a release tag, nobody may move
   or delete one, and a published release cannot change. Keep the release key the only deploy key
   of the repository:

   ```sh
   gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
     --input .github/rulesets/release-tags-create.json
   gh api --method POST repos/hephaestus-build/ichnaea/rulesets \
     --input .github/rulesets/release-tags-fixed.json
   gh api --method PUT repos/hephaestus-build/ichnaea/immutable-releases
   ```

10. **Check.** A person cannot create a release tag. Both commands must fail with a rule
    violation:

    ```sh
    git push origin "$(git rev-parse origin/main):refs/tags/v0.0.0-probe"
    gh api --method POST repos/hephaestus-build/ichnaea/git/refs \
      -f ref=refs/tags/v0.0.0-probe -f sha="$(git rev-parse origin/main)"
    ```

    Read the other settings back:

    ```sh
    gh api repos/hephaestus-build/ichnaea --jq '{visibility, has_wiki, security_and_analysis}'
    gh api repos/hephaestus-build/ichnaea/private-vulnerability-reporting
    gh api repos/hephaestus-build/ichnaea/automated-security-fixes # enabled: false
    gh api repos/hephaestus-build/ichnaea/actions/permissions/workflow
    gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | .name'
    gh api repos/hephaestus-build/ichnaea/environments/release
    gh api repos/hephaestus-build/ichnaea/immutable-releases
    ```

11. **Security scan checks.** CodeQL, dependency review and Scorecard run only on a public
    repository; while the repository is private they skip and write a notice. After the flip, once
    each has run on a pull request, make the three scan checks required in the `main` ruleset. Do
    not do it before: a check that never runs blocks every pull request. Keep CodeQL's default
    setup off, because it refuses results from these workflows. The Scorecard badge goes into the
    README in the pull request that follows the flip.

    ```sh
    id="$(gh api repos/hephaestus-build/ichnaea/rulesets --jq '.[] | select(.name == "main") | .id')"
    gh api "repos/hephaestus-build/ichnaea/rulesets/$id" \
      | jq '{name, target, enforcement, conditions, bypass_actors, rules: [.rules[]
          | if .type == "required_status_checks" then .parameters.required_status_checks += [
              {context: "dependency review", integration_id: 15368},
              {context: "codeql (actions)", integration_id: 15368},
              {context: "codeql (javascript-typescript)", integration_id: 15368}] else . end]}' \
      | gh api --method PUT "repos/hephaestus-build/ichnaea/rulesets/$id" --input -
    ```
