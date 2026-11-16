# Roadmap

This file lists the work that the v2 design defers. Each item names the trigger that brings it in. An item moves into a pull request when its trigger happens, and it lands with its own decision record in [`docs/decisions/`](docs/decisions/README.md).

Section numbers (§) refer to the v2 framework design. Items marked **study** wait for a statistics study that a maintainer registers before the work starts.

## How to read an item

- **Now:** what v2 ships for this need today.
- **Later:** what this item adds.
- **Trigger:** the user or the event that pulls the item in.

## 1. Statistics studies

| Item                         | Now                                                        | Later                                                                         | Trigger                                                                  | Design   |
| ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| Pass: non-inferiority        | Regression, Inconclusive and Invalid. No compare can pass. | A validated "not worse by more than the limit" verdict.                       | **Study:** the non-inferiority simulation passes on the validation grid. | § 0, § 8 |
| The mid-p regression test    | The exact stratified test decides a Regression.            | The mid-p variant, if its false-alarm rate stays at or below α in every cell. | **Study:** the mid-p variant on the same grid as the exact test.         | § 8.10   |
| Score compares               | Score measures are estimates.                              | A validated score compare.                                                    | **Study:** the score permutation study passes.                           | § 8      |
| Must-never ceilings          | The one-arm ceiling with the rule of three.                | A correction for a detector that misses some violations.                      | **Study:** a ceiling study with a calibrated detector.                   | § 7.7    |
| Active sampling of labels    | Uniform sampling for human labels.                         | An inverse-propensity estimate from labels drawn by a judge's uncertainty.    | **Study:** coverage of the estimator on the label grid.                  | § 11.2   |
| Monitor alerts over time     | Alerts on the interval bounds of closed windows.           | Confidence sequences that stay valid when a team checks often.                | **Study:** a sequence method, and a consumer that checks windows daily.  | § 15     |
| Prediction-powered estimates | Judge values and human labels stay apart.                  | Estimates that combine many judge values with few labels.                     | **Study:** coverage on the calibration data.                             | § 11     |

## 2. Adapters that can become native

| Item                       | Now                                                         | Later                                             | Trigger                                                                                             | Design      |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| A Python package           | Copy-in shims, generated types and conformance fixtures.    | A maintained Python package.                      | Three consumers with Python workers ask for one, or a protocol change that the shims cannot absorb. | § 16.4      |
| A Java package             | The same as Python.                                         | A maintained Java package.                        | The same trigger, for Java workers.                                                                 | § 16.4      |
| Review queues              | Rating exports, imports and the Langfuse annotation import. | A native review flow.                             | Two consumers that need queue-based review without a labelling tool.                                | § 11.2      |
| Implicit user signals      | Joined through imports, and descriptive only.               | Signal measures with their own rules.             | A consumer that decides on thumbs or reaction data.                                                 | § 27        |
| Vendor trace fetchers      | OTLP files and a local receiver.                            | Fetching windows from a trace store's API.        | A consumer that cannot export files from its trace store.                                           | § 9.4, § 21 |
| Hub datasets               | A `command` source and a recipe.                            | A native source for datasets on a model hub.      | Two consumers whose datasets live on a hub.                                                         | § 5.6       |
| Encrypted public test sets | Decrypt with your own tool, then Ichnaea checks the digest. | A native decrypt step.                            | A consumer that publishes an encrypted test set.                                                    | § 5.6       |
| Standard safety suites     | Run them in another harness and import its log.             | A packaged regression suite for one standard.     | A consumer that must report a standard safety suite.                                                | § 7.7, § 21 |
| An attacker in the loop    | Attack generators feed cases into the safety pool.          | An attacker model as a pinned, seeded instrument. | A consumer that needs multi-turn attacks in a regression suite.                                     | § 7.7       |
| Playground prompts         | A playground's saved prompt becomes an arm's settings file. | An importer from a playground's prompt versions.  | A consumer that keeps its prompts in a playground.                                                  | § 20        |
| Synthetic cases            | Generated cases are imported with their provenance.         | Generators driven from a suite.                   | A consumer that generates cases on each release.                                                    | § 27        |
| Label distributions        | Adjudicated labels, with the raw labels kept.               | An aggregate that keeps the label distribution.   | The first study with labels that people disagree on by design.                                      | § 11.2      |

## 3. Deferred features

| Item                                 | Now                                                                    | Later                                                 | Trigger                                                                           | Design |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Tool replay                          | Full replay of a fixed upstream output.                                | Replay for agents that choose whether to call a tool. | The first stage suite for such an agent.                                          | § 9.3  |
| The decision key and a blocking gate | Every check is advisory.                                               | A required check that can block a merge.              | A suite with a clean noise plan, a validated Pass and a team that wants to block. | § 14   |
| More importers                       | Inspect, promptfoo, Langfuse, Phoenix, Braintrust, MLflow and lm-eval. | vitest-evals, DeepEval run files, k6 and hyperfine.   | The first caller of each one.                                                     | § 21   |

## 4. Out of scope, and the tool to use

These needs stay outside Ichnaea. The design names the tool to use instead.

| Need                          | Use instead                                                    | Design |
| ----------------------------- | -------------------------------------------------------------- | ------ |
| Hosting a review queue        | Label Studio, Argilla or Langfuse queues                       | § 27   |
| A playground                  | The playgrounds of Langfuse, Braintrust or Phoenix             | § 27   |
| Online A/B tests and canaries | GrowthBook, Statsig or Eppo                                    | § 27   |
| Input drift monitoring        | Evidently                                                      | § 27   |
| Attack and probe generation   | garak, PyRIT or promptfoo red team                             | § 27   |
| Leaderboards of many systems  | Arena-style ranking tools                                      | § 7.2  |
| Hosted, live dashboards       | Your trace platform or Grafana, fed by Ichnaea's table exports | § 12.8 |
