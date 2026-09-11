// Canvas-texture sprites for always-on labels (B-4: never drei/Html for these).
import * as THREE from 'three';

export interface TextSpriteOptions {
  fontSize?: number;
  color?: string;
  background?: string;
  accent?: string;
  /** World height of the sprite in metres. */
  height?: number;
  mono?: boolean;
  padding?: number;
}

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Draws `text` into a canvas and returns a texture plus its aspect ratio. */
export function makeTextTexture(text: string, opts: TextSpriteOptions = {}): { texture: THREE.CanvasTexture; aspect: number } {
  const fontSize = opts.fontSize ?? 44;
  const padding = opts.padding ?? 22;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const font = `600 ${fontSize}px ${opts.mono ? MONO : SANS}`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width + padding * 2 + (opts.accent ? 14 : 0));
  const h = Math.ceil(fontSize * 1.45 + padding);
  canvas.width = Math.max(2, w);
  canvas.height = Math.max(2, h);
  ctx.font = font;
  if (opts.background) {
    ctx.fillStyle = opts.background;
    const r = 12;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, r);
    ctx.fill();
  }
  if (opts.accent) {
    ctx.fillStyle = opts.accent;
    ctx.fillRect(0, 0, 8, canvas.height);
  }
  ctx.fillStyle = opts.color ?? '#E9EEF5';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding + (opts.accent ? 10 : 0), canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, aspect: canvas.width / canvas.height };
}

export function makeTextSprite(text: string, opts: TextSpriteOptions = {}): THREE.Sprite {
  const { texture, aspect } = makeTextTexture(text, opts);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  const height = opts.height ?? 0.9;
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
}
