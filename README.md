# NIGHTWATCH

A bakelite field Morse set. Tune a ham CW frequency, key the lever, and anyone else on that channel hears you.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. Flip **PWR**, pick a band, hold the straight key.

## What it is

- Straight key with sidetone and haptic thump
- Discrete amateur CW calling frequencies so operators can find each other
- Live net on this copy, plus a world relay so different Wi‑Fi / cellular still hear the key
- Auto-decode tape and a Morse code card
- Callsign stored in the browser — no accounts

The amber **SKY** lamp is the world net. If it is dark, you are only on this
Nightwatch copy (typical of same-Wi‑Fi). If it is lit, the key goes out over
HTTPS even when the other set is on another network.

## Stack

React 19, TanStack Start, Tailwind v4, Web Audio.
