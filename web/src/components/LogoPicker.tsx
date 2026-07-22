import { useRef, useState } from "react";

const MAX_INPUT_BYTES = 5 * 1024 * 1024; // reject huge files before decoding them
const SIDE = 128; // token logos render small; 128px square is plenty
const TARGET_BYTES = 24 * 1024; // keep the encoded result modest

/**
 * Token image as a file, not a URL.
 *
 * A pasted link rots — the token stores the string forever while whatever it points at can be
 * deleted or swapped for something else after launch. The file is decoded, cropped square and
 * downscaled in the browser, so what goes on-chain is small and fixed.
 *
 * Where the bytes ultimately live is still an open decision (IPFS pin vs. a finchpad upload
 * endpoint). Until that exists this produces a data URI, which is self-contained and cannot
 * rot, but costs real gas at launch — so it is capped hard and the cost is stated plainly.
 */
export default function LogoPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setErr(null);
    if (!file.type.startsWith("image/")) return setErr("That is not an image file.");
    if (file.size > MAX_INPUT_BYTES) return setErr("Image is larger than 5 MB. Pick a smaller one.");

    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      // Centre-crop to a square so logos are never stretched.
      const side = Math.min(bitmap.width, bitmap.height);
      const sx = (bitmap.width - side) / 2;
      const sy = (bitmap.height - side) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = SIDE;
      canvas.height = SIDE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIDE, SIDE);
      bitmap.close();

      // Step quality down until it fits; webp first, png as the fallback for older engines.
      let out = "";
      for (const q of [0.85, 0.7, 0.55, 0.4]) {
        out = canvas.toDataURL("image/webp", q);
        if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/png");
        if (out.length * 0.75 <= TARGET_BYTES) break;
      }
      if (out.length * 0.75 > TARGET_BYTES) {
        setErr("Could not compress this image enough. Try a simpler or flatter image.");
        return;
      }
      onChange(out);
    } catch {
      setErr("Could not read that image.");
    } finally {
      setBusy(false);
    }
  }

  const approxKb = value ? Math.round((value.length * 0.75) / 1024) : 0;

  return (
    <div>
      <div className="logo-row">
        <div className="logo-preview">
          {value ? <img src={value} alt="token" /> : <span className="dim">no image</span>}
        </div>
        <div>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
              e.target.value = "";
            }}
          />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "processing…" : value ? "replace image" : "choose image"}
          </button>
          {value && (
            <button type="button" onClick={() => onChange("")} style={{ marginLeft: 6 }}>
              remove
            </button>
          )}
          <p className="dim" style={{ marginTop: 6, marginBottom: 0 }}>
            {value
              ? `cropped square, 128px, ~${approxKb} KB stored on-chain with the token`
              : "png, jpeg, webp or gif. Cropped square and downscaled in your browser."}
          </p>
        </div>
      </div>
      {err && <p className="warn">{err}</p>}
    </div>
  );
}
