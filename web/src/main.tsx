import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import App from "./App";
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
        // Give people who have no wallet a way in — the whole point of creator onboarding.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        loginMethods: ["wallet", "email", "google", "github"],
        // Coinbase Smart Wallet does not support chain 4663, and offering it produces a
        // connector that can only fail. EOA connection to Coinbase Wallet still works.
        externalWallets: { coinbaseWallet: { config: { preference: { options: "eoaOnly" } } } },
      }}
    >
      <App />
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
