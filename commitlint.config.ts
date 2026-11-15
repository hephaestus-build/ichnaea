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
        // Dependabot names development dependency updates `deps-dev`.
        "deps-dev",
        "examples",
      ],
    ],
  },
};
