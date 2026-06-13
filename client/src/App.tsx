import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Categories from "@/pages/categories";
import Category from "@/pages/category";
import AreaPage from "@/pages/area";
import Hyperlocal from "@/pages/hyperlocal";
import MicrositePage from "@/pages/microsite";
import TradesmanProfile from "@/pages/tradesman";
import PostAJob from "@/pages/post-a-job";
import ForTradesmen from "@/pages/for-tradesmen";
import FoundingPro from "@/pages/founding-pro";
import Unsubscribe from "@/pages/unsubscribe";
import Partners from "@/pages/partners";
import Join from "@/pages/join";
import SignIn from "@/pages/sign-in";
import Dashboard from "@/pages/dashboard";
import Admin from "@/pages/admin";
import AdminModeration from "@/pages/admin-moderation";
import AdminPartners from "@/pages/admin-partners";
import AdminMicrosites from "@/pages/admin-microsites";
import { About, Contact, Terms, Privacy, Faq } from "@/pages/static-pages";
import { ScrollToTop } from "@/components/scroll-to-top";

// wouter's useHashLocation returns the raw hash as the path (e.g. for
// `#/dashboard?id=42` it returns `/dashboard?id=42`). The <Route path="/dashboard">
// matcher then fails because it sees the query as part of the path, falling
// through to NotFound. We wrap the hook to strip the query string before the
// matcher runs. The full hash (including the query) remains in
// `window.location.hash`, so page-level code that reads search params from the
// hash (e.g. dashboard's getInitialId(), Stripe Checkout `?purchase=success`)
// continues to work unchanged.
const useHashLocationStripQuery: typeof useHashLocation = ((opts) => {
  const [path, navigate] = useHashLocation(opts);
  const qIdx = path.indexOf("?");
  const cleanPath = qIdx === -1 ? path : path.slice(0, qIdx);
  return [cleanPath, navigate] as const;
}) as typeof useHashLocation;
// Preserve the static `.hrefs` helper so wouter's <Link> still produces `#/...` URLs.
(useHashLocationStripQuery as unknown as { hrefs: (h: string) => string }).hrefs =
  (useHashLocation as unknown as { hrefs: (h: string) => string }).hrefs;

function AppRouter() {
  // When the server has resolved this host as a mini-site it injects
  // window.__MICROSITE__ into the SPA bootstrap. We route the root path to
  // a dedicated mini-site renderer instead of the generic homepage; all
  // other client-side routes work unchanged.
  const HomeOrMicrosite =
    typeof window !== "undefined" && window.__MICROSITE__ ? MicrositePage : Home;
  return (
    <Switch>
      <Route path="/" component={HomeOrMicrosite} />
      <Route path="/categories" component={Categories} />
      <Route path="/category/:catSlug/in/:areaSlug" component={Hyperlocal} />
      <Route path="/category/:slug" component={Category} />
      <Route path="/area/:slug" component={AreaPage} />
      <Route path="/tradesman/:slug" component={TradesmanProfile} />
      <Route path="/post-a-job" component={PostAJob} />
      <Route path="/for-tradesmen" component={ForTradesmen} />
      <Route path="/founding-pro" component={FoundingPro} />
      <Route path="/unsubscribe" component={Unsubscribe} />
      <Route path="/partners" component={Partners} />
      <Route path="/join" component={Join} />
      <Route path="/sign-in" component={SignIn} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/moderation" component={AdminModeration} />
      <Route path="/admin/partners" component={AdminPartners} />
      <Route path="/admin/microsites" component={AdminMicrosites} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/faq" component={Faq} />
      {/*
        Canonical SEO landing-page URL: /{categorySlug}-in-{areaSlug}
        e.g. /plumber-in-manchester, /electrician-in-newcastle-upon-tyne.

        Why a regex rather than "/:catSlug-in-:areaSlug":
        wouter's path-to-regexp treats hyphens as part of the param name,
        so the string form collides with /sign-in, /post-a-job, etc.
        The regex below requires "-in-" with at least one char on each
        side, so unrelated single-word routes never match. The component
        re-parses the segment via parseFlatHyperlocalSlug().

        Placed before NotFound so genuine /{cat}-in-{area} URLs render
        the page, and everything else (typos, removed slugs) still 404s
        after Hyperlocal's own "category/area not found" branch handles
        unknown taxonomy gracefully.
      */}
      <Route path={/^\/[^/]+-in-[^/]+$/} component={Hyperlocal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocationStripQuery}>
            <ScrollToTop />
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
