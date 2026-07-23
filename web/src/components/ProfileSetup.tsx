import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import LogoPicker from "@/components/LogoPicker";
import { useActiveWallet } from "@/components/Wallet";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/api";
import { getWalletClient } from "@/lib/tx";

// Mirrors src/backend/users.js — same charset story told to the user before the server says no.
const USERNAME_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** sha-256 hex of the canonical payload — must match the backend's profileMessage exactly. */
async function payloadDigest(p: { username: string; name: string; bio: string; avatar: string }) {
  const canonical = JSON.stringify({ username: p.username, name: p.name, bio: p.bio, avatar: p.avatar });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create/edit the user's profile. The update is authorized by a wallet signature over the
 * payload hash — no session, nothing to steal. Username is the permanent URL identity
 * (unique, strict charset); name/bio/avatar are freeform.
 */
export function ProfileSetup({
  open,
  onClose,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  existing: Profile | null;
  onSaved: (p: { username: string }) => void;
}) {
  const wallet = useActiveWallet();
  const suggested = wallet ? `user_${wallet.address.slice(-6).toLowerCase()}` : "";
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [check, setCheck] = useState<{ available: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsername(existing?.username ?? suggested);
    setName(existing?.name ?? "");
    setBio(existing?.bio ?? "");
    setAvatar(existing?.avatar ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const localProblem = useMemo(() => {
    if (!username) return "pick a username";
    // eslint-disable-next-line no-control-regex
    if (/[^\x21-\x7e]/.test(username)) return "plain characters only — no unicode or styled letters";
    if (username.length < 3 || username.length > 20) return "3–20 characters";
    if (!USERNAME_RE.test(username)) return "lowercase letters + numbers; underscores only between them";
    return null;
  }, [username]);

  // Debounced availability check against the server (which is the real authority).
  useEffect(() => {
    setCheck(null);
    if (localProblem || !wallet) return;
    const t = setTimeout(() => {
      api.usernameCheck(username, wallet.address).then(setCheck).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [username, localProblem, wallet]);

  async function save() {
    if (!wallet) return;
    setBusy(true);
    try {
      const payload = { username, name: name.trim(), bio: bio.trim(), avatar };
      const timestamp = Date.now();
      const digest = await payloadDigest(payload);
      const message = `finchpad profile update v1\naddress: ${wallet.address.toLowerCase()}\npayload: ${digest}\ntime: ${timestamp}`;
      const client = await getWalletClient(wallet);
      const signature = await client.signMessage({ account: wallet.address as Address, message });
      await api.saveProfile({ address: wallet.address, payload, timestamp, signature });
      toast.success(existing ? "Profile updated" : `Welcome, @${username}`);
      onSaved({ username });
      onClose();
    } catch (e) {
      toast.error("Could not save profile", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const canSave = !busy && !localProblem && (check?.available ?? false) && Boolean(wallet);

  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit profile" : "Set up your profile"}>
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">Profile picture</Label>
          <LogoPicker value={avatar} onChange={setAvatar} hint="shown on your profile and next to your trades" />
        </div>

        <div>
          <Label htmlFor="pf-username" className="mb-1.5 block text-xs text-muted-foreground">
            Username <span className="opacity-70">— unique, permanent URL identity</span>
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
            <Input
              id="pf-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="pl-7 font-mono"
              maxLength={20}
              disabled={busy}
            />
          </div>
          <p className="mt-1 text-xs">
            {localProblem ? (
              <span className="text-muted-foreground">{localProblem}</span>
            ) : check === null ? (
              <span className="text-muted-foreground">checking…</span>
            ) : check.available ? (
              <span className="text-primary">@{username} is available</span>
            ) : (
              <span className="text-destructive">{check.reason === "taken" ? "already taken" : check.reason}</span>
            )}
          </p>
        </div>

        <div>
          <Label htmlFor="pf-name" className="mb-1.5 block text-xs text-muted-foreground">
            Name <span className="opacity-70">— display name, anything you like</span>
          </Label>
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} disabled={busy} />
        </div>

        <div>
          <Label htmlFor="pf-bio" className="mb-1.5 block text-xs text-muted-foreground">
            Bio
          </Label>
          <textarea
            id="pf-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 280))}
            rows={3}
            disabled={busy}
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="mt-0.5 text-right text-xs text-muted-foreground tnum">{bio.length}/280</p>
        </div>

        <Button onClick={save} disabled={!canSave} size="lg">
          {busy ? "Signing…" : existing ? "Save changes" : "Claim username"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Saving asks your wallet for one signature — it proves you own this address, costs no gas.
        </p>
      </div>
    </Modal>
  );
}
