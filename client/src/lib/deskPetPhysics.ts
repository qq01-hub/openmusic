// 由 scripts/sync-desk-pet-upstream.mjs 从固定提交的源码提取，请勿手改
// PC2005-cloud/dsh-pet 单视口物理算法，MIT 许可见 public/desk-pet/LICENSE-dsh-pet.txt
export interface PhysicsParams {
    gravity: number;
    restitution: number;
    groundFriction: number;
    ceilingBounce: boolean;
    throwPower: number;
    petCollision: boolean;
    tiltGravity?: boolean;
    shakeThrow?: boolean;
    hapticEnabled?: boolean;
}

export const SPRING_K = 200;

export const SPRING_C = 30;

export const TRAIL_KEEP_MS = 200;

export const RELEASE_WINDOW_MS = 150;

export const RELEASE_STALE_MS = 150;

export const MIN_SPAN_MS = 20;

export const SEG_MIN_DT_MS = 8;

export const DEAD_ZONE_SPEED = 500;

export const MAX_THROW_SPEED = 3600;

export const PEAK_WEIGHT = 0.5;

export const ACCEL_REF = 8000;

export const ACCEL_GAIN_MAX = 0.6;

export const GRAVITY = 1400;

export const RESTITUTION = 0.78;

export const GROUND_FRICTION = 2.5;

export const DEFAULT_PHYSICS: PhysicsParams = {
    gravity: GRAVITY,
    restitution: RESTITUTION,
    groundFriction: GROUND_FRICTION,
    ceilingBounce: true,
    throwPower: 1,
    petCollision: true,
    hapticEnabled: true,
    tiltGravity: true,
    shakeThrow: true,
};

export const DEFAULT_THROW_POWER = 1;

export const REST_NORMAL = 40;

export const REST_TANGENT = 15;

export const REST_NORMAL_EPS = 1;

export const MAX_STEP_DT = 0.05;

export const SQ_SQUASH = 0.55;

export const SQ_DURATION_MS = 220;

export const SQ_SOFT_SPEED = 300;

export const SQ_HARD_SPEED = 1500;

export const SQ_MAX_SQUASH = 0.55;

export const THROW_SPEED_ANCHOR = 1200;

export const SLINGSHOT_REF_RATIO = 0.6;

export const SUBSTEP_PX = 8;

export const SUBSTEP_MAX = 64;

export const PET_BOUNCE_E = 0.995;

export type ContactEdge = 'left' | 'right' | 'ceiling' | 'floor';

export const CONTACT_NORMALS: Readonly<Record<ContactEdge, {
    readonly nx: number;
    readonly ny: number;
}>> = {
    left: { nx: 1, ny: 0 },
    right: { nx: -1, ny: 0 },
    ceiling: { nx: 0, ny: 1 },
    floor: { nx: 0, ny: -1 },
};

export interface ContactResult {
    readonly vx: number;
    readonly vy: number;
    readonly normalSpeed: number;
    readonly tangentSpeed: number;
}

export const resolveContact = (speed: {
    readonly vx: number;
    readonly vy: number;
}, edge: ContactEdge, physics: PhysicsParams, dt: number): ContactResult => {
    const { nx, ny } = CONTACT_NORMALS[edge];
    const tx = -ny;
    const ty = nx;
    const vn = speed.vx * nx + speed.vy * ny;
    const vt = speed.vx * tx + speed.vy * ty;
    const normalSpeed = Math.abs(vn) < REST_NORMAL ? 0 : Math.abs(vn) * physics.restitution;
    const tangentSpeed = vt * Math.max(0, 1 - physics.groundFriction * dt);
    return {
        vx: normalSpeed * nx + tangentSpeed * tx,
        vy: normalSpeed * ny + tangentSpeed * ty,
        normalSpeed,
        tangentSpeed,
    };
};

export const isRestingOnContacts = (edges: readonly ContactEdge[], speed: {
    readonly vx: number;
    readonly vy: number;
}): boolean => {
    if (edges.length === 0)
        return false;
    return edges.every((edge) => {
        const { nx, ny } = CONTACT_NORMALS[edge];
        const normal = Math.abs(speed.vx * nx + speed.vy * ny);
        const tangent = Math.abs(speed.vx * -ny + speed.vy * nx);
        return normal < REST_NORMAL_EPS && tangent < REST_TANGENT;
    });
};

export const springStep = (v: number, x: number, target: number, dt: number, power: number = DEFAULT_THROW_POWER): number => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;

export const softClampSpeed = (speed: number): number => {
    if (speed <= 0)
        return 0;
    return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};

export const trimTrail = (trail: DragSample[], now: number): DragSample[] => {
    const cutoff = now - TRAIL_KEEP_MS;
    let i = 0;
    while (i < trail.length && trail[i].t < cutoff)
        i++;
    return i === 0 ? trail : trail.slice(i);
};

export const throwVelocity = (angleDeg: number, power: number): {
    vx: number;
    vy: number;
} => {
    const speed = softClampSpeed(power * THROW_SPEED_ANCHOR);
    const rad = (angleDeg * Math.PI) / 180;
    return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

export const slingshotRefDist = (size: number): number => (size > 0 ? size * SLINGSHOT_REF_RATIO : 0);

export const slingshotPower = (dist: number, size: number): number => {
    const ref = slingshotRefDist(size);
    if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist))
        return 0;
    return dist / ref;
};

