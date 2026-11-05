// VoxFolk.js — живые воксельные существа: активный рэгдолл (как Euphoria) и расчленение по пикселям.
//
// Тело — частицы Верле (суставы), связанные расстояниями. «Мышцы» тянут частицы к позе анимации (T): пока мышцы
// сильные, существо идёт и целится; попадание толкает частицу и ослабляет мышцы этого места — конечность
// отлетает и возвращается, сильный удар роняет: мышцы гаснут, тело падает настоящим рэгдоллом и встаёт.
// Каждая часть (голова, грудь, рука…) — своя сетка вокселей (мелких, vox ≈ 0.05 м) и свой меш VoxMesher.
// Попадание вынимает воксели сферой, они разлетаются цветными кубиками (VoxFX.spawnDebris). После выреза —
// поиск связности: кусок без связи с суставом отваливается гибом, перебитая кость отрывает конечность вместе со
// всем, что ниже. Внутри — поролон-наполнитель (toy_foam), никакой крови.
//
// Оси: у существа +x — его левый бок, +y — вверх, +z — вперёд (правая тройка). Сетка части — те же оси: индекс
// x + sx·(z + sz·y); +y сетки — от частицы bot к частице top.
//
//   FolkArt.grid(sx, sy, sz, g => { g.box(…); g.ell(…); }) — нарисовать часть (см. FolkGrid)
//   new FolkSkeleton() — частицы, связи, части; FolkKit.biped({...}) — готовый двуногий с позой
//   new FolkRig(type, x, y, z, yaw) — экземпляр; rig.update(dt); rig.raycast(...); rig.hit(...); rig.blast(...)

/** Сетка вокселей части и инструменты рисования. Координаты — воксели от угла сетки. */
class FolkGrid {
    constructor(sx, sy, sz) {
        this.sx = sx; this.sy = sy; this.sz = sz;
        this.data = new Uint8Array(sx * sy * sz);
    }
    set(x, y, z, v) {
        x |= 0; y |= 0; z |= 0;
        if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return this;
        this.data[x + this.sx * (z + this.sz * y)] = v;
        return this;
    }
    get(x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
        return this.data[x + this.sx * (z + this.sz * y)];
    }
    /** Ящик [x0,x1) × [y0,y1) × [z0,z1). v — материал, 0 вырезает; функция (x,y,z) -> материал или −1 (не трогать). */
    box(x0, y0, z0, x1, y1, z1, v) {
        for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
            const m = typeof v === 'function' ? v(x, y, z) : v;
            if (m >= 0) this.set(x, y, z, m);
        }
        return this;
    }
    /** Эллипсоид: центр (cx,cy,cz), полуоси (rx,ry,rz). */
    ell(cx, cy, cz, rx, ry, rz, v) {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
            if (dx * dx + dy * dy + dz * dz > 1) continue;
            const m = typeof v === 'function' ? v(x, y, z) : v;
            if (m >= 0) this.set(x, y, z, m);
        }
        return this;
    }
    /** Цилиндр вдоль y: центр (cx,cz), радиусы rx,rz, слои [y0,y1). */
    cyl(cx, cz, rx, rz, y0, y1, v) {
        for (let y = y0; y < y1; y++) for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
            if (dx * dx + dz * dz > 1) continue;
            const m = typeof v === 'function' ? v(x, y, z) : v;
            if (m >= 0) this.set(x, y, z, m);
        }
        return this;
    }
    /** Перекрасить уже занятые воксели фигурой-предикатом: fn(x,y,z) -> материал или −1. */
    paint(fn) {
        for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) {
            const i = x + this.sx * (z + this.sz * y);
            if (!this.data[i]) continue;
            const m = fn(x, y, z, this.data[i]);
            if (m >= 0) this.data[i] = m;
        }
        return this;
    }
    /** Отразить левую половину (x >= sx/2) на правую. */
    mirrorX() {
        for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) for (let x = this.sx >> 1; x < this.sx; x++) {
            this.data[(this.sx - 1 - x) + this.sx * (z + this.sz * y)] = this.data[x + this.sx * (z + this.sz * y)];
        }
        return this;
    }
    /** Внутренние воксели (со всех сторон закрытые) -> наполнитель. */
    fillInside(v) {
        const out = this.data.slice(), { sx, sy, sz, data } = this;
        for (let y = 1; y < sy - 1; y++) for (let z = 1; z < sz - 1; z++) for (let x = 1; x < sx - 1; x++) {
            const i = x + sx * (z + sz * y);
            if (data[i] && data[i - 1] && data[i + 1] && data[i - sx] && data[i + sx] && data[i - sx * sz] && data[i + sx * sz]) out[i] = v;
        }
        this.data = out;
        return this;
    }
}

/** @satisfies {Record<string, any>} */
const FolkArt = {
    /** @param {(g: FolkGrid) => void} fn */
    grid(sx, sy, sz, fn) { const g = new FolkGrid(sx, sy, sz); fn(g); return g; },
};

/** Описание скелета одного типа существа (общее на все экземпляры). Размеры — метры. */
class FolkSkeleton {
    constructor() {
        /** @type {Record<string, number>} */
        this.ids = {};
        /** @type {{ name: string, x: number, y: number, z: number, r: number, m: number }[]} */
        this.pts = [];
        /** @type {{ a: number, b: number, k: number, min: boolean, L: number }[]} */
        this.links = [];
        /** @type {any[]} */
        this.parts = [];
    }
    /** Частица: имя, покой (от ступней), радиус столкновений, масса. */
    p(name, x, y, z, r = 0.1, m = 1) { this.ids[name] = this.pts.length; this.pts.push({ name, x, y, z, r, m }); return this; }
    /** Связь: расстояние a–b как в покое; k — жёсткость; min — только «не ближе» (L — доля длины покоя). */
    link(a, b, k = 1, min = false, L = 1) {
        const A = this.pts[this.ids[a]], B = this.pts[this.ids[b]];
        this.links.push({ a: this.ids[a], b: this.ids[b], k, min, L: Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z) * L });
        return this;
    }
    /** Жёсткая группа частиц: все со всеми. */
    rigid(names, k = 1) { for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) this.link(names[i], names[j], k); return this; }
    /**
     * Часть-кость. o: art — FolkGrid; top, bot — частицы (ось +y сетки: bot -> top); xa, xb — частицы оси +x сетки
     * (для корпуса; иначе ось держится переносом от родителя); prox — 'top' | 'bot' | null: каким концом часть
     * крепится к родителю; parent — имя родителя; role — 'head' | 'core' | 'arm' | 'leg' | 'other' (живучесть, походка);
     * armor — делитель выреза (толстая броня), ofs — сдвиг центра сетки [x,y,z], м.
     */
    part(name, o) {
        this.parts.push(Object.assign({ name, kind: 'bone', role: 'other', armor: 1, ofs: [0, 0, 0] }, o));
        return this;
    }
    /** Часть-наездник (шапка, оружие, щит): жёстко на родителе. pos — центр в осях родителя (м), rot — [x, y, z] рад. */
    rider(name, o) {
        this.parts.push(Object.assign({ name, kind: 'rider', role: 'other', armor: 1, pos: [0, 0, 0], rot: [0, 0, 0] }, o));
        return this;
    }
}

const FOLK_H = 1 / 60;

