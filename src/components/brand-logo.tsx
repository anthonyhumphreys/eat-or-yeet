import { SHIELD_PATH } from "@/lib/brand/logo";

const place = (rotation: number) => `translate(50 51) rotate(${rotation}) scale(0.46) translate(-50 -50)`;

function Fork() {
  return (
    <>
      <rect x="33" y="10" width="8" height="22" rx="4" />
      <rect x="46" y="10" width="8" height="22" rx="4" />
      <rect x="59" y="10" width="8" height="22" rx="4" />
      <path d="M33 26 H67 V32 a17 17 0 0 1 -34 0 Z" />
      <rect x="45" y="44" width="10" height="46" rx="5" />
    </>
  );
}

/**
 * Shield with a crossed spoon and fork. The shield uses `currentColor`; the spoon and fork
 * use `cut` (defaults to the brand fill) so they read as cut-outs on a brand-coloured tile.
 */
export function BrandLogo({ className, cut = "var(--primary)" }: { className?: string; cut?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
      <path d={SHIELD_PATH} fill="currentColor" />
      <g transform={place(-32)} style={{ fill: cut }}>
        <ellipse cx="50" cy="26" rx="14" ry="17" />
        <rect x="45" y="38" width="10" height="52" rx="5" />
      </g>
      <g transform={place(32)} style={{ fill: cut, stroke: "currentColor", strokeWidth: 8, paintOrder: "stroke" }}><Fork /></g>
      <g transform={place(32)} style={{ fill: cut }}><Fork /></g>
    </svg>
  );
}

/** The logo on its marigold (or saffron, in dark mode) tile, as used in the header. */
export function BrandTile({ className = "size-9" }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground ${className}`}>
      <BrandLogo className="size-[72%]" />
    </span>
  );
}
