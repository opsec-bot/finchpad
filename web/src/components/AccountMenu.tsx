import { useEffect, useRef, useState } from "react";
import { usePrivy, useLinkAccount, useMfaEnrollment } from "@privy-io/react-auth";
import { Copy, EyeOff, LogOut, Settings, User, Users, type LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ReferralsModal } from "@/components/ReferralsModal";
import { useActiveWallet } from "@/components/Wallet";
import { useBlurBalances } from "@/lib/blurBalances";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/**
 * The account dropdown behind the avatar, modelled on fomo's: Your profile / Manage account /
 * Blur balances (a toggle) / Referrals / Log out. Profiles and Referrals are stubbed with a
 * "coming soon" toast until those features land; the rest are live.
 */
export function AccountMenu() {
  const { user, logout, exportWallet } = usePrivy();
  const { linkEmail, linkWallet } = useLinkAccount();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const wallet = useActiveWallet();
  const { blurred, toggle } = useBlurBalances();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [referralsOpen, setReferralsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const email = user?.email?.address;
  const initials = (email ?? wallet?.address?.slice(2) ?? "?").slice(0, 2).toUpperCase();
  const isEmbedded = wallet?.walletClientType === "privy";
  const accounts = user?.linkedAccounts ?? [];
  const hasEmail = accounts.some((a) => a.type === "email");
  const hasWallet = accounts.some((a) => a.type === "wallet");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full ring-1 ring-border/80 transition hover:ring-primary/60"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">{initials}</AvatarFallback>
        </Avatar>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl"
          role="menu"
        >
          <MenuItem icon={User} label="Your profile" onClick={() => (setOpen(false), toast("Profiles are coming soon."))} />
          <MenuItem icon={Settings} label="Manage account" onClick={() => (setOpen(false), setManageOpen(true))} />
          <button
            role="menuitemcheckbox"
            aria-checked={blurred}
            onClick={toggle}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-muted"
          >
            <EyeOff className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-left">Blur balances</span>
            <Switch on={blurred} />
          </button>
          <MenuItem icon={Users} label="Referrals" onClick={() => (setOpen(false), setReferralsOpen(true))} />
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={LogOut} label="Log out" destructive onClick={() => (setOpen(false), logout())} />
        </div>
      )}

      <Modal open={manageOpen} onClose={() => setManageOpen(false)} title="Manage account">
        <div className="flex flex-col gap-4 text-sm">
          {wallet && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Wallet</div>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(wallet.address).then(() => toast("Address copied"));
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs transition-colors hover:bg-muted"
                title={wallet.address}
              >
                <span>{short(wallet.address)}</span>
                <Copy className="size-3.5 text-muted-foreground" aria-hidden />
              </button>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs text-muted-foreground">Linked accounts</div>
            <ul className="flex flex-col gap-1">
              {user?.linkedAccounts?.length ? (
                user.linkedAccounts.map((a, i) => {
                  // linkedAccounts is a wide union (wallet, email, oauth providers…); read the
                  // few display fields loosely rather than narrow every variant.
                  const acc = a as { type: string; address?: string; email?: string; username?: string };
                  const detail = acc.address ? short(acc.address) : acc.email || acc.username || "";
                  return (
                    <li key={i} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-xs">
                      <span className="capitalize text-muted-foreground">{a.type.replace(/_/g, " ")}</span>
                      <span className="font-mono">{detail}</span>
                    </li>
                  );
                })
              ) : (
                <li className="text-xs text-muted-foreground">None linked yet.</li>
              )}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            {!hasEmail && (
              <Button size="sm" variant="secondary" onClick={() => linkEmail()}>
                Link email
              </Button>
            )}
            {!hasWallet && (
              <Button size="sm" variant="secondary" onClick={() => linkWallet()}>
                Link wallet
              </Button>
            )}
            {isEmbedded && (
              <Button size="sm" variant="secondary" onClick={() => exportWallet()}>
                Export wallet
              </Button>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-muted-foreground">Security</div>
            <Button size="sm" variant="secondary" onClick={() => showMfaEnrollmentModal()}>
              Manage two-factor auth
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Required to confirm trades. Verify once, then trade for an hour without re-prompting.
            </p>
          </div>
        </div>
      </Modal>

      <ReferralsModal open={referralsOpen} onClose={() => setReferralsOpen(false)} />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-muted",
        destructive && "text-destructive hover:text-destructive",
      )}
    >
      <Icon className={cn("size-4", destructive ? "text-destructive" : "text-muted-foreground")} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-background shadow transition-transform",
          on ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </span>
  );
}
