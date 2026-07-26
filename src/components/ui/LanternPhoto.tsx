import { useState } from 'react';
import { LanternMark } from './LanternMark';

/**
 * The owner's own photograph: himself as a first-year undergraduate, releasing
 * a sky lantern. Releasing a lantern means sending hopes as high as they will
 * go, and this app exists to help chase that one — which is why the photograph
 * is the logo rather than a graphic derived from it.
 *
 * The photograph is the asset. It is never cropped to isolate the lantern,
 * recoloured, filtered, or regenerated: the subject is the release, both
 * figure and lantern, not the object.
 *
 * It lives at `src/lantern.png` — where the owner placed it, deliberately not
 * moved. The lookup goes through `import.meta.glob` rather than a plain import
 * because a plain `import '../../lantern.png'` FAILS THE BUILD outright if the
 * file is ever absent. The glob compiles to an empty object in that case and
 * resolves to the hashed asset URL when the file is present, so every surface
 * degrades to `LanternMark` instead of breaking the build. Verified both ways.
 *
 * Typed `string | undefined`: the glob genuinely yields nothing when the file
 * is missing, and every read below is guarded.
 */
const lanternPhoto: string | undefined = Object.values(
  import.meta.glob<string>('../../lantern.png', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
)[0];

/**
 * Renders the photograph, falling back to the mark.
 *
 * Only the image itself — each surface owns its own box, because the boxes
 * genuinely differ (a 40px bordered tile in the sidebar, a bare 28px square in
 * the mobile header, a 120px plate on the gate) and pushing that through props
 * would be a worse component than three local wrappers.
 *
 * THE PNG IS RGB WITH NO ALPHA, so its corners are square. Every caller masks
 * with a border radius on its own box; a hard rectangle on the light canvas
 * reads as an unstyled asset.
 *
 * `onError` covers the runtime case the glob cannot: the file was present at
 * build time but the hashed asset fails to load. The mark takes over then too.
 */
export function LanternPhoto({
  size,
  alt,
  className,
  markClassName,
  markTitle,
}: {
  /** Intrinsic width/height, so the box does not reflow while the image loads. */
  size: number;
  /** Describes the image, never the word "logo". */
  alt: string;
  className?: string;
  markClassName?: string;
  /** Passed to the fallback mark when it stands alone and carries the meaning. */
  markTitle?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!lanternPhoto || failed) {
    return <LanternMark className={markClassName} title={markTitle} />;
  }

  return (
    <img
      src={lanternPhoto}
      width={size}
      height={size}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The one description of the image, so the alt text cannot drift between the
 * three surfaces that render it.
 */
export const LANTERN_ALT =
  'A boy reaching up to release a glowing paper sky lantern into a starlit night sky';
