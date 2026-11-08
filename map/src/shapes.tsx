// Project status is encoded by marker shape, not color. Same paths on the map (canvas) and in the UI (SVG).
import type { Status, SwatchKind } from "./data";

const SHAPES: Record<Status, { d: string; fill: boolean }> = {
  operating: { d: "M2 6a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z", fill: true },
  approved: { d: "M2.5 2.5h7v7h-7Z", fill: true },
  planned: { d: "M2 6a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z", fill: false },
  moratorium: { d: "M6 1.5L10.5 6L6 10.5L1.5 6Z", fill: false },
  withdrawn: { d: "M6 2L10.5 10H1.5Z", fill: false },
  rejected: { d: "M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5", fill: false },
};

export function Shape({ status, size = 10, color = "currentColor" }: { status: Status; size?: number; color?: string }) {
  const s = SHAPES[status];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" style={{ flex: "none" }}>
      <path d={s.d} fill={s.fill ? color : "none"} stroke={color} strokeWidth={s.fill ? 0 : 1.4} />
    </svg>
  );
}

// 12px icon at 2x for map.addImage.
export function shapeImage(status: Status, color: string): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 24;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  const s = SHAPES[status];
  const path = new Path2D(s.d);
  // dark halo keeps markers legible on top of the bright end of the resistance scale
  ctx.strokeStyle = "#0b0b0b";
  ctx.lineWidth = 3;
  ctx.stroke(path);
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  if (s.fill) ctx.fill(path);
  else ctx.stroke(path);
  return ctx.getImageData(0, 0, 24, 24);
}

// Infrastructure glyphs (power plant = ring with center dot, data center = hexagon). They share no shape with project status.
const INFRA_PATHS = {
  plant: { d: "M2 6a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z", dot: true },
  dc: { d: "M6 1.5L10 3.75L10 8.25L6 10.5L2 8.25L2 3.75Z", dot: false },
};
export const INFRA_INK = "#a3a39e";

export function infraImage(kind: keyof typeof INFRA_PATHS): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 24;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  const path = new Path2D(INFRA_PATHS[kind].d);
  ctx.fillStyle = "#0b0b0b";
  ctx.fill(path);
  ctx.strokeStyle = INFRA_INK;
  ctx.lineWidth = 1.2;
  ctx.stroke(path);
  if (INFRA_PATHS[kind].dot) {
    ctx.fillStyle = INFRA_INK;
    ctx.beginPath();
    ctx.arc(6, 6, 1.3, 0, 2 * Math.PI);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, 24, 24);
}

// Diagonal hatch for counties the model predicts as blocked (8px pattern at 2x).
export function hatchImage(): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "rgba(230, 230, 227, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const o of [-16, 0, 16]) {
    ctx.moveTo(o, 16);
    ctx.lineTo(o + 16, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, 16, 16);
}

// Legend glyph for an infrastructure layer; matches the paint in MapView.
export function Swatch({ kind }: { kind: SwatchKind }) {
  const dash = { hv: undefined, dashed: "4 2", dashdot: "5 2 1 2", dotted: "1 2" } as const;
  return (
    <svg width={18} height={12} viewBox="0 0 18 12" aria-hidden="true" style={{ flex: "none" }}>
      {kind === "plant" || kind === "dc" ? (
        <g transform="translate(3 0)">
          <path d={INFRA_PATHS[kind].d} fill="none" stroke={INFRA_INK} strokeWidth={1.2} />
          {kind === "plant" && <circle cx={6} cy={6} r={1.3} fill={INFRA_INK} />}
        </g>
      ) : kind === "hatch" ? (
        <path d="M-2 12L10 0M4 12L16 0M10 12L22 0" stroke="#e6e6e3" strokeOpacity={0.6} strokeWidth={0.9} />
      ) : kind === "sub" ? (
        <circle cx={9} cy={6} r={1.8} fill="#7a7a76" />
      ) : (
        <line x1={0} y1={6} x2={18} y2={6} stroke={INFRA_INK} strokeWidth={kind === "hv" ? 1.8 : 1.1} strokeDasharray={dash[kind]} />
      )}
    </svg>
  );
}
