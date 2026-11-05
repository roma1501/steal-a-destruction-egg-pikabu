// VoxDestruction.js — разрушение Rubble Lab: вырезание сферой по правилам материалов (сила инструмента
// или сопротивление взрыву, неровный край), отрыв кусков без опоры в твёрдые тела, обломки и пыль,
// взрывы (обугливание, поджог, толчок тел и игрока, цепные взрывы бочек), удары тел (крошится хрупкое,
// тяжёлые обломки проламывают мягкие материалы — обрушение идёт волной), огонь по дереву и листве.

/** @satisfies {Record<string, any>} */
const VoxDestruction = {
    /** @type {VoxWorld | null} */
    world: null,
    vs: 0.1,
    /** @type {{ a: VoxBody, b: VoxBody | null, p: number[], speed: number, j: number, pts: number[][] }[]} */
    impacts: [],
    /** @type {{ t: number, x: number, y: number, z: number, r: number }[]} */
    pending: [],
    /** Ядерные взрывы в процессе: огненный шар растёт ступенями, ударная волна идёт кольцом. @type {any[]} */
    nukes: [],
    /** @type {Map<number, { t: number, life: number }>} */
    fire: new Map(),
    _fireTick: 0,
    _fireLight: 0,
    /** @type {{ set(v: number): void, stop(): void } | null} */
    _fireLoop: null,
    stats: { carved: 0, bodiesMade: 0, explosions: 0 },
    /** @type {((e: any) => void)[]} */
    _ls: [],
    /**
     * События ущерба (для счёта): { type: 'removed', counts: Map<байт материала, число>, x, y, z, cause },
     * { type: 'body', body, count } — оторвался кусок, { type: 'explosion', x, y, z, r }.
     * cause: 'tool' | 'explosion' | 'impact' | 'fire'.
     */
    on(fn) { this._ls.push(fn); },
    emit(e) { for (const fn of this._ls) { try { fn(e); } catch (err) { console.warn(err); } } },
    _seeds: new Set(),
    /** @type {{ x: number, y: number, z: number, yCut: number, seeds: number[] }[]} */
    stressQueue: [],
    /** @type {{ t: number, supports: number[], x: number, y: number, z: number, snd: string }[]} */
    collapsing: [],
    _hold: new Float32Array(256),
    _mass1: new Float32Array(256),


    /** @param {VoxWorld} world */
    init(world) {
        this.world = world; this.vs = world.vs;
        this.fire = new Map(); this.impacts = []; this.pending = []; this.stressQueue = []; this.collapsing = []; this.nukes = [];
        this._tables();
        VoxPhysics.onImpact = (a, b, p, speed, j, pts) => { if (this.impacts.length < 64) this.impacts.push({ a, b, p, speed, j, pts }); };
    },

    /**
     * Вырезать сферу (м). o: { power — класс инструмента (материал ломается, если hard <= power),
     *   blast — взрыв (радиус × resist материала), jitter — неровность края 0..1, bodies (true) — и тела,
     *   char — радиус обугливания (взрыв), charY0 — ниже не обугливать (вокселей), ignite — поджог горючего, fx (true), speed — разлёт обломков,
     *   skip — тело, которое не трогать, skipSet — WeakSet таких тел, nuke — ядерный (рушится всё, кроме коренной породы), all — прочнее power ломается как равное ему (0.62 радиуса), burst — сколько кубиков-обломков }.
     * Возвращает { count, mat (байт самого частого), removed: [[x,y,z,v]…] (мир), explosive }.
     */
    carve(cx, cy, cz, radius, o = {}) {
        const w = this.world, vs = this.vs, k = 1 / vs;
        const power = o.power != null ? o.power : 2;
        const jitter = o.jitter != null ? o.jitter : 0.25;
        const blast = !!o.blast;
        const removed = [];
        const counts = new Map();
        let explosive = 0, ex = 0, ey = 0, ez = 0;
        const R = radius * (blast ? 1.7 : 1) * k;      // радиус перебора (вокселей)
        const gx = cx * k, gy = cy * k, gz = cz * k;
        const x0 = Math.floor(gx - R), x1 = Math.ceil(gx + R), y0 = Math.max(1, Math.floor(gy - R)), y1 = Math.ceil(gy + R), z0 = Math.floor(gz - R), z1 = Math.ceil(gz + R);
        const seeds = this._seeds;
        const rk = radius * k;
        const limF = this._limTable(blast, power, !!o.nuke, !!o.all), data = w.data;
        const maxR2 = (rk * 1.7 * (1 + jitter * 0.5)) ** 2;
        // ядерный: воронка в земле широкая и неглубокая (по высоте расстояние ×2)
        const flat = o.nuke ? this._kindTab() : null;
        // перебор по кирпичам 8³: пустые пропускаются целиком
        const bx0 = Math.max(0, x0 >> 3), bx1 = Math.min(w.brx - 1, x1 >> 3), by0 = Math.max(0, y0 >> 3), by1 = Math.min(w.bry - 1, y1 >> 3), bz0 = Math.max(0, z0 >> 3), bz1 = Math.min(w.brz - 1, z1 >> 3);
        for (let bby = by0; bby <= by1; bby++) for (let bbz = bz0; bbz <= bz1; bbz++) for (let bbx = bx0; bbx <= bx1; bbx++) {
        if (!w.brick[bbx + bbz * w.brx + bby * w.brx * w.brz]) continue;
        const ya = Math.max(y0, bby * 8), yb = Math.min(y1, bby * 8 + 7), za = Math.max(z0, bbz * 8), zb = Math.min(z1, bbz * 8 + 7), xa = Math.max(x0, bbx * 8), xb = Math.min(x1, bbx * 8 + 7);
        for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) {
            const dy = y + 0.5 - gy, dz = z + 0.5 - gz, d2yz = dy * dy + dz * dz;
            if (d2yz > maxR2) continue;
            const row = (z << w.bx) + (y << w.by);
            for (let x = xa; x <= xb; x++) {
            const v = data[row + x];
            if (!v) continue;
            const f = limF[v];
            if (!f) continue;
            const dx = x + 0.5 - gx;
            const d2 = flat && flat[v] === 1 ? dx * dx + dz * dz + dy * dy * 4 : dx * dx + d2yz;
            let lim = rk * f;
            const lj = lim * (1 + jitter * 0.5);
            if (d2 > lj * lj) continue;
            const d = Math.sqrt(d2);
            if (jitter) lim *= 1 + (this._hash(x, y, z) - 0.5) * jitter;
            if (d > lim) continue;
            const m = VoxMat.of(v);
            removed.push([(x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs, v]);
            counts.set(v & 127, (counts.get(v & 127) || 0) + 1);
            if (m.explosive) { explosive++; ex += x; ey += y; ez += z; }
            w.set(x, y, z, 0);
            if (this.fire.size) this.fire.delete(w.idx(x, y, z));
            }
        }
        }
        // соседи вырезанного — затравка поиска оторвавшихся кусков; низ выреза — срез для проверки прочности
        let cutY = 1e9;
        const stressSeeds = [];
        for (const r of removed) {
            if (!this._isGround(r[3])) cutY = Math.min(cutY, Math.floor(r[1] * k));
        }
        for (const r of removed) {
            const x = Math.floor(r[0] * k), y = Math.floor(r[1] * k), z = Math.floor(r[2] * k);
            if (w.get(x + 1, y, z)) seeds.add(w.idx(x + 1, y, z));
            if (w.get(x - 1, y, z)) seeds.add(w.idx(x - 1, y, z));
            if (w.get(x, y + 1, z)) seeds.add(w.idx(x, y + 1, z));
            if (y > 1 && w.get(x, y - 1, z)) seeds.add(w.idx(x, y - 1, z));
            if (w.get(x, y, z + 1)) seeds.add(w.idx(x, y, z + 1));
            if (w.get(x, y, z - 1)) seeds.add(w.idx(x, y, z - 1));
            if (cutY < 1e9 && y >= cutY && stressSeeds.length < 48 && (stressSeeds.length < 8 || (x + y + z) % 5 === 0)) {
                if (w.get(x, y + 1, z) && !this._isGround(w.get(x, y + 1, z))) stressSeeds.push(w.idx(x, y + 1, z));
                else if (w.get(x + 1, y, z) && !this._isGround(w.get(x + 1, y, z))) stressSeeds.push(w.idx(x + 1, y, z));
                else if (w.get(x - 1, y, z) && !this._isGround(w.get(x - 1, y, z))) stressSeeds.push(w.idx(x - 1, y, z));
            }
        }
        if (stressSeeds.length) this._queueStress(cx, cy, cz, Math.max(w.groundTop || 20, cutY), stressSeeds);
        // обугливание и поджог вокруг взрыва: только открытые воздуху воксели; перебор по кирпичам 8³ и прямым индексам
        if (o.char) {
            const C = o.char * k, data = w.data, L = w.layer, SX = w.sx;
            let lastC = -1;
            w.version++;
            const cx0 = Math.max(1, Math.floor(gx - C)), cx1 = Math.min(w.sx - 2, Math.ceil(gx + C));
            const cy0 = Math.max(1, Math.floor(gy - C), o.charY0 || 0), cy1 = Math.min(w.sy - 2, Math.ceil(gy + C));
            const cz0 = Math.max(1, Math.floor(gz - C)), cz1 = Math.min(w.sz - 2, Math.ceil(gz + C));
            for (let bby = cy0 >> 3; bby <= cy1 >> 3; bby++) for (let bbz = cz0 >> 3; bbz <= cz1 >> 3; bbz++) for (let bbx = cx0 >> 3; bbx <= cx1 >> 3; bbx++) {
                const cnt = w.brick[bbx + bbz * w.brx + bby * w.brx * w.brz];
                if (!cnt) continue;
                const ya = Math.max(cy0, bby * 8), yb = Math.min(cy1, bby * 8 + 7), za = Math.max(cz0, bbz * 8), zb = Math.min(cz1, bbz * 8 + 7), xa = Math.max(cx0, bbx * 8), xb = Math.min(cx1, bbx * 8 + 7);
                for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) {
                    const row = (z << w.bx) + (y << w.by);
                    const dy = y + 0.5 - gy, dz = z + 0.5 - gz, d2yz = dy * dy + dz * dz;
                    if (d2yz > C * C * 1.32) continue;
                    for (let x = xa; x <= xb; x++) {
                        const i = row + x;
                        const v = data[i];
                        if (!v) continue;
                        if (data[i + L] && data[i - 1] && data[i + 1] && data[i + SX] && data[i - SX] && data[i - L]) continue;
                        const dx = x + 0.5 - gx;
                        const d = Math.sqrt(dx * dx + d2yz);
                        if (d > C * (0.85 + this._hash(x, z, y) * 0.3)) continue;
                        const m = VoxMat.of(v);
                        if (!m.hard || m.glass) continue;
                        if (!(v & 128) && this._hash(z, x, y) < 1.25 - (d / C) * 1.1) {
                            // занятость не меняется — только цвет: метка своего чанка, без пересчёта счётчиков
                            data[i] = v | 128;
                            const ch = w.chunkOf(x, y, z);
                            if (ch !== lastC) { w._dirty(x, y, z); lastC = ch; }
                        }
                        if (o.ignite && m.burn && this._hash(y, z, x) < m.burn * 0.3 * (1 - d / C)) this.ignite(x, y, z);
                    }
                }
            }
        }
        // тела
        const bodyRes = { removed: 0 };
        if (o.bodies !== false) this._carveBodies(cx, cy, cz, radius, power, blast, jitter, o, removed, counts, bodyRes);
        let mat = 0, best = 0;
        for (const [v, c] of counts) if (c > best) { best = c; mat = v; }
        if (removed.length) this.emit({ type: 'removed', counts, x: cx, y: cy, z: cz, cause: o.cause || (blast ? 'explosion' : 'tool') });
        this.stats.carved += removed.length;
        if (removed.length) VoxPhysics.wakeInBox(cx - radius - 1, cy - radius - 1, cz - radius - 1, cx + radius + 1, cy + radius + 1, cz + radius + 1);
        if (o.fx !== false && removed.length) {
            VoxFX.voxelsBurst(removed, cx, cy, cz, o.speed != null ? o.speed : (blast ? 9 : 2.5), o.burst || (blast ? 520 : 40));
        }
        if (explosive && !o.noChain) this.queueExplosion(ex / explosive * vs, ey / explosive * vs, ez / explosive * vs, 2.6, 0.12);
        return { count: removed.length, mat, removed, explosive };
    },

    /** @type {Map<string, Float32Array>} */
    _lims: new Map(),
    /** Доля радиуса, на которой ломается каждый байт вокселя: взрыв — resist, ядерный — всё (земля — воронкой), инструмент — по классу прочности. */
    _limTable(blast, power, nuke, all) {
        const key = nuke ? 'n' : blast ? 'b' : (all ? 'a' : 'p') + power;
        let t = this._lims.get(key);
        if (t) return t;
        t = new Float32Array(256);
        for (let v = 1; v < 256; v++) {
            if (!(v & 127)) continue;
            const m = VoxMat.of(v);
            if (!m.hard) continue;
            t[v] = nuke ? (this._isGround(v) ? m.resist * 0.66 : Math.max(0.92, Math.min(1.3, m.resist))) : blast ? m.resist : (m.hard > power ? (all ? 0.62 : 0) : (m.hard === power ? 0.62 : 1));
        }
        this._lims.set(key, t);
        return t;
    },

    _carveBodies(cx, cy, cz, radius, power, blast, jitter, o, removed, counts, res) {
        const L = [0, 0, 0];
        const rk = radius / this.vs;
        const bodies = VoxPhysics.bodies.slice();
        for (const b of bodies) {
            if (b.dead || b === o.skip || (o.skipSet && o.skipSet.has(b))) continue;
            const dx = b.x[0] - cx, dy = b.x[1] - cy, dz = b.x[2] - cz;
            const reach = radius * (blast ? 1.7 : 1) + b.radius;
            if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
            VoxPhysics.toLocal(b, cx, cy, cz, L);
            const R = rk * (blast ? 1.7 : 1);
            const x0 = Math.max(0, Math.floor(L[0] - R)), x1 = Math.min(b.sx - 1, Math.ceil(L[0] + R));
            const y0 = Math.max(0, Math.floor(L[1] - R)), y1 = Math.min(b.sy - 1, Math.ceil(L[1] + R));
            const z0 = Math.max(0, Math.floor(L[2] - R)), z1 = Math.min(b.sz - 1, Math.ceil(L[2] + R));
            const list = [];
            let explosive = 0;
            for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
                const v = b.grid[x + b.sx * (z + b.sz * y)];
                if (!v) continue;
                const m = VoxMat.of(v);
                if (!m.hard) continue;
                const ddx = x + 0.5 - L[0], ddy = y + 0.5 - L[1], ddz = z + 0.5 - L[2];
                const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
                let lim;
                if (blast) lim = rk * m.resist;
                else { if (m.hard > power && !o.all) continue; lim = rk * (m.hard >= power ? 0.62 : 1); }
                if (jitter) lim *= 1 + (this._hash(x + b.ox, y + b.oy, z + b.oz) - 0.5) * jitter;
                if (d > lim) continue;
                list.push([x, y, z]);
                counts.set(v & 127, (counts.get(v & 127) || 0) + 1);
                if (m.explosive) explosive++;
            }
            if (!list.length) continue;
            if (explosive && !o.noChain) { this.queueExplosion(b.x[0], b.x[1], b.x[2], 2.8, 0.1 + Math.random() * 0.12); }
            const r = VoxPhysics.carveBody(b, list);
            for (const v of r.removed) removed.push(v);
            res.removed += r.removed.length;
            this._debrisFx(r.debris, b.v);
        }
    },

    _debrisFx(list, v) {
        for (const d of list) VoxFX.spawnDebris(d[0], d[1], d[2], d[3], (v ? v[0] : 0) + (Math.random() - 0.5) * 2, (v ? v[1] : 0) + Math.random() * 2, (v ? v[2] : 0) + (Math.random() - 0.5) * 2);
    },

    _hash(x, y, z) {
        let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    },

    /**
     * Куски мира без опоры -> тела (или обломки). push — функция (тело) => void для толчка новых тел;
     * minCount — кусок меньше уходит в обломки (по умолчанию — по качеству графики).
     */
    detach(push, minCount) {
        const seeds = this._seeds;
        if (!seeds.size) return [];
        const arr = Int32Array.from(seeds);
        seeds.clear();
        const comps = this.world.findFloating(arr);
        const made = [];
        for (const c of comps) {
            const r = VoxPhysics.fromWorld(c, minCount ? { minCount } : {});
            if (!r) continue;
            if (r instanceof VoxBody) {
                made.push(r);
                this.stats.bodiesMade++;
                this.emit({ type: 'body', body: r, count: r.count });
                if (push) push(r);
                if (r.count > 400 && typeof GameAudio !== 'undefined') GameAudio.debrisRumble(Math.min(1, r.count / 6000), r.x[0], r.x[1], r.x[2]);
            } else if (r.debris) this._debrisFx(r.debris, null);
        }
        return made;
    },

    // =================================================================== взрывы

    queueExplosion(x, y, z, r, delay) {
        for (const p of this.pending) if (Math.hypot(p.x - x, p.y - y, p.z - z) < r * 0.6) return;
        this.pending.push({ t: delay, x, y, z, r });
    },

    /** Взрыв радиуса R (м). */
    explode(x, y, z, R, opts = {}) {
        R *= (typeof RL_EXPLOSION_SCALE !== 'undefined' ? RL_EXPLOSION_SCALE : 1);
        this.stats.explosions++;
        this.emit({ type: 'explosion', x, y, z, r: R });
        if (opts.nuke) return this._nuke(x, y, z, R);
        const res = this.carve(x, y, z, R, { blast: true, jitter: 0.35, char: R * 1.35, ignite: (typeof RL_FIRE !== 'undefined' ? RL_FIRE : 1) > 0, speed: 7 + R * 2 });
        // куски построек из зоны взрыва разлетаются настоящими телами (не только пылью и кубиками)
        this._chunks(res.removed, x, y, z, R);
        const fresh = this.detach(null);
        // крупные оторванные куски колются по трещинам ещё до толчка: стена разлетается кусками, а не монолитом
        const D = VoxPhysics.detail();
        for (const b of fresh.slice()) {
            if (b.dead || b.count < 260) continue;
            for (let c = 0; c < D.blastCracks && !b.dead; c++) {
                let dx = b.x[0] - x, dy = b.x[1] - y, dz = b.x[2] - z;
                const dl = Math.hypot(dx, dy, dz) || 1;
                dx /= dl; dy /= dl; dz /= dl;
                const off = Math.min(dl, b.radius) * (0.15 + Math.random() * 0.5);
                this._fracture(b, b.x[0] - dx * off + (Math.random() - 0.5) * b.radius * 0.6, b.x[1] - dy * off + (Math.random() - 0.5) * b.radius * 0.4, b.x[2] - dz * off + (Math.random() - 0.5) * b.radius * 0.6, dx, dy, dz, 2e5 * R);
            }
        }
        // толчок тел: по площади (воксели^(2/3)), спад от расстояния
        const reach = R * 2.6;
        for (const b of VoxPhysics.bodies) {
            if (b.dead) continue;
            let dx = b.x[0] - x, dy = b.x[1] - y, dz = b.x[2] - z;
            const d = Math.hypot(dx, dy, dz);
            if (d > reach + b.radius * 0.5) continue;
            const f = Math.pow(Math.max(0, 1 - Math.max(0, d - b.radius * 0.4) / reach), 2);
            if (f <= 0) continue;
            const l = d || 1;
            dx /= l; dy = dy / l + 0.35; dz /= l;
            const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
            const area = Math.pow(b.count, 2 / 3) * this.vs * this.vs;
            let J = 5200 * f * area * (R / 2.4);
            J = Math.min(J, b.mass * 28);     // не быстрее ~28 м/с
            const off = b.radius * 0.35;
            VoxPhysics.applyImpulse(b, b.x[0] - dx * off + (Math.random() - 0.5) * off, b.x[1] - dy * off, b.x[2] - dz * off + (Math.random() - 0.5) * off, dx * J, dy * J, dz * J);
        }
        // игрок
        const p = Game.player;
        if (p) {
            const e = p.eye;
            let dx = e.x - x, dy = e.y - y, dz = e.z - z;
            const d = Math.hypot(dx, dy, dz) || 1;
            const f = Math.max(0, 1 - d / (R * 2.8));
            if (f > 0) { dx /= d; dy /= d; dz /= d; p.push(dx * 15 * f, (dy + 0.6) * 9 * f, dz * 15 * f); }
            p.addTrauma(Math.min(1, f * 1.4 + 6 / (d + 6) * 0.5));
        }
        VoxFX.explosion(x, y, z, R);
        if (typeof GameAudio !== 'undefined') GameAudio.explosion(Math.min(2, R / 2.2), x, y, z);
        return { res, fresh };
    },

    // =================================================================== ядерный взрыв

    /** Ступени огненного шара: [время с, доля радиуса core]. */
    _NUKE_STAGES: [[0, 0.5], [0.08, 0.8], [0.18, 1]],

    /**
     * Параметры ядерного взрыва по качеству графики: core — радиус выжигания (× R ракеты), reach — дальность
     * ударной волны (м), shatter — до какого радиуса она ломает постройки, pieces — сколько примерно кусков,
     * burst — кубиков-обломков, chunks — летящих кусков из огненного шара, vmax — толчок тел вблизи (м/с),
     * minPiece — оторванный кусок меньше (вокселей) рассыпается обломками, maxBodies — предел тел после взрыва.
     * На максимуме сносит почти всю карту: нагрузка большая, но это и есть ядерный заряд.
     */
    _nukeP() {
        const q = typeof VoxRender !== 'undefined' && VoxRender.quality ? VoxRender.quality : 'high';
        if (q === 'low') return { core: 1.3, reach: 18, shatter: 0, pieces: 0, burst: 260, chunks: 0, vmax: 22, minPiece: 0, maxBodies: 120 };
        if (q === 'medium') return { core: 1.6, reach: 28, shatter: 18, pieces: 70, burst: 1300, chunks: 12, vmax: 30, minPiece: 160, maxBodies: 170 };
        return { core: 2.0, reach: 44, shatter: 31, pieces: 150, burst: 3400, chunks: 30, vmax: 42, minPiece: 130, maxBodies: 210 };
    },

    /**
     * Ядерный взрыв в точке (R — радиус ракеты): огненный шар выжигает всё в радиусе core ступенями за ~0.25 с
     * (кроме коренной породы, земля — воронкой), ударная волна (50 м/с) ломает постройки в кольце до shatter
     * по рваной сетке трещин и срезает их с земли, а все тела на её пути летят от центра.
     */
    _nuke(x, y, z, R) {
        const P = this._nukeP();
        const N = { x, y, z, R, core: R * P.core, P, t: 0, stage: 0, pass: 0, front: 0, pushed: new WeakSet(), made: new WeakSet(), player: false,
            cell: 0, cnx: 0, cny: 0, cnz: 0, seeds: new Float32Array(0) };
        this.nukes.push(N);
        VoxPhysics.wakeInBox(x - P.reach, y - 4, z - P.reach, x + P.reach, y + P.reach, z + P.reach);
        if (P.shatter > 0) this._shatterCells(N);
        this._nukeStage(N);
        VoxFX.nuke(x, y, z, N.core);
        if (typeof VoxRender !== 'undefined' && VoxRender.holdAuto) VoxRender.holdAuto(16);
        if (typeof GameAudio !== 'undefined') { GameAudio.explosion(2.5, x, y, z); GameAudio.debrisRumble(1, x, y, z); }
        if (Game.player) Game.player.addTrauma(0.7);
        return { res: null, fresh: [] };
    },

    /** Очередная ступень огненного шара: выжечь сферу, куски с её края — летящими телами. */
    _nukeStage(N) {
        const S = this._NUKE_STAGES[N.stage++];
        const last = N.stage === this._NUKE_STAGES.length;
        const r = N.core * S[1];
        const res = this.carve(N.x, N.y, N.z, r, { blast: true, nuke: true, jitter: 0.3, char: last ? N.core * 1.4 : 0, charY0: (/** @type {any} */ (this.world).groundTop || 20) - 3,
            ignite: last && (typeof RL_FIRE !== 'undefined' ? RL_FIRE : 1) > 0, speed: 16 + 12 * S[1], burst: Math.round(N.P.burst / 3), skipSet: N.made });
        for (const b of this._chunks(res.removed, N.x, N.y, N.z, r, { max: Math.round(N.P.chunks / 3), speed: 2.2 })) { N.pushed.add(b); N.made.add(b); }
        this._nukeDetach(N);
    },

    /** Оторванное взрывом — в тела (мелочь — в обломки), рождённые тела помечены, лишние — в обломки. */
    _nukeDetach(N) {
        for (const b of this.detach(null, N.P.minPiece)) N.made.add(b);
        const B = VoxPhysics.bodies, over = B.length - N.P.maxBodies;
        if (over <= 0) return;
        const list = B.filter(b => !b.dead && !b.grabbed).sort((a, b) => a.count - b.count);
        for (let i = 0; i < over && i < list.length; i++) { VoxFX.bodyToDebris(list[i], 4); VoxPhysics.remove(list[i]); }
    },

    _updateNukes(dt) {
        const st = this._NUKE_STAGES;
        for (let i = this.nukes.length - 1; i >= 0; i--) {
            const N = this.nukes[i], P = N.P;
            N.t += dt;
            if (N.stage < st.length && N.t >= st[N.stage][0]) this._nukeStage(N);
            N.front = Math.min(P.reach, 3 + N.t * 50);
            // ударная волна ломает постройки в два прохода (ближнее кольцо, дальнее) — нагрузка по разным кадрам
            if (P.shatter > 0 && N.pass < 3 && N.t >= 0.28 + N.pass * 0.14) {
                const r0 = N.core * 0.8, span = (P.shatter - r0) / 3;
                this._shatter(N, r0 + span * N.pass, r0 + span * (N.pass + 1));
                N.pass++;
            }
            this._nukePush(N, dt);
            if (N.t > 2.5) this.nukes.splice(i, 1);
        }
    },

    /**
     * Ударная волна: тело, до которого дошёл фронт, получает толчок от центра и вверх (60% скорости) и
     * вращение, а следующую секунду «ветер» волны догоняет его до полной скорости — даже если кусок
     * упёрся в ещё целую стену, он разгонится, как только её снесёт.
     */
    _nukePush(N, dt) {
        const P = N.P, F = N.front;
        for (const b of VoxPhysics.bodies) {
            if (b.dead || b.grabbed) continue;
            const dx = b.x[0] - N.x, dy = b.x[1] - N.y, dz = b.x[2] - N.z;
            const dh = Math.hypot(dx, dz), d = Math.hypot(dh, dy);
            if (d - b.radius > F || d > P.reach) continue;
            const f = Math.max(0, 1 - d / P.reach);
            const dv = P.vmax * Math.pow(f, 0.75) + 2;
            let ux = dh > 0.01 ? dx / dh : 0.7, uz = dh > 0.01 ? dz / dh : 0.7, up = 0.3 + 0.6 * f + Math.max(0, dy) / (d + 1);
            const ul = Math.hypot(ux, up, uz); ux /= ul; up /= ul; uz /= ul;
            if (!N.pushed.has(b)) {
                N.pushed.add(b);
                VoxPhysics.applyImpulse(b, b.x[0], b.x[1], b.x[2], ux * b.mass * dv * 0.6, up * b.mass * dv * 0.6, uz * b.mass * dv * 0.6);
                const sp = 7 * f + 1;
                b.w[0] += (Math.random() - 0.5) * sp; b.w[1] += (Math.random() - 0.5) * sp; b.w[2] += (Math.random() - 0.5) * sp;
                continue;
            }
            // ветер волны — секунду после фронта
            if (N.t - (d - 3) / 50 > 1) continue;
            const vr = b.v[0] * ux + b.v[1] * up + b.v[2] * uz;
            if (vr >= dv) continue;
            const add = Math.min(dv - vr, 70 * dt);
            VoxPhysics.wake(b);
            b.v[0] += ux * add; b.v[1] += up * add; b.v[2] += uz * add;
        }
        const p = Game.player;
        if (p && !N.player) {
            const e = p.eye, dx = e.x - N.x, dz = e.z - N.z;
            if (Math.hypot(dx, e.y - N.y, dz) <= F) {
                N.player = true;
                const f = Math.max(0, 1 - Math.hypot(dx, dz) / (P.reach * 1.1)), l = Math.hypot(dx, dz) || 1;
                if (f > 0) p.push(dx / l * 22 * f, 9 * f + 2, dz / l * 22 * f);
                p.addTrauma(1);
                // волна дошла до игрока — второй удар
                if (typeof GameAudio !== 'undefined') GameAudio.explosion(2.5, N.x, N.y, N.z);
            }
        }
    },

    /** Таблицы байт вокселя: 1 — земля (_isGround), 2 — стекло. */
    _kindTab() {
        if (this._kt) return this._kt;
        const t = new Uint8Array(256);
        for (let v = 1; v < 256; v++) {
            if (!(v & 127)) continue;
            const m = VoxMat.of(v);
            if (!m) continue;
            t[v] = this._isGround(v) ? 1 : (m.glass ? 2 : 0);
        }
        return (this._kt = t);
    },
    /** @type {Uint8Array | null} */
    _kt: null,

    /**
     * Сетка трещин ядерного взрыва: ячейка (вокселей) — под примерное число кусков P.pieces по объёму построек
     * в кольце ударной волны; в каждой ячейке смещённый центр (ячейки Вороного).
     */
    _shatterCells(N) {
        const w = this.world;
        const V = this._shatter(N, N.core * 0.8, N.P.shatter, true);
        const C = Math.max(12, Math.min(40, Math.sqrt(V / (2.4 * N.P.pieces))));
        const nx = Math.ceil(w.sx / C) + 1, ny = Math.ceil(w.sy / C) + 1, nz = Math.ceil(w.sz / C) + 1;
        const S = new Float32Array(nx * ny * nz * 3);
        for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
            const s = (ix + nx * (iz + nz * iy)) * 3;
            S[s] = (ix + 0.15 + 0.7 * this._hash(ix, iy, iz)) * C;
            S[s + 1] = (iy + 0.15 + 0.7 * this._hash(iz + 17, ix, iy)) * C;
            S[s + 2] = (iz + 0.15 + 0.7 * this._hash(iy + 31, iz, ix)) * C;
        }
        N.cell = C; N.cnx = nx; N.cny = ny; N.cnz = nz; N.seeds = S;
    },

    /**
     * Ударная волна ломает постройки в кольце [r0, r1) м (выше земли): трещины по границам ячеек Вороного,
     * срез основания у земли и выбитые стёкла. Оторванное становится телами (их толкнёт фронт волны),
     * трещины — обломками. countOnly — только посчитать воксели построек в кольце.
     */
    _shatter(N, r0, r1, countOnly) {
        const w = this.world, vs = this.vs, k = 1 / vs, data = w.data, L = w.layer;
        const K = this._kindTab();
        const gx = N.x * k, gy = N.y * k, gz = N.z * k, R0 = r0 * k, R1 = r1 * k, R02 = R0 * R0, R12 = R1 * R1;
        const yTop = /** @type {any} */ (w).groundTop || 20;
        const x0 = Math.max(1, Math.floor(gx - R1)), x1 = Math.min(w.sx - 2, Math.ceil(gx + R1));
        const z0 = Math.max(1, Math.floor(gz - R1)), z1 = Math.min(w.sz - 2, Math.ceil(gz + R1));
        const y0 = Math.max(1, yTop), y1 = Math.min(w.sy - 2, Math.ceil(gy + R1));
        const C = N.cell, S = N.seeds, cnx = N.cnx, cny = N.cny, cnz = N.cnz;
        const crack = 0.55;            // полутолщина трещины, вокселей
        const removed = [];
        const counts = new Map();
        let n = 0;
        for (let bby = y0 >> 3; bby <= y1 >> 3; bby++) for (let bbz = z0 >> 3; bbz <= z1 >> 3; bbz++) for (let bbx = x0 >> 3; bbx <= x1 >> 3; bbx++) {
            if (!w.brick[bbx + bbz * w.brx + bby * w.brx * w.brz]) continue;
            // кирпич целиком вне кольца — мимо
            const db = Math.hypot(bbx * 8 + 4 - gx, bby * 8 + 4 - gy, bbz * 8 + 4 - gz);
            if (db + 7 < R0 || db - 7 > R1) continue;
            const ya = Math.max(y0, bby * 8), yb = Math.min(y1, bby * 8 + 7), za = Math.max(z0, bbz * 8), zb = Math.min(z1, bbz * 8 + 7), xa = Math.max(x0, bbx * 8), xb = Math.min(x1, bbx * 8 + 7);
            for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) {
                const dy = y + 0.5 - gy, dz = z + 0.5 - gz, d2yz = dy * dy + dz * dz;
                if (d2yz >= R12) continue;
                const row = (z << w.bx) + (y << w.by);
                for (let x = xa; x <= xb; x++) {
                    const i = row + x, v = data[i];
                    if (!v || K[v] === 1) continue;
                    const dx = x + 0.5 - gx, d2 = dx * dx + d2yz;
                    if (d2 < R02 || d2 >= R12) continue;
                    if (countOnly) { n++; continue; }
                    // срез с земли и стекло — всегда; остальное — по границам ячеек
                    let cut = y === yTop || K[data[i - L]] === 1 || K[v] === 2;
                    if (!cut) {
                        const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
                        const fx = px / C - 0.5, fy = py / C - 0.5, fz = pz / C - 0.5;
                        const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
                        let d1 = 1e18, d2b = 1e18, a = -1, b = -1;
                        for (let oy = Math.max(0, iy); oy <= Math.min(cny - 1, iy + 1); oy++)
                            for (let oz = Math.max(0, iz); oz <= Math.min(cnz - 1, iz + 1); oz++)
                                for (let ox = Math.max(0, ix); ox <= Math.min(cnx - 1, ix + 1); ox++) {
                                    const s = (ox + cnx * (oz + cnz * oy)) * 3;
                                    const ex = px - S[s], ey = py - S[s + 1], ez = pz - S[s + 2];
                                    const dd = ex * ex + ey * ey + ez * ez;
                                    if (dd < d1) { d2b = d1; b = a; d1 = dd; a = s; } else if (dd < d2b) { d2b = dd; b = s; }
                                }
                        // расстояние до плоскости между двумя ближайшими центрами
                        if (b >= 0) cut = (d2b - d1) / (2 * (Math.hypot(S[b] - S[a], S[b + 1] - S[a + 1], S[b + 2] - S[a + 2]) || 1)) < crack;
                    }
                    if (!cut) continue;
                    removed.push([(x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs, v]);
                    counts.set(v & 127, (counts.get(v & 127) || 0) + 1);
                    w.set(x, y, z, 0);
                    if (this.fire.size) this.fire.delete(i);
                }
            }
        }
        if (countOnly) return n;
        if (!removed.length) return 0;
        const seeds = this._seeds;
        for (const r of removed) {
            const x = Math.floor(r[0] * k), y = Math.floor(r[1] * k), z = Math.floor(r[2] * k);
            if (w.get(x + 1, y, z)) seeds.add(w.idx(x + 1, y, z));
            if (w.get(x - 1, y, z)) seeds.add(w.idx(x - 1, y, z));
            if (w.get(x, y + 1, z)) seeds.add(w.idx(x, y + 1, z));
            if (w.get(x, y - 1, z)) seeds.add(w.idx(x, y - 1, z));
            if (w.get(x, y, z + 1)) seeds.add(w.idx(x, y, z + 1));
            if (w.get(x, y, z - 1)) seeds.add(w.idx(x, y, z - 1));
        }
        this.stats.carved += removed.length;
        this.emit({ type: 'removed', counts, x: N.x, y: N.y, z: N.z, cause: 'explosion' });
        VoxFX.voxelsBurst(removed, N.x, N.y, N.z, 15, Math.round(N.P.burst * 0.2));
        this._nukeDetach(N);
        return removed.length;
    },

    /**
     * Разлёт кусков: вырезанные взрывом воксели вне ядра (ядро — в пыль) группируются по клеткам 3–4 вокселя,
     * крупные группы становятся маленькими твёрдыми телами и летят от центра с вращением. Число — по качеству графики
     * (VoxPhysics.detail().blastChunks): на максимуме до 32 кусков за взрыв.
     */
    _chunks(removed, cx, cy, cz, R, o) {
        const D = VoxPhysics.detail();
        const max = o && o.max != null ? o.max : (D.blastChunks || 0);
        /** @type {VoxBody[]} */
        const made = [];
        if (!max || !removed.length) return made;
        const k = 1 / this.vs, cell = R > 3.5 ? 4 : 3;
        /** @type {Map<number, number[]>} */
        const groups = new Map();
        for (const r of removed) {
            const v = r[3];
            if (this._isGround(v)) continue;
            const m = VoxMat.of(v);
            if (m.glass || m.explosive) continue;
            const d = Math.hypot(r[0] - cx, r[1] - cy, r[2] - cz);
            if (d < R * 0.3) continue;
            const x = Math.floor(r[0] * k), y = Math.floor(r[1] * k), z = Math.floor(r[2] * k);
            const key = ((x / cell) | 0) + (((z / cell) | 0) << 10) + (((y / cell) | 0) << 20);
            let g = groups.get(key);
            if (!g) { g = []; groups.set(key, g); }
            g.push(x, y, z, v);
        }
        const minN = Math.max(3, D.minBody);
        const list = [...groups.values()].filter(g => g.length / 4 >= minN).sort((a, b) => b.length - a.length).slice(0, max);
        for (const g of list) {
            let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
            for (let i = 0; i < g.length; i += 4) {
                mnx = Math.min(mnx, g[i]); mny = Math.min(mny, g[i + 1]); mnz = Math.min(mnz, g[i + 2]);
                mxx = Math.max(mxx, g[i]); mxy = Math.max(mxy, g[i + 1]); mxz = Math.max(mxz, g[i + 2]);
            }
            const sx = mxx - mnx + 1, sy = mxy - mny + 1, sz = mxz - mnz + 1;
            const grid = new Uint8Array(sx * sy * sz);
            for (let i = 0; i < g.length; i += 4) grid[(g[i] - mnx) + sx * ((g[i + 2] - mnz) + sz * (g[i + 1] - mny))] = g[i + 3];
            // кусок мог распасться на несвязные части — тело берёт всё, split разделит при первом ударе
            const b = VoxPhysics.createBody(grid, sx, sy, sz, mnx, mny, mnz, { minCount: 1 });
            if (!b) continue;
            let dx = b.x[0] - cx, dy = b.x[1] - cy, dz = b.x[2] - cz;
            const d = Math.hypot(dx, dy, dz) || 1;
            dx /= d; dy = dy / d + 0.45; dz /= d;
            const sp = (5 + 11 * Math.max(0, 1 - d / (R * 1.2))) * (0.7 + Math.random() * 0.6) * (o && o.speed || 1);
            b.v[0] = dx * sp; b.v[1] = dy * sp + 1.5; b.v[2] = dz * sp;
            b.w[0] = (Math.random() - 0.5) * 14; b.w[1] = (Math.random() - 0.5) * 14; b.w[2] = (Math.random() - 0.5) * 14;
            this.stats.bodiesMade++;
            this.emit({ type: 'body', body: b, count: b.count });
            made.push(b);
        }
        return made;
    },

    // =================================================================== удары тел

    _processImpacts() {
        const list = this.impacts;
        this.impacts = [];
        let heavy = 0, dusts = 0;
        const brittleOn = (typeof RL_IMPACT_BREAK !== 'undefined' ? RL_IMPACT_BREAK : 1) > 0;
        const vs = this.vs, k = 1 / vs, w = this.world;
        for (const e of list) {
            const a = e.a;
            if (a.dead) continue;
            const [px, py, pz, nx, ny, nz] = e.p;
            const m = Math.min(a.mass, e.b ? e.b.mass : a.mass);
            const strength = Math.min(1, (e.speed / 9) * Math.pow(Math.max(1, m) / 60, 0.22));
            if (typeof GameAudio !== 'undefined') GameAudio.impact(a.sound, strength, px, py, pz);
            const under = e.b ? 0 : w.get(Math.floor((px - nx * 0.05) * k), Math.floor((py - ny * 0.05) * k), Math.floor((pz - nz * 0.05) * k));
            // пыль — не больше 10 ударов за кадр: после ядерного взрыва их сотни
            if (e.speed > 2.5 && a.mass > 15 && dusts++ < 10) VoxFX.impactDust(px, py, pz, under || 2, Math.min(1, strength * (a.mass > 300 ? 1.4 : 0.8)));
            if (a.explosive && e.speed > 9) { this.queueExplosion(a.x[0], a.x[1], a.x[2], 2.8, 0.03); continue; }
            if (!brittleOn || heavy > 5 || a.age < 0.08) continue;
            if (a.impactT && a.age - a.impactT < 0.12) continue;
            // хрупкое тело крошится у точки удара
            if (a.brittle && e.speed > a.brittle) {
                heavy++; a.impactT = a.age;
                this._crushBody(a, px, py, pz, Math.min(0.45, 0.08 + e.speed * 0.025), 1);
            }
            // кинетическая энергия удара проламывает мягкое: мир под телом и само тело
            const E = 0.5 * Math.min(a.mass, 3000) * e.speed * e.speed;
            if (e.speed > 4.5 && E > 2500) {
                heavy++; a.impactT = a.age;
                const r = Math.min(0.55, 0.07 * Math.cbrt(E / 120));
                if (!e.b) {
                    // удар по миру: пролом во всех точках контакта (до трёх)
                    const pts = (e.pts && e.pts.length ? e.pts : [[px, py, pz]]).slice(0, E > 30000 ? 3 : 1);
                    let any = 0;
                    for (const q of pts) any += this.carve(q[0] - nx * r * 0.4, q[1] - ny * r * 0.4, q[2] - nz * r * 0.4, r * (pts.length > 1 ? 0.8 : 1), { power: E > 40000 ? 2 : 1, jitter: 0.5, bodies: false, speed: 2.2, cause: 'impact' }).count;
                    if (any) this.detach(null);
                } else if (!e.b.dead) {
                    this._crushBody(e.b, px, py, pz, r * 0.8, E > 40000 ? 2 : 1);
                }
                this._crushBody(a, px, py, pz, r * 0.7, E > 60000 ? 2 : 1);
                // крупный кусок раскалывается по трещине через точку удара
                const D = VoxPhysics.detail();
                if (E > D.crackE && !a.dead && a.count > 300 && (a.cracks || 0) < D.cracks) this._fracture(a, px, py, pz, nx, ny, nz, E);
            }
        }
    },

    /**
     * Трещина: рваная плоскость через точку удара (нормаль — поперёк удара со случайным поворотом),
     * воксели в слое толщиной ~1 вокселя внутри радиуса уходят в обломки; split() делит тело на куски.
     */
    _fracture(b, px, py, pz, nx, ny, nz, E) {
        b.cracks = (b.cracks || 0) + 1;
        const L = VoxPhysics.toLocal(b, px, py, pz, [0, 0, 0]);
        // нормаль трещины в осях тела: перпендикуляр к нормали удара, случайно повёрнутый
        const R = b.R;
        const lnx = R[0] * nx + R[3] * ny + R[6] * nz, lny = R[1] * nx + R[4] * ny + R[7] * nz, lnz = R[2] * nx + R[5] * ny + R[8] * nz;
        let ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5;
        // ось трещины ⟂ нормали удара
        const d = ax * lnx + ay * lny + az * lnz;
        ax -= d * lnx; ay -= d * lny; az -= d * lnz;
        const al = Math.hypot(ax, ay, az) || 1;
        ax /= al; ay /= al; az /= al;
        const reach = Math.min(30, 8 + Math.cbrt(E / 1000) * 3);    // вокселей
        const list = [];
        for (let y = 0; y < b.sy; y++) for (let z = 0; z < b.sz; z++) for (let x = 0; x < b.sx; x++) {
            const v = b.grid[x + b.sx * (z + b.sz * y)];
            if (!v) continue;
            const m = VoxMat.of(v);
            if (!m.hard || m.hard > 3) continue;
            const dx = x + 0.5 - L[0], dy = y + 0.5 - L[1], dz = z + 0.5 - L[2];
            if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
            // рваный край: смещение плоскости шумом
            const off = (this._hash(x + b.ox, y + b.oy, z + b.oz) - 0.5) * 1.6 + Math.sin((dx + dz) * 0.7 + dy * 0.4) * 0.8;
            if (Math.abs(dx * ax + dy * ay + dz * az + off) > 0.62) continue;
            list.push([x, y, z]);
        }
        if (list.length < 4) return;
        const v0 = b.grid[b.idx(list[0][0], list[0][1], list[0][2])];
        const res = VoxPhysics.carveBody(b, list);
        const counts = new Map();
        for (const r of res.removed) counts.set(r[3] & 127, (counts.get(r[3] & 127) || 0) + 1);
        if (res.removed.length) this.emit({ type: 'removed', counts, x: px, y: py, z: pz, cause: 'impact' });
        VoxFX.voxelsBurst(res.removed, px, py, pz, 1.6, 50);
        this._debrisFx(res.debris, b.v);
        // куски чуть расходятся
        for (const nb of res.bodies) {
            const sx = nb.x[0] - px, sy = nb.x[1] - py, sz = nb.x[2] - pz, sl = Math.hypot(sx, sy, sz) || 1;
            VoxPhysics.applyImpulse(nb, nb.x[0], nb.x[1], nb.x[2], sx / sl * nb.mass * 0.8, 0, sz / sl * nb.mass * 0.8);
            this.emit({ type: 'body', body: nb, count: nb.count });
        }
        VoxFX.dust(px, py, pz, v0 & 127, 1.2, 0, 0.4, 0);
        if (typeof GameAudio !== 'undefined') GameAudio.breakVoxels(VoxMat.of(v0).sound, res.removed.length * 3, px, py, pz);
    },

    /** Раскрошить материал тела класса <= power в сфере (удар). */
    _crushBody(b, px, py, pz, r, power) {
        if (b.dead) return;
        const L = VoxPhysics.toLocal(b, px, py, pz, [0, 0, 0]);
        const R = r / this.vs;
        const list = [];
        for (let y = Math.max(0, Math.floor(L[1] - R)); y <= Math.min(b.sy - 1, Math.ceil(L[1] + R)); y++)
            for (let z = Math.max(0, Math.floor(L[2] - R)); z <= Math.min(b.sz - 1, Math.ceil(L[2] + R)); z++)
                for (let x = Math.max(0, Math.floor(L[0] - R)); x <= Math.min(b.sx - 1, Math.ceil(L[0] + R)); x++) {
                    const v = b.grid[x + b.sx * (z + b.sz * y)];
                    if (!v) continue;
                    const m = VoxMat.of(v);
                    if (!m.hard || (m.hard > power && !(m.brittle && m.hard <= 2))) continue;
                    const d = Math.hypot(x + 0.5 - L[0], y + 0.5 - L[1], z + 0.5 - L[2]);
                    if (d > R * (0.75 + this._hash(x + b.ox, y + b.oy, z + b.oz) * 0.5)) continue;
                    list.push([x, y, z]);
                }
        if (!list.length) return;
        const v0 = b.grid[b.idx(list[0][0], list[0][1], list[0][2])];
        const res = VoxPhysics.carveBody(b, list);
        const counts = new Map();
        for (const r of res.removed) counts.set(r[3] & 127, (counts.get(r[3] & 127) || 0) + 1);
        if (res.removed.length) this.emit({ type: 'removed', counts, x: px, y: py, z: pz, cause: 'impact' });
        VoxFX.voxelsBurst(res.removed, px, py, pz, 2, 30);
        this._debrisFx(res.debris, b.v);
        if (typeof GameAudio !== 'undefined') GameAudio.breakVoxels(VoxMat.of(v0).sound, res.removed.length, px, py, pz);
    },

    // =================================================================== огонь

    ignite(x, y, z) {
        const w = this.world;
        const v = w.get(x, y, z);
        if (!v || !VoxMat.of(v).burn) return false;
        const i = w.idx(x, y, z);
        if (this.fire.has(i) || this.fire.size > 700) return false;
        this.fire.set(i, { t: 0, life: 3.5 + this._hash(x, y, z) * 5 });
        return true;
    },

    /** Поджечь горючее в сфере (м) — огнемёт, искры. */
    igniteSphere(cx, cy, cz, r) {
        const k = 1 / this.vs, R = r * k;
        const gx = cx * k, gy = cy * k, gz = cz * k;
        let n = 0;
        for (let y = Math.floor(gy - R); y <= Math.ceil(gy + R); y++) for (let z = Math.floor(gz - R); z <= Math.ceil(gz + R); z++) for (let x = Math.floor(gx - R); x <= Math.ceil(gx + R); x++) {
            if ((x + 0.5 - gx) ** 2 + (y + 0.5 - gy) ** 2 + (z + 0.5 - gz) ** 2 > R * R) continue;
            if (this.ignite(x, y, z)) n++;
        }
        return n;
    },

    _updateFire(dt) {
        const fire = this.fire;
        if (!fire.size) { if (this._fireLoop) this._fireLoop.set(0); return; }
        const w = this.world, vs = this.vs;
        const mx = w.sx - 1, mz = w.sz - 1;
        this._fireTick += dt;
        const tick = this._fireTick >= 0.1;
        const spreadOn = (typeof RL_FIRE !== 'undefined' ? RL_FIRE : 1) > 0;
        const cam = VoxRender.camera.position;
        let nearCount = 0, lx = 0, ly = 0, lz = 0, ln = 0;
        const dead = [];
        const fxBudget = Math.max(1, Math.ceil(fire.size / 70));
        let f = 0;
        for (const [i, s] of fire) {
            const v = w.data[i];
            if (!v) { fire.delete(i); continue; }
            const x = i & mx, z = (i >> w.bx) & mz, y = i >> w.by;
            s.t += dt;
            const px = (x + 0.5) * vs, py = (y + 1) * vs, pz = (z + 0.5) * vs;
            const dc = (px - cam.x) ** 2 + (py - cam.y) ** 2 + (pz - cam.z) ** 2;
            if (dc < 400) nearCount++;
            if ((f++ % fxBudget) === 0 && dc < 3600) {
                // пламя у открытой грани: сверху, иначе сбоку (горящая стена), иначе снизу
                const k1 = Math.min(1, s.t / 1.2);
                if (!w.get(x, y + 1, z)) VoxFX.fire(px, py, pz, k1);
                else if (!w.get(x + 1, y, z)) VoxFX.fire(px + vs * 0.55, py - vs * 0.5, pz, k1);
                else if (!w.get(x - 1, y, z)) VoxFX.fire(px - vs * 0.55, py - vs * 0.5, pz, k1);
                else if (!w.get(x, y, z + 1)) VoxFX.fire(px, py - vs * 0.5, pz + vs * 0.55, k1);
                else if (!w.get(x, y, z - 1)) VoxFX.fire(px, py - vs * 0.5, pz - vs * 0.55, k1);
                else if (!w.get(x, y - 1, z)) VoxFX.fire(px, py - vs * 1.05, pz, k1 * 0.6);
            }
            if (ln < 40) { lx += px; ly += py; lz += pz; ln++; }
            if (tick && spreadOn) {
                // распространение: вверх охотнее, вниз — реже
                const m = VoxMat.of(v);
                const chance = 0.06 * m.burn * Math.min(1, s.t / 1.5);
                const tryN = (nx, ny, nz, c) => { if (this._rand() < c) this.ignite(nx, ny, nz); };
                tryN(x, y + 1, z, chance * 2.2); tryN(x + 1, y, z, chance); tryN(x - 1, y, z, chance);
                tryN(x, y, z + 1, chance); tryN(x, y, z - 1, chance); tryN(x, y - 1, z, chance * 0.4);
                if (s.t > 1.5) tryN(x + ((this._rand() * 5) | 0) - 2, y + ((this._rand() * 4) | 0) - 1, z + ((this._rand() * 5) | 0) - 2, chance * 0.6);
                // обугливание
                if (s.t > s.life * 0.5 && !(v & 128)) w.set(x, y, z, v | 128);
            }
            if (s.t >= s.life) dead.push(i);
        }
        if (tick) this._fireTick = 0;
        // сгоревшие воксели исчезают -> проверка опоры
        if (dead.length) {
            let bx0 = 1e9, by0 = 1e9, bz0 = 1e9, bx1 = -1e9, by1 = -1e9, bz1 = -1e9;
            for (const i of dead) {
                const x = i & mx, z = (i >> w.bx) & mz, y = i >> w.by;
                bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bz0 = Math.min(bz0, z); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); bz1 = Math.max(bz1, z);
            }
            VoxPhysics.wakeInBox(bx0 * vs - 1, by0 * vs - 1, bz0 * vs - 1, bx1 * vs + 1, by1 * vs + 2, bz1 * vs + 1);
            const fs = [];
            for (const i of dead) { const up = i + w.layer; if (w.data[up]) fs.push(up); if (fs.length > 24) break; }
            if (fs.length) this._queueStress((bx0 + bx1) / 2 * vs, (by0 + by1) / 2 * vs, (bz0 + bz1) / 2 * vs, Math.max(w.groundTop || 20, by0), fs);
            for (const i of dead) {
                fire.delete(i);
                const x = i & mx, z = (i >> w.bx) & mz, y = i >> w.by;
                const v = w.data[i];
                w.set(x, y, z, 0);
                const fc = new Map([[v & 127, 1]]);
                this.emit({ type: 'removed', counts: fc, x: (x + 0.5) * vs, y: (y + 0.5) * vs, z: (z + 0.5) * vs, cause: 'fire' });
                if (this._rand() < 0.3) VoxFX.spawnDebris((x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs, (v & 127) | 128, 0, 0.5, 0, 0.6);
                for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                    if (w.get(x + dx, y + dy, z + dz)) this._seeds.add(w.idx(x + dx, y + dy, z + dz));
                }
            }
        }
        // свет пламени — мерцающая вспышка в центре ближних очагов
        this._fireLight -= dt;
        if (ln && this._fireLight <= 0) {
            this._fireLight = 0.12;
            VoxRender.flash(lx / ln, ly / ln + 0.4, lz / ln, [1, 0.55, 0.2], Math.min(9, 2 + ln * 0.25), 9 + Math.min(10, ln * 0.2), 0.2, 0.6);
        }
        if (typeof GameAudio !== 'undefined') {
            if (!this._fireLoop) this._fireLoop = GameAudio.fireLoop();
            if (this._fireLoop) this._fireLoop.set(Math.min(1, nearCount / 40));
        }
    },

    // =================================================================== прочность конструкций

    _tables() {
        const vv = this.vs ** 3;
        const byKey = { wood: 900, plank: 850, darkwood: 950, crate: 600, brick: 1800, brick2: 1800, mortar: 1500, roof: 1200, tile: 1400,
            concrete: 3600, concrete2: 3600, asphalt: 3000, rock: 4000, metal: 9000, rust: 7000, hazard: 9000, plaster: 320, plaster2: 320,
            foam: 80, glass: 40, lamp: 40, leaves: 20, dirt: 700, grass: 700, sand: 500, barrel: 500, blue: 1200, bedrock: 1e9 };
        const byHard = [1e9, 150, 1200, 3200, 8000];
        for (let v = 1; v < 256; v++) {
            if (!(v & 127)) continue;
            const m = VoxMat.of(v);
            const h = byKey[m.key] != null ? byKey[m.key] : byHard[m.hard] || 1200;
            this._hold[v] = (v & 128) ? h * 0.45 : h;           // обгоревшее держит хуже
            this._mass1[v] = m.density * vv;
        }
    },

    _isGround(v) {
        const k = VoxMat.of(v).key;
        return k === 'dirt' || k === 'grass' || k === 'bedrock' || k === 'sand';
    },

    _queueStress(x, y, z, yCut, seeds) {
        for (const q of this.stressQueue) {
            if (Math.abs(q.x - x) < 2.5 && Math.abs(q.z - z) < 2.5 && Math.abs(q.y - y) < 2.5) {
                q.yCut = Math.min(q.yCut, yCut);
                for (const s of seeds) if (q.seeds.length < 96) q.seeds.push(s);
                return;
            }
        }
        if (this.stressQueue.length < 12) this.stressQueue.push({ x, y, z, yCut, seeds: seeds.slice() });
    },

    /** Одна проверка за кадр: перегруженная тонкая опора трещит и ломается — верх обрушается. */
    _updateStress(dt) {
        const w = this.world, vs = this.vs;
        for (let i = this.collapsing.length - 1; i >= 0; i--) {
            const c = this.collapsing[i];
            c.t -= dt;
            if (Math.random() < 0.5 && c.supports.length) {
                const s = c.supports[(Math.random() * c.supports.length) | 0];
                const x = s & (w.sx - 1), z = (s >> w.bx) & (w.sz - 1), y = s >> w.by;
                if (w.data[s]) VoxFX.dust((x + 0.5) * vs, (y + 0.3) * vs, (z + 0.5) * vs, w.data[s] & 127, 0.15, 0, -0.5, 0);
            }
            if (c.t > 0) continue;
            this.collapsing.splice(i, 1);
            const removed = [];
            for (const s of c.supports) {
                const v = w.data[s];
                if (!v) continue;
                const x = s & (w.sx - 1), z = (s >> w.bx) & (w.sz - 1), y = s >> w.by;
                removed.push([(x + 0.5) * vs, (y + 0.5) * vs, (z + 0.5) * vs, v]);
                w.set(x, y, z, 0);
                if (w.get(x, y + 1, z)) this._seeds.add(w.idx(x, y + 1, z));
                if (w.get(x, y - 1, z)) this._seeds.add(w.idx(x, y - 1, z));
            }
            if (!removed.length) continue;
            const counts = new Map();
            for (const r of removed) counts.set(r[3] & 127, (counts.get(r[3] & 127) || 0) + 1);
            this.emit({ type: 'removed', counts, x: c.x, y: c.y, z: c.z, cause: 'stress' });
            VoxFX.voxelsBurst(removed, c.x, c.y, c.z, 1.5, 60);
            for (let k = 0; k < Math.min(6, removed.length); k++) {
                const r = removed[(Math.random() * removed.length) | 0];
                VoxFX.dust(r[0], r[1], r[2], r[3] & 127, 0.8, 0, 0.2, 0);
            }
            if (typeof GameAudio !== 'undefined') GameAudio.breakVoxels(c.snd, removed.length * 4, c.x, c.y, c.z);
            VoxPhysics.wakeInBox(c.x - 8, c.y - 4, c.z - 8, c.x + 8, c.y + 12, c.z + 8);
            this.detach(null);
        }
        const q = this.stressQueue.shift();
        if (!q) return;
        const live = q.seeds.filter(s => w.data[s]);
        if (!live.length) return;
        const r = w.loadAbove(live, q.yCut, 220000, this._hold, this._mass1);
        if (r.big || !r.supports.length || r.count < 60) return;
        // опрокидывание: центр масс верха далеко за пятном опор
        let scx = 0, scz = 0;
        for (const s of r.supports) { scx += (s & (w.sx - 1)) + 0.5; scz += ((s >> w.bx) & (w.sz - 1)) + 0.5; }
        scx /= r.supports.length; scz /= r.supports.length;
        let spread = 1;
        for (const s of r.supports) spread = Math.max(spread, Math.hypot((s & (w.sx - 1)) + 0.5 - scx, ((s >> w.bx) & (w.sz - 1)) + 0.5 - scz));
        const lever = Math.hypot(r.comX - scx, r.comZ - scz);
        const tips = lever > spread + 6 && r.mass > r.cap * 0.12;
        if (r.mass <= r.cap && !tips) return;
        // перегруз: опоры трещат (пыль, звук) и через миг ломаются
        let snd = 'concrete', best = 0;
        const cnt = {};
        for (const s of r.supports) { const k = VoxMat.of(w.data[s]).sound; cnt[k] = (cnt[k] || 0) + 1; if (cnt[k] > best) { best = cnt[k]; snd = k; } }
        this.collapsing.push({ t: 0.25 + Math.random() * 0.45, supports: r.supports, x: q.x, y: q.yCut * vs, z: q.z, snd });
        if (typeof GameAudio !== 'undefined') GameAudio.impact(snd, 0.9, q.x, q.yCut * vs, q.z);
        if (Game.player) Game.player.addTrauma(0.12);
    },

    _seed: 12345,
    _rand() { this._seed = (this._seed * 16807) % 2147483647; return this._seed / 2147483647; },

    update(dt) {
        if (!this.world) return;
        // отложенные взрывы (цепочки)
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const p = this.pending[i];
            p.t -= dt;
            if (p.t <= 0) { this.pending.splice(i, 1); this.explode(p.x, p.y, p.z, p.r); }
        }
        if (this.nukes.length) this._updateNukes(dt);
        this._processImpacts();
        this._updateFire(dt);
        if (this._seeds.size) this.detach(null);
        this._updateStress(dt);
    },
};
