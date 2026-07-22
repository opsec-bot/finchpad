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
    return (
      <div className="panel" style={{ margin: 40 }}>
        <strong className="warn">VITE_PRIVY_APP_ID is not set.</strong>
        <p className="dim">Add it to web/.env.local, then restart the dev server.</p>
      </div>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain],
        appearance: { theme: "dark", accentColor: "#ffb84d", logo: undefined },
        // Give people who have no wallet a way in — the whole point of creator onboarding.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        loginMethods: ["wallet", "email", "google", "github"],
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
