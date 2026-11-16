// A Markdown twin of every docs page at the same path plus `.md`, for readers and tools that want
// the text without the site around it. llms.txt (starlight-llms-txt) lists the pages.
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";

import { markdownTwin } from "../markdown-twin.ts";

export const getStaticPaths = (async () => {
  const pages = await getCollection("docs");
  return pages.map((page) => ({
    params: { slug: page.id === "index" ? "index" : page.id },
    props: { page },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: CollectionEntry<"docs"> }> = ({ props }) => {
  const { title, description } = props.page.data;
  const body = markdownTwin(props.page.body ?? "");
  const text = [`# ${title}`, description ?? "", body].filter(Boolean).join("\n\n");
  return new Response(`${text}\n`, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
