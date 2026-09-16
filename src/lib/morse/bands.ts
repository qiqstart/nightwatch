export interface Band {
  id: string;
  name: string;
  /** Calling-frequency center, kHz. */
  baseKhz: number;
}

export const BANDS: Band[] = [
  { id: "160", name: "160m", baseKhz: 1812 },
  { id: "80", name: "80m", baseKhz: 3560 },
  { id: "40", name: "40m", baseKhz: 7030 },
  { id: "30", name: "30m", baseKhz: 10118 },
  { id: "20", name: "20m", baseKhz: 14060 },
  { id: "17", name: "17m", baseKhz: 18086 },
  { id: "15", name: "15m", baseKhz: 21060 },
  { id: "12", name: "12m", baseKhz: 24906 },
  { id: "10", name: "10m", baseKhz: 28060 },
];

export const DEFAULT_BAND = 2;
export const TUNE_MIN = -4;
export const TUNE_MAX = 4;

export function freqKhz(bandIndex: number, tune: number): number {
  const band = BANDS[Math.max(0, Math.min(BANDS.length - 1, bandIndex))];
  return band.baseKhz + tune;
}

export function formatMhz(khz: number): string {
  return (khz / 1000).toFixed(3);
}

export function roomIdFor(khz: number): string {
  return `nw${khz}`;
}

export function bandTuneForKhz(khz: number): { band: number; tune: number } | null {
  let best: { band: number; tune: number } | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < BANDS.length; i++) {
    const offset = khz - BANDS[i]!.baseKhz;
    if (offset < TUNE_MIN || offset > TUNE_MAX) continue;
    const dist = Math.abs(offset);
    if (dist < bestDist) {
      best = { band: i, tune: offset };
      bestDist = dist;
    }
  }
  return best;
}

/** `7030`, `7.030`, `nw7030` → a discrete calling frequency on the dial. */
export function parseChannelParam(raw: string | null | undefined): { band: number; tune: number } | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/^nw/, "").replace(/mhz$|khz$/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const khz = n > 0 && n < 50 ? Math.round(n * 1000) : Math.round(n);
  return bandTuneForKhz(khz);
}

export function syncLink(khz: number): string {
  const url = new URL(window.location.href);
  url.searchParams.set("c", String(khz));
  url.hash = "";
  return url.toString();
}

export function toneHz(toneKnob: number): number {
  return 420 + toneKnob * 48;
}
