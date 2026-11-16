import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";

import { browserOnly } from "./browser-only.ts";
import { loadSchemas } from "./src/reference/schemas.ts";

// DOCS_URL is the one setting for where the site lives. Its origin is `site`, and its path is
// `base`. Links between pages carry the base path (`/ichnaea/…`), and the links validator fails the
// build when one does not, so a change of base shows every link to update.
const docsUrl = new URL(process.env.DOCS_URL ?? "https://hephaestus-build.github.io/ichnaea/");
const repository = "https://github.com/hephaestus-build/ichnaea";

export default defineConfig({
  site: docsUrl.origin,
  base: docsUrl.pathname,
  // The site has no raster images to optimize. The pass-through service keeps sharp, which needs
  // an install script, out of the dependency tree.
  image: { service: passthroughImageService() },
  // The interactive pages import the library from its TypeScript sources in this repository, so the
  // site needs no package build and always shows the statistics of its own commit.
  vite: {
    resolve: { conditions: ["ichnaea-source", "module", "browser", "development|production"] },
    // Pages that render at build time (Astro's prerender environment) import the library too, so
    // they resolve to its sources as well. Without it they read a stale or missing dist/.
    environments: {
      prerender: {
        resolve: { conditions: ["ichnaea-source", "module", "node", "development|production"] },
      },
    },
    plugins: [browserOnly()],
    worker: { plugins: () => [browserOnly()] },
  },
  integrations: [
    starlight({
      title: "Ichnaea",
      description:
        "Ichnaea tells you whether a change made your AI feature worse, from paired statistics.",
      social: [{ icon: "github", label: "GitHub", href: repository }],
      editLink: { baseUrl: `${repository}/edit/main/docs/site/` },
      lastUpdated: true,
      components: { Banner: "./src/components/StatusBanner.astro" },
      sidebar: [
        { label: "Planning explorer", link: "/planner/" },
        { label: "How-to guides", items: [{ autogenerate: { directory: "how-to" } }] },
        { label: "Explanation", items: [{ autogenerate: { directory: "explanation" } }] },
        {
          label: "Reference",
          items: [
            { label: "Record schemas", link: "/reference/schemas/" },
            { label: "Reason codes", link: "/reference/reason-codes/" },
            {
              label: "Records",
              collapsed: true,
              items: loadSchemas().map(({ name, title }) => ({
                label: title,
                link: `/reference/schemas/${name}/`,
              })),
            },
          ],
        },
        { label: "Glossary", link: "/glossary/" },
      ],
      plugins: [
        starlightLinksValidator({
          errorOnLocalLinks: true,
          // The record pages are generated routes, which the validator cannot see, so links to
          // them are not checked.
          exclude: [
            "/ichnaea/reference/schemas/",
            "/ichnaea/reference/schemas/*/",
            "/ichnaea/reference/reason-codes/",
          ],
        }),
        starlightLlmsTxt(),
      ],
    }),
  ],
});
