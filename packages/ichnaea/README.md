# @hephaestus-build/ichnaea

Ichnaea evaluates GenAI features whenever their configuration changes, and gives each change a
verdict from paired statistics. This package holds all of it: the record contracts, the statistics,
the plugin host and CLI, the decision rule and the reports. The
[repository README](https://github.com/hephaestus-build/ichnaea#readme) shows how to install it
and runs a five-minute example.

## Subpaths

| Import                                                   | Content                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@hephaestus-build/ichnaea`                              | The [core](src/core/README.md) with its CLI, the [decision rule](src/decide/README.md) and the [reports](src/report/README.md) |
| `@hephaestus-build/ichnaea/contracts`                    | The [record contracts](src/contracts/README.md): zod schemas, canonical hashing, data classes                                  |
| `@hephaestus-build/ichnaea/stats`                        | The [statistics](src/stats/README.md), with their [validation](src/stats/VALIDATION.md)                                        |
| `@hephaestus-build/ichnaea/schemas/<record>.schema.json` | The normative JSON Schema 2020-12 file of each record, for callers in other languages                                          |

The `ichnaea` command runs the CLI. The package needs Node 24.3 or later. zod 4 (4.6 or later) is
a peer dependency: install it once, at the root of your project. The package has no other
dependency.

The package ships JavaScript and declarations in `dist/`, built from the TypeScript sources in
`src/`, which ship too, so that go-to-source works.

## Licence

Code is MIT. This includes the zod sources, the generated JSON Schemas and the fixtures.
Specification text and documentation are CC BY 4.0.
