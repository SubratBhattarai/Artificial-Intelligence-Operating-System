/** Ambient Mode: the orb and desktop tint follow the system's state. Rule-based, never model-driven. */

export type AmbientName = 'calm' | 'busy' | 'heavy' | 'agents' | 'alert' | 'offline';
export type Rgb = [number, number, number];

export interface AmbientInput {
  /** 0..100, or null when unknown. */
  cpu: number | null;
  /** The local language model cannot be reached. */
  modelOffline: boolean;
  /** A high-level security finding is unread. */
  securityAlert: boolean;
  agentsRunning: number;
}

/** Whitesmoke, silver, icy blue — the default look. */
export const CALM_PALETTE: Rgb[] = [
  [245, 247, 250],
  [196, 205, 218],
  [160, 212, 255],
];

export const AMBIENT_PALETTES: Record<AmbientName, Rgb[]> = {
  calm: CALM_PALETTE,
  busy: [
    [245, 247, 250],
    [190, 208, 226],
    [140, 205, 235],
  ],
  heavy: [
    [250, 244, 236],
    [222, 204, 184],
    [255, 196, 140],
  ],
  agents: [
    [244, 248, 250],
    [186, 214, 214],
    [150, 232, 205],
  ],
  alert: [
    [252, 242, 244],
    [226, 190, 198],
    [255, 150, 165],
  ],
  offline: [
    [236, 238, 242],
    [170, 176, 188],
    [140, 150, 170],
  ],
};

/** Highest priority first: a security alert beats everything, then connectivity, load, agents. */
export function ambientFor(input: AmbientInput): AmbientName {
  if (input.securityAlert) return 'alert';
  if (input.modelOffline) return 'offline';
  if (input.cpu !== null && input.cpu >= 85) return 'heavy';
  if (input.agentsRunning > 0) return 'agents';
  if (input.cpu !== null && input.cpu >= 50) return 'busy';
  return 'calm';
}

/** The colours the orb reads every frame. Eased toward the target so changes glide. */
export const AMBIENT = {
  colors: CALM_PALETTE.map((c) => [...c] as Rgb),
};

export function easePalette(target: Rgb[], rate = 0.12): boolean {
  let moving = false;
  target.forEach((goal, index) => {
    for (let channel = 0; channel < 3; channel += 1) {
      const current = AMBIENT.colors[index][channel];
      const delta = goal[channel] - current;
      if (Math.abs(delta) > 0.5) {
        AMBIENT.colors[index][channel] = current + delta * rate;
        moving = true;
      } else AMBIENT.colors[index][channel] = goal[channel];
    }
  });
  return moving;
}