class FolkRig {
    /**
     * @param {any} type запись VoxFolk.TYPES: { id, skeleton, pose, vox, inside, … }
     * @param {number} x @param {number} y ступни @param {number} z @param {number} yaw курс: 0 — вперёд вдоль +z
     */
    constructor(type, x, y, z, yaw, opts = {}) {
        const sk = type.skeleton, s = this.scale = opts.scale || type.scale || 1;
        this.type = type;
        this.vox = (type.vox || 0.05) * s;
        const cap = sk.pts.length + 14;
        this.n = sk.pts.length;
        this.P = new Float32Array(cap * 3); this.O = new Float32Array(cap * 3); this.T = new Float32Array(cap * 3);
        this.Rd = new Float32Array(cap); this.W = new Float32Array(cap); this.pm = new Float32Array(cap);
        this.cut = new Uint8Array(cap);          // частица оторвана от тела: мышцы на неё не действуют
        this.root = { x, y, z, vx: 0, vy: 0, vz: 0, yaw, onGround: true, kx: 0, kz: 0 };
        this.fx = Math.sin(yaw); this.fz = Math.cos(yaw);
        this.rx = Math.cos(yaw); this.rz = -Math.sin(yaw);
        for (let i = 0; i < this.n; i++) {
            const q = sk.pts[i];
            const lx = q.x * s, ly = q.y * s, lz = q.z * s;
            this.P[i * 3] = x + lx * this.rx + lz * this.fx;
            this.P[i * 3 + 1] = y + ly;
            this.P[i * 3 + 2] = z + lx * this.rz + lz * this.fz;
            this.Rd[i] = q.r * s; this.W[i] = 1 / (q.m * s * s); this.pm[i] = 1;
        }
        this.O.set(this.P); this.T.set(this.P);
        this.links = sk.links.map(l => ({ a: l.a, b: l.b, k: l.k, min: l.min, L: l.L * s }));
        /** @type {any[]} */
        this.parts = [];
        /** @type {Record<string, any>} */
        this.byName = {};
        for (const d of sk.parts) {
            const g = d.art;
            const part = {
                name: d.name, kind: d.kind, role: d.role, armor: d.armor, sx: g.sx, sy: g.sy, sz: g.sz, grid: g.data.slice(),
                ox: -(g.sx >> 1), oy: -(g.sy >> 1), oz: -(g.sz >> 1),
                top: d.top != null ? sk.ids[d.top] : -1, bot: d.bot != null ? sk.ids[d.bot] : -1,
                xa: d.xa != null ? sk.ids[d.xa] : -1, xb: d.xb != null ? sk.ids[d.xb] : -1,
                prox: d.prox || null, parent: null, kids: [], attached: true,
                c: [x, y, z], ax: [1, 0, 0], ay: [0, 1, 0], az: [0, 0, 1],
                ofs: (d.ofs || [0, 0, 0]).map(v => v * s), mesh: null, dirty: true, count: 0, count0: 0, check: false,
                pos: d.pos ? d.pos.map(v => v * s) : null, rot: d.rot || null, rel: null, saved: null,
            };
            for (let i = 0; i < part.grid.length; i++) if (part.grid[i]) part.count++;
            part.count0 = part.count;
            if (d.parent) { part.parent = this.byName[d.parent]; if (part.parent) part.parent.kids.push(part); }
            if (d.kind === 'rider' && part.rot) part.rel = FolkRig._relFromEuler(part.pos, part.rot);
            this.parts.push(part);
            this.byName[d.name] = part;
        }
        this.state = 'active';           // active | stumble | down | getup | dead
        this.muscle = 1;
        this.stateT = 0;
        this.stagger = 0;
        this.flinch = 0; this.flx = 0; this.flz = 0;
        this.phase = Math.random() * 6.28;
        this.upper = 'run';              // режим рук: run | aim | melee | flail | throw | idle | crawl
        this.attackT = -1;               // 0..1 — ход удара или броска, −1 — нет
        this.time = Math.random() * 10;
        this.acc = 0;
        this.corpseT = 0;
        this.headless = false;
        this.frozen = 0; this.shock = 0; this.burn = 0;
        this.clutchT = 0; this.clutchPart = null; this.clutchG = [0, 0, 0];
        this.legs = 0; for (const p of this.parts) if (p.role === 'leg' && p.prox) this.legs++;
        this.crawl = false;
        this.gone = false;
        this.lod = false;
        this.radius = (opts.radius || type.radius || 1.4) * s;
        this.h = (type.height || 1.8) * s;
        this.r = (type.girth || 0.3) * s;
        /** @type {((part: any) => void) | null} */
        this.onSever = null;
        this._frames();
    }

    static _relFromEuler(pos, rot) {
        const cx = Math.cos(rot[0]), sx = Math.sin(rot[0]), cy = Math.cos(rot[1]), sy = Math.sin(rot[1]), cz = Math.cos(rot[2]), sz = Math.sin(rot[2]);
        // столбцы — оси части в осях родителя (Ry·Rx·Rz)
        return {
            p: pos,
            x: [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz],
            y: [-cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz],
            z: [sy * cx, -sx, cy * cx],
        };
    }

    /** Текущий центр (таз или первая часть), мир. */
    center(out) {
        const i = this.type.skeleton.ids.pelvis != null ? this.type.skeleton.ids.pelvis : 0;
        out[0] = this.P[i * 3]; out[1] = this.P[i * 3 + 1]; out[2] = this.P[i * 3 + 2];
        return out;
    }

    // =================================================================== кадр

    update(dt) {
        this.time += dt;
        this.stateT += dt;
        if (this.flinch > 0) this.flinch = Math.max(0, this.flinch - dt * 3.2);
        if (this.stagger > 0) this.stagger = Math.max(0, this.stagger - dt * 1.1);
        if (this.shock > 0) this.shock -= dt;
        for (let i = 0; i < this.n; i++) if (this.pm[i] < 1 && !this.cut[i]) this.pm[i] = Math.min(1, this.pm[i] + dt * 2.6);
        // мышцы по состоянию
        let m = 1;
        if (this.state === 'stumble') m = 0.55;
        else if (this.state === 'down') m = this.crawl ? 0.36 : 0;
        else if (this.state === 'getup') { const q = Math.min(1, this.stateT / 1.15); m = q * q * q; }
        else if (this.state === 'dead') m = 0;
        if (this.shock > 0) m *= 0.5 + 0.5 * Math.sin(this.time * 61);
        this.muscle += (m - this.muscle) * Math.min(1, dt * 14);
        if (this.muscle < 0.004) this.muscle = 0;
        // лежачий дёргается: пытается опереться, в конце затихает (умирающий — только первую секунду)
        if (this.muscle === 0 && (this.state === 'down' || this.stateT < 1.1) && this.stateT > 0.35 && Math.random() < dt * 5) {
            const ids = this.type.skeleton.ids, list = ['haL', 'haR', 'anL', 'anR', 'head'];
            const n = list[(Math.random() * list.length) | 0];
            if (ids[n] != null && !this.cut[ids[n]]) this.kick(ids[n], (Math.random() - 0.5) * 3.2, 1 + Math.random() * 2.4, (Math.random() - 0.5) * 3.2);
        }
        if (this.frozen > 0) { this._frames(); this._sync(); return; }
        if (this.muscle > 0.02 && this.type.pose) this.type.pose(this, dt);
        if (this.lod && this.state === 'active') {
            // далеко и стоит на ногах: без физики, прямо по позе
            this.P.set(this.T); this.O.set(this.T);
        } else {
            this.acc = Math.min(this.acc + dt, FOLK_H * 3);
            while (this.acc >= FOLK_H) { this._step(FOLK_H); this.acc -= FOLK_H; }
        }
        this._frames();
        this._checkConnectivity();
        this._sync();
    }

    _step(h) {
        const { P, O, T, W, pm, cut, Rd } = this;
        const g = 12.5 * h * h;
        const mus = this.muscle;
        const physical = mus < 0.8 || this.state === 'stumble';
        for (let i = 0; i < this.n; i++) {
            const a = cut[i] ? 0 : mus * pm[i];
            const damp = 0.996 - 0.2 * a;
            const j = i * 3;
            const vx = (P[j] - O[j]) * damp, vy = (P[j + 1] - O[j + 1]) * damp, vz = (P[j + 2] - O[j + 2]) * damp;
            O[j] = P[j]; O[j + 1] = P[j + 1]; O[j + 2] = P[j + 2];
            P[j] += vx; P[j + 1] += vy - g * (1 - a); P[j + 2] += vz;
            if (a > 0.004) {
                const k = Math.min(0.6, Math.pow(a, 1.5) * 0.62);
                P[j] += (T[j] - P[j]) * k; P[j + 1] += (T[j + 1] - P[j + 1]) * k; P[j + 2] += (T[j + 2] - P[j + 2]) * k;
            }
        }
        const its = physical ? 7 : 4;
        // падающий продолжает заваливаться, пока верх тела выше таза (не остаётся стоять на сложенных ногах)
        if (mus < 0.1 && this.stateT < 1.6 && this.fallX != null && this.type.skeleton.ids.neck != null) {
            const ids = this.type.skeleton.ids, nk = ids.neck * 3, pl = ids.pelvis * 3;
            if (P[nk + 1] - P[pl + 1] > 0.25 * this.scale) {
                const f = 26 * h * h;
                P[nk] += this.fallX * f; P[nk + 2] += this.fallZ * f;
                if (ids.head != null) { P[ids.head * 3] += this.fallX * f; P[ids.head * 3 + 2] += this.fallZ * f; }
                // падая, выставляет руки вперёд: ловит землю
                for (const n of ['haL', 'haR']) {
                    const i = ids[n];
                    if (i == null || this.cut[i]) continue;
                    const q = 34 * h * h;
                    P[i * 3] += this.fallX * q; P[i * 3 + 2] += this.fallZ * q; P[i * 3 + 1] += 8 * h * h;
                }
            }
        }
        for (let it = 0; it < its; it++) {
            for (const c of this.links) {
                const ai = c.a * 3, bi = c.b * 3;
                const dx = P[bi] - P[ai], dy = P[bi + 1] - P[ai + 1], dz = P[bi + 2] - P[ai + 2];
                const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
                if (c.min && L >= c.L) continue;
                const wa = W[c.a], wb = W[c.b], w = wa + wb;
                const f = (L - c.L) / L * c.k / w;
                P[ai] += dx * f * wa; P[ai + 1] += dy * f * wa; P[ai + 2] += dz * f * wa;
                P[bi] -= dx * f * wb; P[bi + 1] -= dy * f * wb; P[bi + 2] -= dz * f * wb;
            }
            if (physical && it % 2 === 1) for (let i = 0; i < this.n; i++) this._collide(i);
        }
    }

