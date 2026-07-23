import { useEffect, useState } from "react";
import { Feather, Plus } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { AccountArea } from "@/components/AccountArea";
import { MfaGate } from "@/components/MfaGate";
import Explore from "@/routes/Explore";
import Launch from "@/routes/Launch";
import Token from "@/routes/Token";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "explore" | "launch";

export default function App() {
  const [tab, setTab] = useState<Tab>("explore");
  const [selected, setSelected] = useState<string | null>(null);
  const [apiUp, setApiUp] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .health()
      .then(() => setApiUp(true))
      .catch(() => setApiUp(false));
  }, []);

  function goExplore() {
    setTab("explore");
    setSelected(null);
  }

  const onExplore = tab === "explore" && !selected;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-6">
            <button className="flex items-center gap-2" onClick={goExplore}>
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Feather className="size-4" aria-hidden />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">finchpad</span>
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
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {apiUp === false && (
              <span className="hidden text-xs text-destructive sm:inline">API offline — run npm run dev</span>
            )}
            <Button size="sm" onClick={() => setTab("launch")}>
              <Plus className="size-4" aria-hidden />
              Launch token
            </Button>
            <AccountArea />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        {tab === "explore" ? (
          selected ? (
            <Token address={selected} onBack={() => setSelected(null)} />
          ) : (
            <Explore onSelect={setSelected} />
          )
        ) : (
          <Launch
            onLaunched={(token) => {
              setSelected(token);
              setTab("explore");
            }}
            onCancel={goExplore}
          />
        )}
      </main>

      <MfaGate />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
