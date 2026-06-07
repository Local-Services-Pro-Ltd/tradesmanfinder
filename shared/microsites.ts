/**
 * TradesmanFinder mini-site registry — single source of truth for the
 * 81 domains in the hyper-local SEO portfolio.
 *
 * Each entry is keyed by lowercase hostname (no protocol, no port). The
 * server middleware (`server/microsite-middleware.ts`) reads `req.hostname`,
 * looks up the entry here, and attaches it to `req.microsite` so downstream
 * route handlers, SEO injection, and the client renderer can branch on it.
 *
 * Kinds:
 *   - geo-trade:         {area}+{trade}.co.uk pattern (55 sites)
 *   - generic-directory: national {verb}local{trade}.co.uk landings (20 sites)
 *   - vertical:          topical, no area (basementcontractors etc., 3 sites)
 *   - redirect:          parked brand-piggyback domains, 301 to canonical (3 sites)
 *
 * Trade and area slugs MUST match the live DB taxonomy from /api/categories
 * and /api/areas. The build-time test `microsites.test.ts` enforces this.
 */

export type MicrositeKind = 'geo-trade' | 'generic-directory' | 'vertical' | 'redirect';

export type Microsite = {
  /** Lowercase hostname, no protocol, no port. */
  host: string;
  kind: MicrositeKind;
  /** Canonical DB category slug (matches /api/categories). */
  trade?: string;
  /** Canonical DB area slug (matches /api/areas). */
  area?: string;
  /** For vertical sites: short topic identifier (e.g. 'basement'). */
  vertical?: string;
  /** Override title for vertical sites. */
  title?: string;
  /** For vertical sites: which trade gets pre-selected on the lead form. */
  leadTrade?: string;
  /** Duplicate-domain canonical host (other host 301s to this one). */
  canonical?: string;
  /** For redirect kind: where this host should 301 to. */
  redirectTo?: string;
};