    /** Сфера частицы против вокселей мира: выталкивание и трение. */
    _collide(i) {
        const w = VoxFolk.world;
        if (!w) return;
        const { P, O, Rd } = this;
        const j = i * 3, r = Rd[i], vs = w.vs, k = 1 / vs;
        const px = P[j], py = P[j + 1], pz = P[j + 2];
        const x0 = Math.floor((px - r) * k), x1 = Math.floor((px + r) * k);
        const y0 = Math.floor((py - r) * k), y1 = Math.floor((py + r) * k);
        const z0 = Math.floor((pz - r) * k), z1 = Math.floor((pz + r) * k);
        if (!w.regionHasSolid(x0, y0, z0, x1, y1, z1)) return;
        let hit = false, nx = 0, ny = 0, nz = 0;
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            if (!w.get(x, y, z)) continue;
            const qx = P[j], qy = P[j + 1], qz = P[j + 2];
            const cx = Math.max(x * vs, Math.min((x + 1) * vs, qx)), cy = Math.max(y * vs, Math.min((y + 1) * vs, qy)), cz = Math.max(z * vs, Math.min((z + 1) * vs, qz));
            let dx = qx - cx, dy = qy - cy, dz = qz - cz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 < 1e-8) {
                // центр внутри вокселя: наружу через открытую грань, вверх по умолчанию
                let dirY = 1;
                if (w.get(x, y + 1, z) && !w.get(x, y - 1, z)) dirY = -1;
                P[j + 1] = dirY > 0 ? (y + 1) * vs + r : y * vs - r;
                ny += dirY; hit = true;
                continue;
            }
            const d = Math.sqrt(d2), f = (r - d) / d;
            P[j] += dx * f; P[j + 1] += dy * f; P[j + 2] += dz * f;
            nx += dx / d; ny += dy / d; nz += dz / d;
            hit = true;
        }
        if (!hit) return;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const vx = P[j] - O[j], vy = P[j + 1] - O[j + 1], vz = P[j + 2] - O[j + 2];
        const vn = vx * nx + vy * ny + vz * nz;
        const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
        const keep = vn > 0 ? vn : -vn * 0.12;
        const fr = 0.34;
        O[j] = P[j] - (tx * (1 - fr) + nx * keep); O[j + 1] = P[j + 1] - (ty * (1 - fr) + ny * keep); O[j + 2] = P[j + 2] - (tz * (1 - fr) + nz * keep);
    }

    // =================================================================== кадры частей и меши

    _frames() {
        const P = this.P;
        for (const p of this.parts) {
            if (p.kind === 'rider') {
                const par = p.parent;
                if (!par || !p.rel) continue;
                const r = p.rel, X = par.ax, Y = par.ay, Z = par.az;
                p.c[0] = par.c[0] + X[0] * r.p[0] + Y[0] * r.p[1] + Z[0] * r.p[2];
                p.c[1] = par.c[1] + X[1] * r.p[0] + Y[1] * r.p[1] + Z[1] * r.p[2];
                p.c[2] = par.c[2] + X[2] * r.p[0] + Y[2] * r.p[1] + Z[2] * r.p[2];
                for (const [o, l] of /** @type {[number[], number[]][]} */ ([[p.ax, r.x], [p.ay, r.y], [p.az, r.z]])) {
                    o[0] = X[0] * l[0] + Y[0] * l[1] + Z[0] * l[2];
                    o[1] = X[1] * l[0] + Y[1] * l[1] + Z[1] * l[2];
                    o[2] = X[2] * l[0] + Y[2] * l[1] + Z[2] * l[2];
                }
                continue;
            }
            const t = p.top * 3, b = p.bot * 3;
            let yx = P[t] - P[b], yy = P[t + 1] - P[b + 1], yz = P[t + 2] - P[b + 2];
            const yl = Math.sqrt(yx * yx + yy * yy + yz * yz) || 1e-5;
            yx /= yl; yy /= yl; yz /= yl;
            let zx, zy, zz, xx, xy, xz;
            if (p.xa >= 0) {
                const a = p.xa * 3, c = p.xb * 3;
                xx = P[a] - P[c]; xy = P[a + 1] - P[c + 1]; xz = P[a + 2] - P[c + 2];
                const d = xx * yx + xy * yy + xz * yz;
                xx -= d * yx; xy -= d * yy; xz -= d * yz;
                const l = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1e-5;
                xx /= l; xy /= l; xz /= l;
                zx = xy * yz - xz * yy; zy = xz * yx - xx * yz; zz = xx * yy - xy * yx;
            } else {
                // перенос оси вперёд от прошлого кадра, с притяжением к родителю (рука не закручивается)
                const Z = p.az, par = p.attached && p.parent ? p.parent.az : null;
                zx = Z[0]; zy = Z[1]; zz = Z[2];
                if (par) { zx += (par[0] - zx) * 0.12; zy += (par[1] - zy) * 0.12; zz += (par[2] - zz) * 0.12; }
                const d = zx * yx + zy * yy + zz * yz;
                zx -= d * yx; zy -= d * yy; zz -= d * yz;
                let l = Math.sqrt(zx * zx + zy * zy + zz * zz);
                if (l < 1e-3) { zx = this.fx; zy = 0.01; zz = this.fz; const dd = zx * yx + zy * yy + zz * yz; zx -= dd * yx; zy -= dd * yy; zz -= dd * yz; l = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1; }
                zx /= l; zy /= l; zz /= l;
                xx = yy * zz - yz * zy; xy = yz * zx - yx * zz; xz = yx * zy - yy * zx;
            }
            p.ax[0] = xx; p.ax[1] = xy; p.ax[2] = xz;
            p.ay[0] = yx; p.ay[1] = yy; p.ay[2] = yz;
            p.az[0] = zx; p.az[1] = zy; p.az[2] = zz;
            const o = p.ofs;
            p.c[0] = (P[t] + P[b]) * 0.5 + xx * o[0] + yx * o[1] + zx * o[2];
            p.c[1] = (P[t + 1] + P[b + 1]) * 0.5 + xy * o[0] + yy * o[1] + zy * o[2];
            p.c[2] = (P[t + 2] + P[b + 2]) * 0.5 + xz * o[0] + yz * o[1] + zz * o[2];
        }
    }

    _sync() {
        const scene = VoxFolk.scene;
        if (!scene) return;
        for (const p of this.parts) {
            if (p.dirty && (VoxFolk.remeshBudget > 0 || !p.mesh)) { this._remesh(p); VoxFolk.remeshBudget--; }
            const m = p.mesh;
            if (!m) continue;
            m.position.set(p.c[0], p.c[1], p.c[2]);
            VoxFolk.axesToQuat(p.ax, p.ay, p.az, m.rotationQuaternion);
        }
    }

    _remesh(p) {
        p.dirty = false;
        if (!p.count) { if (p.mesh) { p.mesh.dispose(); p.mesh = null; } return; }
        const { sx, sy, sz } = p;
        const px = sx + 2, pz = sz + 2, pad = new Uint8Array(px * pz * (sy + 2));
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
            const src = sx * (z + sz * y);
            pad.set(p.grid.subarray(src, src + sx), 1 + px * ((z + 1) + pz * (y + 1)));
        }
        const r = VoxMesher.build(pad, sx, sy, sz, p.ox, p.oy, p.oz, 0.1);
        if (!r.opaque) { if (p.mesh) { p.mesh.dispose(); p.mesh = null; } return; }
        if (!p.mesh) {
            const m = p.mesh = new BABYLON.Mesh('folk', VoxFolk.scene);
            m.material = VoxRender.mat;
            m.isPickable = false;
            m.receiveShadows = true;
            m.rotationQuaternion = new BABYLON.Quaternion();
            m.scaling.setAll(this.vox / 0.1);
            VoxRender._casters = [];
        }
        VoxRender.applyBuffers(p.mesh, r.opaque);
    }

    dispose() {
        for (const p of this.parts) { if (p.mesh) { p.mesh.dispose(); p.mesh = null; } }
        VoxRender._casters = [];
        this.gone = true;
    }

    // =================================================================== попадания

    /** Центр вокселя (i,j,k) части -> мир. */
    voxWorld(p, i, j, k, out) {
        const v = this.vox, a = (i + p.ox + 0.5) * v, b = (j + p.oy + 0.5) * v, c = (k + p.oz + 0.5) * v;
        out[0] = p.c[0] + p.ax[0] * a + p.ay[0] * b + p.az[0] * c;
        out[1] = p.c[1] + p.ax[1] * a + p.ay[1] * b + p.az[1] * c;
        out[2] = p.c[2] + p.ax[2] * a + p.ay[2] * b + p.az[2] * c;
        return out;
    }
    /** Точка мира -> координаты сетки части (дробные воксели от угла). */
    worldVox(p, x, y, z, out) {
        const iv = 1 / this.vox, dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
        out[0] = (dx * p.ax[0] + dy * p.ax[1] + dz * p.ax[2]) * iv - p.ox;
        out[1] = (dx * p.ay[0] + dy * p.ay[1] + dz * p.ay[2]) * iv - p.oy;
        out[2] = (dx * p.az[0] + dy * p.az[1] + dz * p.az[2]) * iv - p.oz;
        return out;
    }

    /** Луч по всем частям: ближайшее попадание { t, x, y, z, part, nx, ny, nz, v, gx, gy, gz } или null. */
    raycast(ox, oy, oz, dx, dy, dz, max) {
        // габарит: сфера у таза
        const c = VoxFolk._v, R = this.radius;
        this.center(c);
        const cx = c[0] - ox, cy = c[1] - oy, cz = c[2] - oz;
        const tc = cx * dx + cy * dy + cz * dz;
        if (tc < -R || tc - R > max) return null;
        const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
        if (d2 > R * R) return null;
        let best = null;
        const L = VoxFolk._v2;
        for (const p of this.parts) {
            if (!p.count) continue;
            this.worldVox(p, ox, oy, oz, L);
            const ldx = dx * p.ax[0] + dy * p.ax[1] + dz * p.ax[2], ldy = dx * p.ay[0] + dy * p.ay[1] + dz * p.ay[2], ldz = dx * p.az[0] + dy * p.az[1] + dz * p.az[2];
            const lim = (best ? best.t : max) / this.vox;
            const h = VoxPhysics._gridRay(p, L[0], L[1], L[2], ldx, ldy, ldz, lim);
            if (!h) continue;
            const t = h.t * this.vox;
            if (best && t >= best.t) continue;
            const n = h.n;
            best = { t, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, part: p, v: h.v, gx: h.x, gy: h.y, gz: h.z,
                nx: p.ax[0] * n[0] + p.ay[0] * n[1] + p.az[0] * n[2], ny: p.ax[1] * n[0] + p.ay[1] * n[1] + p.az[1] * n[2], nz: p.ax[2] * n[0] + p.ay[2] * n[1] + p.az[2] * n[2] };
        }
        return best;
    }

    /**
     * Вынуть из части сферу вокселей: центр в координатах сетки, radius — метры. Кубики разлетаются.
     * Возвращает число вынутых вокселей.
     */
    carve(p, gx, gy, gz, radius, speed = 3, dirx = 0, diry = 0, dirz = 0, burstKeep = 1) {
        const rv = radius / this.vox / (p.armor || 1);
        const x0 = Math.max(0, Math.floor(gx - rv - 1)), x1 = Math.min(p.sx - 1, Math.ceil(gx + rv + 1));
        const y0 = Math.max(0, Math.floor(gy - rv - 1)), y1 = Math.min(p.sy - 1, Math.ceil(gy + rv + 1));
        const z0 = Math.max(0, Math.floor(gz - rv - 1)), z1 = Math.min(p.sz - 1, Math.ceil(gz + rv + 1));
        let n = 0;
        const W = VoxFolk._v3, sx = p.sx, sz = p.sz, G = p.grid;
        const size = this.vox / 0.1 * 1.05;
        const every = Math.max(1, VoxFolk.pixelEvery());
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            const i = x + sx * (z + sz * y);
            const v = G[i];
            if (!v) continue;
            const ddx = x + 0.5 - gx, ddy = y + 0.5 - gy, ddz = z + 0.5 - gz;
            const lim = rv * (0.82 + VoxFolk.hash(x, y, z) * 0.36);
            if (ddx * ddx + ddy * ddy + ddz * ddz > lim * lim) continue;
            G[i] = 0;
            n++;
            if (n % every === 0 && Math.random() < burstKeep) {
                this.voxWorld(p, x, y, z, W);
                const a = (ddx * p.ax[0] + ddy * p.ay[0] + ddz * p.az[0]), b = (ddx * p.ax[1] + ddy * p.ay[1] + ddz * p.az[1]), c = (ddx * p.ax[2] + ddy * p.ay[2] + ddz * p.az[2]);
                const l = Math.hypot(a, b, c) || 1;
                const sp = speed * (0.45 + Math.random() * 0.9);
                VoxFX.spawnDebris(W[0], W[1], W[2], v, a / l * sp + dirx * speed * 0.55, b / l * sp + diry * speed * 0.55 + 0.8, c / l * sp + dirz * speed * 0.55, size);
            }
        }
        if (n) { p.count -= n; p.dirty = true; p.check = true; }
        return n;
    }

    /** Толкнуть частицу: скорость м/с (Верле хранит её прошлым положением). */
    kick(i, vx, vy, vz) {
        const j = i * 3;
        this.O[j] -= vx * FOLK_H; this.O[j + 1] -= vy * FOLK_H; this.O[j + 2] -= vz * FOLK_H;
    }
    /** Все частицы: добавить скорость и ослабить мышцы. */
    kickAll(vx, vy, vz, weak = 0) {
        for (let i = 0; i < this.n; i++) { this.kick(i, vx, vy, vz); if (weak) this.pm[i] = Math.min(this.pm[i], 1 - weak); }
    }

    /**
     * Импульс в точке (от пули, удара): ближайшие частицы получают скорость, мышцы там слабеют; тело вздрагивает.
     * power — м/с у точки удара.
     */
    impulseAt(x, y, z, dx, dy, dz, power) {
        const P = this.P;
        for (let i = 0; i < this.n; i++) {
            const j = i * 3;
            const d = Math.hypot(P[j] - x, P[j + 1] - y, P[j + 2] - z);
            const f = Math.max(0, 1 - d / (0.55 * this.scale));
            const far = 0.12;       // всё тело чуть-чуть
            const k = far + (1 - far) * f;
            this.kick(i, dx * power * k, dy * power * k, dz * power * k);
            if (f > 0) this.pm[i] = Math.min(this.pm[i], 1 - 0.9 * f);
        }
        this.flinch = Math.min(1, this.flinch + Math.min(1, power / 7));
        this.flx = dx; this.flz = dz;
    }

    // =================================================================== связность и отрывы

    _checkConnectivity() {
        for (const p of this.parts) {
            if (!p.check) continue;
            p.check = false;
            this._splitPart(p);
        }
    }

    /** Разметить острова сетки: part.label — номер острова; -> [{ n, prox, dist, first }]. */
    _islands(p) {
        const { sx, sy, sz, grid } = p;
        const label = VoxFolk._label(sx * sy * sz);
        label.fill(0, 0, sx * sy * sz);
        const stack = VoxFolk._stack;
        const out = [];
        const proxY = p.prox === 'top' ? sy - 1 : (p.prox === 'bot' ? 0 : -1);
        const distY = p.prox === 'top' ? 0 : (p.prox === 'bot' ? sy - 1 : -1);
        const band = 2;
        let id = 0;
        for (let s = 0; s < grid.length; s++) {
            if (!grid[s] || label[s]) continue;
            id++;
            let sp = 0, n = 0, prox = false, dist = false;
            stack[sp++] = s; label[s] = id;
            while (sp > 0) {
                const i = stack[--sp];
                n++;
                const y = (i / (sx * sz)) | 0, r = i - y * sx * sz, z = (r / sx) | 0, x = r - z * sx;
                if (proxY >= 0 && Math.abs(y - proxY) <= band) prox = true;
                if (distY >= 0 && Math.abs(y - distY) <= band) dist = true;
                if (x > 0 && grid[i - 1] && !label[i - 1]) { label[i - 1] = id; stack[sp++] = i - 1; }
                if (x < sx - 1 && grid[i + 1] && !label[i + 1]) { label[i + 1] = id; stack[sp++] = i + 1; }
                if (z > 0 && grid[i - sx] && !label[i - sx]) { label[i - sx] = id; stack[sp++] = i - sx; }
                if (z < sz - 1 && grid[i + sx] && !label[i + sx]) { label[i + sx] = id; stack[sp++] = i + sx; }
                const L = sx * sz;
                if (y > 0 && grid[i - L] && !label[i - L]) { label[i - L] = id; stack[sp++] = i - L; }
                if (y < sy - 1 && grid[i + L] && !label[i + L]) { label[i + L] = id; stack[sp++] = i + L; }
            }
            out.push({ id, n, prox, dist, first: s });
        }
        return { out, label };
    }

    _splitPart(p) {
        if (!p.count) { if (p.mesh) p.dirty = true; if (p.attached && p.prox) this._severIfNeeded(p); return; }
        const { out, label } = this._islands(p);
        const hasKids = p.kids.some(k => k.attached && k.kind === 'bone');
        // уже оторванная часть: всё, кроме самого большого куска, отваливается
        if (!p.attached || p.kind === 'rider') {
            out.sort((a, b) => b.n - a.n);
            for (let i = 1; i < out.length; i++) this._dropIsland(p, label, out[i].id, out[i].n);
            return;
        }
        if (out.length === 1 && (!p.prox || out[0].prox) && (!hasKids || out[0].dist)) return;
        // главный остров остаётся на кости: со связью с родителем (и, если есть, с детьми) или самый большой
        out.sort((a, b) => b.n - a.n);
        let main = null;
        if (p.prox) {
            main = out.find(o => o.prox && (!hasKids || o.dist)) || null;
        } else main = out[0];
        if (main) {
            for (const o of out) if (o !== main) this._dropIsland(p, label, o.id, o.n);
            return;
        }
        // кость перебита: то, что у сустава, становится культёй на родителе, остальное летит с детьми
        const proxPiece = out.find(o => o.prox) || null;
        const distPiece = hasKids ? (out.find(o => o.dist && o !== proxPiece) || null) : (out.find(o => o !== proxPiece) || null);
        if (proxPiece && p.parent && p.parent.attached !== undefined) this._makeStump(p, label, proxPiece.id);
        for (const o of out) if (o !== proxPiece && o !== distPiece) this._dropIsland(p, label, o.id, o.n);
        if (p.attached && p.prox) this._sever(p);
    }

    /** Кусок вокселей без связи: мелкий — кубики, крупный — летящий гиб. */
    _dropIsland(p, label, id, n) {
        const { sx, sy, sz, grid } = p;
        if (n < 10 || VoxFolk.gibs.length >= VoxFolk.MAX_GIBS) {
            const W = VoxFolk._v3, size = this.vox / 0.1;
            for (let i = 0; i < grid.length; i++) {
                if (label[i] !== id) continue;
                const y = (i / (sx * sz)) | 0, r = i - y * sx * sz, z = (r / sx) | 0, x = r - z * sx;
                this.voxWorld(p, x, y, z, W);
                VoxFX.spawnDebris(W[0], W[1], W[2], grid[i], (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, size);
                grid[i] = 0;
            }
        } else {
            const g = new Uint8Array(grid.length);
            for (let i = 0; i < grid.length; i++) if (label[i] === id) { g[i] = grid[i]; grid[i] = 0; }
            VoxFolk.spawnGib(this, p, g, n);
        }
        p.count -= n;
        p.dirty = true;
    }

    /** Часть воксельной кости остаётся у сустава жёстким обрубком на родителе. */
    _makeStump(p, label, id) {
        const par = p.parent;
        if (!par) return;
        const g = new Uint8Array(p.grid.length);
        let n = 0;
        for (let i = 0; i < p.grid.length; i++) if (label[i] === id) { g[i] = p.grid[i]; p.grid[i] = 0; n++; }
        p.count -= n; p.dirty = true;
        const dc = [p.c[0] - par.c[0], p.c[1] - par.c[1], p.c[2] - par.c[2]];
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const rel = {
            p: [dot(dc, par.ax), dot(dc, par.ay), dot(dc, par.az)],
            x: [dot(p.ax, par.ax), dot(p.ax, par.ay), dot(p.ax, par.az)],
            y: [dot(p.ay, par.ax), dot(p.ay, par.ay), dot(p.ay, par.az)],
            z: [dot(p.az, par.ax), dot(p.az, par.ay), dot(p.az, par.az)],
        };
        const stump = {
            name: p.name + '-stump', kind: 'rider', role: 'other', armor: p.armor, sx: p.sx, sy: p.sy, sz: p.sz, grid: g, ox: p.ox, oy: p.oy, oz: p.oz,
            top: -1, bot: -1, xa: -1, xb: -1, prox: null, parent: par, kids: [], attached: true,
            c: p.c.slice(), ax: p.ax.slice(), ay: p.ay.slice(), az: p.az.slice(), ofs: [0, 0, 0], mesh: null, dirty: true, count: n, count0: n, check: false,
            pos: null, rot: null, rel, saved: null,
        };
        // родитель стоит в списке раньше: вставляем сразу за ним, порядок кадров сохраняется
        this.parts.splice(this.parts.indexOf(par) + 1, 0, stump);
        par.kids.push(stump);
    }

    _severIfNeeded(p) { if (p.attached && p.prox) this._sever(p); }

    /** Оторвать кость от сустава вместе со всем поддеревом: частица сустава клонируется, связи перевешиваются. */
    _sever(p) {
        if (!p.attached || !p.prox) return;
        p.attached = false;
        const sock = p.prox === 'top' ? p.top : p.bot;
        const J = sock * 3;
        const clone = this.n++;
        this.P[clone * 3] = this.P[J]; this.P[clone * 3 + 1] = this.P[J + 1]; this.P[clone * 3 + 2] = this.P[J + 2];
        this.O[clone * 3] = this.O[J]; this.O[clone * 3 + 1] = this.O[J + 1]; this.O[clone * 3 + 2] = this.O[J + 2];
        this.Rd[clone] = this.Rd[sock]; this.W[clone] = this.W[sock]; this.cut[clone] = 1; this.pm[clone] = 0;
        // все частицы поддерева
        const inside = new Set();
        const walk = (q) => {
            if (q.kind === 'bone') {
                const d = q === p ? (p.prox === 'top' ? q.bot : q.top) : -1;
                if (d >= 0) inside.add(d);
                if (q !== p) { if (q.top >= 0 && q.top !== sock) inside.add(q.top); if (q.bot >= 0 && q.bot !== sock) inside.add(q.bot); }
                if (q.xa >= 0) { inside.add(q.xa); inside.add(q.xb); }
            }
            q.attached = false;
            for (const k of q.kids) walk(k);
        };
        walk(p);
        inside.delete(sock);
        for (const i of inside) { this.cut[i] = 1; this.pm[i] = 0; }
        // связи: внутрь — на клон; через разрез с другими частицами — убрать
        const keep = [];
        for (const c of this.links) {
            const ia = inside.has(c.a), ib = inside.has(c.b);
            if (ia === ib) { keep.push(c); continue; }
            const out = ia ? c.b : c.a;
            if (out === sock && !c.min) { if (ia) c.b = clone; else c.a = clone; keep.push(c); }
        }
        this.links = keep;
        if (p.prox === 'top') p.top = clone; else p.bot = clone;
        // клон входит в кости поддерева, у которых был сокет
        for (const q of this.parts) {
            if (q === p || q.attached || q.kind !== 'bone') continue;
            if (q.top === sock) q.top = clone;
            if (q.bot === sock) q.bot = clone;
        }
        // разлёт
        for (const i of inside) this.kick(i, (Math.random() - 0.5) * 2.4, 1 + Math.random() * 2, (Math.random() - 0.5) * 2.4);
        this.kick(clone, (Math.random() - 0.5) * 2.4, 1 + Math.random() * 2, (Math.random() - 0.5) * 2.4);
        if (this.onSever) this.onSever(p);
    }

    // =================================================================== состояния

    fall(t = 2.2) {
        if (this.state === 'dead') return;
        if (this.state !== 'down') this._topple();
        this.state = 'down'; this.stateT = 0; this.downFor = t;
    }
    /** Тело теряет равновесие: верх уходит по направлению удара (или случайно), низ — обратно. */
    _topple() {
        const ids = this.type.skeleton.ids;
        let dx = this.flx, dz = this.flz, l = Math.hypot(dx, dz);
        if (l < 0.1 || this.flinch <= 0) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); l = 1; }
        dx /= l; dz /= l;
        this.fallX = dx; this.fallZ = dz;
        for (const [n, k] of /** @type {[string, number][]} */ ([['head', 3.4], ['neck', 2.6], ['shL', 2.4], ['shR', 2.4], ['waist', 1.2], ['pelvis', -0.4], ['anL', -1.2], ['anR', -1.2]])) {
            if (ids[n] != null) this.kick(ids[n], dx * k, 0, dz * k);
        }
    }
    stumble(t = 0.7) {
        if (this.state === 'dead' || this.state === 'down') return;
        this.state = 'stumble'; this.stateT = 0; this.stumbleFor = t;
    }
    die() {
        if (this.state === 'dead') return;
        if (this.state !== 'down') this._topple();
        this.state = 'dead'; this.stateT = 0; this.corpseT = 0;
        this.crawl = false;
    }
    /** Заморозка: воксели становятся льдом (исходные цвета — в saved), тело застывает. */
    setFrozen(sec) {
        if (sec > 0 && !this.frozen) {
            const ice = M.toy_ice;
            for (const p of this.parts) { p.saved = p.grid.slice(); for (let i = 0; i < p.grid.length; i++) if (p.grid[i]) p.grid[i] = ice; p.dirty = true; }
        }
        if (sec <= 0 && this.frozen) {
            for (const p of this.parts) { if (p.saved) { for (let i = 0; i < p.grid.length; i++) if (p.grid[i]) p.grid[i] = p.saved[i] || p.grid[i]; p.saved = null; p.dirty = true; } }
        }
        this.frozen = sec;
    }
    /** Обуглить часть вокселей (огонь): бит 128 в байте, цвет темнеет. */
    char(amount = 0.03) {
        for (const p of this.parts) {
            let any = false;
            for (let i = 0; i < p.grid.length; i++) if (p.grid[i] && !(p.grid[i] & 128) && Math.random() < amount) { p.grid[i] |= 128; any = true; }
            if (any) p.dirty = true;
        }
    }
    /** Сколько вокселей осталось у частей с ролью role (доля). */
    roleHealth(role) {
        let n = 0, n0 = 0;
        for (const p of this.parts) if (p.role === role && (p.attached || !p.prox)) { n += p.count; n0 += p.count0; }
        return n0 ? n / n0 : 1;
    }
    /** Рассыпать всё тело кубиками (конец трупа, разбитый лёд). */
    shatter(speed = 3, every = 3) {
        const W = VoxFolk._v3, size = this.vox / 0.1;
        for (const p of this.parts) {
            let c = 0;
            for (let y = 0; y < p.sy; y++) for (let z = 0; z < p.sz; z++) for (let x = 0; x < p.sx; x++) {
                const v = p.grid[x + p.sx * (z + p.sz * y)];
                if (!v || (c++ % every)) continue;
                this.voxWorld(p, x, y, z, W);
                VoxFX.spawnDebris(W[0], W[1], W[2], v, (Math.random() - 0.5) * speed * 2, Math.random() * speed + 0.5, (Math.random() - 0.5) * speed * 2, size);
            }
        }
        this.dispose();
    }
}

