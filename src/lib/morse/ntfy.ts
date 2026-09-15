/** HTTPS/WSS pub-sub on port 443 — gets through cellular and guest Wi‑Fi. */

type NtfyEvent = {
  event?: string;
  message?: string;
};

export class NtfyBus {
  ready = false;
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
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
    this.open();
  }

  stop() {
    this.closed = true;
    this.ready = false;
    this.onReady(false);
    if (this.retry) clearTimeout(this.retry);
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
        /* already closed */
      }
    }
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

  private open() {
    if (this.closed || !this.topic) return;
    try {
      const ws = new WebSocket(`wss://ntfy.sh/${this.topic}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.ready = true;
        this.backoff = 600;
        this.onReady(true);
      };
      ws.onmessage = (ev) => {
        let parsed: NtfyEvent;
        try {
          parsed = JSON.parse(String(ev.data)) as NtfyEvent;
        } catch {
          return;
        }
        if (parsed.event !== "message" || !parsed.message) return;
        this.onMessage(parsed.message);
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

  private dropped() {
    this.ready = false;
    this.onReady(false);
    this.ws = null;
    if (this.closed) return;
    const wait = this.backoff;
    this.backoff = Math.min(8_000, this.backoff * 1.6);
    this.retry = setTimeout(() => this.open(), wait);
  }
}
