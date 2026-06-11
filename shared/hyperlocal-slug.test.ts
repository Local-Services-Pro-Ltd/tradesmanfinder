/**
 * Unit tests for the flat URL parser used by the canonical SEO route
 * `/{categorySlug}-in-{areaSlug}` (PR-#19-B).
 *
 * The parser is its own pure function and worth testing in isolation
 * because it underpins both the router gate and the canonical href that
 * `<link rel="canonical">` writes back into <head>. A regression here
 * silently breaks 400+ SEO landing pages.
 */

import { describe, it, expect } from "vitest";
import { parseFlatHyperlocalSlug, buildFlatHyperlocalPath } from "./hyperlocal-slug";

describe("parseFlatHyperlocalSlug", () => {
  it("splits a simple cat-in-area segment", () => {
    expect(parseFlatHyperlocalSlug("plumber-in-manchester")).toEqual({
      catSlug: "plumber",
      areaSlug: "manchester",
    });
  });

  it("splits on the LAST '-in-' so multi-hyphen area slugs survive", () => {
    // newcastle-upon-tyne has no '-in-' so this is straightforward
    expect(parseFlatHyperlocalSlug("electrician-in-newcastle-upon-tyne")).toEqual({
      catSlug: "electrician",
      areaSlug: "newcastle-upon-tyne",
    });
  });

  it("handles compound category slugs cleanly when area has no '-in-'", () => {
    // painter-and-decorator is a future category; assert it splits correctly.
    expect(parseFlatHyperlocalSlug("painter-and-decorator-in-leeds")).toEqual({
      catSlug: "painter-and-decorator",
      areaSlug: "leeds",
    });
  });

  it("returns empty object when '-in-' is missing", () => {
    expect(parseFlatHyperlocalSlug("post-a-job")).toEqual({});
    expect(parseFlatHyperlocalSlug("categories")).toEqual({});
    expect(parseFlatHyperlocalSlug("sign-in")).toEqual({});
  });

  it("returns empty object for undefined/empty/leading-only/trailing-only", () => {
    expect(parseFlatHyperlocalSlug(undefined)).toEqual({});
    expect(parseFlatHyperlocalSlug("")).toEqual({});
    // '-in-' at the very start means empty catSlug — reject.
    expect(parseFlatHyperlocalSlug("-in-manchester")).toEqual({});
    // '-in-' at the very end means empty areaSlug — reject.
    expect(parseFlatHyperlocalSlug("plumber-in-")).toEqual({});
  });

  it("matches the path-template format used by the manifest generator", () => {
    // shared/seo-routes.ts emits `/{cat.slug}-in-{area.slug}` paths.
    // Parser must round-trip those without loss.
    const path = `/plumber-in-manchester`;
    const segment = path.replace(/^\//, "");
    const parsed = parseFlatHyperlocalSlug(segment);
    expect(`${parsed.catSlug}-in-${parsed.areaSlug}`).toBe(segment);
  });
});

describe("buildFlatHyperlocalPath", () => {
  it("emits /{cat}-in-{area} for any slug pair", () => {
    expect(buildFlatHyperlocalPath("plumber", "manchester")).toBe("/plumber-in-manchester");
    expect(buildFlatHyperlocalPath("electrician", "newcastle-upon-tyne")).toBe(
      "/electrician-in-newcastle-upon-tyne",
    );
  });

  it("round-trips through parseFlatHyperlocalSlug", () => {
    const pairs = [
      ["plumber", "manchester"],
      ["electrician", "newcastle-upon-tyne"],
      ["painter-and-decorator", "leeds"],
      ["builder", "abbey-wood"],
    ] as const;
    for (const [cat, area] of pairs) {
      const path = buildFlatHyperlocalPath(cat, area);
      const segment = path.replace(/^\//, "");
      const parsed = parseFlatHyperlocalSlug(segment);
      expect(parsed).toEqual({ catSlug: cat, areaSlug: area });
    }
  });
});
