import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// A privacy toggle, à la fomo's "blur balances": lets someone stream or screenshot the app
// without doxxing their own figures. Persisted so the choice survives a reload. It only ever
// blurs the viewer's OWN money (wallet balance, positions) — never public token market data.

type Ctx = { blurred: boolean; toggle: () => void };
const BlurContext = createContext<Ctx>({ blurred: false, toggle: () => {} });
const KEY = "finchpad:blur-balances";

export function BlurBalancesProvider({ children }: { children: ReactNode }) {
  const [blurred, setBlurred] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, blurred ? "1" : "0");
    } catch {
      /* private mode / storage disabled — the toggle still works for the session */
    }
  }, [blurred]);
  return <BlurContext.Provider value={{ blurred, toggle: () => setBlurred((b) => !b) }}>{children}</BlurContext.Provider>;
}

export const useBlurBalances = () => useContext(BlurContext);

/** Wrap a sensitive figure so it blurs out when the viewer has hidden their balances. */
export function Balance({ children, className }: { children: ReactNode; className?: string }) {
  const { blurred } = useBlurBalances();
  return <span className={cn(blurred && "select-none blur-sm", className)}>{children}</span>;
}
