import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import App from "./App";
import { BlurBalancesProvider } from "./lib/blurBalances";
import { robinhoodChain } from "./lib/chain";
import "./styles.css";

// The app ID is a public identifier and is meant to ship in the bundle. The app SECRET is
// backend-only and must never appear here — finchpad's backend does not use it at all.
const appId = import.meta.env.VITE_PRIVY_APP_ID;

function Root() {
  if (!appId) {
    // VITE_* values are inlined at BUILD time, so a running server never picks up a change
    // to .env on its own — say that plainly rather than "restart the server".
    return (
      <div className="panel" style={{ margin: 40 }}>
        <strong className="warn">VITE_PRIVY_APP_ID is not set in this build.</strong>
        <p className="dim">
          Set it in the repo-root <code>.env</code> (see <code>.env.example</code>), then rebuild —
          Vite bakes <code>VITE_*</code> values into the bundle at build time, so restarting the API
          alone will not pick it up:
        </p>
        <pre className="review">
          npm run web:build   # then reload http://localhost:8787{"\n"}
          npm run web:dev     # or use the dev server on :5173 for live reload
        </pre>
      </div>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain],
        appearance: { theme: "dark", accentColor: "#7CB4B4", logo: "/logo.svg" },
        // Email + Google only, by design: finchpad is embedded-wallet-only so trading volume
        // stays in-app (see TODOS, "one-click … embedded-wallet only"). No external-wallet or
        // GitHub login. Signup creates an embedded wallet for the new user.
        //
        // showWalletUIs:false gives one-click trading — it suppresses Privy's per-transaction
        // confirmation modal for the embedded wallet. We keep our own pre-trade review
        // (TradePanel) and launch review as the "what am I signing" surface, and MFA
        // (MfaGate + dashboard MFA-for-transactions) still gates transactions.
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: false,
        },
        loginMethods: ["email", "google"],
      }}
    >
      <BlurBalancesProvider>
        <App />
      </BlurBalancesProvider>
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
