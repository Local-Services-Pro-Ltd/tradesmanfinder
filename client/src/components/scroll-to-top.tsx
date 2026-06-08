import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Scrolls to the top of the page on every client-side route change.
 *
 * Without this, hash-based SPA navigation preserves the previous page's
 * scroll position — so clicking a footer link (e.g. /#/area/woolwich) loads
 * the new page but leaves the user at the bottom of the viewport on the
 * footer they just clicked. They then have to manually scroll up to see
 * the page content.
 *
 * Mount once, near the top of the tree, inside <Router>.
 *
 * Notes:
 * - We use `instant` rather than `smooth` so the user doesn't see the page
 *   flash through a scroll animation on every navigation.
 * - We DO NOT reset scroll for in-page anchor jumps. Wouter's location only
 *   contains the path portion of the hash (e.g. `/area/woolwich`), not any
 *   trailing fragment (#pricing), so anchor-based scrollIntoView calls like
 *   the ones in for-tradesmen.tsx and partners.tsx are unaffected — they
 *   don't change the wouter location, so this effect doesn't fire.
 */
export function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location]);

  return null;
}
