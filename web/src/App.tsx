import { useEffect, useState } from "react";
import { WalletButton } from "./components/Wallet";
import Explore from "./routes/Explore";
import Launch from "./routes/Launch";
import { api } from "./lib/api";

type Tab = "explore" | "launch";

export default function App() {
  const [tab, setTab] = useState<Tab>("explore");
  const [selected, setSelected] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("connecting");

  useEffect(() => {
    api
      .health()
      .then((h) => setHealth(`api ok · factory ${h.factory.slice(0, 6)}…`))
      .catch(() => setHealth("api down — run: npm run api"));
  }, []);

  return (
    <>
      <header>
        <h1>finchpad</h1>
        <span className="dim">launchpad on Robinhood Chain (4663)</span>
        <nav>
          <button onClick={() => setTab("explore")} disabled={tab === "explore"}>
            explore
          </button>
          <button onClick={() => setTab("launch")} disabled={tab === "launch"}>
            launch
          </button>
        </nav>
        <span className="spacer" />
        <span className="dim">{health}</span>
        <WalletButton />
      </header>

      {tab === "explore" ? (
        <Explore selected={selected} onSelect={setSelected} />
      ) : (
        <div style={{ padding: "16px 20px", maxWidth: 780 }}>
          <Launch
            onLaunched={(token) => {
              setSelected(token);
              setTab("explore");
            }}
          />
        </div>
      )}
    </>
  );
}
