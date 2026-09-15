import { useEffect, useRef } from "react";
import { HOLD_MS, useEther, type EtherPeer, type KeyWire } from "@/lib/multiplayer/ether";

interface NetSessionProps {
  room: string;
  name: string;
  keyed: boolean;
  onPeers: (peers: EtherPeer[]) => void;
  onRemoteKey: (from: string, name: string, down: boolean) => void;
  onRemoteGone: (from: string) => void;
  onSky: (up: boolean) => void;
}

export function NetSession({
  room,
  name,
  keyed,
  onPeers,
  onRemoteKey,
  onRemoteGone,
  onSky,
}: NetSessionProps) {
  const ether = useEther({ room, name });
  const keyedRef = useRef(keyed);
  keyedRef.current = keyed;
  const downAt = useRef(0);
  const everKeyed = useRef(false);
  const seen = useRef(new Set<string>());
  const pendingUp = useRef(new Map<string, number>());
  const lastDownAt = useRef(new Map<string, number>());

  useEffect(() => {
    onSky(ether.skyUp);
  }, [ether.skyUp, onSky]);

  useEffect(() => {
    onPeers(ether.peers);
    const live = new Set(ether.peers.map((p) => p.id));
    for (const id of seen.current) {
      if (!live.has(id)) onRemoteGone(id);
    }
    seen.current = live;
  }, [onPeers, onRemoteGone, ether.peers]);

  useEffect(() => {
    return () => {
      for (const id of seen.current) onRemoteGone(id);
      seen.current = new Set();
      onPeers([]);
    };
  }, [onPeers, onRemoteGone]);

  useEffect(() => {
    return ether.onMark((mark) => {
      const call = mark.name || mark.from;
      const cancelUp = () => {
        const timer = pendingUp.current.get(mark.from);
        if (timer) {
          window.clearTimeout(timer);
          pendingUp.current.delete(mark.from);
        }
      };
      if (mark.down) {
        cancelUp();
        lastDownAt.current.set(mark.from, performance.now());
        onRemoteKey(mark.from, call, true);
        return;
      }
      if (mark.hold) {
        cancelUp();
        onRemoteKey(mark.from, call, true);
        return;
      }
      const started = lastDownAt.current.get(mark.from);
      lastDownAt.current.delete(mark.from);
      const age = started ? performance.now() - started : Infinity;
      const release = () => {
        pendingUp.current.delete(mark.from);
        onRemoteKey(mark.from, call, false);
      };
      if (age < 90) {
        const playMs = Math.min(Math.max(mark.dur, 28), 1400);
        cancelUp();
        const timer = window.setTimeout(release, playMs);
        pendingUp.current.set(mark.from, timer);
        return;
      }
      cancelUp();
      release();
    });
  }, [onRemoteKey, ether.onMark]);

  useEffect(() => {
    if (keyed) {
      everKeyed.current = true;
      downAt.current = performance.now();
      ether.sendKey({ t: "key", down: true } satisfies KeyWire);
      return;
    }
    if (!everKeyed.current) return;
    const dur = downAt.current ? Math.max(0, Math.round(performance.now() - downAt.current)) : 0;
    downAt.current = 0;
    ether.sendKey({ t: "key", down: false, dur } satisfies KeyWire);
  }, [keyed, ether.sendKey]);

  useEffect(() => {
    if (!keyed) return;
    const id = window.setInterval(() => {
      if (keyedRef.current) ether.sendKey({ t: "hold" } satisfies KeyWire);
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, [keyed, ether.sendKey]);

  return null;
}
