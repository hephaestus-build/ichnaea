export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "contracts",
        "stats",
        "core",
        "testkit",
        "decide",
        "report",
        "runner",
        "cli",
        "docs",
        "repo",
        "ci",
        "deps",
        // Earlier Dependabot commits on `main` use `deps-dev`. Renovate writes `deps`.
        "deps-dev",
        "examples",
      ],
    ],
  },
};
