

// src/components/visualizer/diorama/dioramaSceneConstants.ts
// 镜台场景的窗口、字号、雾带、生命周期、配色阻尼与跟唱上限常量，以及邻行透明度曲线和包络步进。

// Which lines get mounted as 3D text + formations, relative to the current line. Past lines stay
// mounted so a finished line recedes visibly instead of vanishing; upcoming lines mount ahead and are
// born out of the far haze by the lifecycle fade.
export const LINES_AHEAD = 3;
export const LINES_BEHIND = 2;
// The outgoing TEXT during a transition needs only a small departing cluster on screen (it is being left
// behind), so its window is tighter than the live one - fewer meshes/rasters mounted per switch. This
// pair is text-only; the corridor sizes its outgoing window from clearance instead (see below).
export const OUTGOING_LINES_BEHIND = 2;
export const OUTGOING_LINES_AHEAD = 1;
// The corridor gets a LONGER window than the text, and it has to clear the visible band at BOTH ends: a
// point stops existing past DIORAMA_SHAPE_FADE_IN_END (27) and fog closes at FOG_FAR (30), so an end
// nearer than that is a hole you can look through. Lines sit DIORAMA_STEP_DISTANCE (8) apart, and the
// camera trails the read head by DIORAMA_HERO_DISTANCE (5.2), stretched to ~15 in the worst case (the
// widest shot pulls back to 2x hero, and 运镜幅度 scales that excursion by up to 1.6):
//   ahead:  7 * 8 - 3.4 (nearest shot) = 52 units clear - most visible at a song's start, staring down
//           the tunnel from line 0.
//   behind: 6 * 8 - 15 (widest shot)   = 33 units clear. This was 2, i.e. 16 - 15 = ONE unit clear: any
//           shot that swung the camera off the forward axis showed the tunnel's open back end.
export const CORRIDOR_LINES_AHEAD = 7;
export const CORRIDOR_LINES_BEHIND = 6;
// How many neighbour line textures to rasterise per animation frame - keeps the per-frame cost bounded so
// a song change (several new lines at once) spreads across a few frames instead of hitching one.
export const NEIGHBOR_RASTER_BUDGET = 2;
// Opacity for a non-active mounted line, by SIGNED offset from the current line. Past lines stay as a
// receding trail but MUTED - bright enough to exist, dim enough that a lingering credits line can
// never read as a second subtitle stamped over the current one.
export const resolveNeighborLineOpacity = (offset: number): number => {
    if (offset === -1) return 0.3;
    if (offset === -2) return 0.1;
    if (offset === 1) return 0.34;
    if (offset === 2) return 0.16;
    if (offset === 3) return 0.06;
    return 0;
};
// Opacity for an OUTGOING corridor's lines during a transition: a soft, uniform departing glow. Its own
// former-active line reads brightest, the rest a touch dimmer, so the leaving scene still looks like a
// real scene. Uniform ON PURPOSE - the fade-out is the camera flying away from them, applied by the
// distance lifecycle (resolveTextLife) and dressed by the fog, not baked into this curve.
export const resolveOutgoingLineOpacity = (offsetFromOutgoing: number): number =>
    offsetFromOutgoing === 0 ? 0.7 : Math.abs(offsetFromOutgoing) <= 2 ? 0.45 : 0.25;

