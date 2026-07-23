import { useCallback, useEffect, useState } from "react";
import { Feather, Plus } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { AccountArea } from "@/components/AccountArea";
import { MfaGate } from "@/components/MfaGate";
import { DisclaimerGate, disclaimerAccepted } from "@/components/DisclaimerGate";
import Footer from "@/components/Footer";
import Explore from "@/routes/Explore";
import Launch from "@/routes/Launch";
import Token from "@/routes/Token";
import Analytics from "@/routes/Analytics";
import Terms from "@/routes/Terms";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * History-API routing without a router dependency. Real URLs so tokens are linkable:
 *   /                              explore feed
 *   /tokens/robinhood/<address>    token page (chain-scoped, DexScreener-style)
 *   /launch                        launch form
 *   /analytics                     protocol analytics
 *   /terms                         terms & disclaimers
 * The backend serves index.html for these paths (SPA fallback in api.js).
 */
type Route =
  | { page: "explore" }
  | { page: "token"; address: string }
  | { page: "launch" }
  | { page: "analytics" }
  | { page: "terms" };

function parsePath(pathname: string): Route {
  const token = pathname.match(/^\/tokens\/robinhood\/(0x[a-fA-F0-9]{40})$/);
  if (token) return { page: "token", address: token[1] };
  if (pathname === "/launch") return { page: "launch" };
  if (pathname === "/analytics") return { page: "analytics" };
  if (pathname === "/terms") return { page: "terms" };
  return { page: "explore" };
}

function pathFor(route: Route): string {
  switch (route.page) {
    case "token":
      return `/tokens/robinhood/${route.address}`;
    case "launch":
      return "/launch";
    case "analytics":
      return "/analytics";
    case "terms":
      return "/terms";
    default:
      return "/";
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname));
  const [accepted, setAccepted] = useState(disclaimerAccepted);
  const [apiUp, setApiUp] = useState<boolean | null>(null);

  const navigate = useCallback((next: Route) => {
    // Keep the query string (?ref=… referral links) when moving around.
    window.history.pushState(null, "", pathFor(next) + window.location.search);
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    api
      .health()
      .then(() => setApiUp(true))
      .catch(() => setApiUp(false));
  }, []);

  const goExplore = useCallback(() => navigate({ page: "explore" }), [navigate]);
  const onExplore = route.page === "explore";

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-6">
            <button className="flex items-center gap-2" onClick={goExplore}>
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Feather className="size-4" aria-hidden />
              </span>
              <span className="display text-[15px] font-semibold tracking-tight">finchpad</span>
            </button>
            <nav className="hidden items-center gap-1 md:flex">
              <button
                onClick={goExplore}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                  onExplore ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Explore
              </button>
              <button
                onClick={() => navigate({ page: "analytics" })}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                  route.page === "analytics" ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Analytics
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {apiUp === false && (
              <span className="hidden text-xs text-destructive sm:inline">API offline — run npm run dev</span>
            )}
            <Button size="sm" onClick={() => navigate({ page: "launch" })}>
              <Plus className="size-4" aria-hidden />
              Launch token
            </Button>
            <AccountArea />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        {route.page === "analytics" ? (
          <Analytics />
        ) : route.page === "terms" ? (
          <Terms />
        ) : route.page === "token" ? (
          <Token address={route.address} onBack={goExplore} />
        ) : route.page === "launch" ? (
          <Launch
            onLaunched={(token) => navigate({ page: "token", address: token })}
            onCancel={goExplore}
          />
        ) : (
          <Explore onSelect={(address) => navigate({ page: "token", address })} />
        )}
      </main>

      <Footer />
      {!accepted && route.page !== "terms" && <DisclaimerGate onAccept={() => setAccepted(true)} />}
      <MfaGate />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
