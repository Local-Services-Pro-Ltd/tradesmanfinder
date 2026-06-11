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
  },
}));

import { injectMainHostSeo } from "./main-host-spa";
import { buildMainHostSeo } from "../shared/main-host-seo";

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

function makePayload(supplyCount = 3) {
  return buildMainHostSeo({
    category: { id: 2, slug: "plumber", name: "Plumber" },
    area: {
      id: 1,
      slug: "manchester",
      name: "Manchester",
      region: "Greater Manchester M1",
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
