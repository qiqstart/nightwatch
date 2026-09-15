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
- Live net: anyone else on that frequency, on this same Nightwatch, hears the key
- Auto-decode tape and a Morse code card
- Callsign stored in the browser — no accounts

Keying is carried by the Nightwatch net (not a phone-to-phone call), so two
sets on cellular or different Wi‑Fi still hear each other as long as they are
looking at the same Nightwatch.

## Stack

React 19, TanStack Start, Tailwind v4, Web Audio.