/** Гиб: оторванный кусок вокселей без суставов — жёсткий, отскакивает, потом рассыпается. */
class FolkGib {
    constructor(rig, p, grid, n) {
        this.sx = p.sx; this.sy = p.sy; this.sz = p.sz; this.grid = grid; this.n = n;
        this.ox = p.ox; this.oy = p.oy; this.oz = p.oz; this.vox = rig.vox;
        this.x = p.c[0]; this.y = p.c[1]; this.z = p.c[2];
        this.ax = p.ax.slice(); this.ay = p.ay.slice(); this.az = p.az.slice();
        this.vx = (Math.random() - 0.5) * 4; this.vy = 2 + Math.random() * 2.5; this.vz = (Math.random() - 0.5) * 4;
        this.wx = (Math.random() - 0.5) * 9; this.wy = (Math.random() - 0.5) * 9; this.wz = (Math.random() - 0.5) * 9;
        this.t = 0; this.life = 5 + Math.random() * 3;
        this.rest = false;
        this.q = new BABYLON.Quaternion();
        VoxFolk.axesToQuat(this.ax, this.ay, this.az, this.q);
        const px = this.sx + 2, pz = this.sz + 2, pad = new Uint8Array(px * pz * (this.sy + 2));
        for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) {
            const src = this.sx * (z + this.sz * y);
            pad.set(grid.subarray(src, src + this.sx), 1 + px * ((z + 1) + pz * (y + 1)));
        }
        const r = VoxMesher.build(pad, this.sx, this.sy, this.sz, this.ox, this.oy, this.oz, 0.1);
        this.mesh = null;
        // центр масс куска — точка вращения: иначе гиб крутится вокруг центра бывшей части
        let cx = 0, cy = 0, cz = 0, c = 0;
        for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) if (grid[x + this.sx * (z + this.sz * y)]) { cx += x; cy += y; cz += z; c++; }
        if (c) {
            cx = (cx / c + this.ox + 0.5) * this.vox; cy = (cy / c + this.oy + 0.5) * this.vox; cz = (cz / c + this.oz + 0.5) * this.vox;
            this.x += this.ax[0] * cx + this.ay[0] * cy + this.az[0] * cz;
            this.y += this.ax[1] * cx + this.ay[1] * cy + this.az[1] * cz;
            this.z += this.ax[2] * cx + this.ay[2] * cy + this.az[2] * cz;
            this.lc = [cx, cy, cz];
        } else this.lc = [0, 0, 0];
        this.rad = Math.max(this.vox, Math.cbrt(c) * this.vox * 0.45);
        if (r.opaque) {
            const m = this.mesh = new BABYLON.Mesh('gib', VoxFolk.scene);
            m.material = VoxRender.mat; m.isPickable = false; m.receiveShadows = true;
            m.rotationQuaternion = new BABYLON.Quaternion();
            m.scaling.setAll(this.vox / 0.1);
            VoxRender.applyBuffers(m, r.opaque);
            VoxRender._casters = [];
        }
    }
    update(dt) {
        this.t += dt;
        if (!this.rest) {
            this.vy -= 12.5 * dt;
            let nx = this.x + this.vx * dt, ny = this.y + this.vy * dt, nz = this.z + this.vz * dt;
            const w = VoxFolk.world;
            if (w) {
                // земля и стены: куски лёгкие, точность сферы центра достаточно
                if (w.at(nx, ny - this.rad, nz)) {
                    ny = Math.ceil((ny - this.rad) / w.vs) * w.vs + this.rad;
                    if (this.vy < -1.2) this.vy *= -0.32; else this.vy = 0;
                    this.vx *= 0.72; this.vz *= 0.72; this.wx *= 0.7; this.wy *= 0.7; this.wz *= 0.7;
                    if (Math.abs(this.vy) < 0.3 && Math.hypot(this.vx, this.vz) < 0.25) this.rest = true;
                }
                if (w.at(nx + Math.sign(this.vx) * this.rad, ny, nz)) { this.vx *= -0.4; nx = this.x; }
                if (w.at(nx, ny, nz + Math.sign(this.vz) * this.rad)) { this.vz *= -0.4; nz = this.z; }
            }
            this.x = nx; this.y = ny; this.z = nz;
            // поворот осей
            const a = Math.hypot(this.wx, this.wy, this.wz) * dt;
            if (a > 1e-4) {
                const ux = this.wx / (a / dt), uy = this.wy / (a / dt), uz = this.wz / (a / dt), c = Math.cos(a), s = Math.sin(a);
                for (const v of [this.ax, this.ay, this.az]) {
                    const d = ux * v[0] + uy * v[1] + uz * v[2];
                    const cx = uy * v[2] - uz * v[1], cy = uz * v[0] - ux * v[2], cz = ux * v[1] - uy * v[0];
                    v[0] = v[0] * c + cx * s + ux * d * (1 - c); v[1] = v[1] * c + cy * s + uy * d * (1 - c); v[2] = v[2] * c + cz * s + uz * d * (1 - c);
                }
            }
        }
        if (this.mesh) {
            const l = this.lc;
            this.mesh.position.set(
                this.x - (this.ax[0] * l[0] + this.ay[0] * l[1] + this.az[0] * l[2]),
                this.y - (this.ax[1] * l[0] + this.ay[1] * l[1] + this.az[1] * l[2]),
                this.z - (this.ax[2] * l[0] + this.ay[2] * l[1] + this.az[2] * l[2]));
            VoxFolk.axesToQuat(this.ax, this.ay, this.az, this.mesh.rotationQuaternion);
        }
        return this.t < this.life;
    }
    finish() {
        const size = this.vox / 0.1, every = Math.max(1, Math.round(this.n / 60));
        let c = 0;
        const l = this.lc;
        for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) {
            const v = this.grid[x + this.sx * (z + this.sz * y)];
            if (!v || (c++ % every)) continue;
            const a = (x + this.ox + 0.5) * this.vox - l[0], b = (y + this.oy + 0.5) * this.vox - l[1], d = (z + this.oz + 0.5) * this.vox - l[2];
            VoxFX.spawnDebris(
                this.x + this.ax[0] * a + this.ay[0] * b + this.az[0] * d,
                this.y + this.ax[1] * a + this.ay[1] * b + this.az[1] * d,
                this.z + this.ax[2] * a + this.ay[2] * b + this.az[2] * d,
                v, (Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.5) * 1.6, size);
        }
        if (this.mesh) { this.mesh.dispose(); this.mesh = null; VoxRender._casters = []; }
    }
}

