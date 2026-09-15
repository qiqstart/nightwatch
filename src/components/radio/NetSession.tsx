import { useEffect, useRef } from "react";
import { useP2PRoom, type PeerInfo } from "@/lib/multiplayer";

export type KeyWire = { t: "key"; down: boolean } | { t: "hold" };

interface NetSessionProps {
  room: string;
  name: string;
  keyed: boolean;
  onPeers: (peers: PeerInfo[]) => void;
  onRemoteKey: (from: string, name: string, down: boolean) => void;
  onRemoteGone: (from: string) => void;
}

const HOLD_MS = 180;

export function NetSession({
  room,
  name,
  keyed,
  onPeers,
  onRemoteKey,
  onRemoteGone,
}: NetSessionProps) {
  const p2p = useP2PRoom({ room, name });
  const keyedRef = useRef(keyed);
  keyedRef.current = keyed;
  const peersRef = useRef(p2p.peers);
  peersRef.current = p2p.peers;
  const seen = useRef(new Set<string>());

  useEffect(() => {
    onPeers(p2p.peers);
    const live = new Set(p2p.peers.map((p) => p.id));
    for (const id of seen.current) {
      if (!live.has(id)) onRemoteGone(id);
    }
    seen.current = live;
  }, [onPeers, onRemoteGone, p2p.peers]);

  useEffect(() => {
    return () => {
      for (const id of seen.current) onRemoteGone(id);
      seen.current = new Set();
      onPeers([]);
    };
  }, [onPeers, onRemoteGone]);

  useEffect(() => {
    return p2p.onMessage((from, data, channel) => {
      if (channel !== "reliable" && channel !== "state") return;
      const msg = data as KeyWire | null;
      if (!msg || typeof msg !== "object") return;
      const peer = peersRef.current.find((p) => p.id === from);
      const call = peer?.name || from;
      if (msg.t === "key") onRemoteKey(from, call, msg.down);
      else if (msg.t === "hold") onRemoteKey(from, call, true);
    });
  }, [onRemoteKey, p2p]);

  useEffect(() => {
    p2p.send({ t: "key", down: keyed } satisfies KeyWire);
  }, [keyed, p2p]);

  useEffect(() => {
    if (!keyed) return;
    const id = window.setInterval(() => {
      if (keyedRef.current) p2p.broadcast({ t: "hold" } satisfies KeyWire);
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, [keyed, p2p]);

  return null;
}
