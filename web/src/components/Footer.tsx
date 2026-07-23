import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXTwitter, faTelegram, faGithub } from "@fortawesome/free-brands-svg-icons";

/** Site footer: socials (both @finchpad) and the standing risk note. */
export default function Footer() {
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row md:px-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <img src="/logo.svg" alt="" className="size-5 rounded" />
          <span className="font-medium text-foreground">finchpad</span>
          <span className="hidden sm:inline">· unaudited, use at your own risk</span>
        </div>

        <div className="flex items-center gap-1">
          <a
            href="https://x.com/finchpad"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="finchpad on X"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FontAwesomeIcon icon={faXTwitter} className="size-4" />
          </a>
          <a
            href="https://t.me/finchpad"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="finchpad on Telegram"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FontAwesomeIcon icon={faTelegram} className="size-4" />
          </a>
          <a
            href="https://github.com/finchpad"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="finchpad on GitHub"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FontAwesomeIcon icon={faGithub} className="size-4" />
          </a>
          <a href="/terms" className="ml-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
            Terms
          </a>
        </div>
      </div>
    </footer>
  );
}
