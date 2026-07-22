import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * One presentation for every token image, everywhere.
 *
 * Creator artwork is arbitrary — different aspect ratios, transparency, wildly different
 * brightness — so a list that renders it raw looks like a jumble. Fixing the frame (square,
 * cover-cropped, same radius and ring) is what makes a feed of unrelated tokens read as one
 * product. Tokens with no image get a deterministic monogram rather than a broken frame.
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
      {src ? <AvatarImage src={src} alt="" className="object-cover" /> : null}
      <AvatarFallback className="rounded-xl bg-secondary text-secondary-foreground font-semibold">
        {symbol.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
