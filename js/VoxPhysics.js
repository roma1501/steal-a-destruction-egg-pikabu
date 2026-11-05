// VoxPhysics.js — физика твёрдых тел из вокселей Rubble Lab.
//
// Тело — своя воксельная сетка (байты VoxMat) с массой, центром масс и тензором инерции по вокселям
// (плотность материала · объём вокселя), позицией центра масс x, кватернионом q, скоростями v, w.
// Столкновения: «сэмплы» — сферы радиуса ½ вокселя в центрах поверхностных вокселей тела — против
// вокселей мира или сетки другого тела (ближайшая точка куба, внутри — выход через открытую грань);
// упреждающие контакты по скорости, сжатие манифолда до 4 точек на кластер нормалей.
// Решатель — мягкий шаг с подшагами (как Box2D v3): интеграция скоростей, тёплый старт, решение с
// мягким смещением, интеграция положений, «релакс» без смещения, затем отскок. Трение — круговой
// конус. Сон — по островам (группы касающихся тел засыпают вместе). Захват — мягкая точечная связь.
// Единицы: метры, секунды, килограммы; y вверх; правосторонняя система.

class VoxBody {
    constructor(id, sx, sy, sz, grid, ox, oy, oz) {
        this.id = id;
        this.sx = sx; this.sy = sy; this.sz = sz;
        this.grid = grid;
        this.ox = ox; this.oy = oy; this.oz = oz;        // смещение вокселей карты (шум цвета в шейдере)
        this.x = new Float64Array(3); this.v = new Float64Array(3); this.w = new Float64Array(3);
        this.q = new Float64Array([0, 0, 0, 1]);
        this.R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        this.Il = new Float64Array(9);                    // обратный тензор инерции в осях тела
        this.Iw = new Float64Array(9);                    // обратный тензор инерции в мире
        this.x0 = new Float64Array(3); this.q0 = new Float64Array(4); this.dR = new Float64Array(9);
        this.px = new Float64Array(3); this.pq = new Float64Array([0, 0, 0, 1]);   // прошлый шаг — для сглаживания
        this.com = [0, 0, 0];
        this.mass = 0; this.invMass = 0; this.count = 0;
        /** @type {Float32Array | null} */
        this.samples = null;
        /** @type {Int32Array | null} */
        this.sampleKey = null;
        this.ns = 0;
        this.aabb = new Float64Array(6);
        this.radius = 0;
        this.friction = 0.6; this.restitution = 0.1; this.sound = 'concrete'; this.brittle = 0; this.explosive = 0;
        this.sleeping = false; this.sleepT = 0; this.island = 0;
        /** @type {BABYLON.TransformNode | null} */
        this.node = null;
        /** @type {BABYLON.Mesh | null} */
        this.meshO = null;
        /** @type {BABYLON.Mesh | null} */
        this.meshG = null;
        this.dead = false; this.age = 0; this.grabbed = false; this.impactT = 0;
        this.burning = 0; this.cracks = 0; this._margin = 0; this._touch = false;
    }
    idx(x, y, z) { return x + this.sx * (z + this.sz * y); }
    get(x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
        return this.grid[x + this.sx * (z + this.sz * y)];
    }
    /** Сетка с рамкой в 1 воксель для мешера. */
    padded() {
        const px = this.sx + 2, pz = this.sz + 2, py = this.sy + 2;
        const out = new Uint8Array(px * py * pz);
        for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) {
            const src = this.sx * (z + this.sz * y), dst = 1 + px * ((z + 1) + pz * (y + 1));
            out.set(this.grid.subarray(src, src + this.sx), dst);
        }
        return out;
    }
}

