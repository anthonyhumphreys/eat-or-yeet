// The Eat or Yeet mark: a shield with a crossed spoon and fork.
// Drawn on a 100 × 100 grid. `mark` is the shield colour; `cut` is the colour of the
// spoon and fork (normally the tile behind the shield, so they read as cut-outs).

export const brandColors = {
  cream: "#fbf5e9",
  ink: "#1d1a16",
  marigold: "#e39b00",
  charcoal: "#17171a",
  saffron: "#f2a900",
} as const;

export const SHIELD_PATH = "M50 5 L87 17 V47 C87 72 71 88 50 96 C29 88 13 72 13 47 V17 Z";

const FORK = '<rect x="33" y="10" width="8" height="22" rx="4"/><rect x="46" y="10" width="8" height="22" rx="4"/><rect x="59" y="10" width="8" height="22" rx="4"/><path d="M33 26 H67 V32 a17 17 0 0 1 -34 0 Z"/><rect x="45" y="44" width="10" height="46" rx="5"/>';
const SPOON = '<ellipse cx="50" cy="26" rx="14" ry="17"/><rect x="45" y="38" width="10" height="52" rx="5"/>';
const place = (rotation: number) => `translate(50 51) rotate(${rotation}) scale(0.46) translate(-50 -50)`;

/** Standalone SVG markup, for image routes (favicon, link previews) that can't render React components. */
export function logoSvg({ mark, cut, size = 100 }: { mark: string; cut: string; size?: number }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">`
    + `<path d="${SHIELD_PATH}" fill="${mark}"/>`
    + `<g transform="${place(-32)}" fill="${cut}">${SPOON}</g>`
    + `<g transform="${place(32)}" fill="${cut}" stroke="${mark}" stroke-width="8" paint-order="stroke">${FORK}</g>`
    + `<g transform="${place(32)}" fill="${cut}">${FORK}</g>`
    + `</svg>`;
}

/** Base64 data URI for `<img>` inside `ImageResponse`. The markup is ASCII-only, so `btoa` is safe in every runtime. */
export function logoDataUri(colors: { mark: string; cut: string; size?: number }) {
  return `data:image/svg+xml;base64,${btoa(logoSvg(colors))}`;
}
