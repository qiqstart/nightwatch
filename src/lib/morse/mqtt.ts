/** Tiny MQTT 3.1.1 client over WebSocket. QoS 0 only. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function mqttStr(s: string): Uint8Array {
  const b = encoder.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = (b.length >> 8) & 0xff;
  out[1] = b.length & 0xff;
  out.set(b, 2);
  return out;
}

function remLen(n: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    bytes.push(d);
  } while (n > 0);
  return Uint8Array.from(bytes);
}

function packet(type: number, body: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(type), remLen(body.length), body]);
}

function connectPacket(clientId: string): Uint8Array {
  const proto = mqttStr("MQTT");
  const protoLevel = Uint8Array.of(4);
  const flags = Uint8Array.of(0x02); // clean session
  const keepAlive = Uint8Array.of(0, 30);
  const body = concat([proto, protoLevel, flags, keepAlive, mqttStr(clientId)]);
  return packet(0x10, body);
}

function subscribePacket(topic: string): Uint8Array {
  const body = concat([Uint8Array.of(0, 1), mqttStr(topic), Uint8Array.of(0)]);
  return packet(0x82, body);
}

function publishPacket(topic: string, payload: string): Uint8Array {
  const body = concat([mqttStr(topic), encoder.encode(payload)]);
  return packet(0x30, body);
}

function readRem(buf: Uint8Array, i: number): { len: number; i: number } | null {
  let mul = 1;
  let len = 0;
  for (let n = 0; n < 4; n++) {
    if (i >= buf.length) return null;
    const d = buf[i++]!;
    len += (d & 127) * mul;
    if ((d & 128) === 0) return { len, i };
    mul *= 128;
  }
  return null;
}

export class MqttBus {
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private backoff = 800;
  ready = false;
  private urlIndex = 0;
  private readonly urls: string[];
  private readonly clientId: string;
  private readonly topic: string;
  private readonly onMessage: (text: string) => void;
  private readonly onReady: (up: boolean) => void;

  constructor(opts: {
    url?: string;
    urls?: string[];
    clientId: string;
    topic: string;
    onMessage: (text: string) => void;
    onReady: (up: boolean) => void;
  }) {
    this.urls = opts.urls?.length ? opts.urls : opts.url ? [opts.url] : [];
    this.clientId = opts.clientId.slice(0, 23);
    this.topic = opts.topic;
    this.onMessage = opts.onMessage;
    this.onReady = opts.onReady;
  }

  start() {
    this.closed = false;
    this.open();
  }

  stop() {
    this.closed = true;
    this.ready = false;
    this.onReady(false);
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        /* already closed */
      }
    }
  }

  send(text: string) {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(publishPacket(this.topic, text));
      return true;
    } catch {
      return false;
    }
  }

  private open() {
    if (this.closed || this.urls.length === 0) return;
    const url = this.urls[this.urlIndex % this.urls.length]!;
    try {
      const ws = new WebSocket(url, ["mqtt"]);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        ws.send(connectPacket(this.clientId));
      };
      ws.onmessage = (ev) => {
        const chunk = new Uint8Array(ev.data as ArrayBuffer);
        const next = new Uint8Array(this.buf.length + chunk.length);
        next.set(this.buf);
        next.set(chunk, this.buf.length);
        this.buf = next;
        this.drain();
      };
      ws.onclose = () => this.dropped();
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      this.dropped();
    }
  }

  private drain() {
    let i = 0;
    while (i < this.buf.length) {
      const start = i;
      const type = this.buf[i++]!;
      const rem = readRem(this.buf, i);
      if (!rem) {
        this.buf = this.buf.slice(start);
        return;
      }
      i = rem.i;
      if (i + rem.len > this.buf.length) {
        this.buf = this.buf.slice(start);
        return;
      }
      const body = this.buf.slice(i, i + rem.len);
      i += rem.len;
      this.handle(type, body);
    }
    this.buf = new Uint8Array(0);
  }

  private handle(type: number, body: Uint8Array) {
    const cmd = type >> 4;
    if (cmd === 2) {
      // CONNACK
      this.ready = true;
      this.backoff = 800;
      this.onReady(true);
      this.ws?.send(subscribePacket(this.topic));
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => {
        try {
          this.ws?.send(Uint8Array.of(0xc0, 0x00));
        } catch {
          /* ignore */
        }
      }, 20_000);
      return;
    }
    if (cmd === 3) {
      if (body.length < 2) return;
      const tlen = (body[0]! << 8) | body[1]!;
      const qos = (type >> 1) & 0x03;
      let o = 2 + tlen;
      if (qos > 0) o += 2;
      if (o > body.length) return;
      const payload = decoder.decode(body.slice(o));
      this.onMessage(payload);
    }
  }

  private dropped() {
    this.ready = false;
    this.onReady(false);
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    this.ws = null;
    this.buf = new Uint8Array(0);
    this.urlIndex += 1;
    if (this.closed) return;
    const wait = this.backoff;
    this.backoff = Math.min(8_000, this.backoff * 1.6);
    this.retry = setTimeout(() => this.open(), wait);
  }
}
