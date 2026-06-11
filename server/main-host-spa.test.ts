/**
 * Tests for the main-host SPA HTML injector (PR-#19-D).
 *
 * Covers:
 *   - injectMainHostSeo strips and replaces the default <title>
 *     and default OG/description meta tags so we never double up.
 *   - JSON-LD scripts land in the document and parse back.
 *   - Idempotent re-injection (markers replaced, not duplicated).
 *   - </script> in any DB string is escaped so we can't be
 *     injected into ourselves.
 *
 * The Express handler is not exercised by an HTTP harness — the
 * three behaviours that matter (req.microsite gate, slug parsing,
 * DB lookup) are tested via parseFlatHyperlocalSlug and the existing
 * storage tests. This test file focuses on the HTML manipulation
 * which is pure-function-easy to verify.
 */

import { describe, it, expect, vi } from "vitest";

// Mock storage BEFORE importing main-host-spa (hoisted by vi).
// The injection tests don't call storage, but importing main-host-spa
// transitively imports ./storage which needs DATABASE_URL at module
// load. Stubbing with empty methods is enough.
vi.mock("./storage", () => ({
  storage: {
    getCategoryBySlug: vi.fn(),
    getAreaBySlug: vi.fn(),
    getTradesmen: vi.fn(),
    getCategories: vi.fn(),
    getAreas: vi.fn(),
  },
}));

import {
  injectMainHostSeo,
  injectMainHostCrosslinks,
} from "./main-host-spa";
import { buildMainHostSeo } from "../shared/main-host-seo";
import type { MainHostCrosslinks } from "../shared/main-host-crosslinks";

const ORIGIN = "https://tradesmanfinder.com";

// Minimal index.html fixture matching the shape of dist/public/index.html.
// Includes the default tags we expect to be stripped on first injection.
const RAW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>TradesmanFinder — Find a trusted local tradesman</title>
    <meta name="description" content="Default homepage description" />
    <meta property="og:title" content="Default OG title" />
    <meta property="og:description" content="Default OG description" />
    <meta property="og:type" content="website" />
  </head>
  <body><div id="root"></div></body>
