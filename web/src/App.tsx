import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/Wallet";
import Explore from "@/routes/Explore";
import Launch from "@/routes/Launch";
import Token from "@/routes/Token";
import { api } from "@/lib/api";

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

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <button
            className="lift group flex items-center gap-2.5"
            onClick={() => {
              setTab("explore");
              setSelected(null);
            }}
          >
            <img
              src="/logo.svg"
              alt=""
              width={32}
              height={32}
              className="rounded-lg transition-[filter] duration-300 group-hover:glow-primary"
            />
            <span className="text-lg font-bold tracking-tight">finchpad</span>
          </button>

          <nav className="ml-2 hidden items-center gap-1 sm:flex">
            <Button
              variant={tab === "explore" && !selected ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setTab("explore");
                setSelected(null);
              }}
            >
              Explore
            </Button>
            <Button variant={tab === "launch" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("launch")}>
              Launch
            </Button>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {apiUp === false && (
              <span className="hidden text-xs text-destructive sm:inline">API offline — run npm run dev</span>
            )}
            <WalletButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {tab === "explore" ? (
          selected ? (
            <Token address={selected} onBack={() => setSelected(null)} />
          ) : (
            <Explore onSelect={setSelected} />
          )
        ) : (
          <div className="mx-auto max-w-2xl">
            <Launch
              onLaunched={(token) => {
                setSelected(token);
                setTab("explore");
              }}
            />
          </div>
        )}
      </main>

      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
