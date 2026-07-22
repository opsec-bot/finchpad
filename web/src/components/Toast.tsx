import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type Kind = "info" | "success" | "error" | "pending";
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
  href?: string;
}

interface ToastApi {
  push: (t: Omit<Toast, "id">) => number;
  update: (id: number, t: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast outside ToastProvider");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((cur) => [...cur, { ...t, id }]);
      // Pending toasts stay until the caller resolves them; the rest self-dismiss.
      if (t.kind !== "pending") setTimeout(() => dismiss(id), t.kind === "error" ? 12000 : 7000);
      return id;
    },
    [dismiss],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      if (patch.kind && patch.kind !== "pending") setTimeout(() => dismiss(id), patch.kind === "error" ? 12000 : 7000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            <div className="toast-title">
              {t.kind === "pending" && <span className="spinner" />}
              {t.title}
            </div>
            {t.body && <div className="toast-body">{t.body}</div>}
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                view transaction
              </a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
