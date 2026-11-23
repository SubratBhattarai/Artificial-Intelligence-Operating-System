/**
 * Decides whether the person is talking over JARVIS. Echo cancellation lowers JARVIS's own voice in the
 * microphone, so this only fires on clearly louder, sustained speech — not a cough or a short noise.
 */
export interface BargeInOptions {
  /** RMS level (0..1) that counts as someone speaking over the assistant. */
  level?: number;
  /** How long it must be sustained. */
  sustainMs?: number;
  /** Brief dips below the level that do not reset the count. */
  gapMs?: number;
}

export class BargeInDetector {
  private readonly level: number;
  private readonly sustainMs: number;
  private readonly gapMs: number;
  private loudMs = 0;
  private quietMs = 0;

  constructor(options: BargeInOptions = {}) {
    this.level = options.level ?? 0.07;
    this.sustainMs = options.sustainMs ?? 400;
    this.gapMs = options.gapMs ?? 150;
  }

  /** Feed one audio chunk's RMS level and its length. Returns true once the person is interrupting. */
  push(rmsLevel: number, chunkMs: number): boolean {
    if (rmsLevel >= this.level) {
      this.loudMs += chunkMs;
      this.quietMs = 0;
    } else {
      this.quietMs += chunkMs;
      if (this.quietMs > this.gapMs) this.loudMs = 0;
    }
    if (this.loudMs >= this.sustainMs) {
      this.reset();
      return true;
    }
    return false;
  }

  reset(): void {
    this.loudMs = 0;
    this.quietMs = 0;
  }
}
