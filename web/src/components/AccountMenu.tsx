import { useEffect, useRef, useState } from "react";
import { usePrivy, useLinkAccount, useMfaEnrollment } from "@privy-io/react-auth";
import { BadgeDollarSign, Copy, EyeOff, LogOut, Settings, User, Users, type LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ReferralsModal } from "@/components/ReferralsModal";
import { ProfileSetup } from "@/components/ProfileSetup";
import { ClaimCenter } from "@/components/ClaimCenter";
import { useActiveWallet } from "@/components/Wallet";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/api";
import { navigateTo } from "@/lib/nav";
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
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  // undefined = not fetched yet (wallet still initializing / request in flight); null = the
  // server said there is no profile. The distinction matters: acting on "undefined" as if it
  // were "no profile" made "Your profile" open the setup modal during the load race.
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  // Load the profile for this wallet; first signup (no profile yet) auto-opens the username
  // prompt once per session — skippable, and always reachable later via "Your profile".
  useEffect(() => {
    if (!wallet) return setProfile(undefined);
    let alive = true;
    api.profileByAddress(wallet.address).then(({ profile: p }) => {
      if (!alive) return;
      setProfile(p ?? null);
      if (!p && !sessionStorage.getItem("finchpad:profile-prompted")) {
        sessionStorage.setItem("finchpad:profile-prompted", "1");
        setSetupOpen(true);
      }
    }).catch(() => {
      /* leave undefined — the click handler re-fetches rather than assuming no profile */
    });
    return () => {
      alive = false;
    };
  }, [wallet?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Your profile" resolves the truth at click time — never trusts possibly-stale state.
  async function openProfile() {
    if (profile) return navigateTo(`/profile/${profile.username}`);
    if (!wallet) return;
    try {
      const { profile: p } = await api.profileByAddress(wallet.address);
      setProfile(p ?? null);
      if (p) return navigateTo(`/profile/${p.username}`);
    } catch {
      /* fall through to setup — the modal's availability check will surface API trouble */
    }
    setSetupOpen(true);
  }

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
          {profile?.avatar && <AvatarImage src={profile.avatar} alt="" className="object-cover" />}
          <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">{initials}</AvatarFallback>
        </Avatar>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl"
          role="menu"
        >
          <MenuItem
            icon={User}
            label="Your profile"
            onClick={() => {
              setOpen(false);
              void openProfile();
            }}
          />
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
          <MenuItem icon={BadgeDollarSign} label="Claim creator fees" onClick={() => (setOpen(false), setClaimsOpen(true))} />
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

      <ReferralsModal open={referralsOpen} onClose={() => setReferralsOpen(false)} username={profile?.username} />
      <ClaimCenter open={claimsOpen} onClose={() => setClaimsOpen(false)} />
      <ProfileSetup
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        existing={profile ?? null}
        onSaved={({ username }) => {
          if (wallet) api.profileByAddress(wallet.address).then(({ profile: p }) => setProfile(p)).catch(() => {});
          navigateTo(`/profile/${username}`);
        }}
      />
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
