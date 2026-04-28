/** Sliding-window instantaneous WPM from correct keystrokes only. */

export class WpmCalculator {
  private timestamps: number[] = [];

  constructor(private readonly windowSize: number) {}

  recordCorrect(now: number = performance.now()): void {
    this.timestamps.push(now);
    while (this.timestamps.length > this.windowSize) {
      this.timestamps.shift();
    }
  }

  undoLastCorrect(): void {
    this.timestamps.pop();
  }

  reset(): void {
    this.timestamps = [];
  }

  /**
   * Raw WPM from window: (k/5) / (deltaMinutes). Null if not enough signal.
   */
  getInstantWpm(): number | null {
    const ts = this.timestamps;
    if (ts.length < 2) return null;
    const first = ts[0]!;
    const last = ts[ts.length - 1]!;
    const dtMs = last - first;
    if (dtMs <= 0) return null;
    const k = ts.length;
    return (k / 5) / (dtMs / 60_000);
  }

  /** Value for meter bar mapping (0–120 display cap). */
  getMeterWpm(displayCap = 120): number | null {
    const w = this.getInstantWpm();
    if (w === null) return null;
    return Math.min(w, displayCap);
  }
}
