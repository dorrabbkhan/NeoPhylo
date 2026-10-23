// The brand wordmark (v1.3 spec §5): "NeoPhylo" in Inter 600 at text
// color, with the owner-chosen mark at its left. The icon is the
// canonical web/public/brand/icon.svg file — the same asset the
// favicons, PWA icons and og-image are generated from — so the
// wordmark can never drift from a redrawn copy.

export function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className={`wordmark wordmark-${size}`}>
      <img src={`${import.meta.env.BASE_URL}brand/icon.svg`} alt="" />
      <span className="wordmark-text">NeoPhylo</span>
    </span>
  );
}
