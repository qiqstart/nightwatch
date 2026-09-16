import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BANDS,
  DEFAULT_BAND,
  TUNE_MAX,
  TUNE_MIN,
  formatMhz,
  freqKhz,
  roomIdFor,
  toneHz,
} from "@/lib/morse/bands";
import { MorseDecoder } from "@/lib/morse/decoder";
import { MORSE } from "@/lib/morse/alphabet";
import { getRadio } from "@/lib/morse/audio";
import { HAPTIC } from "@/lib/morse/haptics";
import type { EtherPeer } from "@/lib/multiplayer/ether";
import { CodeCard } from "./CodeCard";
import { Knob } from "./Knob";
import { NetSession } from "./NetSession";
import { StraightKey } from "./StraightKey";

const TAPE_MAX = 72;

interface RadioSetProps {
  rig?: string;
  compact?: boolean;
  armed?: boolean;
  split?: boolean;
  onArm?: () => void;
  onToggleSplit?: () => void;
}

interface Settings {
  band: number;
  tune: number;
  vol: number;
  tone: number;
}

interface Occupancy {
  freqKhz: number;
  count: number;
}

function randomCall(): string {
  const L = () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)]!;
  return `${L()}${Math.floor(Math.random() * 10)}${L()}${L()}${L()}`;
}

function storageKeys(rig: string) {
  const suffix = rig === "a" ? "" : `.${rig}`;
  return {
    call: `nightwatch.callsign${suffix}`,
    settings: `nightwatch.settings${suffix}`,
  };
}

function loadSettings(key: string): Settings {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("none");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      band: clampInt(parsed.band ?? DEFAULT_BAND, 0, BANDS.length - 1),
      tune: clampInt(parsed.tune ?? 0, TUNE_MIN, TUNE_MAX),
      vol: clampInt(parsed.vol ?? 7, 0, 10),
      tone: clampInt(parsed.tone ?? 5, 0, 10),
    };
  } catch {
    return { band: DEFAULT_BAND, tune: 0, vol: 7, tone: 5 };
  }
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function appendTape(prev: string, ch: string) {
  const next = (prev + ch).slice(-TAPE_MAX);
  return next;
}

