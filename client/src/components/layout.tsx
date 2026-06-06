import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo, CategoryIcon } from "./brand";
import { useTheme } from "./theme";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import type { Category, Area } from "@/lib/api-types";
import { Moon, Sun, Menu, ChevronDown, MapPin, Hammer } from "lucide-react";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} data-testid="button-theme-toggle" aria-label="Toggle dark mode">
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}

function TopNav() {
  const [open, setOpen] = useState(false);
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-1 lg:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="button-nav-find" className="gap-1">
                Find a Tradesman <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="grid max-h-[70vh] w-[420px] grid-cols-2 gap-0.5 overflow-y-auto p-2">
              {(categories || []).map((c) => (
                <Link key={c.id} href={`/category/${c.slug}`} data-testid={`menu-category-${c.slug}`}>
                  <DropdownMenuItem className="cursor-pointer gap-2">
                    <CategoryIcon name={c.icon} className="h-4 w-4 text-primary" /> {c.name}
                  </DropdownMenuItem>
                </Link>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="button-nav-areas" className="gap-1">
                Areas <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="grid max-h-[70vh] w-[360px] grid-cols-2 gap-0.5 overflow-y-auto p-2">
              {(areas || []).map((a) => (
                <Link key={a.id} href={`/area/${a.slug}`} data-testid={`menu-area-${a.slug}`}>
                  <DropdownMenuItem className="cursor-pointer gap-2">
                    <MapPin className="h-4 w-4 text-primary" /> {a.name}
                  </DropdownMenuItem>
                </Link>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Link href="/for-tradesmen">
            <Button variant="ghost" size="sm" data-testid="button-nav-fortradesmen">For Tradesmen</Button>
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in" className="hidden sm:block">
            <Button variant="outline" size="sm" data-testid="button-nav-signin">Sign In</Button>
          </Link>
          <Link href="/post-a-job" className="hidden sm:block">
            <Button size="sm" data-testid="button-nav-postjob">Post a Job</Button>
          </Link>

          {/* Mobile menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" data-testid="button-mobile-menu" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] overflow-y-auto">
              <SheetTitle className="mb-4">Menu</SheetTitle>
              <div className="flex flex-col gap-1">
                <Link href="/post-a-job" onClick={() => setOpen(false)}>
                  <Button className="w-full justify-start" data-testid="link-mobile-postjob"><Hammer className="mr-2 h-4 w-4" />Post a Job</Button>
                </Link>
                <Link href="/categories" onClick={() => setOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start" data-testid="link-mobile-categories">All Trades</Button>
                </Link>
                <Link href="/for-tradesmen" onClick={() => setOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">For Tradesmen</Button>
                </Link>
                <Link href="/sign-in" onClick={() => setOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">Sign In</Button>
                </Link>
                <div className="my-2 border-t border-border" />
                <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Popular Trades</p>
                {(categories || []).slice(0, 8).map((c) => (
                  <Link key={c.id} href={`/category/${c.slug}`} onClick={() => setOpen(false)}>
                    <Button variant="ghost" size="sm" className="w-full justify-start gap-2 font-normal">
                      <CategoryIcon name={c.icon} className="h-4 w-4 text-primary" /> {c.name}
                    </Button>
                  </Link>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: areas } = useQuery<Area[]>({ queryKey: ["/api/areas"] });
  return (
    <footer className="mt-20 border-t border-border bg-navy text-white/90">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <Logo className="[&_span:last-child]:text-white" />
            <p className="mt-4 max-w-xs text-sm text-white/70">
              The trusted way to find vetted local tradesmen across the UK. Post a job free and compare quotes.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-white">Popular Trades</h4>
            <ul className="space-y-2 text-sm">
              {(categories || []).slice(0, 6).map((c) => (
                <li key={c.id}><Link href={`/category/${c.slug}`} className="text-white/70 hover:text-primary">{c.name}s</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-white">Popular Areas</h4>
            <ul className="space-y-2 text-sm">
              {(areas || []).slice(0, 6).map((a) => (
                <li key={a.id}><Link href={`/area/${a.slug}`} className="text-white/70 hover:text-primary">{a.name}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-white">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/about" className="text-white/70 hover:text-primary">About</Link></li>
              <li><Link href="/for-tradesmen" className="text-white/70 hover:text-primary">For Tradesmen</Link></li>
              <li><Link href="/contact" className="text-white/70 hover:text-primary">Contact</Link></li>
              <li><Link href="/faq" className="text-white/70 hover:text-primary">FAQ</Link></li>
              <li><Link href="/terms" className="text-white/70 hover:text-primary">Terms</Link></li>
              <li><Link href="/privacy" className="text-white/70 hover:text-primary">Privacy</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-white/60 sm:flex-row">
          <p>© {new Date().getFullYear()} Local Services Pro Ltd. All rights reserved.</p>
          <p>Registered in England &amp; Wales. A demo MVP — businesses shown are illustrative.</p>
        </div>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [loc] = useLocation();
  const hideFloating = loc.startsWith("/post-a-job");
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex-1">{children}</main>
      <Footer />
      {/* Mobile floating Post a Job button */}
      {!hideFloating && (
        <Link href="/post-a-job" className="fixed bottom-5 right-5 z-40 sm:hidden">
          <Button size="lg" className="rounded-full shadow-lg" data-testid="button-floating-postjob">
            <Hammer className="mr-2 h-4 w-4" /> Post a Job
          </Button>
        </Link>
      )}
    </div>
  );
}