/** @satisfies {Record<string, any>} */
const VoxPhysics = {
    vs: 0.1,
    /** @type {VoxWorld | null} */
    world: null,
    /** @type {VoxBody[]} */
    bodies: [],
    _id: 1,
    acc: 0,
    alpha: 1,
    steps: 0,
    /** @type {any[]} */
    manifolds: [],
    /** @type {Map<number, Map<number, number[]>>} */
    cache: new Map(),
    /** @type {{ body: VoxBody, local: number[], target: number[], hertz: number, zeta: number, maxForce: number, acc: number[] }[]} */
    joints: [],
    /** @type {((a: VoxBody, b: VoxBody | null, p: number[], speed: number, impulse: number, pts: number[][]) => void) | null} */
    onImpact: null,
    stats: { bodies: 0, awake: 0, manifolds: 0, points: 0, ms: 0 },


    /**
     * Детализация физики по уровню графики (VoxRender.quality): на максимуме мелкие куски — настоящие
     * тела (от 3 вокселей), тел почти вдвое больше, больше подшагов решателя, крупное колется чаще.
     * Константы RL_* — база среднего уровня.
     */
    detail() {
        const q = typeof VoxRender !== 'undefined' && VoxRender.quality ? VoxRender.quality : 'high';
        if (this._detailQ === q && this._detailV) return this._detailV;
        const base = typeof RL_DEBRIS_MIN !== 'undefined' ? RL_DEBRIS_MIN : 7;
        const maxB = typeof RL_MAX_BODIES !== 'undefined' ? RL_MAX_BODIES : 360;
        const sub = Math.max(1, (typeof RL_SUBSTEPS !== 'undefined' ? RL_SUBSTEPS : 4) | 0);
        let d;
        // минимум: мелкие куски — в частицы, тел мало, 2 подшага, без раскола — тянет на слабом железе
        if (q === 'low') d = { minBody: base + 5, maxBodies: Math.round(maxB * 0.35), substeps: 2, crackE: 1e12, cracks: 0, blastCracks: 0, blastChunks: 0 };
        else if (q === 'medium') d = { minBody: base, maxBodies: maxB, substeps: sub, crackE: 38000, cracks: 3, blastCracks: 2, blastChunks: 14 };
        else d = { minBody: Math.max(2, Math.round(base * 0.45)), maxBodies: Math.round(maxB * 1.9), substeps: sub + 1, crackE: 20000, cracks: 5, blastCracks: 3, blastChunks: 32 };
        this._detailQ = q; this._detailV = d;
        return d;
    },
    _detailQ: '',
    _loadMs: 0,
    /** @type {any} */
    _detailV: null,

    /** @param {VoxWorld} world */
    init(world) {
        this.world = world;
        this.vs = world.vs;
        for (const b of this.bodies) if (!b.dead) { b.dead = true; if (typeof VoxRender !== 'undefined') VoxRender.disposeBodyView(b); }
        this.manifolds = [];
        this.acc = 0;
        this.bodies = [];
        this.cache = new Map();
        this.joints = [];
    },

    // =================================================================== тела

    /**
     * Тело из сетки вокселей: grid (x + sx·(z + sz·y)), смещение карты (ox, oy, oz) — сетка стоит
     * на своём месте в вокселях мира без поворота. null — если вокселей меньше minCount.
     */
    createBody(grid, sx, sy, sz, ox, oy, oz, opts = {}) {
        const b = new VoxBody(this._id++, sx, sy, sz, grid, ox, oy, oz);
        if (!this.recompute(b) || b.count < (opts.minCount != null ? opts.minCount : 1)) return null;
        const vs = this.vs;
        b.x[0] = ox * vs + b.com[0]; b.x[1] = oy * vs + b.com[1]; b.x[2] = oz * vs + b.com[2];
        if (opts.q) { b.q.set(opts.q); }
        if (opts.x) { b.x.set(opts.x); }
        if (opts.v) b.v.set(opts.v);
        if (opts.w) b.w.set(opts.w);
        this._syncR(b);
        b.px.set(b.x); b.pq.set(b.q);
        b.sleeping = !!opts.sleep;
        this.bodies.push(b);
        if (typeof VoxRender !== 'undefined' && VoxRender.scene) { VoxRender.makeBodyView(b); this._syncView(b, 1); }
        return b;
    },

    /** Масса, центр масс, инерция, сэмплы. false — тело пустое. */
    recompute(b) {
        const vs = this.vs, vv = vs * vs * vs;
        const { sx, sy, sz, grid } = b;
        let M = 0, cx = 0, cy = 0, cz = 0, sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0, fr = 0, re = 0, cnt = 0, brittle = 99, expl = 0;
        /** @type {Record<string, number>} */
        const snd = {};
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
            let i = sx * (z + sz * y);
            for (let x = 0; x < sx; x++, i++) {
                const v = grid[i];
                if (!v) continue;
                const mt = VoxMat.of(v);
                const m = mt.density * vv;
                const px = (x + 0.5) * vs, py = (y + 0.5) * vs, pz = (z + 0.5) * vs;
                M += m; cx += m * px; cy += m * py; cz += m * pz;
                sxx += m * px * px; syy += m * py * py; szz += m * pz * pz;
                sxy += m * px * py; sxz += m * px * pz; syz += m * py * pz;
                fr += mt.friction * m; re += mt.restitution * m; cnt++;
                snd[mt.sound] = (snd[mt.sound] || 0) + m;
                if (mt.brittle) brittle = Math.min(brittle, mt.brittle);
                if (mt.explosive) expl++;
            }
        }
        b.count = cnt;
        if (!cnt) return false;
        cx /= M; cy /= M; cz /= M;
        b.com[0] = cx; b.com[1] = cy; b.com[2] = cz;
        b.mass = M; b.invMass = 1 / M;
        b.friction = fr / M; b.restitution = re / M;
        b.brittle = brittle < 99 ? brittle : 0;
        b.explosive = expl;
        let best = 'concrete', bm = -1;
        for (const k in snd) if (snd[k] > bm) { bm = snd[k]; best = k; }
        b.sound = best;
        const cube = M * vs * vs / 6;
        let Ixx = (syy + szz) - M * (cy * cy + cz * cz) + cube;
        let Iyy = (sxx + szz) - M * (cx * cx + cz * cz) + cube;
        let Izz = (sxx + syy) - M * (cx * cx + cy * cy) + cube;
        const Ixy = -(sxy - M * cx * cy), Ixz = -(sxz - M * cx * cz), Iyz = -(syz - M * cy * cz);
        // тонкие стержни и пластины: нижний предел инерции (иначе крутятся неустойчиво)
        const minI = M * (vs * 1.6) * (vs * 1.6) / 6;
        Ixx = Math.max(Ixx, minI); Iyy = Math.max(Iyy, minI); Izz = Math.max(Izz, minI);
        this._inv3([Ixx, Ixy, Ixz, Ixy, Iyy, Iyz, Ixz, Iyz, Izz], b.Il);
        // габарит
        let r2 = 0;
        for (const ex of [0, sx * vs]) for (const ey of [0, sy * vs]) for (const ez of [0, sz * vs]) {
            r2 = Math.max(r2, (ex - cx) ** 2 + (ey - cy) ** 2 + (ez - cz) ** 2);
        }
        b.radius = Math.sqrt(r2);
        this._buildSamples(b);
        return true;
    },

    _buildSamples(b) {
        const { sx, sy, sz, grid } = b, vs = this.vs;
        const surf = [];
        let edges = 0;
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
            const i = x + sx * (z + sz * y);
            if (!grid[i]) continue;
            const open = (b.get(x - 1, y, z) ? 0 : 1) + (b.get(x + 1, y, z) ? 0 : 1) + (b.get(x, y - 1, z) ? 0 : 1)
                + (b.get(x, y + 1, z) ? 0 : 1) + (b.get(x, y, z - 1) ? 0 : 1) + (b.get(x, y, z + 1) ? 0 : 1);
            if (!open) continue;
            surf.push(x, y, z, open, i);
            if (open >= 2) edges++;
        }
        const n = surf.length / 5;
        let keepMod = 1;
        if (n > 150) keepMod = 2;
        if (n > 2400) keepMod = 3;
        if (n > 6000) keepMod = 4;
        const pts = [], keys = [];
        for (let k = 0; k < n; k++) {
            const x = surf[k * 5], y = surf[k * 5 + 1], z = surf[k * 5 + 2], open = surf[k * 5 + 3];
            if (keepMod > 1 && open < 2 && ((x + y + z) % keepMod) !== 0) continue;
            if (keepMod > 2 && open < 3 && open >= 2 && ((x + y * 3 + z * 5) % 2) !== 0) continue;
            pts.push((x + 0.5) * vs - b.com[0], (y + 0.5) * vs - b.com[1], (z + 0.5) * vs - b.com[2]);
            keys.push(surf[k * 5 + 4]);
        }
        b.samples = new Float32Array(pts);
        b.sampleKey = new Int32Array(keys);
        b.ns = keys.length;
    },

    _inv3(m, out) {
        const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
        const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
        let det = a * A + b * B + c * C;
        if (Math.abs(det) < 1e-18) det = 1e-18;
        const inv = 1 / det;
        out[0] = A * inv; out[1] = -(b * i - c * h) * inv; out[2] = (b * f - c * e) * inv;
        out[3] = B * inv; out[4] = (a * i - c * g) * inv; out[5] = -(a * f - c * d) * inv;
        out[6] = C * inv; out[7] = -(a * h - b * g) * inv; out[8] = (a * e - b * d) * inv;
        return out;
    },

    /** R и обратная инерция в мире из q. */
    _syncR(b) {
        const q = b.q, R = b.R;
        const x = q[0], y = q[1], z = q[2], w = q[3];
        R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
        R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
        R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
        // Iw = R · Il · Rᵀ
        const I = b.Il, T = this._t9 || (this._t9 = new Float64Array(9)), O = b.Iw;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[r * 3 + c] = R[r * 3] * I[c] + R[r * 3 + 1] * I[3 + c] + R[r * 3 + 2] * I[6 + c];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) O[r * 3 + c] = T[r * 3] * R[c * 3] + T[r * 3 + 1] * R[c * 3 + 1] + T[r * 3 + 2] * R[c * 3 + 2];
    },

    _updateAABB(b, margin) {
        const vs = this.vs, R = b.R, c = b.com;
        const lx0 = -c[0], ly0 = -c[1], lz0 = -c[2], lx1 = b.sx * vs - c[0], ly1 = b.sy * vs - c[1], lz1 = b.sz * vs - c[2];
        const cx = (lx0 + lx1) / 2, cy = (ly0 + ly1) / 2, cz = (lz0 + lz1) / 2;
        const hx = (lx1 - lx0) / 2, hy = (ly1 - ly0) / 2, hz = (lz1 - lz0) / 2;
        const wx = b.x[0] + R[0] * cx + R[1] * cy + R[2] * cz;
        const wy = b.x[1] + R[3] * cx + R[4] * cy + R[5] * cz;
        const wz = b.x[2] + R[6] * cx + R[7] * cy + R[8] * cz;
        const ex = Math.abs(R[0]) * hx + Math.abs(R[1]) * hy + Math.abs(R[2]) * hz + margin;
        const ey = Math.abs(R[3]) * hx + Math.abs(R[4]) * hy + Math.abs(R[5]) * hz + margin;
        const ez = Math.abs(R[6]) * hx + Math.abs(R[7]) * hy + Math.abs(R[8]) * hz + margin;
        const a = b.aabb;
        a[0] = wx - ex; a[1] = wy - ey; a[2] = wz - ez; a[3] = wx + ex; a[4] = wy + ey; a[5] = wz + ez;
    },

    /** Вынуть из мира все воксели ящика [x0,x1)… — каждый связный кусок становится телом. */
    extractRegion(x0, y0, z0, x1, y1, z1, opts = {}) {
        const w = this.world;
        const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
        if (sx <= 0 || sy <= 0 || sz <= 0) return [];
        const seen = new Uint8Array(sx * sy * sz);
        const out = [];
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
            const li = x + sx * (z + sz * y);
            if (seen[li] || !w.get(x0 + x, y0 + y, z0 + z)) continue;
            // заливка внутри ящика
            const list = [li]; seen[li] = 1;
            for (let k = 0; k < list.length; k++) {
                const c = list[k];
                const cx = c % sx, cz = ((c / sx) | 0) % sz, cy = (c / (sx * sz)) | 0;
                const nb = [[cx - 1, cy, cz], [cx + 1, cy, cz], [cx, cy - 1, cz], [cx, cy + 1, cz], [cx, cy, cz - 1], [cx, cy, cz + 1]];
                for (const [nx, ny, nz] of nb) {
                    if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
                    const ni = nx + sx * (nz + sz * ny);
                    if (seen[ni] || !w.get(x0 + nx, y0 + ny, z0 + nz)) continue;
                    seen[ni] = 1; list.push(ni);
                }
            }
            const idx = new Int32Array(list.length);
            for (let k = 0; k < list.length; k++) {
                const c = list[k];
                const cx = c % sx, cz = ((c / sx) | 0) % sz, cy = (c / (sx * sz)) | 0;
                idx[k] = w.idx(x0 + cx, y0 + cy, z0 + cz);
            }
            const b = this.fromWorld(idx, { sleep: opts.sleep, minCount: 1 });
            if (b) out.push(b);
        }
        return out;
    },

    /**
     * Кусок мира (индексы вокселей) -> тело; воксели уходят из мира. Если кусок меньше minCount —
     * воксели всё равно убираются, а возвращается { debris: [[wx,wy,wz,v]…] } (мир, м) для частиц.
     */
    fromWorld(indices, opts = {}) {
        const w = this.world;
        let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1, mxy = -1, mxz = -1;
        const mx = w.sx - 1, mz = w.sz - 1;
        for (let k = 0; k < indices.length; k++) {
            const i = indices[k];
            const x = i & mx, z = (i >> w.bx) & mz, y = i >> w.by;
            if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
            if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
        }
        const sx = mxx - mnx + 1, sy = mxy - mny + 1, sz = mxz - mnz + 1;
        const minCount = opts.minCount != null ? opts.minCount : this.detail().minBody;
        if (indices.length < minCount) {
            const debris = [];
            for (let k = 0; k < indices.length; k++) {
                const i = indices[k];
                const x = i & mx, z = (i >> w.bx) & mz, y = i >> w.by;
                debris.push([(x + 0.5) * w.vs, (y + 0.5) * w.vs, (z + 0.5) * w.vs, w.data[i]]);
                w.set(x, y, z, 0);
            }
            return { debris };
        }
        const grid = new Uint8Array(sx * sy * sz);
        for (let k = 0; k < indices.length; k++) {
            const i = indices[k];
            const x = i & mx, z = (i >> w.bx) & mz, y = i >> w.by;
            grid[(x - mnx) + sx * ((z - mnz) + sz * (y - mny))] = w.data[i];
            w.set(x, y, z, 0);
        }
        return this.createBody(grid, sx, sy, sz, mnx, mny, mnz, opts);
    },

    remove(b) {
        if (b.dead) return;
        b.dead = true;
        this.joints = this.joints.filter(j => j.body !== b);
        if (typeof VoxRender !== 'undefined') VoxRender.disposeBodyView(b);
    },

    wake(b) { if (b.sleeping) { b.sleeping = false; b.sleepT = 0; } },
    /** Разбудить тела, задевающие ящик (метры). */
    wakeInBox(x0, y0, z0, x1, y1, z1) {
        for (const b of this.bodies) {
            if (b.dead || !b.sleeping) continue;
            const a = b.aabb;
            if (a[3] < x0 || a[0] > x1 || a[4] < y0 || a[1] > y1 || a[5] < z0 || a[2] > z1) continue;
            this.wake(b);
        }
    },

    /** Импульс J (Н·с) в точке p (мир). */
    applyImpulse(b, px, py, pz, jx, jy, jz) {
        if (b.dead) return;
        this.wake(b);
        const im = b.invMass;
        b.v[0] += jx * im; b.v[1] += jy * im; b.v[2] += jz * im;
        const rx = px - b.x[0], ry = py - b.x[1], rz = pz - b.x[2];
        const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx;
        const I = b.Iw;
        b.w[0] += I[0] * tx + I[1] * ty + I[2] * tz;
        b.w[1] += I[3] * tx + I[4] * ty + I[5] * tz;
        b.w[2] += I[6] * tx + I[7] * ty + I[8] * tz;
    },

    pointVelocity(b, px, py, pz) {
        const rx = px - b.x[0], ry = py - b.x[1], rz = pz - b.x[2];
        return [b.v[0] + b.w[1] * rz - b.w[2] * ry, b.v[1] + b.w[2] * rx - b.w[0] * rz, b.v[2] + b.w[0] * ry - b.w[1] * rx];
    },

    /** Точка мира -> координаты в сетке тела (вокселей, дробные). */
    toLocal(b, px, py, pz, out) {
        const R = b.R, dx = px - b.x[0], dy = py - b.x[1], dz = pz - b.x[2];
        const k = 1 / this.vs;
        out[0] = ((R[0] * dx + R[3] * dy + R[6] * dz) + b.com[0]) * k;
        out[1] = ((R[1] * dx + R[4] * dy + R[7] * dz) + b.com[1]) * k;
        out[2] = ((R[2] * dx + R[5] * dy + R[8] * dz) + b.com[2]) * k;
        return out;
    },
    /** Центр вокселя (lx, ly, lz) тела -> мир. */
    toWorld(b, lx, ly, lz, out) {
        const vs = this.vs, R = b.R;
        const x = (lx + 0.5) * vs - b.com[0], y = (ly + 0.5) * vs - b.com[1], z = (lz + 0.5) * vs - b.com[2];
        out[0] = b.x[0] + R[0] * x + R[1] * y + R[2] * z;
        out[1] = b.x[1] + R[3] * x + R[4] * y + R[5] * z;
        out[2] = b.x[2] + R[6] * x + R[7] * y + R[8] * z;
        return out;
    },

    /**
     * Луч по телам: ближайшее попадание { body, x, y, z (воксель тела), t, nx, ny, nz (мир), v } или null.
     */
    raycastBodies(ox, oy, oz, dx, dy, dz, maxDist) {
        let best = null;
        const L = [0, 0, 0];
        for (const b of this.bodies) {
            if (b.dead) continue;
            // сфера-габарит
            const cx = b.x[0] - ox, cy = b.x[1] - oy, cz = b.x[2] - oz;
            const tc = cx * dx + cy * dy + cz * dz;
            const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
            if (d2 > b.radius * b.radius || tc < -b.radius || tc - b.radius > maxDist) continue;
            const R = b.R, k = 1 / this.vs;
            this.toLocal(b, ox, oy, oz, L);
            const ldx = R[0] * dx + R[3] * dy + R[6] * dz, ldy = R[1] * dx + R[4] * dy + R[7] * dz, ldz = R[2] * dx + R[5] * dy + R[8] * dz;
            const hit = this._gridRay(b, L[0], L[1], L[2], ldx, ldy, ldz, (best ? best.t : maxDist) * k);
            if (hit) {
                const t = hit.t * this.vs;
                if (!best || t < best.t) {
                    const n = hit.n;
                    best = { body: b, x: hit.x, y: hit.y, z: hit.z, t, v: hit.v,
                        nx: R[0] * n[0] + R[1] * n[1] + R[2] * n[2], ny: R[3] * n[0] + R[4] * n[1] + R[5] * n[2], nz: R[6] * n[0] + R[7] * n[1] + R[8] * n[2] };
                }
            }
        }
        return best;
    },

    /** DDA по сетке тела в её координатах (вокселях). */
    _gridRay(b, px, py, pz, dx, dy, dz, maxT) {
        // вход в габарит сетки
        let t0 = 0, t1 = maxT;
        const lo = [0, 0, 0], hi = [b.sx, b.sy, b.sz], p = [px, py, pz], d = [dx, dy, dz];
        for (let a = 0; a < 3; a++) {
            if (Math.abs(d[a]) < 1e-12) { if (p[a] < lo[a] || p[a] > hi[a]) return null; continue; }
            let ta = (lo[a] - p[a]) / d[a], tb = (hi[a] - p[a]) / d[a];
            if (ta > tb) { const s = ta; ta = tb; tb = s; }
            if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
            if (t0 > t1) return null;
        }
        const e = 1e-6;
        let x = Math.floor(px + dx * (t0 + e)), y = Math.floor(py + dy * (t0 + e)), z = Math.floor(pz + dz * (t0 + e));
        const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
        const tdx = dx ? Math.abs(1 / dx) : 1e30, tdy = dy ? Math.abs(1 / dy) : 1e30, tdz = dz ? Math.abs(1 / dz) : 1e30;
        const qx = px + dx * t0, qy = py + dy * t0, qz = pz + dz * t0;
        let tmx = dx ? t0 + ((sx > 0 ? (x + 1 - qx) : (qx - x)) * tdx) : 1e30;
        let tmy = dy ? t0 + ((sy > 0 ? (y + 1 - qy) : (qy - y)) * tdy) : 1e30;
        let tmz = dz ? t0 + ((sz > 0 ? (z + 1 - qz) : (qz - z)) * tdz) : 1e30;
        // нормаль входа — по оси, где был t0
        let n = [0, 0, 0];
        {
            const ta = [(dx ? ((dx > 0 ? 0 : b.sx) - px) / dx : -1e30), (dy ? ((dy > 0 ? 0 : b.sy) - py) / dy : -1e30), (dz ? ((dz > 0 ? 0 : b.sz) - pz) / dz : -1e30)];
            const ax = ta[0] >= ta[1] && ta[0] >= ta[2] ? 0 : (ta[1] >= ta[2] ? 1 : 2);
            n[ax] = -(ax === 0 ? sx : ax === 1 ? sy : sz);
        }
        let t = t0;
        for (let guard = 0; guard < 2048; guard++) {
            if (x < 0 || y < 0 || z < 0 || x >= b.sx || y >= b.sy || z >= b.sz) { if (t > t0 + 1) return null; }
            else {
                const v = b.grid[x + b.sx * (z + b.sz * y)];
                if (v) return { x, y, z, t, n, v };
            }
            if (tmx < tmy) {
                if (tmx < tmz) { x += sx; t = tmx; tmx += tdx; n = [-sx, 0, 0]; } else { z += sz; t = tmz; tmz += tdz; n = [0, 0, -sz]; }
            } else {
                if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; n = [0, -sy, 0]; } else { z += sz; t = tmz; tmz += tdz; n = [0, 0, -sz]; }
            }
            if (t > t1) return null;
        }
        return null;
    },

    /**
     * Убрать воксели тела (список [x,y,z] сетки) и разделить на связные куски. Возвращает
     * { removed: [[wx,wy,wz,v]…] (мир, для частиц), bodies: новые тела, debris: мелочь [[wx,wy,wz,v]…] }.
     */
    carveBody(b, list) {
        const removed = [];
        const W = [0, 0, 0];
        for (const [x, y, z] of list) {
            const i = b.idx(x, y, z);
            const v = b.grid[i];
            if (!v) continue;
            this.toWorld(b, x, y, z, W);
            removed.push([W[0], W[1], W[2], v]);
            b.grid[i] = 0;
        }
        if (!removed.length) return { removed, bodies: [], debris: [] };
        const res = this.split(b);
        return { removed, bodies: res.bodies, debris: res.debris };
    },

    /** Разбить тело на связные куски (после правки сетки). */
    split(b) {
        const { sx, sy, sz, grid } = b;
        const n = sx * sy * sz;
        const label = new Int32Array(n);
        /** @type {number[][]} */
        const comps = [];
        for (let i = 0; i < n; i++) {
            if (!grid[i] || label[i]) continue;
            const list = [i]; label[i] = comps.length + 1;
            for (let k = 0; k < list.length; k++) {
                const c = list[k];
                const x = c % sx, z = ((c / sx) | 0) % sz, y = (c / (sx * sz)) | 0;
                if (x > 0 && grid[c - 1] && !label[c - 1]) { label[c - 1] = comps.length + 1; list.push(c - 1); }
                if (x < sx - 1 && grid[c + 1] && !label[c + 1]) { label[c + 1] = comps.length + 1; list.push(c + 1); }
                if (z > 0 && grid[c - sx] && !label[c - sx]) { label[c - sx] = comps.length + 1; list.push(c - sx); }
                if (z < sz - 1 && grid[c + sx] && !label[c + sx]) { label[c + sx] = comps.length + 1; list.push(c + sx); }
                const L = sx * sz;
                if (y > 0 && grid[c - L] && !label[c - L]) { label[c - L] = comps.length + 1; list.push(c - L); }
                if (y < sy - 1 && grid[c + L] && !label[c + L]) { label[c + L] = comps.length + 1; list.push(c + L); }
            }
            comps.push(list);
        }
        const bodies = [], debris = [];
        const W = [0, 0, 0];
        if (!comps.length) { this.remove(b); return { bodies, debris }; }
        comps.sort((a, c) => c.length - a.length);
        const minCount = this.detail().minBody;
        const oldX = [b.x[0], b.x[1], b.x[2]], oldCom = [b.com[0], b.com[1], b.com[2]];
        const vs = this.vs;
        // куски, кроме самого большого, — новые тела (или обломки)
        for (let ci = 1; ci < comps.length; ci++) {
            const list = comps[ci];
            if (list.length < minCount) {
                for (const c of list) {
                    const x = c % sx, z = ((c / sx) | 0) % sz, y = (c / (sx * sz)) | 0;
                    this.toWorld(b, x, y, z, W);
                    debris.push([W[0], W[1], W[2], grid[c]]);
                    grid[c] = 0;
                }
                continue;
            }
            let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1, mxy = -1, mxz = -1;
            for (const c of list) {
                const x = c % sx, z = ((c / sx) | 0) % sz, y = (c / (sx * sz)) | 0;
                if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
                if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
            }
            const nsx = mxx - mnx + 1, nsy = mxy - mny + 1, nsz = mxz - mnz + 1;
            const g2 = new Uint8Array(nsx * nsy * nsz);
            for (const c of list) {
                const x = c % sx, z = ((c / sx) | 0) % sz, y = (c / (sx * sz)) | 0;
                g2[(x - mnx) + nsx * ((z - mnz) + nsz * (y - mny))] = grid[c];
                grid[c] = 0;
            }
            const nb = new VoxBody(this._id++, nsx, nsy, nsz, g2, b.ox + mnx, b.oy + mny, b.oz + mnz);
            if (!this.recompute(nb)) continue;
            // центр масс нового куска в осях старого тела
            const lc = [mnx * vs + nb.com[0] - oldCom[0], mny * vs + nb.com[1] - oldCom[1], mnz * vs + nb.com[2] - oldCom[2]];
            const R = b.R;
            nb.x[0] = oldX[0] + R[0] * lc[0] + R[1] * lc[1] + R[2] * lc[2];
            nb.x[1] = oldX[1] + R[3] * lc[0] + R[4] * lc[1] + R[5] * lc[2];
            nb.x[2] = oldX[2] + R[6] * lc[0] + R[7] * lc[1] + R[8] * lc[2];
            nb.q.set(b.q);
            const pv = this.pointVelocity(b, nb.x[0], nb.x[1], nb.x[2]);
            nb.v[0] = pv[0]; nb.v[1] = pv[1]; nb.v[2] = pv[2];
            nb.w.set(b.w);
            this._syncR(nb);
            nb.px.set(nb.x); nb.pq.set(nb.q);
            nb.burning = b.burning;
            this.bodies.push(nb);
            if (typeof VoxRender !== 'undefined') { VoxRender.makeBodyView(nb); this._syncView(nb, 1); }
            bodies.push(nb);
        }
        // главный кусок: обрезать сетку до габарита и пересчитать массу (центр масс сдвигается)
        const main = comps[0];
        if (main.length < minCount) {
            for (const c of main) {
                const x = c % sx, z = ((c / sx) | 0) % sz, y = (c / (sx * sz)) | 0;
                this.toWorld(b, x, y, z, W);
                debris.push([W[0], W[1], W[2], grid[c]]);
            }
            this.remove(b);
            return { bodies, debris };
        }
        this._shrink(b);
        this.wake(b);
        return { bodies, debris };
    },

    /** Обрезать сетку тела до занятого габарита, пересчитать массу, сохранить положение вокселей. */
    _shrink(b) {
        const { sx, sy, sz, grid } = b;
        let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1, mxy = -1, mxz = -1;
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
            if (!grid[x + sx * (z + sz * y)]) continue;
            if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
            if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
        }
        const vs = this.vs;
        const oldCom = [b.com[0], b.com[1], b.com[2]];
        if (mnx > 0 || mny > 0 || mnz > 0 || mxx < sx - 1 || mxy < sy - 1 || mxz < sz - 1) {
            const nsx = mxx - mnx + 1, nsy = mxy - mny + 1, nsz = mxz - mnz + 1;
            const g2 = new Uint8Array(nsx * nsy * nsz);
            for (let y = 0; y < nsy; y++) for (let z = 0; z < nsz; z++) {
                const src = (mnx) + sx * ((z + mnz) + sz * (y + mny));
                g2.set(grid.subarray(src, src + nsx), nsx * (z + nsz * y));
            }
            b.grid = g2; b.sx = nsx; b.sy = nsy; b.sz = nsz;
            b.ox += mnx; b.oy += mny; b.oz += mnz;
        } else { mnx = mny = mnz = 0; }
        this.recompute(b);
        // сдвиг центра масс в осях тела
        const d = [mnx * vs + b.com[0] - oldCom[0], mny * vs + b.com[1] - oldCom[1], mnz * vs + b.com[2] - oldCom[2]];
        const R = b.R;
        const wx = R[0] * d[0] + R[1] * d[1] + R[2] * d[2], wy = R[3] * d[0] + R[4] * d[1] + R[5] * d[2], wz = R[6] * d[0] + R[7] * d[1] + R[8] * d[2];
        // скорость точки нового центра
        const pv = this.pointVelocity(b, b.x[0] + wx, b.x[1] + wy, b.x[2] + wz);
        b.x[0] += wx; b.x[1] += wy; b.x[2] += wz;
        b.px[0] += wx; b.px[1] += wy; b.px[2] += wz;
        b.v[0] = pv[0]; b.v[1] = pv[1]; b.v[2] = pv[2];
        this._syncR(b);
        if (typeof VoxRender !== 'undefined') VoxRender.rebuildBodyView(b);
    },

    // =================================================================== контакты

    _pool: /** @type {any[]} */ ([]),
    _np: 0,
    _pt() {
        let p = this._pool[this._np];
        if (!p) { p = this._pool[this._np] = { rAx: 0, rAy: 0, rAz: 0, rBx: 0, rBy: 0, rBz: 0, sep: 0, nm: 0, tm1: 0, tm2: 0, jn: 0, jt1: 0, jt2: 0, vn0: 0, maxJn: 0, key: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, d: 0 }; }
        this._np++;
        return p;
    },

    /**
     * Сэмплы тела a против сетки (мир, если other = null, иначе тело other). Контакты (нормаль от
     * другого к a) — в raw. margin — упреждение (м).
     */
    _collide(a, other, margin, raw) {
        const vs = this.vs, k = 1 / vs;
        const S = a.samples, ns = a.ns, R = a.R;
        const r = vs * 0.5;
        const rr = (r + margin) * k;          // в вокселях
        const r0 = r * k;
        const w = this.world;
        let get, Rb = null, bx = 0, by = 0, bz = 0, cbx = 0, cby = 0, cbz = 0;
        if (!other) get = (x, y, z) => w.get(x, y, z);
        else {
            const o = other;
            get = (x, y, z) => o.get(x, y, z);
            Rb = o.R; bx = o.x[0]; by = o.x[1]; bz = o.x[2]; cbx = o.com[0] * k; cby = o.com[1] * k; cbz = o.com[2] * k;
        }
        const ax = a.x[0], ay = a.x[1], az = a.x[2];
        // быстрый крупный кусок (разлёт после взрыва) — каждый 2-й или 4-й сэмпл: упреждение margin и так велико
        const spd = Math.abs(a.v[0]) + Math.abs(a.v[1]) + Math.abs(a.v[2]);
        const stride = ns > 64 && spd > 8 ? (spd > 18 ? 4 : 2) : 1;
        for (let i = 0; i < ns; i += stride) {
            const lx = S[i * 3], ly = S[i * 3 + 1], lz = S[i * 3 + 2];
            const wx = ax + R[0] * lx + R[1] * ly + R[2] * lz;
            const wy = ay + R[3] * lx + R[4] * ly + R[5] * lz;
            const wz = az + R[6] * lx + R[7] * ly + R[8] * lz;
            let gx, gy, gz;
            if (!Rb) { gx = wx * k; gy = wy * k; gz = wz * k; }
            else {
                // габарит другого тела в мире — до поворота в его оси
                const oa = other.aabb, pad = r + margin;
                if (wx < oa[0] - pad || wx > oa[3] + pad || wy < oa[1] - pad || wy > oa[4] + pad || wz < oa[2] - pad || wz > oa[5] + pad) continue;
                const dx = wx - bx, dy = wy - by, dz = wz - bz;
                gx = (Rb[0] * dx + Rb[3] * dy + Rb[6] * dz) * k + cbx;
                gy = (Rb[1] * dx + Rb[4] * dy + Rb[7] * dz) * k + cby;
                gz = (Rb[2] * dx + Rb[5] * dy + Rb[8] * dz) * k + cbz;
                if (gx < -rr || gy < -rr || gz < -rr || gx > other.sx + rr || gy > other.sy + rr || gz > other.sz + rr) continue;
            }
            const x0 = Math.floor(gx - rr), x1 = Math.floor(gx + rr);
            const y0 = Math.floor(gy - rr), y1 = Math.floor(gy + rr);
            const z0 = Math.floor(gz - rr), z1 = Math.floor(gz + rr);
            if (!other) {
                // мир: пустые кирпичи 8³ вокруг сэмпла — сразу дальше (падающее тело почти всё в воздухе)
                const bx0 = Math.max(0, x0 >> 3), bx1 = Math.min(w.brx - 1, x1 >> 3), by0 = Math.max(0, y0 >> 3), by1 = Math.min(w.bry - 1, y1 >> 3);
                const bz0 = Math.max(0, z0 >> 3), bz1 = Math.min(w.brz - 1, z1 >> 3);
                let any = false;
                for (let by = by0; by <= by1 && !any; by++) for (let bz = bz0; bz <= bz1 && !any; bz++) for (let bx = bx0; bx <= bx1; bx++) {
                    if (w.brick[bx + bz * w.brx + by * w.brx * w.brz]) { any = true; break; }
                }
                if (!any) continue;
            }
            let best = -1e9, bnx = 0, bny = 0, bnz = 0;
            for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
                if (!get(cx, cy, cz)) continue;
                const qx = gx < cx ? cx : (gx > cx + 1 ? cx + 1 : gx);
                const qy = gy < cy ? cy : (gy > cy + 1 ? cy + 1 : gy);
                const qz = gz < cz ? cz : (gz > cz + 1 ? cz + 1 : gz);
                const dx = gx - qx, dy = gy - qy, dz = gz - qz;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > rr * rr) continue;
                let nx, ny, nz, depth;
                if (d2 > 1e-10) {
                    const d = Math.sqrt(d2);
                    nx = dx / d; ny = dy / d; nz = dz / d; depth = r0 - d;
                } else {
                    // центр сферы внутри куба: выход через ближайшую открытую грань
                    let bd = 1e9; nx = 0; ny = 1; nz = 0;
                    const fx0 = gx - cx, fx1 = cx + 1 - gx, fy0 = gy - cy, fy1 = cy + 1 - gy, fz0 = gz - cz, fz1 = cz + 1 - gz;
                    if (fy1 < bd && !get(cx, cy + 1, cz)) { bd = fy1; nx = 0; ny = 1; nz = 0; }
                    if (fx0 < bd && !get(cx - 1, cy, cz)) { bd = fx0; nx = -1; ny = 0; nz = 0; }
                    if (fx1 < bd && !get(cx + 1, cy, cz)) { bd = fx1; nx = 1; ny = 0; nz = 0; }
                    if (fz0 < bd && !get(cx, cy, cz - 1)) { bd = fz0; nx = 0; ny = 0; nz = -1; }
                    if (fz1 < bd && !get(cx, cy, cz + 1)) { bd = fz1; nx = 0; ny = 0; nz = 1; }
                    if (fy0 < bd && !get(cx, cy - 1, cz)) { bd = fy0; nx = 0; ny = -1; nz = 0; }
                    if (bd > 1e8) bd = fy1;
                    depth = r0 + bd;
                }
                if (depth > best) { best = depth; bnx = nx; bny = ny; bnz = nz; }
            }
            if (best < -margin * k) continue;
            // нормаль в мир
            let nx = bnx, ny = bny, nz = bnz;
            if (Rb) {
                nx = Rb[0] * bnx + Rb[1] * bny + Rb[2] * bnz;
                ny = Rb[3] * bnx + Rb[4] * bny + Rb[5] * bnz;
                nz = Rb[6] * bnx + Rb[7] * bny + Rb[8] * bnz;
            }
            raw.push(wx - nx * r, wy - ny * r, wz - nz * r, nx, ny, nz, best * vs, a.sampleKey[i]);
        }
    },

    /**
     * Сжать сырые контакты (8 чисел на точку) до манифолда: кластеры нормалей (до 3), в каждом —
     * до 4 точек (глубочайшая, дальняя, максимум площади). Возвращает индексы выбранных точек.
     */
    _reduce(raw) {
        const n = raw.length / 8;
        if (n <= 4) { const out = []; for (let i = 0; i < n; i++) out.push(i); return out; }
        /** @type {{ nx: number, ny: number, nz: number, items: number[] }[]} */
        const clusters = [];
        for (let i = 0; i < n; i++) {
            const nx = raw[i * 8 + 3], ny = raw[i * 8 + 4], nz = raw[i * 8 + 5];
            let c = null;
            for (const cl of clusters) if (cl.nx * nx + cl.ny * ny + cl.nz * nz > 0.9) { c = cl; break; }
            if (!c) { if (clusters.length >= 4) { c = clusters[0]; let bd = -2; for (const cl of clusters) { const d = cl.nx * nx + cl.ny * ny + cl.nz * nz; if (d > bd) { bd = d; c = cl; } } } else { c = { nx, ny, nz, items: [] }; clusters.push(c); } }
            c.items.push(i);
        }
        const out = [];
        // глубокие кластеры — первыми
        const depthOf = (cl) => { let d = -1e9; for (const i of cl.items) d = Math.max(d, raw[i * 8 + 6]); return d; };
        clusters.sort((a, b) => depthOf(b) - depthOf(a) || b.items.length - a.items.length);
        for (let ci = 0; ci < Math.min(3, clusters.length); ci++) {
            const it = clusters[ci].items;
            if (it.length <= 4) { out.push(...it); continue; }
            const P = (i) => [raw[i * 8], raw[i * 8 + 1], raw[i * 8 + 2]];
            const cn = [clusters[ci].nx, clusters[ci].ny, clusters[ci].nz];
            // 1: глубочайшая
            let a = it[0];
            for (const i of it) if (raw[i * 8 + 6] > raw[a * 8 + 6]) a = i;
            const pa = P(a);
            // 2: дальняя от первой
            let b = a, bd = -1;
            for (const i of it) { const p = P(i); const d = (p[0] - pa[0]) ** 2 + (p[1] - pa[1]) ** 2 + (p[2] - pa[2]) ** 2; if (d > bd) { bd = d; b = i; } }
            const pb = P(b);
            // 3: максимум площади треугольника (со знаком по нормали)
            const area = (p, q, s) => {
                const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
                return (uy * vz - uz * vy) * cn[0] + (uz * vx - ux * vz) * cn[1] + (ux * vy - uy * vx) * cn[2];
            };
            let c = a, ca = 0;
            for (const i of it) { const s = area(pa, pb, P(i)); if (Math.abs(s) > Math.abs(ca)) { ca = s; c = i; } }
            // 4: с другой стороны от a–b
            let d = a, da = 0;
            for (const i of it) { const s = area(pa, pb, P(i)); if (s * ca < 0 && Math.abs(s) > Math.abs(da)) { da = s; d = i; } }
            out.push(a);
            if (b !== a) out.push(b);
            if (c !== a && c !== b) out.push(c);
            if (d !== a && d !== b && d !== c) out.push(d);
        }
        return out;
    },

    _raw: /** @type {number[]} */ ([]),

    /** Построить манифолд из сырых контактов: a — тело сэмплов, b — тело или null (мир/статика). */
    _manifold(a, b, raw, bStatic) {
        if (!raw.length) return;
        const sel = this._reduce(raw);
        if (!sel.length) return;
        const key = a.id * 65536 + (b ? b.id : 0);
        const old = this.cache.get(key);
        const pts = [];
        let nx = 0, ny = 0, nz = 0;
        for (const i of sel) {
            const p = this._pt();
            p.px = raw[i * 8]; p.py = raw[i * 8 + 1]; p.pz = raw[i * 8 + 2];
            p.nx = raw[i * 8 + 3]; p.ny = raw[i * 8 + 4]; p.nz = raw[i * 8 + 5];
            p.d = raw[i * 8 + 6]; p.key = raw[i * 8 + 7];
            p.sep = -p.d;
            p.rAx = p.px - a.x[0]; p.rAy = p.py - a.x[1]; p.rAz = p.pz - a.x[2];
            if (b) { p.rBx = p.px - b.x[0]; p.rBy = p.py - b.x[1]; p.rBz = p.pz - b.x[2]; } else { p.rBx = p.rBy = p.rBz = 0; }
            const c = old && old.get(p.key);
            p.jn = c ? c[0] : 0; p.jt1 = c ? c[1] : 0; p.jt2 = c ? c[2] : 0;
            p.maxJn = 0;
            nx += p.nx * Math.max(0.01, p.d + 0.02); ny += p.ny * Math.max(0.01, p.d + 0.02); nz += p.nz * Math.max(0.01, p.d + 0.02);
            pts.push(p);
        }
        this.manifolds.push({ a, b: bStatic ? null : b, other: b, key, pts,
            friction: Math.sqrt(a.friction * (b ? b.friction : 0.7)), restitution: Math.max(a.restitution, b ? b.restitution : 0.05) });
    },

    // =================================================================== шаг

    update(dt) {
        if (!this.world) return;
        const t0 = performance.now();
        const hz = (typeof RL_PHYS_HZ !== 'undefined' ? RL_PHYS_HZ : 60);
        const h = 1 / hz;
        this.acc += dt;
        let steps = 0;
        const maxSteps = this._loadMs > 20 ? 1 : 2;
        while (this.acc >= h && steps < maxSteps) {
            for (const b of this.bodies) { b.px.set(b.x); b.pq.set(b.q); }
            const ts = performance.now();
            this.step(h);
            this._loadMs += ((performance.now() - ts) - this._loadMs) * 0.08;
            this.acc -= h; steps++;
        }
        if (steps >= maxSteps) this.acc = Math.min(this.acc, h);
        this.alpha = Math.max(0, Math.min(1, this.acc / h));
        for (const b of this.bodies) if (!b.dead) this._syncView(b, this.alpha);
        this.stats.ms += ((performance.now() - t0) - this.stats.ms) * 0.1;
    },

    /** Вид тела: позиция между прошлым и текущим шагом (плавно на 120+ Гц). */
    _syncView(b, alpha) {
        const n = b.node; if (!n) return;
        const a1 = alpha, a0 = 1 - alpha;
        n.position.set(b.px[0] * a0 + b.x[0] * a1, b.px[1] * a0 + b.x[1] * a1, b.px[2] * a0 + b.x[2] * a1);
        let qx = b.q[0], qy = b.q[1], qz = b.q[2], qw = b.q[3];
        if (b.pq[0] * qx + b.pq[1] * qy + b.pq[2] * qz + b.pq[3] * qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
        qx = b.pq[0] * a0 + qx * a1; qy = b.pq[1] * a0 + qy * a1; qz = b.pq[2] * a0 + qz * a1; qw = b.pq[3] * a0 + qw * a1;
        const l = Math.hypot(qx, qy, qz, qw) || 1;
        n.rotationQuaternion.set(qx / l, qy / l, qz / l, qw / l);
    },

    step(h) {
        const g = (typeof RL_GRAVITY !== 'undefined' ? RL_GRAVITY : 9.81);
        const D = this.detail();
        // нагрузка: долгий шаг — меньше подшагов (завал из сотен тел не роняет частоту кадров)
        const sub = Math.max(2, D.substeps - (this._loadMs > 14 ? 2 : (this._loadMs > 9 ? 1 : 0)));
        const hs = h / sub, inv_hs = 1 / hs;
        const bodies = this.bodies = this.bodies.filter(b => !b.dead);
        this.steps++;
        const ex = this.world.sx * this.vs + 8, ez = this.world.sz * this.vs + 8;
        // габариты
        for (const b of bodies) {
            b.age += h;
            const sp = Math.hypot(b.v[0], b.v[1], b.v[2]) + Math.hypot(b.w[0], b.w[1], b.w[2]) * b.radius;
            b._margin = Math.min(this.vs * (b.ns < 160 ? 3 : 1.2), Math.max(this.vs * 0.15, sp * h * 1.1));
            this._updateAABB(b, b._margin);
            if (b.x[1] < -20 || b.x[0] < -8 || b.x[0] > ex || b.x[2] < -8 || b.x[2] > ez) this.remove(b);
        }
        // ---- контакты
        this._np = 0;
        this.manifolds = [];
        const raw = this._raw;
        const w = this.world, k = 1 / this.vs;
        for (const b of bodies) {
            if (b.sleeping || b.dead) continue;
            const a = b.aabb;
            if (!w.regionHasSolid(Math.floor(a[0] * k) - 1, Math.floor(a[1] * k) - 1, Math.floor(a[2] * k) - 1, Math.floor(a[3] * k) + 1, Math.floor(a[4] * k) + 1, Math.floor(a[5] * k) + 1)) continue;
            raw.length = 0;
            this._collide(b, null, b._margin, raw);
            this._manifold(b, null, raw, true);
        }
        // тело против тела: сортировка по x
        const list = bodies.filter(b => !b.dead).sort((p, q) => p.aabb[0] - q.aabb[0]);
        const pairs = [];
        for (let i = 0; i < list.length; i++) {
            const A = list[i], aa = A.aabb;
            for (let j = i + 1; j < list.length; j++) {
                const B = list[j], bb = B.aabb;
                if (bb[0] > aa[3]) break;
                if (A.sleeping && B.sleeping) continue;
                if (bb[1] > aa[4] || bb[4] < aa[1] || bb[2] > aa[5] || bb[5] < aa[2]) continue;
                pairs.push(A, B);
            }
        }
        for (let p = 0; p < pairs.length; p += 2) {
            let A = pairs[p], B = pairs[p + 1];
            // спящий рядом с бодрствующим: будить, если тот движется заметно
            if (A.sleeping !== B.sleeping) {
                const awake = A.sleeping ? B : A, sl = A.sleeping ? A : B;
                const sp = Math.hypot(awake.v[0], awake.v[1], awake.v[2]) + Math.hypot(awake.w[0], awake.w[1], awake.w[2]) * awake.radius * 0.5;
                if (sp > 0.35 || awake.grabbed) this.wake(sl);
            }
            const margin = Math.max(A._margin, B._margin);
            // сэмплы меньшего — против сетки большего; оба направления, если оба небольшие
            if (A.ns > B.ns) { const t = A; A = B; B = t; }
            const both = A.ns + B.ns < 300;
            if (!A.sleeping) { raw.length = 0; this._collide(A, B, margin, raw); this._manifold(A, B, raw, B.sleeping); }
            else if (!B.sleeping && !both) { raw.length = 0; this._collide(B, A, margin, raw); this._manifold(B, A, raw, true); }
            if (both && !B.sleeping) { raw.length = 0; this._collide(B, A, margin, raw); this._manifold(B, A, raw, A.sleeping); }
        }
        // ---- подготовка
        const hertz = Math.min((typeof RL_CONTACT_HERTZ !== 'undefined' ? RL_CONTACT_HERTZ : 30), 0.25 * sub / h);
        const zeta = (typeof RL_CONTACT_DAMPING !== 'undefined' ? RL_CONTACT_DAMPING : 10);
        const soft = this._soft(hertz, zeta, hs), softStatic = this._soft(2 * hertz, zeta, hs);
        const maxBias = (typeof RL_PUSHOUT !== 'undefined' ? RL_PUSHOUT : 3);
        for (const b of bodies) { b.x0.set(b.x); b.q0.set(b.q); b.dR[0] = 1; b.dR[1] = 0; b.dR[2] = 0; b.dR[3] = 0; b.dR[4] = 1; b.dR[5] = 0; b.dR[6] = 0; b.dR[7] = 0; b.dR[8] = 1; }
        for (const b of bodies) b._touch = false;
        for (const m of this.manifolds) { this._prepare(m); m.a._touch = true; if (m.b) m.b._touch = true; }
        // ---- подшаги
        const awake = bodies.filter(b => !b.sleeping && !b.dead);
        const linD = 1 / (1 + hs * 0.02), angD = 1 / (1 + hs * 0.08);
        for (let s = 0; s < sub; s++) {
            for (const b of awake) {
                b.v[1] -= g * hs;
                b.v[0] *= linD; b.v[1] *= linD; b.v[2] *= linD;
                b.w[0] *= angD; b.w[1] *= angD; b.w[2] *= angD;
                if (b.grabbed) { const d = Math.exp(-6 * hs); b.w[0] *= d; b.w[1] *= d; b.w[2] *= d; }
            }
            this._solveJoints(hs, s === 0);
            for (const m of this.manifolds) this._warm(m);
            for (const m of this.manifolds) this._solve(m, true, inv_hs, soft, softStatic, maxBias);
            const roll = 1 / (1 + hs * 0.55);
            for (const b of awake) { if (b._touch) { b.w[0] *= roll; b.w[1] *= roll; b.w[2] *= roll; } this._integrate(b, hs); }
            for (const m of this.manifolds) this._solve(m, false, inv_hs, soft, softStatic, maxBias);
        }
        for (const m of this.manifolds) this._restitution(m);
        // ---- кэш импульсов, удары
        const cache = new Map();
        let npts = 0;
        for (const m of this.manifolds) {
            const c = this.cache.get(m.key) || new Map();
            c.clear();
            let maxSpeed = 0, maxJ = 0, mp = null;
            for (const p of m.pts) {
                c.set(p.key, [p.jn, p.jt1, p.jt2]);
                if (-p.vn0 > maxSpeed) { maxSpeed = -p.vn0; mp = p; }
                maxJ = Math.max(maxJ, p.maxJn);
            }
            npts += m.pts.length;
            cache.set(m.key, c);
            if (this.onImpact && mp && maxSpeed > 1.0) this.onImpact(m.a, m.other, [mp.px, mp.py, mp.pz, mp.nx, mp.ny, mp.nz], maxSpeed, maxJ, m.pts.slice(0, 4).map(p => [p.px, p.py, p.pz]));
        }
        this.cache = cache;
        // ---- сон по островам
        this._sleep(h);
        this.stats.bodies = bodies.length;
        this.stats.awake = awake.length;
        this.stats.manifolds = this.manifolds.length;
        this.stats.points = npts;
        // предел числа тел: самые мелкие спящие — в обломки
        const maxB = D.maxBodies;
        if (bodies.length > maxB) {
            const victims = bodies.filter(b => !b.dead && !b.grabbed).sort((p, q) => (p.count - q.count) || (q.age - p.age));
            for (let i = 0; i < bodies.length - maxB && i < victims.length; i++) {
                const b = victims[i];
                if (typeof VoxFX !== 'undefined' && VoxFX.bodyToDebris) VoxFX.bodyToDebris(b);
                this.remove(b);
            }
        }
    },

    _soft(hertz, zeta, h) {
        if (hertz <= 0) return { biasRate: 0, massScale: 1, impulseScale: 0 };
        const omega = 2 * Math.PI * hertz;
        const a1 = 2 * zeta + h * omega, a2 = h * omega * a1, a3 = 1 / (1 + a2);
        return { biasRate: omega / a1, massScale: a2 * a3, impulseScale: a3 };
    },

    /** k = 1/mA + 1/mB + (r×d)·I⁻¹(r×d) для обоих. */
    _effMass(a, b, rax, ray, raz, rbx, rby, rbz, dx, dy, dz) {
        let k = a.invMass;
        {
            const cx = ray * dz - raz * dy, cy = raz * dx - rax * dz, cz = rax * dy - ray * dx;
            const I = a.Iw;
            k += cx * (I[0] * cx + I[1] * cy + I[2] * cz) + cy * (I[3] * cx + I[4] * cy + I[5] * cz) + cz * (I[6] * cx + I[7] * cy + I[8] * cz);
        }
        if (b) {
            k += b.invMass;
            const cx = rby * dz - rbz * dy, cy = rbz * dx - rbx * dz, cz = rbx * dy - rby * dx;
            const I = b.Iw;
            k += cx * (I[0] * cx + I[1] * cy + I[2] * cz) + cy * (I[3] * cx + I[4] * cy + I[5] * cz) + cz * (I[6] * cx + I[7] * cy + I[8] * cz);
        }
        return k > 0 ? 1 / k : 0;
    },

    _prepare(m) {
        const a = m.a, b = m.b;
        for (const p of m.pts) {
            const nx = p.nx, ny = p.ny, nz = p.nz;
            // касательные
            let t1x, t1y, t1z;
            if (Math.abs(nx) > 0.57) { t1x = ny; t1y = -nx; t1z = 0; } else { t1x = 0; t1y = nz; t1z = -ny; }
            const tl = Math.hypot(t1x, t1y, t1z); t1x /= tl; t1y /= tl; t1z /= tl;
            p.t1x = t1x; p.t1y = t1y; p.t1z = t1z;
            p.t2x = ny * t1z - nz * t1y; p.t2y = nz * t1x - nx * t1z; p.t2z = nx * t1y - ny * t1x;
            p.nm = this._effMass(a, b, p.rAx, p.rAy, p.rAz, p.rBx, p.rBy, p.rBz, nx, ny, nz);
            p.tm1 = this._effMass(a, b, p.rAx, p.rAy, p.rAz, p.rBx, p.rBy, p.rBz, t1x, t1y, t1z);
            p.tm2 = this._effMass(a, b, p.rAx, p.rAy, p.rAz, p.rBx, p.rBy, p.rBz, p.t2x, p.t2y, p.t2z);
            // относительная скорость по нормали до решения (для отскока и ударов)
            const dv = this._dv(a, b, p);
            p.vn0 = dv[0] * nx + dv[1] * ny + dv[2] * nz;
        }
    },

    _dvo: new Float64Array(3),
    /** Относительная скорость точек контакта a − b (без выделения памяти: общий буфер). */
    _dv(a, b, p) {
        const o = this._dvo, av = a.v, aw = a.w;
        let x = av[0] + aw[1] * p.rAz - aw[2] * p.rAy, y = av[1] + aw[2] * p.rAx - aw[0] * p.rAz, z = av[2] + aw[0] * p.rAy - aw[1] * p.rAx;
        if (b) {
            const bv = b.v, bw = b.w;
            x -= bv[0] + bw[1] * p.rBz - bw[2] * p.rBy; y -= bv[1] + bw[2] * p.rBx - bw[0] * p.rBz; z -= bv[2] + bw[0] * p.rBy - bw[1] * p.rBx;
        }
        o[0] = x; o[1] = y; o[2] = z;
        return o;
    },

    _vel(b, rx, ry, rz) {
        const v = b.v, w = b.w;
        return [v[0] + w[1] * rz - w[2] * ry, v[1] + w[2] * rx - w[0] * rz, v[2] + w[0] * ry - w[1] * rx];
    },

    _applyP(a, b, p, Px, Py, Pz) {
        const ia = a.invMass;
        a.v[0] += Px * ia; a.v[1] += Py * ia; a.v[2] += Pz * ia;
        {
            const tx = p.rAy * Pz - p.rAz * Py, ty = p.rAz * Px - p.rAx * Pz, tz = p.rAx * Py - p.rAy * Px, I = a.Iw;
            a.w[0] += I[0] * tx + I[1] * ty + I[2] * tz; a.w[1] += I[3] * tx + I[4] * ty + I[5] * tz; a.w[2] += I[6] * tx + I[7] * ty + I[8] * tz;
        }
        if (b) {
            const ib = b.invMass;
            b.v[0] -= Px * ib; b.v[1] -= Py * ib; b.v[2] -= Pz * ib;
            const tx = p.rBy * Pz - p.rBz * Py, ty = p.rBz * Px - p.rBx * Pz, tz = p.rBx * Py - p.rBy * Px, I = b.Iw;
            b.w[0] -= I[0] * tx + I[1] * ty + I[2] * tz; b.w[1] -= I[3] * tx + I[4] * ty + I[5] * tz; b.w[2] -= I[6] * tx + I[7] * ty + I[8] * tz;
        }
    },

    _warm(m) {
        const a = m.a, b = m.b;
        if (a.sleeping) return;
        for (const p of m.pts) {
            const Px = p.nx * p.jn + p.t1x * p.jt1 + p.t2x * p.jt2;
            const Py = p.ny * p.jn + p.t1y * p.jt1 + p.t2y * p.jt2;
            const Pz = p.nz * p.jn + p.t1z * p.jt1 + p.t2z * p.jt2;
            this._applyP(a, b, p, Px, Py, Pz);
        }
    },

    _solve(m, useBias, inv_h, soft, softStatic, maxBias) {
        const a = m.a, b = m.b;
        if (a.sleeping) return;
        const sf = b ? soft : softStatic;
        const mu = m.friction;
        const dRa = a.dR, dRb = b ? b.dR : null;
        for (const p of m.pts) {
            // текущий зазор: начальный + сдвиг точек тел по нормали
            const ax = a.x[0] - a.x0[0] + (dRa[0] * p.rAx + dRa[1] * p.rAy + dRa[2] * p.rAz) - p.rAx;
            const ay = a.x[1] - a.x0[1] + (dRa[3] * p.rAx + dRa[4] * p.rAy + dRa[5] * p.rAz) - p.rAy;
            const az = a.x[2] - a.x0[2] + (dRa[6] * p.rAx + dRa[7] * p.rAy + dRa[8] * p.rAz) - p.rAz;
            let bx = 0, by = 0, bz = 0;
            if (b) {
                bx = b.x[0] - b.x0[0] + (dRb[0] * p.rBx + dRb[1] * p.rBy + dRb[2] * p.rBz) - p.rBx;
                by = b.x[1] - b.x0[1] + (dRb[3] * p.rBx + dRb[4] * p.rBy + dRb[5] * p.rBz) - p.rBy;
                bz = b.x[2] - b.x0[2] + (dRb[6] * p.rBx + dRb[7] * p.rBy + dRb[8] * p.rBz) - p.rBz;
            }
            const s = p.sep + (ax - bx) * p.nx + (ay - by) * p.ny + (az - bz) * p.nz + 0.004;
            let bias = 0, massScale = 1, impulseScale = 0;
            if (s > 0) bias = s * inv_h;
            else if (useBias) { bias = Math.max(sf.biasRate * s, -maxBias); massScale = sf.massScale; impulseScale = sf.impulseScale; }
            // относительная скорость в точке
            const dv = this._dv(a, b, p);
            const vn = dv[0] * p.nx + dv[1] * p.ny + dv[2] * p.nz;
            let lam = -p.nm * massScale * (vn + bias) - impulseScale * p.jn;
            const nj = Math.max(p.jn + lam, 0);
            lam = nj - p.jn; p.jn = nj;
            if (lam > p.maxJn) p.maxJn = lam;
            if (lam) this._applyP(a, b, p, p.nx * lam, p.ny * lam, p.nz * lam);
            // трение (круговой конус)
            const dv2 = this._dv(a, b, p);
            const ex = dv2[0], ey = dv2[1], ez = dv2[2];
            const vt1 = ex * p.t1x + ey * p.t1y + ez * p.t1z, vt2 = ex * p.t2x + ey * p.t2y + ez * p.t2z;
            let j1 = p.jt1 - p.tm1 * vt1, j2 = p.jt2 - p.tm2 * vt2;
            const maxF = mu * p.jn, jl = Math.hypot(j1, j2);
            if (jl > maxF) { const sc = maxF / jl; j1 *= sc; j2 *= sc; }
            const d1 = j1 - p.jt1, d2 = j2 - p.jt2;
            p.jt1 = j1; p.jt2 = j2;
            if (d1 || d2) this._applyP(a, b, p, p.t1x * d1 + p.t2x * d2, p.t1y * d1 + p.t2y * d2, p.t1z * d1 + p.t2z * d2);
        }
    },

    _restitution(m) {
        const a = m.a, b = m.b;
        if (a.sleeping) return;
        const e = m.restitution, thr = (typeof RL_RESTITUTION_MIN !== 'undefined' ? RL_RESTITUTION_MIN : 1.2);
        if (e <= 0) return;
        for (const p of m.pts) {
            if (p.vn0 > -thr || p.maxJn <= 0) continue;
            const dv = this._dv(a, b, p);
            const vn = dv[0] * p.nx + dv[1] * p.ny + dv[2] * p.nz;
            let lam = -p.nm * (vn + e * p.vn0);
            const nj = Math.max(p.jn + lam, 0);
            lam = nj - p.jn; p.jn = nj;
            if (lam) this._applyP(a, b, p, p.nx * lam, p.ny * lam, p.nz * lam);
        }
    },

    _integrate(b, h) {
        // пределы скоростей
        const vl = Math.hypot(b.v[0], b.v[1], b.v[2]);
        if (vl > 36) { const s = 36 / vl; b.v[0] *= s; b.v[1] *= s; b.v[2] *= s; }
        const wl = Math.hypot(b.w[0], b.w[1], b.w[2]);
        if (wl > 40) { const s = 40 / wl; b.w[0] *= s; b.w[1] *= s; b.w[2] *= s; }
        b.x[0] += b.v[0] * h; b.x[1] += b.v[1] * h; b.x[2] += b.v[2] * h;
        const q = b.q, wx = b.w[0], wy = b.w[1], wz = b.w[2];
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
        q[0] += 0.5 * h * (wx * qw + wy * qz - wz * qy);
        q[1] += 0.5 * h * (wy * qw + wz * qx - wx * qz);
        q[2] += 0.5 * h * (wz * qw + wx * qy - wy * qx);
        q[3] += 0.5 * h * (-wx * qx - wy * qy - wz * qz);
        const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
        this._syncR(b);
        // поворот с начала шага: dR = R · R0ᵀ
        const q0 = b.q0;
        // dq = q * conj(q0)
        const ax = -q0[0], ay = -q0[1], az = -q0[2], aw = q0[3];
        const dx = q[3] * ax + q[0] * aw + q[1] * az - q[2] * ay;
        const dy = q[3] * ay - q[0] * az + q[1] * aw + q[2] * ax;
        const dz = q[3] * az + q[0] * ay - q[1] * ax + q[2] * aw;
        const dw = q[3] * aw - q[0] * ax - q[1] * ay - q[2] * az;
        const D = b.dR;
        D[0] = 1 - 2 * (dy * dy + dz * dz); D[1] = 2 * (dx * dy - dz * dw); D[2] = 2 * (dx * dz + dy * dw);
        D[3] = 2 * (dx * dy + dz * dw); D[4] = 1 - 2 * (dx * dx + dz * dz); D[5] = 2 * (dy * dz - dx * dw);
        D[6] = 2 * (dx * dz - dy * dw); D[7] = 2 * (dy * dz + dx * dw); D[8] = 1 - 2 * (dx * dx + dy * dy);
    },

    // =================================================================== захват

    /** Мягкая связь: точка тела (локально, от центра масс) тянется к target. Возвращает связь. */
    grab(b, local, target, maxForce) {
        this.wake(b);
        b.grabbed = true;
        const j = { body: b, local: local.slice(), target: target.slice(), hertz: 6, zeta: 0.9, maxForce, acc: [0, 0, 0] };
        this.joints.push(j);
        return j;
    },
    release(j) {
        this.joints = this.joints.filter(x => x !== j);
        if (j && j.body) j.body.grabbed = this.joints.some(x => x.body === j.body);
    },

    _solveJoints(h, first) {
        for (const j of this.joints) {
            const b = j.body;
            if (b.dead) continue;
            const R = b.R, l = j.local;
            const rx = R[0] * l[0] + R[1] * l[1] + R[2] * l[2], ry = R[3] * l[0] + R[4] * l[1] + R[5] * l[2], rz = R[6] * l[0] + R[7] * l[1] + R[8] * l[2];
            const Cx = b.x[0] + rx - j.target[0], Cy = b.x[1] + ry - j.target[1], Cz = b.x[2] + rz - j.target[2];
            const sf = this._soft(j.hertz, j.zeta, h);
            // K = m⁻¹·E + [r]ᵀ I⁻¹ [r]
            const I = b.Iw, im = b.invMass;
            const sk = [0, -rz, ry, rz, 0, -rx, -ry, rx, 0];       // [r]×
            const K = new Float64Array(9);
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
                let s = 0;
                for (let k1 = 0; k1 < 3; k1++) for (let k2 = 0; k2 < 3; k2++) s += sk[k1 * 3 + r] * I[k1 * 3 + k2] * sk[k2 * 3 + c];
                K[r * 3 + c] = s + (r === c ? im : 0);
            }
            const Ki = this._inv3(K, new Float64Array(9));
            // тёплый старт: накопленный импульс подшага прикладывается заново (как у Box2D)
            {
                const ax = j.acc[0], ay = j.acc[1], az = j.acc[2];
                b.v[0] += ax * im; b.v[1] += ay * im; b.v[2] += az * im;
                const tx = ry * az - rz * ay, ty = rz * ax - rx * az, tz = rx * ay - ry * ax;
                b.w[0] += I[0] * tx + I[1] * ty + I[2] * tz; b.w[1] += I[3] * tx + I[4] * ty + I[5] * tz; b.w[2] += I[6] * tx + I[7] * ty + I[8] * tz;
            }
            const v = this._vel(b, rx, ry, rz);
            const bx = v[0] + sf.biasRate * Cx, by = v[1] + sf.biasRate * Cy, bz = v[2] + sf.biasRate * Cz;
            let ix = -sf.massScale * (Ki[0] * bx + Ki[1] * by + Ki[2] * bz) - sf.impulseScale * j.acc[0];
            let iy = -sf.massScale * (Ki[3] * bx + Ki[4] * by + Ki[5] * bz) - sf.impulseScale * j.acc[1];
            let iz = -sf.massScale * (Ki[6] * bx + Ki[7] * by + Ki[8] * bz) - sf.impulseScale * j.acc[2];
            const ox = j.acc[0], oy = j.acc[1], oz = j.acc[2];
            let ax = ox + ix, ay = oy + iy, az = oz + iz;
            const maxI = j.maxForce * h, al = Math.hypot(ax, ay, az);
            if (al > maxI) { const s = maxI / al; ax *= s; ay *= s; az *= s; }
            j.acc[0] = ax; j.acc[1] = ay; j.acc[2] = az;
            ix = ax - ox; iy = ay - oy; iz = az - oz;
            b.v[0] += ix * im; b.v[1] += iy * im; b.v[2] += iz * im;
            const tx = ry * iz - rz * iy, ty = rz * ix - rx * iz, tz = rx * iy - ry * ix;
            b.w[0] += I[0] * tx + I[1] * ty + I[2] * tz; b.w[1] += I[3] * tx + I[4] * ty + I[5] * tz; b.w[2] += I[6] * tx + I[7] * ty + I[8] * tz;
        }
    },

    // =================================================================== сон

    _sleep(h) {
        const T = (typeof RL_SLEEP_TIME !== 'undefined' ? RL_SLEEP_TIME : 0.55), lin = (typeof RL_SLEEP_LIN !== 'undefined' ? RL_SLEEP_LIN : 0.09), ang = (typeof RL_SLEEP_ANG !== 'undefined' ? RL_SLEEP_ANG : 0.14);
        const bodies = this.bodies;
        // острова: union-find по манифолдам между бодрствующими телами
        const parent = new Map();
        const find = (b) => { let r = b; while (parent.get(r) !== r) r = parent.get(r); let c = b; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
        for (const b of bodies) if (!b.sleeping && !b.dead) parent.set(b, b);
        for (const m of this.manifolds) {
            if (!m.b || m.b.sleeping || m.a.sleeping) continue;
            const ra = find(m.a), rb = find(m.b);
            if (ra !== rb) parent.set(ra, rb);
        }
        /** @type {Map<VoxBody, number>} */
        const minT = new Map();
        for (const b of bodies) {
            if (b.sleeping || b.dead) continue;
            const v2 = b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2, w2 = b.w[0] ** 2 + b.w[1] ** 2 + b.w[2] ** 2;
            if (v2 < lin * lin && w2 < ang * ang && !b.grabbed) b.sleepT += h; else b.sleepT = 0;
            const r = find(b);
            minT.set(r, Math.min(minT.has(r) ? minT.get(r) : Infinity, b.sleepT));
        }
        for (const b of bodies) {
            if (b.sleeping || b.dead) continue;
            // остров спит целиком; в большом завале тело засыпает и само, если долго почти неподвижно
            const v2 = b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2, w2 = b.w[0] ** 2 + b.w[1] ** 2 + b.w[2] ** 2;
            const alone = b.sleepT >= T * 2.5 && v2 < lin * lin * 0.36 && w2 < ang * ang * 0.36;
            if (minT.get(find(b)) >= T || alone) {
                b.sleeping = true;
                b.v[0] = b.v[1] = b.v[2] = 0; b.w[0] = b.w[1] = b.w[2] = 0;
                b.px.set(b.x); b.pq.set(b.q);
            }
        }
    },

    // =================================================================== игрок

    /**
     * Игрок против тел: сферы-сэмплы рядом с ящиком игрока выталкивают его (вверх — опора, вбок — упор),
     * а тела получают обратный толчок (масса игрока) и вес стоящего.
     */
    playerContacts(p, dt) {
        const r = p.r, hgt = p.h, vs = this.vs, sr = vs * 0.5;
        const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
        const x0 = px - r - sr, x1 = px + r + sr, y0 = py - sr, y1 = py + hgt + sr, z0 = pz - r - sr, z1 = pz + r + sr;
        let up = 0, down = 0, ex = 0, wx = 0, sz = 0, nz = 0;
        /** @type {VoxBody | null} */
        let ground = null;
        const pm = (typeof RL_PLAYER_MASS !== 'undefined' ? RL_PLAYER_MASS : 80);
        const g = (typeof RL_GRAVITY !== 'undefined' ? RL_GRAVITY : 9.81);
        for (const b of this.bodies) {
            if (b.dead || b.grabbed) continue;
            const a = b.aabb;
            if (a[3] < x0 || a[0] > x1 || a[4] < y0 || a[1] > y1 || a[5] < z0 || a[2] > z1) continue;
            const S = b.samples, R = b.R;
            let touched = false, gx = 0, gy = 0, gz = 0, gn = 0;
            let bodyUp = 0;
            // точки тела у игрока (мир)
            const near = this._near || (this._near = []);
            near.length = 0;
            for (let i = 0; i < b.ns; i++) {
                const lx = S[i * 3], ly = S[i * 3 + 1], lz = S[i * 3 + 2];
                const sx = b.x[0] + R[0] * lx + R[1] * ly + R[2] * lz;
                if (sx < x0 || sx > x1) continue;
                const sz2 = b.x[2] + R[6] * lx + R[7] * ly + R[8] * lz;
                if (sz2 < z0 || sz2 > z1) continue;
                const sy = b.x[1] + R[3] * lx + R[4] * ly + R[5] * lz;
                if (sy < y0 || sy > y1) continue;
                near.push(sx, sy, sz2);
            }
            if (!near.length) continue;
            // опора: верх тела под ступнями (в пределах ступеньки) — на него встаём
            let top = -1e9;
            for (let i = 0; i < near.length; i += 3) {
                const sx = near[i], sy = near[i + 1], sz2 = near[i + 2];
                if (Math.abs(sx - px) > r + sr * 0.3 || Math.abs(sz2 - pz) > r + sr * 0.3) continue;
                if (sy + sr - py > 0.45) continue;
                if (sy + sr > top) top = sy + sr;
            }
            const stepUp = top - py;
            const support = stepUp > -0.02 && stepUp <= 0.45 ? top : -1e9;
            for (let i = 0; i < near.length; i += 3) {
                const sx = near[i], sy = near[i + 1], sz2 = near[i + 2];
                if (sy + sr <= support + 0.03) {
                    // опорная точка
                    if (Math.abs(sx - px) < r + sr && Math.abs(sz2 - pz) < r + sr) { touched = true; gx += sx; gy += sy; gz += sz2; gn++; }
                    continue;
                }
                const pDown = (py + hgt) - (sy - sr);
                const pE = (sx + sr) - (px - r), pW = (px + r) - (sx - sr);
                const pS = (sz2 + sr) - (pz - r), pN = (pz + r) - (sz2 - sr);
                let best = Math.min(pE, pW, pS, pN), dir = 0;
                if (sy > py + hgt - 0.3 && pDown < best) { best = pDown; dir = 2; }
                if (best <= 0) continue;
                touched = true;
                if (dir === 2) down = Math.max(down, best);
                else if (best === pE) ex = Math.max(ex, pE);
                else if (best === pW) wx = Math.max(wx, pW);
                else if (best === pS) sz = Math.max(sz, pS);
                else nz = Math.max(nz, pN);
            }
            if (support > -1e8 && gn) { bodyUp = Math.max(0, support - py) + 1e-4; if (bodyUp > up) up = bodyUp; }
            if (!touched) continue;
            if (bodyUp > 0 && gn) {
                ground = (!ground || bodyUp >= up) ? b : ground;
                // вес игрока давит на тело
                if (!b.sleeping || b.mass < pm * 6) this.applyImpulse(b, gx / gn, gy / gn, gz / gn, 0, -pm * g * dt * 0.8, 0);
            }
            // толчок телом: скорость игрока в сторону тела
            const vx = p.vel.x, vz = p.vel.z;
            const into = Math.hypot(vx, vz);
            if (into > 0.3 && (ex || wx || sz || nz)) {
                const share = pm / (pm + b.mass);
                const J = pm * into * 0.35;
                this.applyImpulse(b, px + vx / into * r, py + hgt * 0.4, pz + vz / into * r, vx / into * J, 0, vz / into * J);
                p.vel.x *= 1 - (1 - share) * 0.5; p.vel.z *= 1 - (1 - share) * 0.5;
            }
        }
        if (up > 0 && up < 0.5) {
            p.pos.y += up;
            if (p.vel.y < 0) p.vel.y = 0;
            p.onGround = true;
            p.groundBody = ground;
            p.eyeLift += Math.min(up, 0.2) * 0.8;
        }
        if (down > 0 && down < 0.3 && p.vel.y > 0) { p.vel.y = 0; }
        const dx = ex - wx, dz = sz - nz;
        if (dx || dz) {
            p.pos.x += Math.max(-0.08, Math.min(0.08, dx));
            p.pos.z += Math.max(-0.08, Math.min(0.08, dz));
        }
    },
};
