import * as THREE from 'three';
import { RIG, type ClipKey, type ResolvedClips } from './rig';

const FADE = 0.25;

/**
 * Per-avatar animation: one mixer, one action per clip, cross-fades between
 * them, plus two code-driven overlays applied after the mixer each frame —
 * typing (forearm/hand oscillation on the seated clip) and carrying (arms
 * held forward on the walk clip). Both overlays are placeholders for real
 * clips and are listed in PLACEHOLDERS.md.
 */
export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipKey, THREE.AnimationAction>();
  private current: ClipKey | null = null;
  private readonly bones: Partial<Record<keyof typeof RIG.bones, THREE.Bone>> = {};
  private readonly rest: Partial<Record<keyof typeof RIG.bones, THREE.Quaternion>> = {};
  /** 0..1 blend of the typing overlay. */
  typing = 0;
  /** 0..1 blend of the carry overlay. */
  carry = 0;
  /** Per-avatar phase so groups never gesture in lockstep. */
  phase = 0;
  private time = 0;

  constructor(
    readonly root: THREE.Object3D,
    readonly resolved: ResolvedClips,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [key, clip] of Object.entries(resolved.clips) as Array<[ClipKey, THREE.AnimationClip]>) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(key, action);
    }
    for (const [key, name] of Object.entries(RIG.bones) as Array<[keyof typeof RIG.bones, string]>) {
      const bone = root.getObjectByName(name);
      if (bone instanceof THREE.Bone) {
        this.bones[key] = bone;
        this.rest[key] = bone.quaternion.clone();
      }
    }
  }

  has(key: ClipKey): boolean {
    return this.actions.has(key);
  }

  get playing(): ClipKey | null {
    return this.current;
  }

  /** Cross-fade to a looping clip. Missing clips fall back to idle; the avatar shows a MISSING badge for them. */
  play(key: ClipKey, opts: { fade?: number; timeScale?: number; once?: boolean; startAt?: number } = {}): void {
    const wanted = this.actions.has(key) ? key : 'idle';
    const next = this.actions.get(wanted);
    if (!next) return;
    if (this.current === wanted && !opts.once) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset();
    next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    next.clampWhenFinished = Boolean(opts.once);
    next.timeScale = opts.timeScale ?? 1;
    if (opts.startAt !== undefined) next.time = opts.startAt;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, opts.fade ?? FADE, true);
    }
    this.current = wanted;
  }

  /** Play a one-shot clip, then return to `then`. */
  playOnce(key: ClipKey, then: ClipKey, onDone?: () => void): void {
    const action = this.actions.get(key);
    if (!action) {
      this.play(then);
      onDone?.();
      return;
    }
    this.play(key, { once: true });
    const handler = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return;
      this.mixer.removeEventListener('finished', handler);
      // A newer state may have taken over mid-clip; never override it.
      if (this.current === key) this.play(then);
      onDone?.();
    };
    this.mixer.addEventListener('finished', handler);
  }

  update(dt: number): void {
    this.time += dt;
    this.mixer.update(dt);
    if (this.typing > 0.001) this.applyTyping(this.typing);
    if (this.carry > 0.001) this.applyCarry(this.carry);
  }

  /**
   * Aim a bone so that its child lies along `desired` (avatar-local frame,
   * +Z forward, +X the avatar's left, +Y up), blended by `w`. Axis-agnostic:
   * it never assumes which local axis the rig's bones run along.
   */
  private aim(bone: THREE.Bone | undefined, child: THREE.Bone | undefined, desired: THREE.Vector3, w: number): void {
    if (!bone || !child || w <= 0) return;
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(this.worldQ);
    this.root.getWorldQuaternion(this.rootQ);
    this.curDir.copy(child.position).applyQuaternion(this.worldQ).normalize();
    this.desDir.copy(desired).normalize().applyQuaternion(this.rootQ);
    this.delta.setFromUnitVectors(this.curDir, this.desDir);
    // parentWorld = world * local⁻¹ ; newLocal = parentWorld⁻¹ * (delta * world)
    this.parentQ.copy(this.worldQ).multiply(this.invQ.copy(bone.quaternion).invert());
    this.targetQ.copy(this.delta).multiply(this.worldQ).premultiply(this.parentQ.invert());
    bone.quaternion.slerp(this.targetQ, w);
  }

  private readonly worldQ = new THREE.Quaternion();
  private readonly rootQ = new THREE.Quaternion();
  private readonly parentQ = new THREE.Quaternion();
  private readonly invQ = new THREE.Quaternion();
  private readonly targetQ = new THREE.Quaternion();
  private readonly delta = new THREE.Quaternion();
  private readonly curDir = new THREE.Vector3();
  private readonly desDir = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  /** Upper arms down and a little forward, forearms onto the keyboard, hands bobbing alternately. */
  private applyTyping(w: number): void {
    const t = this.time * 7.5 + this.phase;
    const { upperArmL, upperArmR, lowerArmL, lowerArmR, handL, handR } = this.bones;
    this.aim(upperArmL, lowerArmL, this.v.set(-0.12, -0.8, 0.58), w);
    this.aim(upperArmR, lowerArmR, this.v.set(0.12, -0.8, 0.58), w);
    const bobL = 0.1 * Math.sin(t);
    const bobR = 0.1 * Math.sin(t + Math.PI * 0.7);
    this.aim(lowerArmL, handL, this.v.set(-0.1, -0.22 + bobL, 0.97), w);
    this.aim(lowerArmR, handR, this.v.set(0.1, -0.22 + bobR, 0.97), w);
  }

  /** Arms forward and down, forearms up and inward, as if holding a folder against the chest. */
  private applyCarry(w: number): void {
    const { upperArmL, upperArmR, lowerArmL, lowerArmR, handL, handR } = this.bones;
    this.aim(upperArmL, lowerArmL, this.v.set(-0.15, -0.7, 0.7), w);
    this.aim(upperArmR, lowerArmR, this.v.set(0.15, -0.7, 0.7), w);
    this.aim(lowerArmL, handL, this.v.set(-0.7, 0.3, 0.65), w);
    this.aim(lowerArmR, handR, this.v.set(0.7, 0.3, 0.65), w);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
