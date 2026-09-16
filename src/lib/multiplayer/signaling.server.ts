/**
 * Frequency net: roster + CW marks (and leftover WebRTC signaling).
 * Keying is server-relayed so two phones on the same Nightwatch hear each
 * other — no hole-punch, no TURN. GET poll is join + inbox.
 */
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import type { PeerRow, RtcPollResponse, SignalRow } from "./p2p";

const ID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const signalSchema = z.object({
  op: z.literal("signal"),
  room: ID,
  from: ID,
  to: ID,
  kind: z.enum(["offer", "answer", "ice"]),
  payload: z.unknown().refine((v) => v !== undefined && JSON.stringify(v).length <= 32_768, {
    message: "payload too large",
  }),
});
const leaveSchema = z.object({ op: z.literal("leave"), room: ID, peer: ID });
const cwSchema = z.object({
  op: z.literal("cw"),
  room: ID,
  from: ID,
  name: z.string().max(64).default(""),
  down: z.boolean(),
  hold: z.boolean().optional().default(false),
  dur: z.number().int().min(0).max(8_000).optional().default(0),
});
const postSchema = z.discriminatedUnion("op", [signalSchema, leaveSchema, cwSchema]);

const PEER_TTL_SECONDS = 30;
const SIGNAL_TTL_SECONDS = 60;
const CW_TTL_SECONDS = 8;
const CW_LIVE_SECONDS = 2;

const globalRef = globalThis as typeof globalThis & {
  __rtcSchemaPromiseCw__?: Promise<void>;
};

function ensureSchema(sql: Sql): Promise<void> {
  globalRef.__rtcSchemaPromiseCw__ ??= (async () => {
    await sql.query(
      `CREATE TABLE IF NOT EXISTS webrtc_peers (
         room TEXT NOT NULL,
         peer_id TEXT NOT NULL,
         name TEXT NOT NULL DEFAULT '',
         last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (room, peer_id)
       )`,
    );
    await sql.query(
      `CREATE TABLE IF NOT EXISTS webrtc_signals (
         id BIGSERIAL PRIMARY KEY,
         room TEXT NOT NULL,
         to_peer TEXT NOT NULL,
         from_peer TEXT NOT NULL,
         kind TEXT NOT NULL,
         payload JSONB NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await sql.query(
      `CREATE INDEX IF NOT EXISTS webrtc_signals_inbox
         ON webrtc_signals (room, to_peer, id)`,
    );
    await sql.query(
      `CREATE TABLE IF NOT EXISTS cw_marks (
         id BIGSERIAL PRIMARY KEY,
         room TEXT NOT NULL,
         from_peer TEXT NOT NULL,
         name TEXT NOT NULL DEFAULT '',
         down BOOLEAN NOT NULL,
         hold BOOLEAN NOT NULL DEFAULT FALSE,
         dur_ms INTEGER NOT NULL DEFAULT 0,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await sql.query(
      `CREATE INDEX IF NOT EXISTS cw_marks_inbox
         ON cw_marks (room, id)`,
    );
  })().catch((err) => {
    globalRef.__rtcSchemaPromiseCw__ = undefined;
    throw err;
  });
  return globalRef.__rtcSchemaPromiseCw__;
}

async function roster(sql: Sql, room: string): Promise<PeerRow[]> {
  const rows = await sql.query<{ peer_id: string; name: string }>(
    `SELECT peer_id, name FROM webrtc_peers
     WHERE room = $1 AND last_seen > now() - make_interval(secs => $2)
     ORDER BY peer_id LIMIT 32`,
    [room, PEER_TTL_SECONDS],
  );
  return rows.map((r) => ({ id: r.peer_id, name: r.name }));
}

async function touchPeer(sql: Sql, room: string, peer: string, name: string) {
  await sql.query(
    `INSERT INTO webrtc_peers (room, peer_id, name, last_seen)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (room, peer_id)
     DO UPDATE SET last_seen = now(), name = EXCLUDED.name`,
    [room, peer, name],
  );
}

async function prune(sql: Sql) {
  await Promise.all([
    sql.query(`DELETE FROM webrtc_signals WHERE created_at < now() - make_interval(secs => $1)`, [
      SIGNAL_TTL_SECONDS,
    ]),
    sql.query(`DELETE FROM webrtc_peers WHERE last_seen < now() - make_interval(secs => $1)`, [
      PEER_TTL_SECONDS,
    ]),
    sql.query(`DELETE FROM cw_marks WHERE created_at < now() - make_interval(secs => $1)`, [
      CW_TTL_SECONDS,
    ]),
  ]);
}

function corsHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extra,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(),
  });
}

