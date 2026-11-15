# @hephaestus-build/ichnaea-report

The `report` plugin renders a stored decision as a CI summary in Markdown (`summary.md`) and a
static HTML report (`report.html`).

- Both come from one view model of the decision record. They compute nothing new, and they show
  the same numbers.
- Before it renders, the plugin recomputes the decision from the stored records. It refuses to
  render when the two differ.
- `lintReport` checks each output. A rate or a difference must stand next to its interval. The
  word "significant" and an anonymity claim are not allowed, and a lineage footer is required.
- The HTML report has no JavaScript and no external resource. Every verdict is written out, so its
  meaning never rests on colour. The colours come from the Okabe–Ito palette.
