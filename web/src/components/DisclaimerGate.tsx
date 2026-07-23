import { useState } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "finchpad:disclaimer-v1";

export function disclaimerAccepted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * First-visit gate: the site is unaudited and tokens are third-party — the user must
 * acknowledge that before anything else. Deliberately NOT dismissible by Esc or clicking
 * outside; the only way through is the checkbox + Continue. Versioned key so a materially
 * changed disclaimer re-prompts everyone.
 */
export function DisclaimerGate({ onAccept }: { onAccept: () => void }) {
  const [agreed, setAgreed] = useState(false);

  function accept() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode — gate simply shows again next visit */
    }
    onAccept();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <ShieldAlert className="size-5" aria-hidden />
          </span>
          <h2 className="display text-lg font-semibold">Before you continue</h2>
        </div>

        <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            finchpad is <strong className="text-foreground">unaudited, open-source software</strong>. Tokens here are
            created by third parties — we don't vet, audit, or endorse any of them.
          </p>
          <p>
            Crypto is extremely volatile and most tokens go to zero. Nothing here is financial advice. You use this
            site entirely at your own risk and are responsible for the security of your own wallet.
          </p>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="leading-snug">
            I have read and agree to the{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noopener"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
            >
              Terms &amp; Disclaimers
            </a>
            , and I understand this is unaudited, high-risk software.
          </span>
        </label>

        <Button className="mt-4 w-full" size="lg" disabled={!agreed} onClick={accept}>
          Continue
        </Button>
      </div>
    </div>,
    document.body,
  );
}
