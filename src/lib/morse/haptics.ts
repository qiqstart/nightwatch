/** Fire the vibration motor when the browser exposes it (Android; some PWAs). */
export function vibrate(ms: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    // iOS Safari throws or no-ops; audio thump covers the tactile gap.
  }
}

export const HAPTIC = {
  keyDown: () => vibrate(16),
  keyUp: () => vibrate(8),
  detent: () => vibrate(7),
  power: () => vibrate([12, 30, 24]),
} as const;