/** All 83 registered mini-site domains. */
export const MICROSITES: ReadonlyArray<Microsite> = [
  { host: 'abbeywoodbuilder.co.uk', kind: 'geo-trade', trade: 'builder', area: 'abbey-wood' },
  { host: 'abingdonbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'abingdon' },
  { host: 'accringtonbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'accrington' },
  { host: 'actonbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'acton' },
  { host: 'barnsburybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'barnsbury' },
  { host: 'basementcontractors.co.uk', kind: 'vertical', vertical: 'basement', title: 'Specialist basement contractors — UK directory', leadTrade: 'builder' },
  { host: 'batterseaelectricians.co.uk', kind: 'geo-trade', trade: 'electrician', area: 'battersea' },
  { host: 'batterseaplumber.co.uk', kind: 'geo-trade', trade: 'plumber', area: 'battersea' },
  { host: 'belsizeparkbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'belsize-park' },
  { host: 'bermondseybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'bermondsey' },
  { host: 'bexleybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'bexley' },
  { host: 'bexleyheathbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'bexleyheath' },
  { host: 'blackheathbuilder.co.uk', kind: 'geo-trade', trade: 'builder', area: 'blackheath', canonical: 'blackheathbuilders.co.uk' },
  { host: 'blackheathbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'blackheath' },
  { host: 'blackheathcarpenters.co.uk', kind: 'geo-trade', trade: 'carpenter', area: 'blackheath' },
  { host: 'blackheathcleaners.co.uk', kind: 'geo-trade', trade: 'cleaner', area: 'blackheath' },
  { host: 'blackheathdecorator.co.uk', kind: 'geo-trade', trade: 'painter-decorator', area: 'blackheath' },
  { host: 'blackheathelectricians.co.uk', kind: 'geo-trade', trade: 'electrician', area: 'blackheath' },
  { host: 'blackheathpainter.co.uk', kind: 'geo-trade', trade: 'painter-decorator', area: 'blackheath' },
  { host: 'blackheathplumber.co.uk', kind: 'geo-trade', trade: 'plumber', area: 'blackheath' },
  { host: 'bognorregisbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'bognor-regis' },
  { host: 'bowbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'bow' },
  { host: 'brixtonbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'brixton' },
  { host: 'burnleybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'burnley' },
  { host: 'canningtownbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'canning-town' },
  { host: 'catfordbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'catford' },
  { host: 'cricklewoodbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'cricklewood' },
  { host: 'dagenhambuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'dagenham' },
  { host: 'docklandbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'docklands' },
  { host: 'docklandelectricians.co.uk', kind: 'geo-trade', trade: 'electrician', area: 'docklands' },
  { host: 'docklandsdecorators.co.uk', kind: 'geo-trade', trade: 'painter-decorator', area: 'docklands' },
  { host: 'dulwichdecorators.co.uk', kind: 'geo-trade', trade: 'painter-decorator', area: 'dulwich' },
  { host: 'dulwichelectricians.co.uk', kind: 'geo-trade', trade: 'electrician', area: 'dulwich' },
  { host: 'enfieldbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'enfield' },
  { host: 'finchleybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'finchley' },
  { host: 'findalocalbuilder.co.uk', kind: 'generic-directory', trade: 'builder' },
  { host: 'findalocalpainter.net', kind: 'generic-directory', trade: 'painter-decorator' },
  { host: 'finsburybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'finsbury' },
  { host: 'getacarpenter.co.uk', kind: 'generic-directory', trade: 'carpenter' },
  { host: 'getalocalbabysitter.com', kind: 'generic-directory' },
  { host: 'getalocalbuilder.co.uk', kind: 'generic-directory', trade: 'builder' },
  { host: 'getalocalbuilder.com', kind: 'generic-directory', trade: 'builder' },
  { host: 'getalocalcleaner.co.uk', kind: 'generic-directory', trade: 'cleaner' },
  { host: 'getalocalcleaner.com', kind: 'generic-directory', trade: 'cleaner' },
  { host: 'getalocalhandyman.co.uk', kind: 'generic-directory', trade: 'handyman' },
  { host: 'getalocalhandyman.com', kind: 'generic-directory', trade: 'handyman' },
  { host: 'getalocalpainter.co.uk', kind: 'generic-directory', trade: 'painter-decorator' },
  { host: 'getalocalpainter.com', kind: 'generic-directory', trade: 'painter-decorator' },
  { host: 'getalocalplumber.co.uk', kind: 'generic-directory', trade: 'plumber' },
  { host: 'getalocalroofer.co.uk', kind: 'generic-directory', trade: 'roofer' },
  { host: 'getalocalroofer.com', kind: 'generic-directory', trade: 'roofer' },
  { host: 'getaplumber.co.uk', kind: 'generic-directory', trade: 'plumber' },
  { host: 'glastonburybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'glastonbury' },
  { host: 'greenwichbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'greenwich' },
  { host: 'hampsteadhandyman.co.uk', kind: 'geo-trade', trade: 'handyman', area: 'hampstead' },
  { host: 'hampsteadheathbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'hampstead-heath' },
  { host: 'haringeybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'haringey' },
  { host: 'hornchurchbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'hornchurch' },
  { host: 'ikeahandyman.co.uk', kind: 'redirect', redirectTo: 'https://tradesmanfinder.com' },
  { host: 'kingsburybuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'kingsbury' },
  { host: 'leightonbuzzardbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'leighton-buzzard' },
  { host: 'lewishambuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'lewisham' },
  { host: 'leytonbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'leyton' },
  { host: 'leytonstonebuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'leytonstone' },
  { host: 'leytonstoneplumbers.co.uk', kind: 'geo-trade', trade: 'plumber', area: 'leytonstone' },
  { host: 'localtradesmandirectory.co.uk', kind: 'generic-directory' },
  { host: 'localtradesmendirectory.co.uk', kind: 'generic-directory' },
  { host: 'localtradesmenfinder.co.uk', kind: 'generic-directory' },
  { host: 'loughtonbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'loughton' },
  { host: 'mertonbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'merton' },
  { host: 'mortlakebuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'mortlake' },
  { host: 'newhambuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'newham' },
  { host: 'pimlicobuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'pimlico' },
  { host: 'plumsteadplumbers.co.uk', kind: 'geo-trade', trade: 'plumber', area: 'plumstead' },
  { host: 'redbridgebuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'redbridge' },
  { host: 'repairmyproperty.co.uk', kind: 'vertical', vertical: 'property-repair', title: 'Repair my property — find local property repair specialists' },
  { host: 'repairyourproperty.co.uk', kind: 'vertical', vertical: 'property-repair', title: 'Repair your property — UK property repair directory' },
  { host: 'screwfixhandyman.co.uk', kind: 'redirect', redirectTo: 'https://tradesmanfinder.com' },
  { host: 'sydenhambuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'sydenham' },
  { host: 'ukbuildersdirectory.co.uk', kind: 'generic-directory', trade: 'builder' },
  { host: 'walthamforestbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'waltham-forest' },
  { host: 'wansteadbuilders.co.uk', kind: 'geo-trade', trade: 'builder', area: 'wanstead' },
  { host: 'wickeshandyman.co.uk', kind: 'redirect', redirectTo: 'https://tradesmanfinder.com' },
];

/** Lookup table built once for O(1) resolution. */
const BY_HOST = new Map<string, Microsite>(
  MICROSITES.map((m) => [m.host.toLowerCase(), m]),
);

/**
 * Resolve a request hostname to a microsite entry, or null if the host is
 * not in the portfolio (i.e. it's the main tradesmanfinder.com site).
 *
 * Strips `www.` prefix and the port if present so callers can pass
 * `req.hostname`, `req.headers.host`, or any normalised host string.
 */
export function resolveMicrositeByHost(rawHost: string | undefined | null): Microsite | null {
  if (!rawHost) return null;
  let host = rawHost.toLowerCase().trim();
  // strip port
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  // strip www.
  if (host.startsWith('www.')) host = host.slice(4);
  return BY_HOST.get(host) ?? null;
}

/** Total number of registered domains (for tests / observability). */
export const MICROSITE_COUNT = 83;
