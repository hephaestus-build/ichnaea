import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

// DOCS_URL is the one setting for where the site lives. Its origin is `site`, and its path is
// `base`. A custom domain later only changes this value.
const docsUrl = new URL(process.env.DOCS_URL ?? "https://hephaestus-build.github.io/ichnaea/");
const repository = "https://github.com/hephaestus-build/ichnaea";

export default defineConfig({
  site: docsUrl.origin,
  base: docsUrl.pathname,
  // The site has no raster images to optimize. The pass-through service keeps sharp, which needs
  // an install script, out of the dependency tree.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: "Ichnaea",
      description:
        "Ichnaea tells you whether a change made your AI feature worse, from paired statistics.",
      social: [{ icon: "github", label: "GitHub", href: repository }],
      editLink: { baseUrl: `${repository}/edit/main/docs/site/` },
      lastUpdated: true,
      components: { Banner: "./src/components/StatusBanner.astro" },
      plugins: [starlightLinksValidator({ errorOnLocalLinks: true })],
    }),
  ],
});
