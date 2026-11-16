# Contributing to Ichnaea

Thank you for helping. Ichnaea is a general framework: it must work for any GenAI application.

## Ground rules

1. **No application special cases in the framework.** A behaviour that only one application needs
   belongs in that application's plugin or suite. `pnpm lint` fails on known application terms.
2. **No personal data, production content, secrets or private data.** Examples and fixtures are
   synthetic. Never commit real users' text, real run records or credentials.
3. **Every claim has a test that could fail.** A statistical method matches published reference
   values and passes its simulation checks within a stated Monte Carlo tolerance.
4. **Contracts change carefully.** zod is the source and the generated JSON Schema is normative.
   No refinements, transforms or defaults in contract schemas. Additive changes keep the major
   version. Every field has a data class.
5. **A change that can flip a verdict on the same records is a major change** of that package.

## Workflow

1. Open an issue first for anything larger than a fix.
2. Branch from `main`. Use [Conventional Commits](https://www.conventionalcommits.org/) with a scope
   from `commitlint.config.ts`, for example `feat(contracts): case sets record their pools`.
3. Run `pnpm check` before you push. A change to the package also runs
   `node scripts/build-consumer.ts`, which builds it, installs the build and runs the README's
   example.
4. Open a pull request. Its title and body become the squash commit on `main`, so the title
   follows the same commit rule; the `pull request text` check lints it. The titles on `main` are
   the change log: write the title for the package's users. CI must be green and a maintainer must
   approve it.

## Signed commits

A commit pushed to a branch in this repository must be signed. Its commit email must be an address
verified on your GitHub account, so set `git config user.email` to one before you commit. The
repository refuses a push that carries an unsigned commit.

A pull request from a fork needs none of this. GitHub creates and signs the commit that enters
`main`.

Sign with the SSH key you already push with.
[GitHub accepts an authentication key a second time as a signing key](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification):

```sh
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Then register that public key on GitHub as a signing key: Settings → SSH and GPG keys → New SSH
key, with the key type **Signing Key**, or `gh ssh-key add ~/.ssh/id_ed25519.pub --type signing`.
Until you register the key as a signing key, signatures made with it stay unverified.

If a push is refused, sign the commits that your branch already carries and force-push:

```sh
git rebase --exec 'git commit --amend --no-edit -S' origin/main
```

## Regenerate artefacts

`pnpm generate` rewrites the JSON Schema files and the shared fixtures from their sources. Commit
the result. Never edit generated files by hand.

## Requirements and decisions

- `REQ-n` in code, tests and docs refers to [`docs/requirements.md`](docs/requirements.md). The
  maintainers generate that file from their requirements record and replace it as a whole. Never
  edit it by hand. To propose a change to a requirement, open an issue.
- Framework decisions are recorded in [`docs/decisions/`](docs/decisions/README.md). Code cites
  them by number.

## Licence of contributions

By contributing you agree that your code is licensed under MIT and your prose under CC BY 4.0, as
stated in `LICENSE` and `LICENSE-docs.md`.
