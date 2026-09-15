/**
 * Frequency net. Same Nightwatch copy talks through /api/rtc. Off-network
 * copies also share a world relay (MQTT plus an HTTPS/WSS bus on port 443)
 * so two phones on different Wi‑Fi still hear each other.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MqttBus } from "@/lib/morse/mqtt";
import { NtfyBus } from "@/lib/morse/ntfy";

export interface EtherPeer {
  id: string;
  name: string;
}

export interface CwMark {
  id: number;
  from: string;
  name: string;
  down: boolean;
  hold: boolean;
  dur: number;
}

interface PollBody {
  peers?: EtherPeer[];
  marks?: CwMark[];
}

interface SkyMsg {
  t: "hello" | "cw";
  from: string;
  name: string;
  down?: boolean;
  hold?: boolean;
  dur?: number;
  mid?: string;
}

const POLL_MS = 90;
const HOLD_MS = 180;
const HELLO_MS = 2500;
const RELAY_HELLO_MS = 8000;
const PEER_TTL_MS = 8000;
const MQTT_URLS = [
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://broker.emqx.io:8084/mqtt",
];

export type KeyWire = { t: "key"; down: boolean; dur?: number } | { t: "hold" };

export function useEther(options: { room: string; name: string }): {
  selfId: string;
  peers: EtherPeer[];
  skyUp: boolean;
  sendKey: (msg: KeyWire) => void;
  onMark: (fn: (mark: CwMark) => void) => () => void;
} {
  const [selfId] = useState(() => `p-${Math.random().toString(36).slice(2, 10)}`);
  const [room] = useState(() => options.room);
  const [name] = useState(() => options.name);
  const [peers, setPeers] = useState<EtherPeer[]>([]);
  const [skyUp, setSkyUp] = useState(false);
  const cwCursor = useRef(0);
  const closed = useRef(false);
  const listeners = useRef(new Set<(mark: CwMark) => void>());
  const mqttRef = useRef<MqttBus | null>(null);
  const ntfyRef = useRef<NtfyBus | null>(null);
  const mqttUp = useRef(false);
  const ntfyUp = useRef(false);
  const localPeers = useRef<EtherPeer[]>([]);
  const skyPeers = useRef(new Map<string, { name: string; at: number }>());
  const seenMid = useRef(new Set<string>());
  const lastHit = useRef(new Map<string, number>());
  const seq = useRef(1);

  const emitPeers = useCallback(() => {
    const now = Date.now();
    const merged = new Map<string, string>();
    for (const p of localPeers.current) merged.set(p.id, p.name);
    for (const [id, p] of skyPeers.current) {
      if (now - p.at > PEER_TTL_MS) skyPeers.current.delete(id);
      else merged.set(id, p.name);
    }
    merged.delete(selfId);
    const next = [...merged].map(([id, peerName]) => ({ id, name: peerName }));
    setPeers((prev) => {
      if (
        prev.length === next.length &&
        prev.every((p, i) => p.id === next[i]?.id && p.name === next[i]?.name)
      ) {
        return prev;
      }
      return next;
    });
  }, [selfId]);

  const ingest = useCallback(
    (mark: CwMark, mid?: string) => {
      if (mark.from === selfId) return;
      if (mid) {
        if (seenMid.current.has(mid)) return;
        seenMid.current.add(mid);
        if (seenMid.current.size > 400) {
          const first = seenMid.current.values().next().value as string | undefined;
          if (first) seenMid.current.delete(first);
        }
      }
      const sig = `${mark.from}:${mark.down ? 1 : 0}:${mark.hold ? 1 : 0}`;
      const now = Date.now();
      const prev = lastHit.current.get(sig) ?? 0;
      if (now - prev < 80) return;
      lastHit.current.set(sig, now);
      skyPeers.current.set(mark.from, { name: mark.name || mark.from, at: now });
      emitPeers();
      for (const fn of listeners.current) fn(mark);
    },
    [emitPeers, selfId],
  );

  const postCw = useCallback(
    (body: { down: boolean; hold?: boolean; dur?: number }) => {
      void fetch("/api/rtc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "cw",
          room,
          from: selfId,
          name,
          down: body.down,
          hold: Boolean(body.hold),
          dur: Math.max(0, Math.round(body.dur ?? 0)),
        }),
        keepalive: true,
      }).catch(() => {});
    },
    [name, room, selfId],
  );

  const sendSky = useCallback((msg: SkyMsg, via: "all" | "mqtt" | "relay" = "all") => {
    const body = JSON.stringify(msg);
    if (via !== "relay") mqttRef.current?.send(body);
    if (via !== "mqtt") ntfyRef.current?.send(body);
  }, []);

  const bumpSky = useCallback(() => {
    setSkyUp(mqttUp.current || ntfyUp.current);
  }, []);

  const onSkyText = useCallback(
    (text: string) => {
      let msg: SkyMsg;
      try {
        msg = JSON.parse(text) as SkyMsg;
      } catch {
        return;
      }
      if (!msg || msg.from === selfId) return;
      if (msg.t === "hello") {
        skyPeers.current.set(msg.from, { name: msg.name || msg.from, at: Date.now() });
        emitPeers();
        return;
      }
      if (msg.t === "cw") {
        ingest(
          {
            id: seq.current++,
            from: msg.from,
            name: msg.name || msg.from,
            down: Boolean(msg.down),
            hold: Boolean(msg.hold),
            dur: Number(msg.dur) || 0,
          },
          msg.mid,
        );
      }
    },
    [emitPeers, ingest, selfId],
  );

  useEffect(() => {
    closed.current = false;
    mqttUp.current = false;
    ntfyUp.current = false;
    setSkyUp(false);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let helloTimer: ReturnType<typeof setInterval> | null = null;
    let relayHello: ReturnType<typeof setInterval> | null = null;

    const mqtt = new MqttBus({
      urls: MQTT_URLS,
      clientId: selfId,
      topic: `nightwatch/cw/${room}`,
      onReady: (up) => {
        mqttUp.current = up;
        bumpSky();
        if (up) sendSky({ t: "hello", from: selfId, name }, "mqtt");
      },
      onMessage: onSkyText,
    });
    const ntfy = new NtfyBus({
      topic: `nightwatch-cw-${room}`,
      onReady: (up) => {
        ntfyUp.current = up;
        bumpSky();
        if (up) sendSky({ t: "hello", from: selfId, name }, "relay");
      },
      onMessage: onSkyText,
    });
    mqttRef.current = mqtt;
    ntfyRef.current = ntfy;
    mqtt.start();
    ntfy.start();

    const poll = async () => {
      if (closed.current) return;
      try {
        const params = new URLSearchParams({
          room,
          peer: selfId,
          name,
          since: "0",
          cw: String(cwCursor.current),
        });
        const res = await fetch(`/api/rtc?${params}`, { cache: "no-store" });
        if (!res.ok || closed.current) return;
        const body = (await res.json()) as PollBody;
        if (closed.current) return;
        localPeers.current = (body.peers ?? []).filter((p) => p.id !== selfId);
        emitPeers();
        for (const mark of body.marks ?? []) {
          cwCursor.current = Math.max(cwCursor.current, mark.id);
          ingest(mark, `l-${mark.id}`);
        }
      } catch {
        /* next poll retries */
      } finally {
        if (!closed.current) timer = setTimeout(() => void poll(), POLL_MS);
      }
    };

    void poll();
    helloTimer = setInterval(() => {
      sendSky({ t: "hello", from: selfId, name }, "mqtt");
      emitPeers();
    }, HELLO_MS);
    relayHello = setInterval(() => {
      sendSky({ t: "hello", from: selfId, name }, "relay");
    }, RELAY_HELLO_MS);

    return () => {
      closed.current = true;
      if (timer) clearTimeout(timer);
      if (helloTimer) clearInterval(helloTimer);
      if (relayHello) clearInterval(relayHello);
      mqtt.stop();
      ntfy.stop();
      mqttRef.current = null;
      ntfyRef.current = null;
      void fetch("/api/rtc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "leave", room, peer: selfId }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [bumpSky, emitPeers, ingest, name, onSkyText, room, selfId, sendSky]);

  const sendKey = useCallback(
    (msg: KeyWire) => {
      const down = msg.t === "hold" ? true : msg.down;
      const hold = msg.t === "hold";
      const dur = msg.t === "key" ? (msg.dur ?? 0) : 0;
      const mid = `${selfId}-${seq.current++}`;
      const sky: SkyMsg = { t: "cw", from: selfId, name, down, hold, dur, mid };
      sendSky(sky, hold ? "mqtt" : "all");
      postCw({ down, hold, dur });
    },
    [name, postCw, selfId, sendSky],
  );

  const onMark = useCallback((fn: (mark: CwMark) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return { selfId, peers, skyUp, sendKey, onMark };
}

export { HOLD_MS };
