import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
// Imported (not a /public path) so Vite bundles it under /assets/ with a hashed name — the
// backend serves only /assets/*, so a public-folder URL would 404 in production.
import tokenPlaceholder from "@/assets/brand/token-placeholder.png";

// Default artwork for tokens that ship no logo of their own — the finchpad mascot, so a
// logo-less token still reads as one of ours rather than a broken frame.
const TOKEN_PLACEHOLDER = tokenPlaceholder;

/**
 * One presentation for every token image, everywhere.
 *
 * Creator artwork is arbitrary — different aspect ratios, transparency, wildly different
 * brightness — so a list that renders it raw looks like a jumble. Fixing the frame (square,
 * cover-cropped, same radius and ring) is what makes a feed of unrelated tokens read as one
 * product. Tokens with no image fall back to the mascot placeholder, and to a deterministic
 * monogram only if even that fails to load.
 */
export default function TokenAvatar({
  src,
  symbol,
  size = "md",
  className,
}: {
  src?: string | null;
  symbol: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = size === "lg" ? "size-14" : size === "sm" ? "size-8" : "size-10";
  return (
    <Avatar className={cn(dims, "rounded-xl ring-1 ring-border/80 shrink-0", className)}>
      <AvatarImage src={src || TOKEN_PLACEHOLDER} alt="" className="object-cover" />
      <AvatarFallback className="rounded-xl bg-secondary text-secondary-foreground font-semibold">
        {symbol.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
