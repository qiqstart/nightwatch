export const MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "/": "-..-.",
  "=": "-...-",
  "+": ".-.-.",
  "-": "-....-",
};

export const FROM_MORSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([letter, code]) => [code, letter]),
);

export const CODE_CARD: { ch: string; code: string }[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((ch) => ({ ch, code: MORSE[ch] })),
  ..."0123456789".split("").map((ch) => ({ ch, code: MORSE[ch] })),
  { ch: "/", code: MORSE["/"] },
  { ch: "?", code: MORSE["?"] },
  { ch: ".", code: MORSE["."] },
  { ch: ",", code: MORSE[","] },
];

export function encodeText(text: string): string {
  return text
    .toUpperCase()
    .split("")
    .map((ch) => (ch === " " ? "/" : (MORSE[ch] ?? "")))
    .filter(Boolean)
    .join(" ");
}
