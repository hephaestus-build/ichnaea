# Reports: `@tumaet/ichnaea`

The `report` plugin renders a stored decision as a CI summary in Markdown (`summary.md`) and a
static HTML report (`report.html`). `report(decision, { format })` renders one as Markdown, HTML
or the JSON view model. It is synchronous, writes no file, and refuses a report that the lint
refuses (`ReportError`).

- Both come from one view model of the decision record. They compute nothing new, and they show
  the same numbers.
- Before it renders, the plugin recomputes the decision from the stored records. It refuses to
  render when the two differ.
- A lower bound is labelled "not validated" unless the comparison's non-inferiority result is
  validated (decision 0015). The regression result never vouches for an interval.
- `lintReport` checks each output. A rate or a difference must stand next to its interval, and an
  HTML bound marked not validated must carry its label. The word "significant" and an anonymity
  claim are not allowed, and a lineage footer is required.
- The HTML report has no JavaScript and no external resource. Every verdict is written out, so its
  meaning never rests on colour. The colours come from the Okabe–Ito palette.
