import { FROM_MORSE } from "./alphabet";

const MIN_UNIT = 45;
const MAX_UNIT = 200;

export class MorseDecoder {
  unitMs = 80;
  private buffer = "";
  private lastEdge = 0;
  private keyed = false;
  private needSpace = false;
  private onChar: (ch: string) => void;

  constructor(onChar: (ch: string) => void) {
    this.onChar = onChar;
  }

  reset() {
    this.buffer = "";
    this.lastEdge = 0;
    this.keyed = false;
    this.needSpace = false;
  }

  onKeyDown(t: number) {
    if (!this.keyed && this.lastEdge) {
      const gap = t - this.lastEdge;
      if (gap >= this.unitMs * 6.2) {
        this.flushChar();
        this.emit(" ");
        this.needSpace = false;
      } else if (gap >= this.unitMs * 2.4) {
        this.flushChar();
      }
    }
    this.keyed = true;
    this.lastEdge = t;
  }

  onKeyUp(t: number) {
    if (!this.keyed) return;
    const dur = Math.max(1, t - this.lastEdge);
    this.keyed = false;
    this.lastEdge = t;
    if (dur < this.unitMs * 2) {
      this.buffer += ".";
      this.adapt(dur);
    } else {
      this.buffer += "-";
      this.adapt(dur / 3);
    }
  }

  /** Call ~every frame so inter-character gaps flush without a next key. */
  tick(t: number) {
    if (this.keyed || !this.lastEdge) return;
    const gap = t - this.lastEdge;
    if (this.buffer && gap >= this.unitMs * 2.4) {
      this.flushChar();
    }
    if (this.needSpace && gap >= this.unitMs * 6.2) {
      this.emit(" ");
      this.needSpace = false;
    }
  }

  pending(): string {
    return this.buffer;
  }

  private adapt(observedUnit: number) {
    const next = this.unitMs * 0.72 + observedUnit * 0.28;
    this.unitMs = Math.min(MAX_UNIT, Math.max(MIN_UNIT, next));
  }

  private flushChar() {
    if (!this.buffer) return;
    const ch = FROM_MORSE[this.buffer];
    this.emit(ch ?? "�");
    this.buffer = "";
    this.needSpace = true;
  }

  private emit(ch: string) {
    this.onChar(ch);
  }
}
