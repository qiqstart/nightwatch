/**
 * World net over ordinary HTTPS. EventSource first (phones allow it),
 * WebSocket if that fails — never a non-443 MQTT port.
 */

type NtfyEvent = {
  id?: string;
  event?: string;
  message?: string;
};

export class NtfyBus {
  ready = false;
  private es: EventSource | null = null;
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private fallback: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private backoff = 600;
  private readonly topic: string;
  private readonly onMessage: (text: string) => void;
  private readonly onReady: (up: boolean) => void;

  constructor(opts: {
    topic: string;
    onMessage: (text: string) => void;
    onReady: (up: boolean) => void;
  }) {
    this.topic = opts.topic.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    this.onMessage = opts.onMessage;
    this.onReady = opts.onReady;
  }

  start() {
    this.closed = false;
    this.openSse();
    this.fallback = setTimeout(() => {
      if (!this.closed && !this.ready) this.openWs();
    }, 1800);
  }

  stop() {
    this.closed = true;
    this.ready = false;
    this.onReady(false);
    if (this.retry) clearTimeout(this.retry);
    if (this.fallback) clearTimeout(this.fallback);
    this.teardown();
  }

  send(text: string) {
    if (!this.topic) return false;
    void fetch(`https://ntfy.sh/${this.topic}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Priority: "min",
        Firebase: "no",
      },
      body: text,
      keepalive: true,
    }).catch(() => {});
    return true;
  }

  private markUp() {
    if (this.ready) return;
    this.ready = true;
    this.backoff = 600;
    this.onReady(true);
  }

  private ingestRaw(raw: string) {
    let parsed: NtfyEvent;
    try {
      parsed = JSON.parse(raw) as NtfyEvent;
    } catch {
      return;
    }
    if (parsed.event && parsed.event !== "message") return;
    if (!parsed.message) return;
    this.onMessage(parsed.message);
  }

  private openSse() {
    if (this.closed || !this.topic || typeof EventSource === "undefined") return;
    try {
      const es = new EventSource(`https://ntfy.sh/${this.topic}/sse`);
      this.es = es;
      es.onopen = () => this.markUp();
      es.onmessage = (ev) => this.ingestRaw(String(ev.data ?? ""));
      es.onerror = () => {
        if (this.closed) return;
        if (es.readyState === EventSource.CLOSED) {
          this.dropSse();
          if (!this.ws) this.openWs();
        }
      };
    } catch {
      this.openWs();
    }
  }

  private openWs() {
    if (this.closed || !this.topic || this.ws) return;
    try {
      const ws = new WebSocket(`wss://ntfy.sh/${this.topic}/ws`);
      this.ws = ws;
      ws.onopen = () => this.markUp();
      ws.onmessage = (ev) => this.ingestRaw(String(ev.data));
      ws.onclose = () => this.dropWs();
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      this.schedule();
    }
  }

  private dropSse() {
    const es = this.es;
    this.es = null;
    if (es) {
      es.onopen = null;
      es.onmessage = null;
      es.onerror = null;
      try {
        es.close();
      } catch {
        /* ignore */
      }
    }
  }

  private dropWs() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {
        /* ignore */
      }
    }
    if (!this.es) this.dropped();
  }

  private teardown() {
    this.dropSse();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private dropped() {
    this.ready = false;
    this.onReady(false);
    this.schedule();
  }

  private schedule() {
    if (this.closed) return;
    const wait = this.backoff;
    this.backoff = Math.min(8_000, this.backoff * 1.6);
    this.retry = setTimeout(() => {
      if (this.closed) return;
      this.openSse();
    }, wait);
  }
}
