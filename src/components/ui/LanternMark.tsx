/**
 * The app mark: a sky lantern, released. Built for small sizes — the
 * silhouette is what stays readable down to 16px, and the flame is the only
 * accent, so nothing competes with it.
 *
 * The two fills are the ONE deliberate exception to the no-hex rule in src/.
 * They are brand identity, not theme: this mark also ships as the favicon and
 * the app icon, where no CSS variable of ours reaches, and an identity that
 * shifts between the app and the browser tab is not an identity. Navy #002147
 * is Imperial's core navy; Tangerine #EB7300 is its supporting orange.
 *
 * Specifically NOT `--escalate`: the light theme darkens its amber to #9A5200
 * for contrast on white, which is the right call for a due-soon chip and the
 * wrong one for the flame — it is the only accent carrying the mark at 16px,
 * and it must match the generated icons under public/ exactly.
 */
export function LanternMark({
  className,
  title,
}: {
  className?: string;
  /** Omit when the mark sits beside the wordmark; pass a description when it
   *  stands alone and carries the meaning itself. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 52"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d="M8 14 Q8 2 32 2 Q56 2 56 14 L48 44 L16 44 Z" fill="#002147" />
      <rect x="16" y="44" width="32" height="4" rx="1" fill="#002147" />
      <path d="M32 30 Q26 38 32 42 Q38 38 32 30 Z" fill="#EB7300" />
    </svg>
  );
}