async function handleGet(url: URL): Promise<Response> {
  const parsed = z
    .object({
      room: ID,
      peer: ID,
      name: z.string().max(64).default(""),
      since: z.coerce.number().int().min(0).default(0),
      cw: z.coerce.number().int().min(0).default(0),
    })
    .safeParse({
      room: url.searchParams.get("room"),
      peer: url.searchParams.get("peer"),
      name: url.searchParams.get("name") ?? "",
      since: url.searchParams.get("since") ?? 0,
      cw: url.searchParams.get("cw") ?? 0,
    });
  if (!parsed.success) return json({ error: "invalid query" }, 400);
  const { room, peer, name, since, cw } = parsed.data;

  const sql = await getSql();
  await ensureSchema(sql);
  if (since === 0 || cw === 0 || Math.random() < 0.02) await prune(sql);
  const live = await roster(sql, room);
  const already = live.some((p) => p.id === peer);
  if (!already && live.length >= 8) {
    return json({ error: "channel full", peers: live, signals: [], marks: [] }, 409);
  }
  await touchPeer(sql, room, peer, name);
  const rows = await sql.query<{
    id: number;
    from_peer: string;
    kind: SignalRow["kind"];
    payload: unknown;
  }>(
    `SELECT id, from_peer, kind, payload FROM webrtc_signals
     WHERE room = $1 AND to_peer = $2 AND id > $3
     ORDER BY id LIMIT 200`,
    [room, peer, since],
  );
  const markRows = await sql.query<{
    id: number;
    from_peer: string;
    name: string;
    down: boolean;
    hold: boolean;
    dur_ms: number;
  }>(
    `SELECT id, from_peer, name, down, hold, dur_ms FROM cw_marks
     WHERE room = $1 AND from_peer <> $2 AND id > $3
       AND created_at > now() - make_interval(secs => $4)
     ORDER BY id LIMIT 200`,
    [room, peer, cw, CW_LIVE_SECONDS],
  );
  const body: RtcPollResponse = {
    peers: await roster(sql, room),
    signals: rows.map((r) => ({
      id: r.id,
      from: r.from_peer,
      kind: r.kind,
      payload: r.payload,
    })),
    marks: markRows.map((r) => ({
      id: Number(r.id),
      from: r.from_peer,
      name: r.name,
      down: Boolean(r.down),
      hold: Boolean(r.hold),
      dur: Number(r.dur_ms) || 0,
    })),
  };
  return json(body);
}

async function handlePost(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid request" }, 400);
  const msg = parsed.data;
  const sql = await getSql();
  await ensureSchema(sql);

  if (msg.op === "signal") {
    await sql.query(
      `INSERT INTO webrtc_signals (room, to_peer, from_peer, kind, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [msg.room, msg.to, msg.from, msg.kind, JSON.stringify(msg.payload)],
    );
  } else if (msg.op === "cw") {
    await sql.query(
      `INSERT INTO cw_marks (room, from_peer, name, down, hold, dur_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [msg.room, msg.from, msg.name, msg.down, msg.hold ?? false, msg.dur ?? 0],
    );
    await touchPeer(sql, msg.room, msg.from, msg.name);
  } else {
    await sql.query(`DELETE FROM webrtc_peers WHERE room = $1 AND peer_id = $2`, [
      msg.room,
      msg.peer,
    ]);
  }
  return json({ ok: true });
}

export async function handleSignaling(request: Request): Promise<Response> {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method === "GET") return await handleGet(new URL(request.url));
    if (request.method === "POST") return await handlePost(request);
    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    console.error("[rtc] signaling error:", error);
    return json({ error: "signaling failed" }, 500);
  }
}

export async function handleNets(): Promise<Response> {
  try {
    const sql = await getSql();
    await ensureSchema(sql);
    const rows = await sql.query<{ room: string; n: number }>(
      `SELECT room, COUNT(*)::int AS n FROM webrtc_peers
       WHERE last_seen > now() - make_interval(secs => $1)
       GROUP BY room`,
      [PEER_TTL_SECONDS],
    );
    const nets = rows
      .map((r) => {
        const m = /^nw(\d+)$/.exec(r.room);
        if (!m) return null;
        return { room: r.room, freqKhz: Number(m[1]), count: Number(r.n) };
      })
      .filter((x): x is { room: string; freqKhz: number; count: number } => x !== null);
    return json({ nets });
  } catch (error) {
    console.error("[rtc] nets error:", error);
    return json({ nets: [] });
  }
}
