import { useMfa, useMfaEnrollment, useRegisterMfaListener } from "@privy-io/react-auth";
import { toast } from "sonner";

/**
 * Completes Privy's transaction MFA challenge. Because we disable wallet UIs for one-click
 * trading (`showWalletUIs:false`, see main.tsx), Privy no longer auto-shows its MFA prompt — so
 * when a transaction requires a second factor (dashboard "MFA for transactions", cached ~1h),
 * Privy calls `onMfaRequired` and we drive the challenge ourselves via `useMfa`.
 *
 * Renders nothing: `promptMfa()` shows Privy's own built-in verification UI. If the user has no
 * factor enrolled yet, we route them into enrollment instead so the transaction isn't a dead end.
 *
 * Must stay mounted wherever a transaction can be triggered — rendered once in <App/>.
 */
export function MfaGate() {
  const { init, promptMfa } = useMfa();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  useRegisterMfaListener({
    // Privy invokes this whenever a transaction needs a second factor. The callback is
    // synchronous (`=> void`), so kick off the async challenge in a fire-and-forget IIFE.
    onMfaRequired: ({ mfaMethods }) => {
      void (async () => {
        try {
          if (!mfaMethods || mfaMethods.length === 0) {
            toast("Set up two-factor authentication to confirm transactions.");
            showMfaEnrollmentModal();
            return;
          }
          await init(mfaMethods[0]);
          await promptMfa();
        } catch {
          // Cancelled or failed verification — Privy rejects the pending transaction, and the
          // trade/launch flow surfaces the rejection through its own error toast.
        }
      })();
    },
  });

  return null;
}