/** @satisfies {Record<string, any>} */
const VoxFolk = {
    /** @type {VoxWorld | null} */
    world: null,
    /** @type {BABYLON.Scene | null} */
    scene: null,
    /** Типы существ: id -> { id, skeleton, pose, vox, … } (заполняет EnemyTypes.js). @type {Record<string, any>} */
    TYPES: {},
    /** @type {FolkGib[]} */
    gibs: [],
    MAX_GIBS: 36,
    remeshBudget: 8,
    _v: [0, 0, 0], _v2: [0, 0, 0], _v3: [0, 0, 0],
    _stack: new Int32Array(1 << 16),
    /** @type {Int32Array} */
    _labels: new Int32Array(1 << 16),
    _label(n) { if (this._labels.length < n) this._labels = new Int32Array(n * 2); return this._labels; },

    init(world, scene) { this.world = world; this.scene = scene; this.clear(); },
    clear() { for (const g of this.gibs) if (g.mesh) g.mesh.dispose(); this.gibs = []; },

    /** Сколько вокселей на кубик-обломок: на слабой графике реже. */
    pixelEvery() { const q = typeof VoxRender !== 'undefined' ? VoxRender.quality : 'high'; return q === 'low' ? 3 : 1; },

    hash(x, y, z) {
        let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    },

    /** Кватернион из столбцов-осей. */
    axesToQuat(x, y, z, q) {
        const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
        const tr = m00 + m11 + m22;
        if (tr > 0) {
            const s = Math.sqrt(tr + 1) * 2;
            q.set((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s);
        } else if (m00 > m11 && m00 > m22) {
            const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
            q.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
        } else if (m11 > m22) {
            const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
            q.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
        } else {
            const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
            q.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
        }
        return q;
    },

    spawnGib(rig, p, grid, n) {
        const g = new FolkGib(rig, p, grid, n);
        this.gibs.push(g);
        return g;
    },
    /** Кадр: гибы и бюджет пересборки сеток. */
    update(dt) {
        this.remeshBudget = 8;
        for (let i = this.gibs.length - 1; i >= 0; i--) {
            const g = this.gibs[i];
            if (!g.update(dt)) { g.finish(); this.gibs.splice(i, 1); }
        }
    },
    /** Взрыв по гибам: толчок. */
    pushGibs(x, y, z, R, power) {
        for (const g of this.gibs) {
            const dx = g.x - x, dy = g.y - y, dz = g.z - z, d = Math.hypot(dx, dy, dz) || 1;
            if (d > R * 2) continue;
            const f = (1 - d / (R * 2)) * power;
            g.vx += dx / d * f; g.vy += dy / d * f + f * 0.4; g.vz += dz / d * f;
            g.rest = false;
        }
    },
};

/** Заготовки скелетов и поз. Размеры в метрах, дальше масштабирует rig.scale. */
/** @satisfies {Record<string, any>} */
const FolkKit = {
    /**
     * Двуногий. dims: { legU, legL, hipW, belly, chest, shW, armU, armF, neck, head } (м).
     * art: { head, chest, belly, armU, armF, legU, legL } — FolkGrid (ноги и руки: один рисунок на левую и правую,
     * armUR/armFR/legUR/legLR — свой рисунок правой при асимметрии). riders: [{ name, art, parent, pos, rot }].
     * armor: { head, chest, … } — делители выреза. Возвращает FolkSkeleton.
     */
    biped(dims, art, riders, armor) {
        const d = Object.assign({ legU: 0.42, legL: 0.42, hipW: 0.13, belly: 0.25, chest: 0.32, shW: 0.25, armU: 0.3, armF: 0.32, neck: 0.04, head: 0.42 }, dims);
        const sk = new FolkSkeleton();
        const hipY = d.legU + d.legL + 0.05;
        const waistY = hipY + d.belly, neckY = waistY + d.chest, topY = neckY + d.neck + d.head;
        const shY = neckY - 0.03;
        sk.p('pelvis', 0, hipY, 0, 0.13, 8).p('waist', 0, waistY, 0, 0.13, 8).p('neck', 0, neckY, 0, 0.13, 7);
        sk.p('head', 0, topY, 0, 0.13, 3);
        sk.p('hiL', d.hipW, hipY - 0.03, 0, 0.1, 5).p('hiR', -d.hipW, hipY - 0.03, 0, 0.1, 5);
        sk.p('shL', d.shW, shY, 0, 0.09, 4).p('shR', -d.shW, shY, 0, 0.09, 4);
        sk.p('elL', d.shW + 0.02, shY - d.armU, 0, 0.07, 2).p('elR', -d.shW - 0.02, shY - d.armU, 0, 0.07, 2);
        sk.p('haL', d.shW + 0.03, shY - d.armU - d.armF, 0.02, 0.07, 1.4).p('haR', -d.shW - 0.03, shY - d.armU - d.armF, 0.02, 0.07, 1.4);
        sk.p('knL', d.hipW, hipY - 0.03 - d.legU, 0.015, 0.08, 3).p('knR', -d.hipW, hipY - 0.03 - d.legU, 0.015, 0.08, 3);
        sk.p('anL', d.hipW, 0.08, 0, 0.08, 2).p('anR', -d.hipW, 0.08, 0, 0.08, 2);
        sk.rigid(['pelvis', 'waist', 'hiL', 'hiR']);
        sk.rigid(['waist', 'neck', 'shL', 'shR']);
        sk.link('neck', 'pelvis', 0.3).link('shL', 'hiL', 0.2).link('shR', 'hiR', 0.2).link('shL', 'hiR', 0.2).link('shR', 'hiL', 0.2);
        sk.link('neck', 'head', 1).link('shL', 'head', 0.3).link('shR', 'head', 0.3).link('waist', 'head', 0.15);
        for (const [s, e, h, hi, kn, an] of [['shL', 'elL', 'haL', 'hiL', 'knL', 'anL'], ['shR', 'elR', 'haR', 'hiR', 'knR', 'anR']]) {
            sk.link(s, e).link(e, h).link(s, h, 1, true, 0.42);
            sk.link(hi, kn).link(kn, an).link(hi, an, 1, true, 0.34);
        }
        const ar = armor || {};
        sk.part('belly', { art: art.belly, top: 'waist', bot: 'pelvis', xa: 'hiL', xb: 'hiR', prox: null, role: 'core', armor: ar.belly || 1 });
        sk.part('chest', { art: art.chest, top: 'neck', bot: 'waist', xa: 'shL', xb: 'shR', prox: 'bot', parent: 'belly', role: 'core', armor: ar.chest || 1 });
        sk.part('head', { art: art.head, top: 'head', bot: 'neck', prox: 'bot', parent: 'chest', role: 'head', armor: ar.head || 1 });
        const lim = (nm, g, top, bot, parent, role) => sk.part(nm, { art: g, top, bot, prox: 'top', parent, role, armor: ar[nm] || ar[role] || 1 });
        lim('armUL', art.armU, 'shL', 'elL', 'chest', 'arm'); lim('armFL', art.armF, 'elL', 'haL', 'armUL', 'arm');
        lim('armUR', art.armUR || art.armU, 'shR', 'elR', 'chest', 'arm'); lim('armFR', art.armFR || art.armF, 'elR', 'haR', 'armUR', 'arm');
        lim('legUL', art.legU, 'hiL', 'knL', 'belly', 'leg'); lim('legLL', art.legL, 'knL', 'anL', 'legUL', 'leg');
        lim('legUR', art.legUR || art.legU, 'hiR', 'knR', 'belly', 'leg'); lim('legLR', art.legLR || art.legL, 'knR', 'anR', 'legUR', 'leg');
        for (const r of riders || []) sk.rider(r.name, r);
        /** @type {any} */ (sk).dims = d;
        /** @type {any} */ (sk).hipY = hipY;
        return sk;
    },

    /** Поза двуногого: шаг по скорости корня, руки по rig.upper, вздрагивание, ползком и т. п. */
    poseBiped(rig, dt) {
        const sk = rig.type.skeleton, d = sk.dims, ids = sk.ids, s = rig.scale, T = rig.T, R = rig.root;
        const stride = rig.type.stride != null ? rig.type.stride : 0.42;
        const speed = Math.hypot(R.vx, R.vz);
        rig.phase += speed * dt / (stride * s * 1.15) * Math.PI;
        const walk = Math.min(1, speed / (1.8 * s));
        const ph = rig.phase, sw = Math.sin(ph) * walk, cw = Math.cos(ph);
        const hip = sk.hipY - Math.abs(cw) * 0.03 * walk - 0.05 * walk;
        // локально вперёд по ходу: поворот не мгновенный — корпус ведёт угол корня
        rig.fx = Math.sin(R.yaw); rig.fz = Math.cos(R.yaw); rig.rx = rig.fz; rig.rz = -rig.fx;
        const fx = rig.fx, fz = rig.fz, rx = rig.rx, rz = rig.rz;
        // ход вбок и назад: ноги двигаются вдоль скорости
        const hdg = speed > 0.1 ? (R.vx * fx + R.vz * fz) / speed : 1, side = speed > 0.1 ? (R.vx * rx + R.vz * rz) / speed : 0;
        const lean = 0.12 * walk * hdg + (rig.type.hunch || 0);
        const fl = rig.flinch;
        const flf = (rig.flx * fx + rig.flz * fz) * fl * 0.24, flr = (rig.flx * rx + rig.flz * rz) * fl * 0.24;
        /** @param {string} name */
        const put = (name, lx, ly, lz) => {
            const i = ids[name], j = i * 3;
            T[j] = R.x + (lx * s) * rx + (lz * s) * fx;
            T[j + 1] = R.y + ly * s;
            T[j + 2] = R.z + (lx * s) * rz + (lz * s) * fz;
        };
        const crawl = rig.crawl;
        if (crawl) {
            // ползком: корпус низко, руки тянутся вперёд, ноги волочатся (мышц на них нет)
            const c = Math.sin(rig.time * 7), L = d.belly + d.chest;
            put('pelvis', 0, 0.2, -L * 0.5); put('waist', 0, 0.2, -L * 0.5 + d.belly); put('neck', 0, 0.26, L * 0.5);
            put('head', 0, 0.42, L * 0.5 + d.head * 0.85);
            put('hiL', d.hipW, 0.17, -L * 0.5); put('hiR', -d.hipW, 0.17, -L * 0.5);
            put('shL', d.shW, 0.26, L * 0.46); put('shR', -d.shW, 0.26, L * 0.46);
            put('elL', d.shW + 0.08, 0.22, L * 0.46 + d.armU * (0.5 + 0.4 * c)); put('elR', -d.shW - 0.08, 0.22, L * 0.46 + d.armU * (0.5 - 0.4 * c));
            put('haL', d.shW + 0.1, 0.1, L * 0.46 + (d.armU + d.armF) * (0.55 + 0.4 * c)); put('haR', -d.shW - 0.1, 0.1, L * 0.46 + (d.armU + d.armF) * (0.55 - 0.4 * c));
            for (const n of ['knL', 'knR', 'anL', 'anR']) rig.pm[ids[n]] = 0;
            return;
        }
        const pz = lean * 0.2 - flf * 0.4, px = -flr * 0.2;
        const bow = rig.type.bow || 0;
        put('pelvis', px, hip, pz);
        put('waist', px * 1.2, hip + d.belly, pz + lean * 0.35 - flf * 0.7);
        const nz = pz + lean * 0.95 - flf * 1.4 + bow, nx = px * 1.4 - flr * 0.9;
        const nY = hip + d.belly + d.chest - fl * 0.05;
        put('neck', nx, nY, nz);
        put('head', nx - flr * 0.5, nY + d.neck + d.head, nz + lean * 0.3 - flf * 0.8);
        put('hiL', d.hipW + px, hip - 0.03, pz); put('hiR', -d.hipW + px, hip - 0.03, pz);
        const shY = nY - 0.03;
        put('shL', d.shW + nx, shY, nz); put('shR', -d.shW + nx, shY, nz);
        // ноги
        const amp = stride * 0.55 * walk;
        const lift = 0.15 * walk;
        const foot = (name, kn, x, phase) => {
            const q = Math.sin(phase) * amp, l = Math.max(0, Math.cos(phase)) * lift;
            const ax = x + q * side, az = q * hdg;
            put(name, ax, 0.08 + l, az);
            const kf = 0.05 + l * 0.8;
            put(kn, x + (ax - x) * 0.5, (hip + 0.08 + l) * 0.5 + 0.02, az * 0.5 + kf + pz * 0.5);
        };
        foot('anL', 'knL', d.hipW, ph);
        foot('anR', 'knR', -d.hipW, ph + Math.PI);
        // руки
        const up = rig.upper, aL = d.armU + d.armF;
        const atk = rig.attackT;
        const arm = (side2, sh, el, ha, sx0) => {
            const sgn = side2;
            let hx = sx0 + sgn * 0.03, hy = shY - aL * 0.94, hz = nz - sw * sgn * 0.3;
            let ex = sx0 + sgn * 0.04, ey = shY - d.armU, ez = nz - sw * sgn * 0.14 - 0.03;
            if (up === 'aim') {
                // правая (−x) держит оружие перед собой, левая поддерживает
                const kick = fl * 0.16;
                if (sgn < 0) { hx = sx0 + 0.09; hy = shY - 0.1 + kick; hz = nz + aL * 0.9; ex = sx0 - 0.02; ey = shY - d.armU * 0.72; ez = nz + d.armU * 0.5; }
                else { hx = -sx0 * 0.1 + 0.1; hy = shY - 0.14; hz = nz + aL * 0.72; ex = sx0 + 0.02; ey = shY - d.armU * 0.8; ez = nz + d.armU * 0.45; }
            } else if (up === 'melee') {
                const t = atk < 0 ? 0 : atk;
                // правая рука бьёт: замах назад-вверх -> удар вперёд-вниз; левая отведена для равновесия
                if (sgn < 0) {
                    const a = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
                    const strike = t > 0.45 && t < 0.72 ? 1 : 0;
                    hx = sx0 + 0.05; hy = shY + aL * (0.75 * a) - (strike ? 0.25 : 0.1); hz = nz + (strike ? aL * 0.95 : aL * 0.2 - 0.25 * a);
                    ex = sx0 - 0.04; ey = shY + d.armU * (0.5 * a - 0.2); ez = nz + (strike ? d.armU * 0.6 : -0.1 * a);
                } else { hx = sx0 + 0.16; hy = shY - aL * 0.65; hz = nz - 0.18; ex = sx0 + 0.1; ey = shY - d.armU * 0.8; ez = nz - 0.1; }
            } else if (up === 'throw') {
                const t = atk < 0 ? 0 : atk;
                if (sgn < 0) {
                    hx = sx0; hy = shY + aL * (t < 0.55 ? 0.6 : 0.15); hz = nz + (t < 0.55 ? -aL * 0.55 : aL * 0.85);
                    ex = sx0 - 0.03; ey = shY + d.armU * (t < 0.55 ? 0.2 : -0.1); ez = nz + (t < 0.55 ? -0.2 : d.armU * 0.6);
                } else { hx = sx0 * 0.5; hy = shY - 0.1; hz = nz + aL * 0.55; ex = sx0; ey = shY - d.armU * 0.75; ez = nz + d.armU * 0.35; }
            } else if (up === 'flail') {
                // равновесие ловит: руки в стороны и вращаются
                const w = rig.time * 13 * sgn;
                hx = sx0 + sgn * aL * (0.72 + 0.14 * Math.sin(w)); hy = shY + aL * 0.34 * Math.cos(w); hz = nz + aL * 0.3 * Math.sin(w);
                ex = sx0 + sgn * d.armU * 0.9; ey = shY + 0.04; ez = nz;
            } else if (up === 'idle') {
                const b = Math.sin(rig.time * 2.1) * 0.012;
                hx = sx0 + sgn * 0.05; hy = shY - aL * 0.92 + b; hz = nz + 0.04; ex = sx0 + sgn * 0.05; ey = shY - d.armU; ez = nz - 0.02;
            } else if (up === 'wave') {
                // правая машет, левая опёрта о прилавок
                if (sgn < 0) { const w = Math.sin(rig.time * 9) * 0.15; hx = sx0 - 0.12 + w; hy = shY + aL * 0.8; hz = nz + 0.1; ex = sx0 - 0.1; ey = shY + d.armU * 0.3; ez = nz + 0.03; }
                else { hx = sx0 - 0.02; hy = shY - aL * 0.5; hz = nz + aL * 0.62; ex = sx0 + 0.06; ey = shY - d.armU * 0.78; ez = nz + d.armU * 0.32; }
            } else if (up === 'counter') {
                // обе руки на прилавке, чуть покачивается
                const b = Math.sin(rig.time * 1.7 + sgn) * 0.012;
                hx = sx0 - sgn * 0.02; hy = shY - aL * 0.5 + b; hz = nz + aL * 0.62; ex = sx0 + sgn * 0.06; ey = shY - d.armU * 0.78; ez = nz + d.armU * 0.32;
            } else if (up === 'panic') {
                // руки над головой — бежит и горит
                const b = Math.sin(rig.time * 19 * sgn) * 0.08;
                hx = sx0 * 0.6; hy = shY + aL * 0.8 + b; hz = nz + 0.1; ex = sx0 + sgn * 0.08; ey = shY + d.armU * 0.4; ez = nz;
            }
            put(ha, hx, hy, hz); put(el, ex, ey, ez);
        };
        arm(1, 'shL', 'elL', 'haL', d.shW + nx);
        arm(-1, 'shR', 'elR', 'haR', -d.shW + nx);
        if (rig.headless) { rig.upper = 'flail'; }
        // зажимает рану свободной рукой
        if (rig.clutchT > 0) {
            rig.clutchT -= dt;
            const cp = rig.clutchPart, W = VoxFolk._v3;
            if (cp && cp.count && cp.attached) {
                rig.voxWorld(cp, rig.clutchG[0], rig.clutchG[1], rig.clutchG[2], W);
                const i = ids.haL * 3;
                if (!rig.cut[ids.haL]) { T[i] = W[0]; T[i + 1] = W[1]; T[i + 2] = W[2]; }
            }
        }
    },
};