</html>`;

function makePayload(supplyCount = 3, withCoords = true) {
  return buildMainHostSeo({
    category: { id: 2, slug: "plumber", name: "Plumber" },
    area: {
      id: 1,
      slug: "manchester",
      name: "Manchester",
      region: "Greater Manchester M1",
      ...(withCoords ? { latitude: 53.4808, longitude: -2.2426 } : {}),
    },
    origin: ORIGIN,
    supplyCount,
  });
}

describe("injectMainHostSeo — first injection", () => {
  it("replaces the default <title> with the SEO title", () => {
    const seo = makePayload();
    const out = injectMainHostSeo(RAW_HTML, seo);
    // Default title is gone …
    expect(out).not.toContain(
      "<title>TradesmanFinder — Find a trusted local tradesman</title>",
    );
    // … and ours is in.
    expect(out).toContain(`<title>${seo.title}</title>`);
  });

  it("strips the default description meta tag", () => {
    const seo = makePayload();
    const out = injectMainHostSeo(RAW_HTML, seo);
    expect(out).not.toContain("Default homepage description");
    expect(out).toContain(
      `<meta name="description" content="${seo.description}">`,
    );
  });

  it("strips the default og:* meta tags before adding new ones", () => {
    const seo = makePayload();
    const out = injectMainHostSeo(RAW_HTML, seo);
    expect(out).not.toContain("Default OG title");
    expect(out).not.toContain("Default OG description");
    // Exactly one og:title now.
    const ogTitleCount = (out.match(/property="og:title"/g) || []).length;
    expect(ogTitleCount).toBe(1);
  });

  it("inserts the canonical link", () => {
    const seo = makePayload();
    const out = injectMainHostSeo(RAW_HTML, seo);
    expect(out).toContain(
      `<link rel="canonical" href="https://tradesmanfinder.com/plumber-in-manchester">`,
    );
  });

  it("inserts the marker-bracketed block before </head>", () => {
    const seo = makePayload();
    const out = injectMainHostSeo(RAW_HTML, seo);
    const startIdx = out.indexOf("<!-- main-host-seo:start -->");
    const endIdx = out.indexOf("<!-- main-host-seo:end -->");
    const headCloseIdx = out.indexOf("</head>");
    expect(startIdx).toBeGreaterThan(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(endIdx).toBeLessThan(headCloseIdx);
  });

  it("emits three JSON-LD <script> blocks and they parse", () => {
    const seo = makePayload();
    const out = injectMainHostSeo(RAW_HTML, seo);
    const matches = out.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    );
    expect(matches).toHaveLength(3);
    for (const m of matches!) {
      const inner = m.replace(
        /<script type="application\/ld\+json">|<\/script>/g,
        "",
      );
      expect(() => JSON.parse(inner)).not.toThrow();
    }
  });

  it("emits Twitter card meta tags", () => {
    const seo = makePayload();
    const out = injectMainHostSeo(RAW_HTML, seo);
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(out).toContain('<meta name="twitter:title"');
    expect(out).toContain('<meta name="twitter:description"');
  });
});

describe("injectMainHostSeo — idempotency", () => {
  it("re-injecting replaces the existing block rather than duplicating", () => {
    const first = injectMainHostSeo(RAW_HTML, makePayload(3));
    const second = injectMainHostSeo(first, makePayload(7));
    const startCount = (second.match(/main-host-seo:start/g) || []).length;
    const endCount = (second.match(/main-host-seo:end/g) || []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
    // New count reflected in the title.
    expect(second).toContain("7 Verified Local Pros");
    expect(second).not.toContain("3 Verified Local Pros");
  });
});

describe("injectMainHostSeo — escaping", () => {
  it("escapes </script in JSON-LD strings so the block cannot break out", () => {
    // Force a payload with a hostile string in the area name.
    // (The real DB would never produce this, but defence in depth matters.)
    const seo = buildMainHostSeo({
      category: { id: 2, slug: "plumber", name: "Plumber" },
      area: {
        id: 99,
        slug: "evil",
        name: "</script><script>alert(1)</script>",
        region: "Test",
      },
      origin: ORIGIN,
      supplyCount: 0,
    });
    const out = injectMainHostSeo(RAW_HTML, seo);
    // The literal </script> sequence must not appear inside our JSON-LD
    // blocks. It can appear elsewhere (closing the application/ld+json
    // <script> tag itself) — we just check it's escaped within JSON.
    const jsonBlocks = out.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    );
    for (const block of jsonBlocks || []) {
      const inner = block.replace(
        /<script type="application\/ld\+json">|<\/script>/g,
        "",
      );
      expect(inner).not.toContain("</script");
      expect(inner).toContain("<\\/script");
    }
  });

  it("HTML-escapes quotes and angle brackets in attribute values", () => {
    const seo = buildMainHostSeo({
      category: { id: 2, slug: "plumber", name: 'Plumber "Pro"' },
      area: {
        id: 1,
        slug: "manchester",
        name: "Manchester",
        region: "Greater Manchester M1",
      },
      origin: ORIGIN,
      supplyCount: 1,
    });
    const out = injectMainHostSeo(RAW_HTML, seo);
    // The literal quote inside the trade name must be entity-escaped
    // in attribute contexts.
    expect(out).toContain("Plumber &quot;Pro&quot;");
  });
});

// ──────────────────────────────────────────────────────────────────
// PR-#19-F — OG image + locale + robots + geo + <html lang>
// ──────────────────────────────────────────────────────────────────

describe("injectMainHostSeo — PR-#19-F head additions", () => {
  it("emits og:image, og:image:width/height/alt", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload());
    expect(out).toContain(
      '<meta property="og:image" content="https://tradesmanfinder.com/og-default.png">',
    );
    expect(out).toContain('<meta property="og:image:width" content="1200">');
    expect(out).toContain('<meta property="og:image:height" content="630">');
    expect(out).toMatch(/<meta property="og:image:alt" content="[^"]+Manchester[^"]*">/);
  });

  it("emits twitter:image and twitter:image:alt", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload());
    expect(out).toContain(
      '<meta name="twitter:image" content="https://tradesmanfinder.com/og-default.png">',
    );
    expect(out).toContain('<meta name="twitter:image:alt"');
  });

  it("emits og:locale en_GB", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload());
    expect(out).toContain('<meta property="og:locale" content="en_GB">');
  });

  it("emits the robots directive with max-image-preview:large", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload());
    expect(out).toMatch(/<meta name="robots" content="[^"]*max-image-preview:large[^"]*">/);
    expect(out).toMatch(/<meta name="robots" content="index,follow[^"]*">/);
  });

  it("rewrites <html lang=\"en\"> to <html lang=\"en-GB\">", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload());
    expect(out).toContain('<html lang="en-GB">');
    expect(out).not.toMatch(/<html lang="en">/);
    // Only one <html> tag — the rewrite must not duplicate it.
    const htmlOpenCount = (out.match(/<html\b/g) || []).length;
    expect(htmlOpenCount).toBe(1);
  });

  it("adds lang attribute when <html> has none", () => {
    const noLang = RAW_HTML.replace('<html lang="en">', "<html>");
    const out = injectMainHostSeo(noLang, makePayload());
    expect(out).toContain('<html lang="en-GB">');
  });

  it("emits geo.position, ICBM, geo.placename, geo.region when coords present", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload(3, true));
    expect(out).toContain('<meta name="geo.position" content="53.4808;-2.2426">');
    expect(out).toContain('<meta name="ICBM" content="53.4808, -2.2426">');
    expect(out).toContain('<meta name="geo.placename" content="Manchester">');
    expect(out).toContain('<meta name="geo.region" content="GB-ENG">');
  });

  it("omits geo meta tags when coords are absent", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload(3, false));
    expect(out).not.toContain('name="geo.position"');
    expect(out).not.toContain('name="ICBM"');
    expect(out).not.toContain('name="geo.placename"');
    expect(out).not.toContain('name="geo.region"');
  });

  it("strips a pre-existing default robots tag", () => {
    const withRobots = RAW_HTML.replace(
      "<title>",
      '<meta name="robots" content="noindex"><title>',
    );
    const out = injectMainHostSeo(withRobots, makePayload());
    expect(out).not.toContain('content="noindex"');
    // Exactly one robots tag.
    const robotsCount = (out.match(/name="robots"/g) || []).length;
    expect(robotsCount).toBe(1);
  });

  it("strips a pre-existing default twitter:* tag", () => {
    const withTw = RAW_HTML.replace(
      "<title>",
      '<meta name="twitter:card" content="summary"><title>',
    );
    const out = injectMainHostSeo(withTw, makePayload());
    // The default summary card was stripped; ours (summary_large_image) is the only one.
    expect(out).toContain('twitter:card" content="summary_large_image"');
    expect(out).not.toMatch(/twitter:card" content="summary"/);
  });
});

describe("injectMainHostSeo — supply-count title flips", () => {
  it("supply=0 uses the reviews-quotes framing", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload(0));
    expect(out).toContain("Reviews &amp; Free Quotes");
    expect(out).not.toContain("Verified Local Pros");
  });

  it("supply>0 uses the verified-pros framing", () => {
    const out = injectMainHostSeo(RAW_HTML, makePayload(5));
    expect(out).toContain("5 Verified Local Pros");
  });
});

// ──────────────────────────────────────────────────────────────────
// PR-#19-E — internal cross-link injection
// ──────────────────────────────────────────────────────────────────

const SAMPLE_CROSSLINKS: MainHostCrosslinks = {
  nearbyCities: [
    { label: "Plumbers in Liverpool", href: "/plumber-in-liverpool", slug: "liverpool" },
    { label: "Plumbers in Leeds", href: "/plumber-in-leeds", slug: "leeds" },
  ],
  relatedTrades: [
    { label: "Electricians in Manchester", href: "/electrician-in-manchester", slug: "electrician" },
    { label: "Builders in Manchester", href: "/builder-in-manchester", slug: "builder" },
  ],
};

describe("injectMainHostCrosslinks — first injection", () => {
  it("inserts the marker-bracketed block before </body>", () => {
    const out = injectMainHostCrosslinks(RAW_HTML, SAMPLE_CROSSLINKS);
    const startIdx = out.indexOf("<!-- main-host-crosslinks:start -->");
    const endIdx = out.indexOf("<!-- main-host-crosslinks:end -->");
    const bodyCloseIdx = out.indexOf("</body>");
    expect(startIdx).toBeGreaterThan(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(endIdx).toBeLessThan(bodyCloseIdx);
  });

  it("renders an anchor for every nearby city and every related trade", () => {
    const out = injectMainHostCrosslinks(RAW_HTML, SAMPLE_CROSSLINKS);
    expect(out).toContain('href="/plumber-in-liverpool"');
    expect(out).toContain('href="/plumber-in-leeds"');
    expect(out).toContain('href="/electrician-in-manchester"');
    expect(out).toContain('href="/builder-in-manchester"');
    expect(out).toContain("Plumbers in Liverpool");
    expect(out).toContain("Electricians in Manchester");
  });

  it("marks the SSR block with data-server-crosslinks for client de-dup", () => {
    const out = injectMainHostCrosslinks(RAW_HTML, SAMPLE_CROSSLINKS);
    expect(out).toContain('data-server-crosslinks="true"');
  });

  it("uses semantic <nav> + <ul><li><a> structure for crawler-friendliness", () => {
    const out = injectMainHostCrosslinks(RAW_HTML, SAMPLE_CROSSLINKS);
    const navCount = (out.match(/<nav /g) || []).length;
    expect(navCount).toBeGreaterThanOrEqual(2);
    expect(out).toContain('aria-label="Nearby cities"');
    expect(out).toContain('aria-label="Related trades"');
  });
});

describe("injectMainHostCrosslinks — idempotency", () => {
  it("re-injecting replaces the existing block rather than duplicating", () => {
    const first = injectMainHostCrosslinks(RAW_HTML, SAMPLE_CROSSLINKS);
    const second = injectMainHostCrosslinks(first, {
      nearbyCities: [
        { label: "Plumbers in Bristol", href: "/plumber-in-bristol", slug: "bristol" },
      ],
      relatedTrades: [],
    });
    const startCount = (second.match(/main-host-crosslinks:start/g) || []).length;
    const endCount = (second.match(/main-host-crosslinks:end/g) || []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
    expect(second).not.toContain("/plumber-in-liverpool");
    expect(second).toContain("/plumber-in-bristol");
  });

  it("strips any previous block when given empty inputs", () => {
    const first = injectMainHostCrosslinks(RAW_HTML, SAMPLE_CROSSLINKS);
    const second = injectMainHostCrosslinks(first, {
      nearbyCities: [],
      relatedTrades: [],
    });
    expect(second).not.toContain("main-host-crosslinks:start");
    expect(second).not.toContain("/plumber-in-liverpool");
  });
});

describe("injectMainHostCrosslinks — empty inputs", () => {
  it("returns the HTML unchanged when both clusters are empty", () => {
    const out = injectMainHostCrosslinks(RAW_HTML, {
      nearbyCities: [],
      relatedTrades: [],
    });
    expect(out).toBe(RAW_HTML);
  });
});

describe("injectMainHostCrosslinks — escaping", () => {
  it("HTML-escapes hostile labels and hrefs", () => {
    const out = injectMainHostCrosslinks(RAW_HTML, {
      nearbyCities: [
        {
          label: "<script>alert(1)</script>",
          href: '/x"><script>alert(2)</script>',
          slug: "x",
        },
      ],
      relatedTrades: [],
    });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain('/x"><script>');
    expect(out).toContain("&lt;script&gt;");
  });
});