export function RadioSet({
  rig = "a",
  compact = false,
  armed = true,
  split = false,
  onArm,
  onToggleSplit,
}: RadioSetProps) {
  const [hydrated, setHydrated] = useState(false);
  const [powered, setPowered] = useState(false);
  const [warming, setWarming] = useState(false);
  const [callsign, setCallsign] = useState("N0NW");
  const [editingCall, setEditingCall] = useState(false);
  const [band, setBand] = useState(DEFAULT_BAND);
  const [tune, setTune] = useState(0);
  const [vol, setVol] = useState(7);
  const [tone, setTone] = useState(5);
  const [keyed, setKeyed] = useState(false);
  const [txTape, setTxTape] = useState("");
  const [rxTape, setRxTape] = useState("");
  const [txPending, setTxPending] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [peers, setPeers] = useState<EtherPeer[]>([]);
  const [occupancy, setOccupancy] = useState<Occupancy[]>([]);
  const [receiving, setReceiving] = useState(false);
  const [sMeter, setSMeter] = useState(0);
  const [skyUp, setSkyUp] = useState(false);

  const keys = storageKeys(rig);
  const radioRef = useRef(getRadio(rig));
  const localDecoder = useRef<MorseDecoder | null>(null);
  const remoteDecoders = useRef(new Map<string, MorseDecoder>());
  const remoteKeyed = useRef(new Map<string, number>());
  const keyedRef = useRef(false);
  const spaceHeld = useRef(false);
  const cqBusy = useRef(false);

  const khz = freqKhz(band, tune);
  const room = roomIdFor(khz);
  const mhz = formatMhz(khz);
  const bandName = BANDS[band]?.name ?? "40m";

  useEffect(() => {
    const savedCall = localStorage.getItem(keys.call);
    setCallsign(savedCall && savedCall.length >= 3 ? savedCall : randomCall());
    const settings = loadSettings(keys.settings);
    setBand(settings.band);
    setTune(settings.tune);
    setVol(settings.vol);
    setTone(settings.tone);
    setHydrated(true);
  }, [keys.call, keys.settings]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(keys.settings, JSON.stringify({ band, tune, vol, tone }));
  }, [band, tune, vol, tone, hydrated, keys.settings]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(keys.call, callsign);
  }, [callsign, hydrated, keys.call]);

  useEffect(() => {
    localDecoder.current = new MorseDecoder((ch) => setTxTape((prev) => appendTape(prev, ch)));
  }, []);

  const onTxPending = useCallback((code: string) => setTxPending(code), []);
  useEffect(() => {
    const decoder = localDecoder.current;
    if (!decoder) return;
    const id = window.setInterval(() => {
      decoder.tick(performance.now());
      onTxPending(decoder.pending());
    }, 40);
    return () => window.clearInterval(id);
  }, [onTxPending]);

  useEffect(() => {
    if (!powered) return;
    const radio = radioRef.current;
    radio.setVolume(vol / 10);
    radio.setTone(toneHz(tone));
  }, [powered, vol, tone]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && powered) radioRef.current.resume();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [powered]);

  const commitCall = (value: string) => {
    const next = value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    setCallsign(next.length >= 3 ? next : randomCall());
    setEditingCall(false);
  };

  const powerOn = () => {
    const radio = radioRef.current;
    radio.unlock();
    radio.playPowerOn();
    radio.setVolume(vol / 10);
    radio.setTone(toneHz(tone));
    HAPTIC.power();
    setWarming(true);
    setPowered(true);
    window.setTimeout(() => setWarming(false), 700);
  };

  const powerOff = () => {
    radioRef.current.muteAll();
    radioRef.current.setLocalKeyed(false);
    setKeyed(false);
    keyedRef.current = false;
    setPowered(false);
    setWarming(false);
    setPeers([]);
    setReceiving(false);
    setSMeter(0);
    remoteKeyed.current.clear();
  };

  const togglePower = () => {
    if (powered) powerOff();
    else powerOn();
  };

  const keyDown = useCallback(() => {
    if (!powered || keyedRef.current) return;
    keyedRef.current = true;
    setKeyed(true);
    const now = performance.now();
    radioRef.current.setLocalKeyed(true);
    radioRef.current.playThump();
    HAPTIC.keyDown();
    localDecoder.current?.onKeyDown(now);
  }, [powered]);

  const keyUp = useCallback(() => {
    if (!keyedRef.current) return;
    keyedRef.current = false;
    setKeyed(false);
    const now = performance.now();
    radioRef.current.setLocalKeyed(false);
    HAPTIC.keyUp();
    localDecoder.current?.onKeyUp(now);
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!armed) return;
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.repeat) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      spaceHeld.current = true;
      keyDown();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (!spaceHeld.current) return;
      event.preventDefault();
      spaceHeld.current = false;
      keyUp();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", keyUp);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", keyUp);
    };
  }, [keyDown, keyUp, armed]);

  const sendCq = useCallback(async () => {
    if (!powered || cqBusy.current) return;
    onArm?.();
    cqBusy.current = true;
    const unit = 90;
    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const element = async (sym: string) => {
      keyDown();
      await sleep(sym === "." ? unit : unit * 3);
      keyUp();
      await sleep(unit);
    };
    try {
      for (const ch of "CQ") {
        const code = MORSE[ch] ?? "";
        for (const sym of code) await element(sym);
        await sleep(unit * 2);
      }
    } finally {
      keyUp();
      cqBusy.current = false;
    }
  }, [keyDown, keyUp, onArm, powered]);

  const onPeers = useCallback((next: EtherPeer[]) => setPeers(next), []);
  const onSky = useCallback((up: boolean) => setSkyUp(up), []);

  const onRemoteKey = useCallback((from: string, name: string, down: boolean) => {
    const radio = radioRef.current;
    if (down) {
      const already = remoteKeyed.current.has(from);
      remoteKeyed.current.set(from, performance.now());
      setReceiving(true);
      if (already) return;
      let decoder = remoteDecoders.current.get(from);
      if (!decoder) {
        let burst = false;
        decoder = new MorseDecoder((ch) => {
          setRxTape((prev) => {
            if (ch === " ") {
              burst = false;
              return appendTape(prev, " ");
            }
            if (!burst) {
              burst = true;
              const pad = prev && !prev.endsWith(" ") ? " " : "";
              return appendTape(`${prev}${pad}${name}:`, ch);
            }
            return appendTape(prev, ch);
          });
        });
        remoteDecoders.current.set(from, decoder);
      }
      decoder.onKeyDown(performance.now());
      radio.setRemoteKeyed(from, true);
      return;
    }
    if (remoteKeyed.current.has(from)) {
      remoteDecoders.current.get(from)?.onKeyUp(performance.now());
    }
    remoteKeyed.current.delete(from);
    radio.setRemoteKeyed(from, false);
    setReceiving(remoteKeyed.current.size > 0);
  }, []);

  const onRemoteGone = useCallback((from: string) => {
    radioRef.current.dropRemote(from);
    remoteKeyed.current.delete(from);
    remoteDecoders.current.delete(from);
    setReceiving(remoteKeyed.current.size > 0);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now();
      for (const [peer, at] of remoteKeyed.current) {
        if (now - at > 900) {
          radioRef.current.setRemoteKeyed(peer, false);
          remoteDecoders.current.get(peer)?.onKeyUp(now);
          remoteKeyed.current.delete(peer);
          setReceiving(remoteKeyed.current.size > 0);
        }
      }
      for (const decoder of remoteDecoders.current.values()) decoder.tick(now);
      const live = remoteKeyed.current.size;
      const next = keyedRef.current ? 7 : live ? 6 : peers.length ? 1 : 0;
      setSMeter((prev) => (prev === next ? prev : next));
    }, 50);
    return () => window.clearInterval(id);
  }, [peers.length]);

  useEffect(() => {
    if (!powered) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/nets", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { nets?: Occupancy[] };
        if (!cancelled) setOccupancy(body.nets ?? []);
      } catch {
        /* occupancy is advisory */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [powered]);

  const occupied = useMemo(() => new Set(occupancy.map((n) => n.freqKhz)), [occupancy]);
  const bandTicks = BANDS.map((b) =>
    occupancy.some((n) => {
      const onBand = Math.abs(n.freqKhz - b.baseKhz) <= TUNE_MAX;
      if (!onBand) return false;
      return n.freqKhz !== khz || n.count > 1;
    }),
  );
  const tuneTicks = Array.from({ length: TUNE_MAX - TUNE_MIN + 1 }, (_, i) => {
    const f = freqKhz(band, TUNE_MIN + i);
    if (f === khz) return peers.length > 0;
    return occupied.has(f);
  });

  const others = peers;
  const netLabel = !powered
    ? "STANDBY"
    : others.length
      ? `${others.length} ON FREQ`
      : skyUp
        ? "WORLD"
        : "LOCAL";

  const onBand = (v: number) => {
    if (v !== band) {
      HAPTIC.detent();
      if (powered) radioRef.current.playClick();
    }
    setBand(v);
    setTxTape("");
    setRxTape("");
    localDecoder.current?.reset();
  };
  const onTune = (v: number) => {
    if (v !== tune) {
      HAPTIC.detent();
      if (powered) radioRef.current.playClick();
    }
    setTune(v);
    setTxTape("");
    setRxTape("");
    localDecoder.current?.reset();
  };
  const onVol = (v: number) => {
    if (v !== vol) HAPTIC.detent();
    setVol(v);
  };
  const onTone = (v: number) => {
    if (v !== tone) HAPTIC.detent();
    setTone(v);
  };

  return (
    <div
      className={`radio ${powered ? "is-on" : "is-off"} ${warming ? "is-warming" : ""} ${compact ? "is-compact" : ""} ${armed ? "is-armed" : ""}`}
      onPointerDown={() => {
        onArm?.();
        if (powered) radioRef.current.resume();
      }}
    >
      {powered && hydrated ? (
        <NetSession
          key={`${room}:${callsign}`}
          room={room}
          name={callsign}
          keyed={keyed}
          onPeers={onPeers}
          onRemoteKey={onRemoteKey}
          onRemoteGone={onRemoteGone}
          onSky={onSky}
        />
      ) : null}

        <header className="radio-head">
          <div className="wordmark">
            <p className="wordmark-kicker">FIELD SET · MK II</p>
            <h1>NIGHTWATCH</h1>
          </div>
          <div className="head-right">
            {editingCall ? (
              <input
                className="call-input"
                autoFocus
                defaultValue={callsign}
                maxLength={8}
                aria-label="Callsign"
                onBlur={(e) => commitCall(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCall((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setEditingCall(false);
                }}
              />
            ) : (
              <button type="button" className="call-plate" onClick={() => setEditingCall(true)}>
                {callsign}
              </button>
            )}
            <button
              type="button"
              className={`power-rocker ${powered ? "is-on" : ""}`}
              aria-pressed={powered}
              aria-label={powered ? "Power off" : "Power on"}
              onClick={togglePower}
            >
              <span>PWR</span>
              <i />
            </button>
          </div>
        </header>

        <section className={`crt ${receiving ? "is-rx" : ""}`} aria-live="polite">
          <div className="crt-glass">
            <p className="crt-freq">
              <span>{mhz}</span>
              <small>MHz</small>
            </p>
            <div className="crt-meta">
              <span>{bandName} CW</span>
              <span className="s-meter" aria-label={`Signal ${sMeter}`}>
                {Array.from({ length: 9 }, (_, i) => (
                  <i key={i} className={i < sMeter ? "is-lit" : ""} />
                ))}
              </span>
              <span>{netLabel}</span>
            </div>
          </div>
          <div className="jewels">
            <span className={`jewel jewel-pwr ${powered ? "is-on" : ""}`}>PWR</span>
            <span className={`jewel jewel-tx ${keyed ? "is-on" : ""}`}>TX</span>
            <span className={`jewel jewel-rx ${receiving ? "is-on" : ""}`}>RX</span>
            <span className={`jewel jewel-net ${others.length ? "is-on" : ""}`}>NET</span>
            <span className={`jewel jewel-sky ${skyUp ? "is-on" : ""}`} title={skyUp ? "World net up" : "World net down"}>
              SKY
            </span>
          </div>
        </section>

        <div className="panel">
          <CodeCard open={codeOpen} onClose={() => setCodeOpen(false)} />
          <section className="knob-deck">
          <Knob
            label="BAND"
            readout={bandName}
            value={band}
            min={0}
            max={BANDS.length - 1}
            onChange={onBand}
            ticks={bandTicks}
          />
          <Knob
            label="TUNE"
            readout={`${tune >= 0 ? "+" : ""}${tune} kHz`}
            value={tune}
            min={TUNE_MIN}
            max={TUNE_MAX}
            onChange={onTune}
            ticks={tuneTicks}
          />
        </section>
        <section className="knob-deck knob-deck-sm">
          <Knob
            label="AF GAIN"
            readout={String(vol)}
            value={vol}
            min={0}
            max={10}
            onChange={onVol}
            size="sm"
            disabled={!powered}
          />
          <Knob
            label="TONE"
            readout={`${toneHz(tone)} Hz`}
            value={tone}
            min={0}
            max={10}
            onChange={onTone}
            size="sm"
            disabled={!powered}
          />
        </section>

        <section className="tape" aria-label="Decoded Morse">
          <p>
            <span>RX</span>
            <code>{rxTape || (powered ? "—" : "OFF")}</code>
          </p>
          <p>
            <span>TX</span>
            <code>
              {txTape}
              <em>{txPending.replace(/\./g, "·").replace(/-/g, "–")}</em>
            </code>
          </p>
        </section>
        </div>

        <div className="key-well">
          <StraightKey down={keyed} disabled={!powered} onDown={keyDown} onUp={keyUp} />
        </div>

        <footer className="radio-foot">
          <button type="button" className="plate-btn" onClick={() => setCodeOpen((o) => !o)}>
            {codeOpen ? "HIDE CARD" : "CODE CARD"}
          </button>
          <button
            type="button"
            className="plate-btn"
            disabled={!powered}
            onClick={() => void sendCq()}
          >
            CQ
          </button>
          {onToggleSplit ? (
            <button type="button" className="plate-btn" onClick={onToggleSplit}>
              {split ? "ONE SET" : "SPLIT"}
            </button>
          ) : null}
          <p className="peer-line">
            {others.length
              ? `${others.map((p) => p.name).join(" · ")}${skyUp ? "" : " · local"}`
              : split
                ? powered
                  ? "Power both. Tap CQ on one."
                  : "Flip PWR on this set"
                : powered
                  ? skyUp
                    ? `World net up on ${mhz} — HTTPS`
                    : "World net down — same Wi‑Fi only"
                  : "Flip power. Pick a frequency. Key the lever."}
          </p>
        </footer>
    </div>
  );
}