export const pullAngle = (pullX: number, pullY: number): number => (Math.atan2(pullY, -pullX) * 180) / Math.PI;

export const slingshotVelocity = (angleDeg: number, power: number, throwPower: number = DEFAULT_THROW_POWER): {
    vx: number;
    vy: number;
} => {
    const speed = THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
    if (speed === 0)
        return { vx: 0, vy: 0 };
    const rad = (angleDeg * Math.PI) / 180;
    return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

export const estimateReleaseVelocity = (trail: DragSample[], now: number, physics: PhysicsParams = DEFAULT_PHYSICS): {
    vx: number;
    vy: number;
} | null => {
    if (trail.length === 0)
        return null;
    const last = trail[trail.length - 1];
    if (now - last.t > RELEASE_STALE_MS)
        return null;
    const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
    if (win.length < 2)
        return null;
    const t0 = win[0].t;
    const x0 = win[0].x;
    const y0 = win[0].y;
    const t1 = win[win.length - 1].t;
    const x1 = win[win.length - 1].x;
    const y1 = win[win.length - 1].y;
    const spanMs = t1 - t0;
    if (spanMs < MIN_SPAN_MS)
        return null;
    const baseVx = ((x1 - x0) / spanMs) * 1000;
    const baseVy = ((y1 - y0) / spanMs) * 1000;
    const baseSpeed = Math.hypot(baseVx, baseVy);
    if (baseSpeed < 1e-6)
        return null;
    const segSpeeds: {
        speed: number;
        tEnd: number;
    }[] = [];
    let px = x0;
    let py = y0;
    let pt = t0;
    for (const s of win.slice(1)) {
        const dt = s.t - pt;
        if (dt >= SEG_MIN_DT_MS) {
            segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
            px = s.x;
            py = s.y;
            pt = s.t;
        }
    }
    const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
    let accel = 0;
    if (segSpeeds.length >= 2) {
        const lastSeg = segSpeeds[segSpeeds.length - 1];
        const firstSeg = segSpeeds[0];
        accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, MIN_SPAN_MS / 1000);
    }
    const speedBeforeClamp = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) *
        (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
    const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
    if (speed < DEAD_ZONE_SPEED)
        return null;
    return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
};

export const landingSquash = (impactSpeed: number): number => {
    const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
    return Math.min(0.8, 1 - t * (1 - SQ_MAX_SQUASH));
};

export const squashScale = (u: number, squash: number = SQ_SQUASH): number => {
    if (u < 0.45) {
        const p = u / 0.45;
        return 1 - (1 - squash) * p * p;
    }
    const p = (u - 0.45) / 0.55;
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};

export interface DragSample {
    t: number;
    x: number;
    y: number;
}

export interface ThrowBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface ThrowState {
    x: number;
    y: number;
    vx: number;
    vy: number;
}

export interface ThrowHit {
    edge: ContactEdge;
    speed: number;
}

export interface GravityVector {
    readonly gx: number;
    readonly gy: number;
}

export const throwStep = (s: ThrowState, dtRaw: number, b: ThrowBounds, physics: PhysicsParams = DEFAULT_PHYSICS, gravity?: GravityVector): ThrowState & {
    bounced: boolean;
    atRest: boolean;
    hit: ThrowHit | null;
    contacts: ContactEdge[];
} => {
    const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
    const g: GravityVector = gravity ?? { gx: 0, gy: physics.gravity };
    let { x, y, vx, vy } = s;
    vx += g.gx * dt;
    vy += g.gy * dt;
    x += vx * dt;
    y += vy * dt;
    let bounced = false;
    let hit: ThrowHit | null = null;
    const contacts: ContactEdge[] = [];
    const record = (edge: ContactEdge, speed: number): void => {
        contacts.push(edge);
        if (hit === null || speed > hit.speed)
            hit = { edge, speed };
    };
    if (x < b.minX) {
        record('left', Math.abs(vx));
        x = b.minX;
        const out = resolveContact({ vx, vy }, 'left', physics, dt);
        vx = out.vx;
        vy = out.vy;
        bounced = true;
    }
    else if (x > b.maxX) {
        record('right', Math.abs(vx));
        x = b.maxX;
        const out = resolveContact({ vx, vy }, 'right', physics, dt);
        vx = out.vx;
        vy = out.vy;
        bounced = true;
    }
    if (y < b.minY) {
        if (physics.ceilingBounce) {
            record('ceiling', Math.abs(vy));
            y = b.minY;
            const out = resolveContact({ vx, vy }, 'ceiling', physics, dt);
            vx = out.vx;
            vy = out.vy;
            bounced = true;
        }
    }
    else if (y >= b.maxY) {
        record('floor', Math.abs(vy));
        y = b.maxY;
        const out = resolveContact({ vx, vy }, 'floor', physics, dt);
        vx = out.vx;
        vy = out.vy;
        bounced = true;
    }
    return { x, y, vx, vy, bounced, atRest: isRestingOnContacts(contacts, { vx, vy }), hit, contacts };
};

export const throwSubsteps = (vx: number, vy: number, dt: number): number => {
    const travel = Math.hypot(vx, vy) * Math.min(Math.max(dt, 0), MAX_STEP_DT);
    if (!(travel > SUBSTEP_PX))
        return 1;
    return Math.min(SUBSTEP_MAX, Math.ceil(travel / SUBSTEP_PX));
};
