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

export function toneHz(toneKnob: number): number {
  return 420 + toneKnob * 48;
}