// Nominal world size of one em of lyric text. A line is always exactly one row (the rasteriser never
// wraps); longer lines are shrunk to fit via the frame-fit scale below.
export const LINE_FONT_SIZE = 0.62;
// Fraction of the visible frame width a full line may occupy AT THE HERO DISTANCE. The fit scale is
// computed against this FIXED reference distance, not the live camera distance, so the camera
// approaching/passing a line genuinely grows/foreshortens it (real dolly motion).
export const TARGET_FRAME_WIDTH_FRACTION = 0.72;
// Floor for the fit scale so an extremely long line becomes small-but-readable instead of vanishing.
export const MIN_FIT_SCALE = 0.28;
export const DEG_TO_RAD = Math.PI / 180;
// Fog band: far enough to keep the hero line and its formation crisp, near enough that the +3 line
// and its set-piece are born inside the haze (the lifecycle fade and the fog work together).
export const FOG_NEAR = 12;
export const FOG_FAR = 30;
// Text-specific near-dissolve band (tighter than the shapes'): a lyric passing right by the lens
// melts away instead of smearing across it, but no shot's normal framing distance ever triggers it.
export const TEXT_DISSOLVE_START = 2.0;
export const TEXT_DISSOLVE_END = 0.9;
// Far end of the text lifecycle - the half that was missing. Sits entirely PAST the fog's far plane, so
// it can never dim a line the scene actually means to show (a mounted neighbour tops out around 24-30
// units even in the widest shot); it exists to guarantee a line reaches true zero rather than merely
// fog-coloured. Fog recolours a fragment toward the background, it does not remove it - a fully-fogged
// lyric still draws background-coloured glyphs at its own opacity, which over the corridor's points
// (rather than over the empty shell background) reads as a ghost line that is not in this scene. A song
// change parks the previous corridor TRANSITION_DISTANCE (46) away while its last lines stay mounted as
// the new song's index-adjacent trail, so that is the normal path, not a corner case.
export const TEXT_FADE_IN_START = 32;
export const TEXT_FADE_IN_END = 40;
// How quickly the damped theme colours chase their targets (per-second rate for the exp smoothing).
// Deliberately gentle (~1.5s to settle) so on a song change the palette eases over roughly the same span
// the outgoing scene takes to recede into the fog - the departing elements don't visibly snap to the new
// song's theme mid-flight, and manual/AI theme changes glide instead of stepping.
export const COLOR_DAMP_RATE = 1.2;
// Per-unit sung-state rendering, copying the project's classic-visualizer reveal model: a unit that
// has not been sung yet sits dim; the unit being sung RIGHT NOW turns accent-coloured and glows; a
// finished unit returns to plain bright text.
export const ACTIVE_LINE_OPACITY = 0.92;
export const UNSUNG_UNIT_OPACITY = 0.5;
// Ceiling for the glow plane's additive opacity (scaled by the per-frame level and the 辉光 slider).
export const UNIT_GLOW_MAX_OPACITY = 0.9;
// 灵魂出窍跟唱: an additive GHOST copy of the sung glyph (the crisp base raster, not the blurred
// glow). While the unit is being sung the ghost hovers just off the text; once the unit finishes,
// its envelope releases slowly and the ghost DETACHES - rising, swelling and fading out, like the
// glyph's energy layer leaving the body. All ceilings scale with the 灵魂出窍 slider.
export const SOUL_MAX_OPACITY = 0.6;
export const SOUL_ACTIVE_LIFT_EM = 0.06;
export const SOUL_DETACH_LIFT_EM = 0.5;
export const SOUL_ACTIVE_SWELL = 0.1;
export const SOUL_DETACH_SWELL = 0.3;
// How long AFTER a glyph finishes the ghost eases from "registered on the glyph" (当前字漂移) to full
// "out-of-body flight" (灵魂出窍强度). Read from the clock, so it is exactly 0 the whole time the glyph
// is being sung - the currently-sung glyph can never pick up the flight, no matter its envelope charge.
export const SOUL_HANDOFF_SECONDS = 0.5;

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Fast-attack / slow-release envelope step: a rising target is chased quickly (beats hit on time), a
// falling one slowly (long notes sustain, then breathe out). Everything music-reactive in the scene
// tracks these smoothed envelopes instead of raw per-frame FFT values, so nothing can flicker.
export const stepEnvelope = (current: number, target: number, attack: number, release: number, delta: number): number =>
    current + (target - current) * (1 - Math.exp(-(target > current ? attack : release) * delta));

export const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

// 渐变跟唱 wake, in seconds AFTER a unit stops being sung: a brief hold at full tint, then a bounded
// decay that lands on exactly 0. Total wake is HOLD + TRAIL, the same order as the trail this replaces.
export const GRADIENT_HOLD_SECONDS = 0.35;
export const GRADIENT_TRAIL_SECONDS = 1.8;
