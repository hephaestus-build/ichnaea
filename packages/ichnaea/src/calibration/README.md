# Judge calibration: `@hephaestus-build/ichnaea/calibration`

A model judge reads answers the way a person would, and labels them. Before its labels are shown
beside a measure, it is calibrated: two human raters and the judge label the same answers, and
`analyzeCalibration` checks the judge against the raters. The module is pure. It reads labels that
the caller collected, and it never calls a model.

## The rule

A judge is `calibrated` when every condition holds. Otherwise it is `diagnostic`, and `failed`
names each condition that does not hold.

| Condition                                                   | Yes/no labels (1 marks a defect)                | Levels 1 to K                                    |
| ----------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `ratersFloor`: the raters agree enough to calibrate against | lower bound of rater–rater AC1 ≥ 0.60           | lower bound of rater–rater ordinal alpha ≥ 0.667 |
| `agreement`: D = judge–rater minus rater–rater agreement    | lower bound of D on Gwet's AC1 ≥ −0.15          | lower bound of D on ordinal alpha ≥ −0.15        |
| `sensitivity` and `specificity`                             | each gap's lower bound ≥ −0.10                  | —                                                |
| `armBias`: the bias between base and candidate is ruled out | the 90 % interval of the bias lies within ±0.20 | the 90 % interval of the bias lies within ±0.15  |

- **Bounds.** Each lower bound is the one-sided 95 % percentile bound of one bootstrap. The bootstrap
  resamples whole items within their sampling strata, because the answers of one item are not
  independent.
- **Weights.** Every statistic weights each answer by 1/π, the inverse of its inclusion
  probability, so that a draw that oversampled likely defects still estimates the population.
  Ordinal alpha takes no weights, so a levels set must weight every answer 1.
- **Why sensitivity and specificity.** AC1 can be high when the raters agree only by chance. At a
  low defect rate, a judge that always says "no defect" can pass an AC1 condition. The sensitivity
  condition refuses it.
- **Why the bias gate.** A judge whose bias between base and candidate is not ruled out makes its
  measured changes uninterpretable, so the gate holds for a secondary measure too. Only base and
  candidate enter it; known-worse answers do not.
- **Use.** A calibrated judge's measures are secondary: they are shown, and they never decide.
  `analysis.use` is always `"secondary"`.

## The bias between base and candidate, and the slope

- `armBias` is the judge's bias between base and candidate: its weighted mean reading minus the
  raters' mean reading, on the candidate's answers minus on the base's, on [0, 1]. Levels are
  normalized as (level − 1)/(K − 1). `shownBound` is max(|lower|, |upper|) of its 90 % interval.
- `slope` needs yes/no labels and answers from a known-worse configuration. It is β = the judge's
  change ÷ the raters' change in quality (1 − defect) from base to known-worse, with its one-sided
  95 % lower bound β_L, capped at 1, and B, the bias bound on the same pair. A judge that sees half
  of every drop has β = 1/2: it still detects a large drop, but it shrinks every change.
- `judgePass(analysis, limit)` says whether a judge-based Pass is reachable at a measure's limit. It
  is reachable only when the raters' drop is shown and β_L · limit > B. Then the judge-measured
  change's lower bound must be at least −(β_L · limit − B). At a limit of 0.10 and a few hundred
  answers it is practically never reachable (see the operating characteristics in
  [VALIDATION.md](../stats/VALIDATION.md#the-judge-calibration-rule-operating-characteristics)).

```ts
import { analyzeCalibration } from "@hephaestus-build/ichnaea/calibration";

const analysis = analyzeCalibration(
  {
    scale: "binary",
    units: [
      // One entry per labelled answer: its item, stratum, configuration, 1/π weight and labels.
      {
        item: "q1",
        stratum: "flagged",
        configuration: "base",
        weight: 1,
        raters: [1, 1],
        judge: 1,
      },
      {
        item: "q1",
        stratum: "flagged",
        configuration: "candidate",
        weight: 1,
        raters: [0, 0],
        judge: 0,
      },
      // …
    ],
  },
  { seed: 1 },
);
analysis.status; // "calibrated" or "diagnostic"
analysis.failed; // for example ["sensitivity"]
```

`analyzeCalibration` refuses a set it cannot analyze: a weight below 1, a label outside the scale,
an item in two strata, no base or no candidate answer, or weighted levels.
