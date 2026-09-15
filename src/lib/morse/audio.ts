type RemoteVoice = {
  osc: OscillatorNode;
  gate: GainNode;
};

function audioCtor(): typeof AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not available");
  return Ctor;
}

/**
 * Sidetone + radio hiss + tactile thump. Constructed on the first user gesture
 * so iOS actually unlocks the context.
 */
export class RadioAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private localOsc: OscillatorNode | null = null;
  private localGate: GainNode | null = null;
  private remotes = new Map<string, RemoteVoice>();
  private volume = 0.7;
  private tone = 660;
  private unlocked = false;

  get ready() {
    return this.unlocked;
  }

  /** Must run synchronously inside a click/touch handler. */
  unlock() {
    if (!this.ctx) {
      const Ctx = audioCtor();
      this.ctx = new Ctx({ latencyHint: "interactive" });
      this.buildGraph();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    this.unlocked = true;
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.ramp(this.master, this.volume * this.volume, 0.04);
    this.ramp(this.hissGain, this.volume * 0.028, 0.08);
  }

  setTone(hz: number) {
    this.tone = hz;
    const now = this.ctx?.currentTime ?? 0;
    if (this.localOsc && this.ctx) {
      this.localOsc.frequency.setTargetAtTime(hz, now, 0.02);
    }
    for (const [id, voice] of this.remotes) {
      voice.osc.frequency.setTargetAtTime(hz + detune(id), now, 0.02);
    }
  }

  setLocalKeyed(on: boolean) {
    this.ramp(this.localGate, on ? 1 : 0, on ? 0.004 : 0.008);
  }

  setRemoteKeyed(id: string, on: boolean) {
    const voice = this.ensureRemote(id);
    if (!voice) return;
    this.ramp(voice.gate, on ? 0.85 : 0, on ? 0.006 : 0.01);
  }

  dropRemote(id: string) {
    const voice = this.remotes.get(id);
    if (!voice || !this.ctx) return;
    const now = this.ctx.currentTime;
    voice.gate.gain.setTargetAtTime(0, now, 0.01);
    window.setTimeout(() => {
      try {
        voice.osc.stop();
        voice.osc.disconnect();
        voice.gate.disconnect();
      } catch {
        /* already gone */
      }
    }, 80);
    this.remotes.delete(id);
  }

  playClick() {
    this.burst(1800, 0.035, 0.012);
  }

  playThump() {
    this.burst(62, 0.55, 0.028);
  }

  playPowerOn() {
    this.burst(90, 0.4, 0.05);
    window.setTimeout(() => this.burst(1400, 0.08, 0.02), 40);
  }

  muteAll() {
    this.ramp(this.master, 0, 0.08);
    this.setLocalKeyed(false);
    for (const id of [...this.remotes.keys()]) this.dropRemote(id);
  }

  private buildGraph() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * this.volume;
    this.master.connect(ctx.destination);

    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = this.volume * 0.028;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 1200;
    hissFilter.Q.value = 0.7;
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoise(ctx, 1.5);
    noise.loop = true;
    noise.connect(hissFilter);
    hissFilter.connect(this.hissGain);
    this.hissGain.connect(this.master);
    noise.start();

    this.localGate = ctx.createGain();
    this.localGate.gain.value = 0;
    this.localOsc = ctx.createOscillator();
    this.localOsc.type = "sine";
    this.localOsc.frequency.value = this.tone;
    const localFilter = ctx.createBiquadFilter();
    localFilter.type = "lowpass";
    localFilter.frequency.value = 2400;
    this.localOsc.connect(localFilter);
    localFilter.connect(this.localGate);
    this.localGate.connect(this.master);
    this.localOsc.start();
  }

  private ensureRemote(id: string): RemoteVoice | null {
    if (!this.ctx || !this.master) return null;
    const existing = this.remotes.get(id);
    if (existing) return existing;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = this.tone + detune(id);
    const gate = this.ctx.createGain();
    gate.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    osc.connect(filter);
    filter.connect(gate);
    gate.connect(this.master);
    osc.start();
    const voice = { osc, gate };
    this.remotes.set(id, voice);
    return voice;
  }

  private ramp(node: GainNode | null, value: number, tc: number) {
    if (!node || !this.ctx) return;
    node.gain.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  private burst(hz: number, gain: number, seconds: number) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + seconds + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function detune(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 17) - 8;
}

const radios = new Map<string, RadioAudio>();

export function getRadio(id = "main"): RadioAudio {
  let radio = radios.get(id);
  if (!radio) {
    radio = new RadioAudio();
    radios.set(id, radio);
  }
  return radio;
}
