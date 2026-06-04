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
import TradesmanProfile from "@/pages/tradesman";
import PostAJob from "@/pages/post-a-job";
import ForTradesmen from "@/pages/for-tradesmen";
import Join from "@/pages/join";
import Dashboard from "@/pages/dashboard";
import Admin from "@/pages/admin";
import { About, Contact, Terms, Privacy, Faq } from "@/pages/static-pages";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/categories" component={Categories} />
      <Route path="/category/:catSlug/in/:areaSlug" component={Hyperlocal} />
      <Route path="/category/:slug" component={Category} />
      <Route path="/area/:slug" component={AreaPage} />
      <Route path="/tradesman/:slug" component={TradesmanProfile} />
      <Route path="/post-a-job" component={PostAJob} />
      <Route path="/for-tradesmen" component={ForTradesmen} />
      <Route path="/join" component={Join} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/admin" component={Admin} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/faq" component={Faq} />
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
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
