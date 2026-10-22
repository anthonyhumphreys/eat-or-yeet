import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";
import { Easing } from "remotion";

import { brandColors } from "../../src/lib/brand/logo";

export const { fontFamily: sans } = loadGeist("normal", { weights: ["500", "600", "700", "800", "900"], subsets: ["latin"] });
export const { fontFamily: mono } = loadGeistMono("normal", { weights: ["500"], subsets: ["latin"] });

// Mirrors DESIGN.md / globals.css. Flat fills only: the GIF palette has 256 colours.
export const c = {
  ...brandColors,
  card: "#fffcf5",
  muted: "#6b6358",
  border: "#e8dec8",
  secondary: "#f3ebda",
  yeet: "#9e1b14",
  yeetSoft: "#fdecea",
  maybe: "#7a3900",
  maybeSoft: "#fff1db",
  darkCard: "#222226",
  darkMuted: "#a8a49b",
  darkLine: "rgba(255,255,255,0.12)",
  darkSecondary: "#2a2a2f",
  darkYeet: "#ffb1a8",
  darkYeetSoft: "#3a1a18",
};

export const FPS = 30;
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const snappy = { damping: 20, stiffness: 200 };
