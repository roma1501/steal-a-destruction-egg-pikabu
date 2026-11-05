// GameMapBuild.js — тестовая карта Rubble Lab из маркеров Maps.js: земля из вокселей и постройки.
// Маркер карты (px; 1 воксель = 10 px) задаёт ЦЕНТР постройки, rot[1] — поворот (кратно 90°):
// локальная +x постройки смотрит по курсу маркера (0 — на восток, 90 — на юг, −90 — на север).
// Протяжённые маркеры (road, path, fence, picket, hedge, ditch, scaffold, barriers) берут длину из scale:
// полудлина вдоль локальной x = scale[0]·10 вокселей, полуширина вдоль z = scale[2]·10 (как у зон).
// Сборка идёт быстрым путём world.put/fill, в конце Game зовёт world.recount().
// Динамические предметы (ящики, мебель, бочки…) ставятся вокселями и отмечаются rdyn: после
// загрузки каждый связный кусок внутри ящика становится своим твёрдым телом (спящим).

/** @typedef {{ w: VoxWorld, x: number, z: number, rot: number,
 *   wx: (lx: number, lz: number) => number, wz: (lx: number, lz: number) => number,
 *   put: (lx: number, ly: number, lz: number, v: number) => void, get: (lx: number, ly: number, lz: number) => number,
 *   box: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, v: number | ((lx: number, ly: number, lz: number) => number)) => void,
 *   dyn: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
 *   body: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, v: number | ((lx: number, ly: number, lz: number) => number)) => void,
 *   h: (lx: number, ly: number, lz: number) => number }} MapFrame */

/** @satisfies {Record<string, any>} */
const GameMapBuild = {
    GROUND: 20,          // верх земли (вокселей): коренная порода y = 0, земля 1..18, трава 19
    /** Земляные работы — до построек (канава, дороги и тропы красят и режут землю под ними). */
    EARTH: { ditch: 1, road: 1, path: 1, plaza: 1, sandpit: 1 },

    /** @param {VoxWorld} w @param {any} map */
    build(w, map) {
        /** @type {any} */ (w).groundTop = this.GROUND;
        this.dynamic = [];
        this.ground(w);
        const markers = (map && map.objects || []).filter(o => o.kind === 'marker');
        const base = mk => String(mk.name).replace(/-\d+$/, '');
        const order = markers.map((mk, i) => ({ mk, i, e: this.EARTH[base(mk)] ? 0 : 1 }));
        order.sort((a, b) => a.e - b.e || a.i - b.i);
        for (const { mk } of order) {
            const fn = this.builders[base(mk)];
            if (!fn) continue;
            const x = Math.round(mk.x / 10), z = Math.round(mk.y / 10);
            const rot = ((Math.round(((mk.rot && mk.rot[1]) || 0) / 90) % 4) + 4) % 4;
            fn.call(this, w, x, z, rot, mk);
        }
    },

    /** Земля: коренная порода, грунт, трава с пятнами другого оттенка (крупный шум). */
    ground(w) {
        const G = this.GROUND;
        w.fill(0, 0, 0, w.sx, 1, w.sz, M.bedrock);
        w.fill(0, 1, 0, w.sx, G - 1, w.sz, M.dirt);
        w.fill(0, G - 1, 0, w.sx, G, w.sz, M.grass);
        for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
            const n = this.vnoise(x, z, 34) * 0.7 + this.vnoise(x + 311, z + 97, 9) * 0.3;
            if (n > 0.6) w.put(x, G - 1, z, M.grass2);
        }
    },

    /** @type {number[][]} ящики вокселей мира [x0, y0, z0, x1, y1, z1), которые станут твёрдыми телами */
    dynamic: [],

    /**
     * Отметить ящик постройки (локальные координаты, как у rbox) как ДИНАМИЧЕСКИЙ: после сборки
     * все воксели внутри вынимаются из мира в твёрдые тела (каждый связный кусок — своё тело),
     * тела стартуют спящими (стопки стоят, пока их не тронут). Воксели ставь как обычно (rbox/rput).
     */
    rdyn(w, x, z, rot, x0, y0, z0, x1, y1, z1) {
        const pts = [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]].map(([lx, lz]) => {
            let dx = lx, dz = lz;
            if (rot === 1) { dx = -lz; dz = lx; } else if (rot === 2) { dx = -lx; dz = -lz; } else if (rot === 3) { dx = lz; dz = -lx; }
            return [x + dx, z + dz];
        });
        const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
        this.dynamic.push([Math.min(...xs), this.GROUND + y0, Math.min(...zs), Math.max(...xs) + 1, this.GROUND + y1, Math.max(...zs) + 1]);
    },

    /** После VoxPhysics.init: вынуть динамические ящики в тела. */
    spawnBodies(w, map) {
        if (typeof VoxPhysics === 'undefined' || !VoxPhysics.extractRegion) return;
        for (const b of this.dynamic) VoxPhysics.extractRegion(b[0], b[1], b[2], b[3], b[4], b[5], { sleep: true });
        this.dynamic = [];
    },

    /** Поставить воксель в повёрнутой системе постройки: (lx, ly, lz) от угла (x, z), rot — четверти. */
    rput(w, x, z, rot, lx, ly, lz, v) {
        let dx = lx, dz = lz;
        if (rot === 1) { dx = -lz; dz = lx; } else if (rot === 2) { dx = -lx; dz = -lz; } else if (rot === 3) { dx = lz; dz = -lx; }
        w.put(x + dx, this.GROUND + ly, z + dz, v);
    },
    /** Ящик в системе постройки [x0,x1) … материалом v или функцией (lx, ly, lz) -> v. */
    rbox(w, x, z, rot, x0, y0, z0, x1, y1, z1, v) {
        for (let ly = y0; ly < y1; ly++) for (let lz = z0; lz < z1; lz++) for (let lx = x0; lx < x1; lx++) {
            const m = typeof v === 'function' ? v(lx, ly, lz) : v;
            if (m >= 0) this.rput(w, x, z, rot, lx, ly, lz, m);
        }
    },

    /**
     * Локальная система постройки (центр — маркер): put/get/box/dyn/body в (lx, ly от GROUND, lz).
     * box с числом — быстрый fill, с функцией — по вокселю (−1 — не трогать, 0 — воздух).
     * @returns {MapFrame}
     */
    frame(w, x, z, rot) {
        const G = this.GROUND, self = this;
        const ca = [1, 0, -1, 0][rot], sa = [0, 1, 0, -1][rot];
        const wx = (lx, lz) => x + lx * ca - lz * sa, wz = (lx, lz) => z + lx * sa + lz * ca;
        /** @type {MapFrame} */
        const F = {
            w, x, z, rot, wx, wz,
            put(lx, ly, lz, v) { w.put(x + lx * ca - lz * sa, G + ly, z + lx * sa + lz * ca, v); },
            get(lx, ly, lz) { return w.get(x + lx * ca - lz * sa, G + ly, z + lx * sa + lz * ca); },
            box(x0, y0, z0, x1, y1, z1, v) {
                if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
                if (typeof v === 'number') {
                    const ax = wx(x0, z0), bx = wx(x1 - 1, z1 - 1), az = wz(x0, z0), bz = wz(x1 - 1, z1 - 1);
                    w.fill(Math.min(ax, bx), G + y0, Math.min(az, bz), Math.max(ax, bx) + 1, G + y1, Math.max(az, bz) + 1, v);
                    return;
                }
                for (let ly = y0; ly < y1; ly++) for (let lz = z0; lz < z1; lz++) for (let lx = x0; lx < x1; lx++) {
                    const m = v(lx, ly, lz);
                    if (m >= 0) w.put(x + lx * ca - lz * sa, G + ly, z + lx * sa + lz * ca, m);
                }
            },
            dyn(x0, y0, z0, x1, y1, z1) { self.rdyn(w, x, z, rot, x0, y0, z0, x1, y1, z1); },
            body(x0, y0, z0, x1, y1, z1, v) { F.box(x0, y0, z0, x1, y1, z1, v); F.dyn(x0, y0, z0, x1, y1, z1); },
            h(lx, ly, lz) { return self.hash(wx(lx, lz), ly, wz(lx, lz)); },
        };
        return F;
    },

    /** Целочисленный хэш -> [0, 1). */
    hash(a, b, c) {
        let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    },
    /** Гладкий шум значений по сетке s (0..1). */
    vnoise(x, z, s) {
        const fx = x / s, fz = z / s, ix = Math.floor(fx), iz = Math.floor(fz);
        let tx = fx - ix, tz = fz - iz;
        tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
        const a = this.hash(ix, 7, iz), b = this.hash(ix + 1, 7, iz), c = this.hash(ix, 7, iz + 1), d = this.hash(ix + 1, 7, iz + 1);
        return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    },
    /** Длина маркера: полуразмеры в вокселях из scale (1 = 1 м = 10 вокселей). */
    span(mk, defX, defZ) {
        const s = (mk && mk.scale) || [1, 1, 1];
        return [Math.max(2, Math.round((s[0] || 1) * 10 * (defX || 1))), Math.max(1, Math.round((s[2] || 1) * 10 * (defZ || 1)))];
    },

    /**
     * Убрать оторванные крошки (листва, камень) в ящике мира [x0,x1)×[y0,y1)×[z0,z1): обход от нижнего
     * слоя y0 (земля) по граням; недостижимые воксели материалов mats — в воздух.
     */
    prune(w, x0, y0, z0, x1, y1, z1, mats) {
        x0 = Math.max(0, x0); z0 = Math.max(0, z0); x1 = Math.min(w.sx, x1); z1 = Math.min(w.sz, z1); y1 = Math.min(w.sy, y1);
        const nx = x1 - x0, nz = z1 - z0, ny = y1 - y0, n = nx * ny * nz;
        if (n <= 0) return;
        const vis = new Uint8Array(n), q = new Int32Array(n);
        let h = 0, t = 0;
        for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (w.get(x, y0, z)) { const k = (x - x0) + nx * (z - z0); vis[k] = 1; q[t++] = k; }
        const sxz = nx * nz;
        while (h < t) {
            const k = q[h++], ly = (k / sxz) | 0, r = k - ly * sxz, lz = (r / nx) | 0, lx = r - lz * nx;
            const X = x0 + lx, Y = y0 + ly, Z = z0 + lz;
            if (lx > 0 && !vis[k - 1] && w.get(X - 1, Y, Z)) { vis[k - 1] = 1; q[t++] = k - 1; }
            if (lx < nx - 1 && !vis[k + 1] && w.get(X + 1, Y, Z)) { vis[k + 1] = 1; q[t++] = k + 1; }
            if (lz > 0 && !vis[k - nx] && w.get(X, Y, Z - 1)) { vis[k - nx] = 1; q[t++] = k - nx; }
            if (lz < nz - 1 && !vis[k + nx] && w.get(X, Y, Z + 1)) { vis[k + nx] = 1; q[t++] = k + nx; }
            if (ly > 0 && !vis[k - sxz] && w.get(X, Y - 1, Z)) { vis[k - sxz] = 1; q[t++] = k - sxz; }
            if (ly < ny - 1 && !vis[k + sxz] && w.get(X, Y + 1, Z)) { vis[k + sxz] = 1; q[t++] = k + sxz; }
        }
        for (let k = 0; k < n; k++) {
            if (vis[k]) continue;
            const ly = (k / sxz) | 0, r = k - ly * sxz, lz = (r / nx) | 0, lx = r - lz * nx;
            const v = w.get(x0 + lx, y0 + ly, z0 + lz);
            if (v && mats.includes(v)) w.put(x0 + lx, y0 + ly, z0 + lz, 0);
        }
    },

    // ---------- общие детали ----------

    /**
     * Проём в стене толщиной T: axis 'z' — стена поперёк z (идёт вдоль x, a = lx), 'x' — вдоль z (a = lz);
     * outer — наружный слой, d — шаг внутрь (±1). kind: 'win' — рама, стекло, импост, подоконник;
     * 'door' — коробка, o.leaf — открытая внутрь створка на петлях; 'hole' — просто вырез.
     */
    opening(F, axis, outer, d, T, a0, a1, y0, y1, kind, o) {
        o = o || {};
        const P = axis === 'z' ? (a, ly, t, v) => F.put(a, ly, outer + t * d, v) : (a, ly, t, v) => F.put(outer + t * d, ly, a, v);
        for (let ly = y0; ly < y1; ly++) for (let a = a0; a < a1; a++) for (let t = 0; t < T; t++) P(a, ly, t, 0);
        const mid = o.mid != null ? o.mid : (T >> 1), fr = o.frame || M.darkwood;
        if (kind === 'win') {
            const am = (a1 - a0) >= 9 ? a0 + ((a1 - a0) >> 1) : -9999;
            const ym = (y1 - y0) >= 10 ? y0 + Math.round((y1 - y0) * 0.68) : -9999;
            for (let ly = y0; ly < y1; ly++) for (let a = a0; a < a1; a++) {
                const edge = a === a0 || a === a1 - 1 || ly === y0 || ly === y1 - 1 || a === am || ly === ym;
                P(a, ly, mid, edge ? fr : M.glass);
            }
            if (o.sill !== false) {
                for (let a = a0 - 1; a <= a1; a++) { P(a, y0 - 1, -1, M.concrete); for (let t = 0; t < T - 1; t++) P(a, y0 - 1, t, M.concrete); }
                if (T > 2) for (let a = a0; a < a1; a++) P(a, y0 - 1, T - 1, M.darkwood);
            }
        } else if (kind === 'door') {
            for (let ly = y0; ly < y1; ly++) { P(a0, ly, mid, fr); P(a1 - 1, ly, mid, fr); }
            for (let a = a0; a < a1; a++) P(a, y1 - 1, mid, fr);
            if (o.leaf) {
                const L = a1 - a0 - 3;
                for (let ly = y0; ly < y1 - 1; ly++) for (let s = 0; s < L; s++) {
                    const panel = (ly === y0 + 4 || ly === y1 - 5 || ly === y0 + 12) || s === 0 || s === L - 1;
                    P(a0 + 1, ly, mid + s, (ly === y0 + 10 && s === L - 2) ? M.metal : panel ? M.darkwood : (o.leafMat || M.wood));
                }
            }
        }
        if (o.lintel) for (let a = a0 - 1; a <= a1; a++) for (let t = 0; t < Math.max(1, T - 1); t++) P(a, y1, t, o.lintel);
    },

    /** Вертикальный цилиндр (центр cx, cz — дробные, радиус r), материал или функция (lx, ly, lz, ring) -> v. */
    cyl(F, cx, cz, r, y0, y1, v) {
        const r2 = r * r, ri = (r - 1) * (r - 1);
        for (let lz = Math.floor(cz - r); lz <= Math.ceil(cz + r); lz++) for (let lx = Math.floor(cx - r); lx <= Math.ceil(cx + r); lx++) {
            const dx = lx + 0.5 - cx, dz = lz + 0.5 - cz, q = dx * dx + dz * dz;
            if (q > r2) continue;
            const ring = q > ri;
            for (let ly = y0; ly < y1; ly++) {
                const m = typeof v === 'function' ? v(lx, ly, lz, ring) : v;
                if (m >= 0) F.put(lx, ly, lz, m);
            }
        }
    },
    /** Шар с центром (cx, cy, cz) радиуса r; rough — неровность края (0..1). */
    blob(F, cx, cy, cz, r, v, rough) {
        rough = rough || 0;
        for (let ly = Math.floor(cy - r - 1); ly <= Math.ceil(cy + r + 1); ly++)
            for (let lz = Math.floor(cz - r - 1); lz <= Math.ceil(cz + r + 1); lz++)
                for (let lx = Math.floor(cx - r - 1); lx <= Math.ceil(cx + r + 1); lx++) {
                    const dx = lx + 0.5 - cx, dy = ly + 0.5 - cy, dz = lz + 0.5 - cz;
                    const rr = r * (1 + (F.h(lx >> 1, ly >> 1, lz >> 1) - 0.5) * rough);
                    if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
                    const m = typeof v === 'function' ? v(lx, ly, lz) : v;
                    if (m >= 0) F.put(lx, ly, lz, m);
                }
    },

    /** Ящик со стороной s (тело): светлые доски, тёмные рёбра. */
    crate(F, x0, y0, z0, s, sy) {
        sy = sy || s;
        F.body(x0, y0, z0, x0 + s, y0 + sy, z0 + s, (lx, ly, lz) => {
            const ex = lx === x0 || lx === x0 + s - 1, ey = ly === y0 || ly === y0 + sy - 1, ez = lz === z0 || lz === z0 + s - 1;
            return ((ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0)) >= 2 ? M.darkwood : M.crate;
        });
    },
    /** Взрывная бочка 6×9×6 (тело): красный корпус, металлические обручи и крышка. */
    barrel(F, x0, y0, z0) {
        this.cyl(F, x0 + 3, z0 + 3, 3.2, y0, y0 + 9, (lx, ly, lz, ring) => {
            const k = ly - y0;
            if (k === 0) return M.metal;
            if (k === 8) return ring ? M.metal : M.barrel;
            if ((k === 2 || k === 6) && ring) return M.metal;
            return M.barrel;
        });
        F.put(x0 + 4, y0 + 8, z0 + 2, M.metal);       // пробка
        F.dyn(x0, y0, z0, x0 + 6, y0 + 9, z0 + 6);
    },
    /** Стул 5×5 (тело): ножки, сиденье, спинка с края back ('-x' | '+x' | '-z' | '+z'). */
    chair(F, x0, y0, z0, back, seat) {
        seat = seat || M.wood;
        F.body(x0, y0, z0, x0 + 5, y0 + 11, z0 + 5, (lx, ly, lz) => {
            const i = lx - x0, j = lz - z0, k = ly - y0;
            const isBack = back === '-x' ? i === 0 : back === '+x' ? i === 4 : back === '-z' ? j === 0 : j === 4;
            if (k < 4) return ((i === 0 || i === 4) && (j === 0 || j === 4)) ? M.darkwood : 0;
            if (k === 4) return seat;
            if (isBack) return (k === 10 || ((back === '-x' || back === '+x') ? (j === 0 || j === 4) : (i === 0 || i === 4))) ? M.darkwood : (k === 7 ? M.darkwood : 0);
            return 0;
        });
    },

    /** Кирпичная кладка: пятна темнее «по кирпичу» (2 вокселя, ряды со сдвигом). */
    brickAt(a, ly, wall) {
        return this.hash(Math.floor((a + (ly & 1)) / 2), ly, wall + 11) < 0.13 ? M.brick2 : M.brick;
    },

    // ---------- дом ----------

    /** Коробка дома: фундамент, полы, стены (кладка, цоколь, пояс, угловые камни), перекрытия. */
    houseShell(F) {
        const X0 = -46, X1 = 46, Z0 = -36, Z1 = 36;
        const roofB = lz => 56 + (39 - (lz < 0 ? -lz - 1 : lz));
        F.box(X0, 0, Z0, X1, 1, Z1, M.concrete2);
        F.box(X0 + 3, 1, Z0 + 3, X1 - 3, 2, Z1 - 3, (lx, ly, lz) => ((lz + 40) % 5 === 0 ? M.wood : M.plank));
        F.box(X0, 0, Z0, X1, 100, Z1, (lx, ly, lz) => {
            const d1 = Math.min(lx - X0, X1 - 1 - lx), d2 = Math.min(lz - Z0, Z1 - 1 - lz), t = Math.min(d1, d2);
            if (t > 2 || ly >= roofB(lz)) return -1;
            if (ly === 0) return M.concrete2;
            if (t === 2) {
                if (ly < 30) return M.plaster;
                if (ly < 58 && lx < 4) return M.plaster2;
                if (ly < 46 && lx >= 6 && lx < 31 && lz < -22) return M.tile;
                return M.plaster;
            }
            if (ly < 4) return M.concrete2;
            const along = Math.max(d1, d2), wall = d1 < d2 ? (lx < 0 ? 0 : 1) : (lz < 0 ? 2 : 3);
            if (ly < 60 && along < ((((ly - 4) / 4) | 0) % 2 ? 4 : 7)) return M.mortar;
            if (ly === 30) return M.mortar;
            return this.brickAt(d1 < d2 ? lz : lx, ly, wall);
        });
        // перекрытия: снизу штукатурка, сверху доски
        for (const y of [30, 58]) {
            F.box(X0 + 3, y, Z0 + 3, X1 - 3, y + 1, Z1 - 3, M.plaster);
            F.box(X0 + 3, y + 1, Z0 + 3, X1 - 3, y + 2, Z1 - 3, (lx, ly, lz) => ((lz + 40) % 5 === 0 ? M.wood : M.plank));
        }
    },

    houseOpenings(F) {
        const lintel = M.brick2;
        // юг: гостиная, входная дверь, второй этаж
        for (const [a0, y0] of [[-36, 10], [-14, 10], [-36, 40], [-14, 40], [16, 40]]) this.opening(F, 'z', 35, -1, 3, a0, a0 + 12, y0, y0 + 14, 'win', { lintel });
        this.opening(F, 'z', 35, -1, 3, 16, 28, 2, 25, 'door', { lintel, leaf: true });
        // север: гостиная, кухня, спальня, ванная
        this.opening(F, 'z', -36, 1, 3, -30, -18, 10, 24, 'win', { lintel });
        this.opening(F, 'z', -36, 1, 3, 16, 26, 14, 24, 'win', { lintel });
        this.opening(F, 'z', -36, 1, 3, -30, -18, 40, 54, 'win', { lintel });
        this.opening(F, 'z', -36, 1, 3, 14, 22, 44, 54, 'win', { lintel });
        // запад (по сторонам от камина) и восток
        for (const y0 of [10, 40]) for (const a0 of [-26, 14]) this.opening(F, 'x', -46, 1, 3, a0, a0 + 12, y0, y0 + 14, 'win', { lintel });
        for (const y0 of [10, 40]) this.opening(F, 'x', 45, -1, 3, -28, -16, y0, y0 + 14, 'win', { lintel });
        this.opening(F, 'x', 45, -1, 3, -5, 5, 68, 78, 'win', { sill: false });       // чердак
    },

    houseInterior(F) {
        // перегородки (штукатурка, 2 вокселя) и двери
        F.box(4, 2, -33, 6, 30, 33, M.plaster);
        this.opening(F, 'x', 4, 1, 2, -6, 6, 2, 25, 'door', { mid: 0 });
        F.box(4, 32, -33, 6, 58, 33, M.plaster);
        this.opening(F, 'x', 5, -1, 2, 0, 12, 32, 55, 'door', { mid: 0, leaf: true });
        F.box(6, 32, -22, 33, 58, -20, (lx, ly) => ly < 46 ? M.tile : M.plaster);
        F.box(31, 32, -33, 33, 58, -22, (lx, ly) => ly < 46 ? M.tile : M.plaster);
        this.opening(F, 'z', -21, -1, 2, 18, 30, 32, 55, 'door', { mid: 0 });
        F.box(6, 31, -33, 31, 32, -22, M.tile);                      // пол ванной
        // лестница вдоль восточной стены: 15 ступеней 2 × 3, снизу у входа, вверх на север
        for (let k = 0; k < 15; k++) {
            const top = 3 + 2 * k;
            F.box(33, 2, 33 - 3 * (k + 1), 43, top + 1, 33 - 3 * k, (lx, ly) => ly === top ? M.darkwood : (ly === top - 1 ? M.wood : M.plaster));
        }
        F.box(33, 30, -9, 43, 32, 22, 0);                            // проём лестницы в перекрытии
        // перила вокруг проёма
        for (let lz = -9; lz < 22; lz++) { F.put(32, 41, lz, M.darkwood); if ((lz + 9) % 4 === 0) F.box(32, 32, lz, 33, 41, lz + 1, M.darkwood); }
        for (let lx = 32; lx < 43; lx++) { F.put(lx, 41, 22, M.darkwood); if (lx % 4 === 0) F.box(lx, 32, 22, lx + 1, 41, 23, M.darkwood); }
        F.box(42, 32, 22, 43, 41, 23, M.darkwood);
        // кухня: тумбы со столешницей, мойка, плита, навесные шкафы
        F.box(14, 2, -33, 32, 11, -27, (lx, ly, lz) => {
            if (ly === 10) return M.tile;
            if (ly === 2) return M.darkwood;
            if (lz === -28 && (lx % 6 === 1)) return M.darkwood;
            return M.plaster;
        });
        F.box(19, 8, -32, 23, 11, -29, 0); F.box(19, 7, -32, 23, 8, -29, M.metal);
        F.put(21, 11, -33, M.metal); F.put(21, 12, -33, M.metal); F.put(21, 12, -32, M.metal);
        F.box(26, 2, -33, 32, 11, -27, (lx, ly, lz) => ly === 10 ? M.concrete2 : (lz === -28 && ly === 8 && lx % 2 === 0 ? M.concrete2 : M.metal));
        F.box(26, 17, -33, 32, 25, -30, (lx, ly, lz) => (lz === -31 && (lx === 28 || ly === 17 || ly === 24)) ? M.darkwood : M.wood);
        // ванная: ванна, унитаз
        F.box(7, 32, -33, 23, 37, -26, (lx, ly, lz) => (ly > 32 && lx > 7 && lx < 22 && lz > -33 && lz < -27) ? 0 : M.tile);
        F.box(26, 32, -33, 30, 36, -29, M.tile); F.box(26, 36, -33, 30, 40, -32, M.tile);
        F.box(27, 35, -32, 29, 36, -30, 0);
        // ковёр под столом (вровень с полом)
        F.box(-32, 1, 2, -8, 2, 20, (lx, ly, lz) => (lx === -32 || lx === -9 || lz === 2 || lz === 19) ? M.blue : M.fabric);
        // камин и труба у западной стены
        F.box(-46, 0, -4, -38, 60, 4, (lx, ly, lz) => this.brickAt(lz + lx, ly, 5));
        F.box(-41, 2, -3, -38, 11, 3, 0);
        F.box(-42, 2, -3, -41, 11, 3, M.concrete2);
        F.box(-41, 1, -5, -35, 2, 5, M.concrete);
        F.box(-41, 2, -2, -39, 3, 2, M.metal);
        F.box(-41, 3, -1, -39, 4, 1, M.darkwood);
        F.box(-38, 13, -5, -37, 14, 5, M.darkwood);
        // крыльцо: ступень, козырёк на кронштейнах, фонарь
        F.box(15, 0, 36, 29, 2, 40, M.concrete);
        F.box(14, 26, 36, 30, 27, 41, M.roof2);
        for (const bx of [14, 29]) { F.put(bx, 25, 36, M.darkwood); F.put(bx, 25, 37, M.darkwood); F.put(bx, 24, 36, M.darkwood); F.put(bx, 25, 38, M.darkwood); }
        F.put(31, 19, 36, M.metal); F.put(31, 18, 36, M.lamp); F.put(31, 20, 36, M.metal);
    },

    /** Двускатная крыша (конёк вдоль x), свесы, лобовые доски, конёк; труба поверх. */
    houseRoof(F) {
        for (let lz = -40; lz < 40; lz++) {
            const zz = lz < 0 ? -lz - 1 : lz, k = 39 - zz, yb = 56 + k;
            for (let lx = -50; lx < 50; lx++) {
                const m = (k % 3 === 0 || this.hash(lx >> 1, k, 3) < 0.08) ? M.roof2 : M.roof;
                F.put(lx, yb, lz, m); F.put(lx, yb + 1, lz, m);
                if (zz === 39) F.put(lx, yb - 1, lz, M.darkwood);
            }
            F.put(-50, yb - 1, lz, M.darkwood); F.put(49, yb - 1, lz, M.darkwood);
        }
        F.box(-50, 97, -1, 50, 98, 1, M.roof2);
        // дымовая труба: через крышу до 104, оголовок, дымоход, горшки
        F.box(-46, 60, -4, -38, 102, 4, (lx, ly, lz) => this.brickAt(lz + lx, ly, 5));
        F.box(-47, 102, -5, -37, 104, 5, M.concrete2);
        F.box(-43, 88, -1, -41, 104, 1, 0);
        F.box(-45, 104, -3, -43, 106, -1, M.terracotta); F.box(-41, 104, 1, -39, 106, 3, M.terracotta);
    },

    /** Мебель дома — тела (каждая вещь — свой ящик, зазор 1 воксель от стен). */
    houseFurniture(F) {
        // гостиная: обеденный стол и 4 стула
        F.body(-28, 2, 6, -12, 10, 16, (lx, ly, lz) => ly === 9 ? M.plank : ((lx === -27 || lx === -13) && (lz === 7 || lz === 14) ? M.darkwood : 0));
        this.chair(F, -26, 2, 0, '-z'); this.chair(F, -18, 2, 0, '-z');
        this.chair(F, -26, 2, 17, '+z'); this.chair(F, -18, 2, 17, '+z');
        // диван и журнальный столик
        F.body(-36, 2, -31, -16, 11, -23, (lx, ly, lz) => {
            const arm = lx < -34 || lx > -19;
            if (lz < -29) return M.fabric;
            if (arm) return ly < 8 ? M.fabric : 0;
            if (ly < 5) return ly === 2 ? M.darkwood : M.fabric;
            return 0;
        });
        F.body(-30, 2, -19, -22, 6, -14, (lx, ly, lz) => ly === 5 ? M.darkwood : ((lx === -30 || lx === -23) && (lz === -19 || lz === -15) ? M.darkwood : 0));
        // книжный стеллаж с книгами
        const books = [M.blue, M.brick2, M.plank, M.fabric, M.hazard, M.foam, M.steelg];
        F.body(-2, 2, 16, 2, 23, 28, (lx, ly, lz) => {
            const side = lz === 16 || lz === 27, shelf = (ly - 2) % 5 === 0 || ly === 22;
            if (side || shelf || lx === 1) return M.darkwood;
            const k = (ly - 2) % 5, hh = 2 + Math.floor(this.hash(lz, ly - k, 1) * 3);
            return k <= hh ? books[Math.floor(this.hash(lz, (ly - k) * 3, 2) * books.length)] : 0;
        });
        // кухня: холодильник
        F.body(7, 2, -32, 13, 22, -27, (lx, ly, lz) => (lz === -27 && lx === 12 && (ly === 9 || ly === 16)) ? M.metal : (ly === 13 && lz === -27 ? M.concrete : M.tile));
        // спальня: кровать, тумбочка, шкаф, письменный стол и стул
        F.body(-40, 32, -20, -20, 43, -6, (lx, ly, lz) => {
            if (lx < -38) return M.darkwood;
            if (ly < 35) return (ly === 34 || ((lx === -37 || lx === -21) && (lz === -20 || lz === -7))) ? M.darkwood : 0;
            if (ly < 37) return M.foam;
            if (ly === 37) return lx < -33 ? ((lz > -19 && lz < -14) || (lz > -12 && lz < -7) ? M.foam : 0) : M.fabric;
            return 0;
        });
        F.body(-40, 32, -26, -36, 38, -22, (lx, ly, lz) => ly === 37 ? (lx === -38 && lz === -24 ? M.lamp : 0) : (ly === 36 ? M.darkwood : M.wood));
        F.body(-12, 32, -32, 0, 52, -26, (lx, ly, lz) => {
            const shell = lx === -12 || lx === -1 || ly === 32 || ly === 51 || lz === -32 || lz === -27;
            if (!shell) return 0;
            if (lz === -27 && lx === -6) return M.darkwood;
            if (lz === -27 && ly === 42 && (lx === -8 || lx === -4)) return M.metal;
            return lz === -27 ? M.wood : M.darkwood;
        });
        F.body(-36, 32, 25, -22, 40, 32, (lx, ly, lz) => ly === 39 ? M.plank : ((lx === -36 || lx === -23) && (lz === 25 || lz === 31) ? M.darkwood : 0));
        this.chair(F, -31, 32, 18, '-z', M.blue);
    },

    // ---------- сарай ----------

    /** Тюк сена 10 × 5 × 6 (тело) с двумя обвязками. */
    hayBale(F, x0, y0, z0, alongZ) {
        const sx = alongZ ? 6 : 10, sz = alongZ ? 10 : 6;
        F.body(x0, y0, z0, x0 + sx, y0 + 5, z0 + sz, (lx, ly, lz) => {
            const a = alongZ ? lz - z0 : lx - x0;
            return (a === 2 || a === 7) ? M.wood : M.hay;
        });
    },

    /** Каркас и обшивка сарая: фундамент, столбы, доски, обвязка, ворота, окна. */
    barnShell(F) {
        const X0 = -42, X1 = 42, Z0 = -32, Z1 = 32;
        const roofB = lz => 43 + (34 - (lz < 0 ? -lz - 1 : lz));
        const postA = [-42, -41, -22, -21, -2, -1, 18, 19, 40, 41], postZ = [-32, -31, -16, -15, -12, -11, 10, 11, 14, 15, 30, 31];
        F.box(X0 + 2, -1, Z0 + 2, X1 - 2, 0, Z1 - 2, (lx, ly, lz) => F.h(lx >> 1, 0, lz >> 1) < 0.12 ? M.hay : M.dirt);
        F.box(X0, 0, Z0, X1, 80, Z1, (lx, ly, lz) => {
            const d1 = Math.min(lx - X0, X1 - 1 - lx), d2 = Math.min(lz - Z0, Z1 - 1 - lz), t = Math.min(d1, d2);
            if (t > 1 || ly >= roofB(lz)) return -1;
            if (ly < 2) return M.concrete2;
            const longWall = d2 <= d1;                       // стена вдоль x
            const post = longWall ? postA.includes(lx) : postZ.includes(lz);
            if (post) return M.darkwood;
            if (longWall && ly >= 44) return M.darkwood;     // верхняя обвязка
            if (t === 1) return (ly === 14 || ly === 15 || ly === 30 || ly === 31) && (longWall || ly < 44) ? M.darkwood : 0;
            const c = longWall ? lx : lz;
            if ((c + 64) % 6 === 0) return M.darkwood;
            return this.hash(c >> 1, longWall ? 1 : 2, d1 < d2 ? (lx < 0 ? 3 : 4) : (lz < 0 ? 5 : 6)) < 0.3 ? M.plank : M.wood;
        });
        // ворота (восточный торец): проём, балка над ним, две откатные створки на рельсе
        F.box(40, 2, -14, 42, 34, 14, 0);
        F.box(40, 34, -16, 42, 36, 16, M.darkwood);
        F.box(42, 36, -30, 43, 37, 22, M.metal);
        for (const z0 of [-29, 6]) {
            F.box(42, 2, z0, 43, 34, z0 + 14, (lx, ly, lz) => {
                const j = lz - z0, k = ly - 2;
                if (j === 0 || j === 13 || k === 0 || k === 31 || k === 15) return M.darkwood;
                const half = k < 15 ? k : k - 16;
                if (Math.abs(j - Math.round(half * 13 / 15)) === 0) return M.darkwood;
                return (lz & 1) ? M.plank : M.wood;
            });
            F.box(42, 34, z0 + 1, 43, 36, z0 + 2, M.metal); F.box(42, 34, z0 + 12, 43, 36, z0 + 13, M.metal);
        }
        // задняя дверь и сенная дверь с балкой подъёмника
        this.opening(F, 'x', -42, 1, 2, -5, 5, 2, 24, 'door', { mid: 1 });
        this.opening(F, 'x', -42, 1, 2, -7, 7, 30, 42, 'door', { mid: 1 });
        F.box(-50, 46, -1, -40, 48, 1, M.darkwood);
        F.box(-48, 43, -1, -47, 46, 0, M.metal);
        // окна на длинных стенах
        for (const a0 of [-34, -12, 6, 26]) {
            this.opening(F, 'z', -32, 1, 2, a0, a0 + 7, 20, 28, 'win', { sill: false, mid: 0 });
            this.opening(F, 'z', 31, -1, 2, a0, a0 + 7, 20, 28, 'win', { sill: false, mid: 0 });
        }
        F.box(-11, 21, -32, -8, 24, -31, 0);                      // выбитое стекло
    },

    /** Сеновал, лестница, верстак, крыша из профлиста. */
    barnInterior(F) {
        F.box(-40, 26, -30, 0, 27, 30, lx => (lx + 64) % 4 === 0 ? M.darkwood : -1);
        F.box(-40, 27, -30, 0, 28, 30, (lx, ly, lz) => (lz + 64) % 7 === 0 ? M.wood : M.plank);
        F.box(-2, 24, -30, 0, 28, 30, M.darkwood);
        for (const z0 of [-17, -1, 15]) F.box(-2, 2, z0, 0, 24, z0 + 2, M.darkwood);
        for (let lz = -30; lz < 30; lz++) {
            if (lz >= 19 && lz < 25) continue;
            F.put(-1, 36, lz, M.darkwood);
            if ((lz + 30) % 6 === 0) F.box(-1, 28, lz, 0, 36, lz + 1, M.darkwood);
        }
        F.box(-1, 28, 18, 0, 36, 19, M.darkwood); F.box(-1, 28, 25, 0, 36, 26, M.darkwood);
        // лестница на сеновал
        F.box(0, 0, 20, 1, 34, 21, M.darkwood); F.box(0, 0, 23, 1, 34, 24, M.darkwood);
        for (let ly = 3; ly < 34; ly += 4) F.box(0, ly, 21, 1, ly + 1, 23, M.wood);
        // верстак с тисками
        F.box(10, 0, -30, 30, 10, -25, (lx, ly, lz) => {
            if (ly === 9) return M.plank;
            if (ly === 3) return M.wood;
            return ((lx === 10 || lx === 29) && (lz === -30 || lz === -26)) ? M.darkwood : -1;
        });
        F.box(26, 10, -28, 28, 12, -26, M.metal); F.put(27, 12, -27, M.metal);
        // крыша: профлист (полосы ржавчины и металла), коньковая планка
        for (let lz = -35; lz < 35; lz++) {
            const zz = lz < 0 ? -lz - 1 : lz, k = 34 - zz, yb = 43 + k;
            for (let lx = -45; lx < 45; lx++) {
                const m = ((lx + 64) % 4 < 2) ? M.rust : (this.hash(lx, zz >> 2, 9) < 0.3 ? M.rust : M.metal);
                F.put(lx, yb, lz, m); F.put(lx, yb + 1, lz, m);
            }
        }
        F.box(-45, 79, -1, 45, 80, 1, M.metal);
    },

    /** Тюки на сеновале и внизу, ящики у ворот. */
    barnProps(F) {
        for (const bx of [-38, -27, -16]) for (const bz of [-28, -21, -14]) this.hayBale(F, bx, 28, bz, false);
        for (const bx of [-38, -27]) for (const bz of [-28, -21]) this.hayBale(F, bx, 33, bz, false);
        this.hayBale(F, -38, 28, 4, true); this.hayBale(F, -31, 28, 4, true); this.hayBale(F, -38, 33, 4, true);
        this.hayBale(F, 20, 0, 16, false); this.hayBale(F, 20, 0, 23, false); this.hayBale(F, 20, 5, 16, false);
        this.crate(F, 6, 0, 18, 6); this.crate(F, 13, 0, 18, 6); this.crate(F, 6, 6, 18, 6); this.crate(F, 32, 0, -22, 6);
    },

    // ---------- теплица ----------

    /** Горшок с растением 4 × 8 × 4 (тело): терракота, земля, листва. */
    pot(F, x0, y0, z0, k) {
        F.body(x0, y0, z0, x0 + 4, y0 + 9, z0 + 4, (lx, ly, lz) => {
            const i = lx - x0, j = lz - z0, l = ly - y0, corner = (i === 0 || i === 3) && (j === 0 || j === 3);
            if (l < 4) return corner ? 0 : (l === 3 && i > 0 && i < 3 && j > 0 && j < 3 ? M.dirt : M.terracotta);
            const r = l - 4, centre = i > 0 && i < 3 && j > 0 && j < 3;
            if (k % 3 === 2) return centre && r < 5 ? (r === 4 ? M.leaves2 : M.leaves) : 0;
            if ((r === 1 || r === 2) && !corner) return (k & 1) ? M.leaves2 : M.leaves;
            if ((r === 0 || r === 3) && centre) return M.leaves;
            return 0;
        });
    },

    /** Теплица: бетонный цоколь, тонкий металлический каркас, стекло стен и крыши, дверь-купе. */
    greenhouseShell(F) {
        const X0 = -32, X1 = 32, Z0 = -22, Z1 = 22;
        const postX = lx => (lx - X0) % 8 === 0 || lx === X1 - 1, postZ = lz => (lz - Z0) % 11 === 0 || lz === Z1 - 1;
        const yb = lz => 27 + 21 - (lz < 0 ? -lz - 1 : lz);
        F.box(X0, -1, Z0, X1, 0, Z1, (lx, ly, lz) => (lz >= -5 && lz < 5) ? ((lx + 64) % 8 === 0 ? M.concrete2 : M.concrete) : M.dirt);
        F.box(X0, 0, Z0, X1, 4, Z1, (lx, ly, lz) => Math.min(lx - X0, X1 - 1 - lx, lz - Z0, Z1 - 1 - lz) < 2 ? M.concrete : -1);
        F.box(X0, 4, Z0, X1, 60, Z1, (lx, ly, lz) => {
            const d1 = Math.min(lx - X0, X1 - 1 - lx), d2 = Math.min(lz - Z0, Z1 - 1 - lz);
            if (Math.min(d1, d2) > 0) return -1;
            const longWall = d2 === 0;
            if (longWall && ly > 26) return -1;
            if (!longWall && ly >= yb(lz)) return -1;
            if ((longWall ? postX(lx) : postZ(lz)) || ly === 4 || ly === 15 || ly === 26) return M.metal;
            return M.glass;
        });
        for (let lz = Z0 - 1; lz < Z1 + 1; lz++) {
            const zz = lz < 0 ? -lz - 1 : lz, y = yb(lz);
            for (let lx = X0; lx < X1; lx++) F.put(lx, y, lz, (zz >= 21 || zz === 10 || postX(lx)) ? M.metal : M.glass);
        }
        F.box(X0, 49, -1, X1, 50, 1, M.metal);
        // дверь (восточный торец) и стеклянная створка на рельсе
        F.box(X1 - 2, 0, -5, X1, 23, 5, 0);
        F.box(X1 - 1, 0, -5, X1, 23, -4, M.metal); F.box(X1 - 1, 0, 4, X1, 23, 5, M.metal); F.box(X1 - 1, 22, -5, X1, 23, 5, M.metal);
        F.box(X1, 22, -15, X1 + 1, 23, 5, M.metal);
        F.box(X1, 1, -14, X1 + 1, 22, -5, (lx, ly, lz) => (ly === 1 || ly === 21 || lz === -14 || lz === -6 || ly === 11) ? M.metal : M.glass);
    },

    /** Столы на металлических ножках и горшки на них (тела). */
    greenhouseProps(F) {
        for (const [z0, pz] of [[-19, -17], [10, 12]]) {
            F.box(-28, 0, z0, 26, 9, z0 + 8, (lx, ly, lz) => {
                if (ly === 8) return M.plank;
                const leg = (lx === -28 || lx === 25 || (lx + 28) % 13 === 0) && (lz === z0 || lz === z0 + 7);
                return leg || (ly === 2 && (lz === z0 || lz === z0 + 7)) ? M.metal : -1;
            });
            let k = z0 < 0 ? 0 : 7;
            for (const px of [-26, -17, -8, 1, 10, 19]) this.pot(F, px, 9, pz, k++);
        }
        // мешки с грунтом и лейка у двери
        F.body(20, 0, -3, 26, 3, 2, (lx, ly) => ly === 2 && lx % 3 === 0 ? 0 : M.sand);
        F.body(20, 3, -2, 25, 5, 1, M.sand);
    },
    // ---------- офис ----------

    /** Этаж офиса f (0..2) и крыша (f = 3): плита, колонны, витражи, светильники. */
    officeStorey(F, f) {
        const X0 = -60, X1 = 60, Z0 = -48, Z1 = 48, Y = 28 * f;
        F.box(X0, Y, Z0, X1, Y + 1, Z1, M.concrete);
        const finish = f === 0 ? ((lx, ly, lz) => ((lx + 64) % 10 === 0 || (lz + 64) % 10 === 0) ? M.concrete : M.tile)
            : f === 3 ? M.asphalt : M.concrete2;
        F.box(X0, Y + 1, Z0, X1, Y + 2, Z1, finish);
        if (f > 0) F.box(32, Y, -44, 52, Y + 2, -23, 0);            // проём лестницы
        if (f === 3) {
            F.box(X0, Y + 2, Z0, X1, Y + 6, Z1, (lx, ly, lz) => Math.min(lx - X0, X1 - 1 - lx, lz - Z0, Z1 - 1 - lz) < 2 ? (ly === Y + 5 ? M.metal : M.concrete) : -1);
            return;
        }
        for (const cx of [-56, -28, 0, 28, 56]) for (const cz of [-44, -15, 15, 44]) F.box(cx - 2, Y + 2, cz - 2, cx + 2, Y + 28, cz + 2, M.concrete2);
        F.box(X0, Y + 2, Z0, X1, Y + 28, Z1, (lx, ly, lz) => {
            const d1 = Math.min(lx - X0, X1 - 1 - lx), d2 = Math.min(lz - Z0, Z1 - 1 - lz);
            if (d1 <= 1 && d2 <= 1) return M.concrete;                 // угловые пилоны
            if (Math.min(d1, d2) !== 1) return -1;
            const a = d2 === 1 ? lx : lz, k = ly - Y;
            if (k <= 4) return M.concrete2;                             // глухая панель у перекрытия
            if (k >= 25 || (a + 64) % 10 === 0) return M.metal;
            return M.glass;
        });
        for (const lz of [-30, 0, 30]) for (const x0 of [-50, -20, 8, 38]) {
            if (lz === -30 && x0 === 38) continue;
            F.box(x0, Y + 27, lz, x0 + 12, Y + 28, lz + 1, M.lamp);
        }
    },

    /** Лестничная клетка: стены, двухмаршевые лестницы, двери на этажи, будка выхода на крышу. */
    officeCore(F) {
        const CX0 = 30, CX1 = 54, CZ0 = -46, CZ1 = -12;
        F.box(CX0, 2, CZ0, CX1, 104, CZ1, (lx, ly, lz) => Math.min(lx - CX0, CX1 - 1 - lx, lz - CZ0, CZ1 - 1 - lz) < 2 ? ((ly % 28) === 0 ? M.concrete2 : M.concrete) : -1);
        F.box(CX0, 104, CZ0, CX1, 106, CZ1, M.concrete);
        F.box(CX0 - 1, 106, CZ0 - 1, CX1 + 1, 107, CZ1 + 1, M.metal);
        for (let f = 0; f < 3; f++) {
            const Y = 28 * f;
            F.box(32, Y + 14, -44, 52, Y + 16, -37, M.concrete);
            F.box(41, Y + 2, -37, 43, Y + 28, -23, M.concrete);
            for (let i = 0; i < 7; i++) {
                const ta = Y + 3 + 2 * i, tb = Y + 17 + 2 * i;
                F.box(32, ta - 2, -23 - 2 * (i + 1), 41, ta + 1, -23 - 2 * i, (lx, ly) => ly === ta ? M.concrete2 : M.concrete);
                F.box(43, tb - 2, -37 + 2 * i, 52, tb + 1, -35 + 2 * i, (lx, ly) => ly === tb ? M.concrete2 : M.concrete);
            }
            this.opening(F, 'z', -13, -1, 2, 36, 48, Y + 2, Y + 25, 'door', { mid: 0, frame: M.metal, leaf: f === 1, leafMat: M.blue });
        }
        this.opening(F, 'z', -13, -1, 2, 36, 48, 86, 103, 'door', { mid: 0, frame: M.metal });
    },

    /** Вход: проём, раздвижные стеклянные створки, козырёк, ступени; ресепшн. */
    officeLobby(F) {
        F.box(-9, 2, 46, 9, 25, 47, 0);
        F.box(-9, 2, 46, -8, 25, 47, M.metal); F.box(8, 2, 46, 9, 25, 47, M.metal); F.box(-9, 24, 46, 9, 25, 47, M.metal);
        for (const x0 of [-17, 9]) F.box(x0, 2, 45, x0 + 8, 24, 46, (lx, ly) => (ly === 2 || ly === 23 || lx === x0 || lx === x0 + 7) ? M.metal : M.glass);
        F.box(-18, 28, 48, 18, 30, 58, M.concrete);
        F.box(-18, 30, 57, 18, 31, 58, M.metal);
        F.box(-10, 27, 52, 10, 28, 53, M.lamp);
        F.box(-14, 0, 48, 14, 1, 54, M.concrete); F.box(-14, 1, 48, 14, 2, 51, M.concrete);
        // ресепшн: Г-образная стойка
        F.box(-14, 2, 22, 14, 12, 26, (lx, ly) => ly === 11 ? M.darkwood : (ly === 2 ? M.concrete2 : M.plaster));
        F.box(-14, 2, 14, -10, 12, 22, (lx, ly) => ly === 11 ? M.darkwood : (ly === 2 ? M.concrete2 : M.plaster));
        F.box(4, 12, 23, 9, 15, 24, M.concrete2); F.box(6, 12, 24, 7, 13, 25, M.metal);
        // кресла и растения в холле
        this.chair(F, -40, 2, 34, '+z', M.blue); this.chair(F, -34, 2, 34, '+z', M.blue); this.chair(F, -28, 2, 34, '+z', M.blue);
        this.pot(F, 20, 2, 40, 2); this.pot(F, -24, 2, 40, 1);
        F.body(-40, 2, 26, -24, 6, 31, (lx, ly) => ly === 5 ? M.glass : ((lx === -40 || lx === -25) ? M.metal : 0));
    },

    /** Рабочие этажи: переговорная за стеклом, столы с мониторами, стулья (тела). */
    officeFurniture(F, f) {
        const Y = 28 * f;
        F.box(-59, Y + 2, -24, -31, Y + 28, -23, (lx, ly) => (lx >= -44 && lx < -36 && ly < Y + 24) ? 0 : ((ly === Y + 2 || ly === Y + 27 || (lx + 64) % 8 === 0 || ly === Y + 24) ? M.metal : M.glass));
        F.box(-31, Y + 2, -46, -30, Y + 28, -23, (lx, ly, lz) => (ly === Y + 2 || ly === Y + 27 || (lz + 64) % 8 === 0) ? M.metal : M.glass);
        F.body(-52, Y + 2, -39, -36, Y + 10, -31, (lx, ly, lz) => ly === Y + 9 ? M.plank : ((lx === -51 || lx === -37) && (lz === -38 || lz === -32) ? M.metal : 0));
        this.chair(F, -50, Y + 2, -45, '-z', M.blue); this.chair(F, -42, Y + 2, -45, '-z', M.blue);
        this.chair(F, -50, Y + 2, -30, '+z', M.blue); this.chair(F, -42, Y + 2, -30, '+z', M.blue);
        for (const dx of [-20, 8]) for (const dz of [8, 28]) {
            F.body(dx, Y + 2, dz, dx + 16, Y + 14, dz + 8, (lx, ly, lz) => {
                if (ly === Y + 9) return M.plank;
                if (ly < Y + 9) return ((lx === dx || lx === dx + 15) && (lz === dz || lz === dz + 7)) || (ly === Y + 8 && lz === dz && (lx === dx || lx === dx + 15)) ? M.metal : 0;
                if (lz === dz + 1 && lx >= dx + 5 && lx < dx + 11 && ly > Y + 10) return M.concrete2;
                if (lz === dz + 1 && lx === dx + 8 && ly === Y + 10) return M.metal;
                return 0;
            });
            this.chair(F, dx + 5, Y + 2, dz + 9, '+z', M.blue);
        }
        F.body(50, Y + 2, 30, 56, Y + 20, 36, (lx, ly, lz) => { const k = (ly - Y) % 6; return k === 2 || lx === 50 || lx === 55 ? M.metal : ((k === 3 || k === 4) && F.h(lx, ly - k, lz) < 0.6 ? M.foam : 0); });
    },

    /** Крыша офиса: бак на опорах, два кондиционера на плитах. */
    officeRoof(F) {
        for (const [lx, lz] of [[-46, -28], [-34, -28], [-46, -16], [-34, -16]]) F.box(lx, 86, lz, lx + 2, 92, lz + 2, M.metal);
        F.box(-46, 91, -28, -32, 92, -14, (lx, ly, lz) => (lx === -46 || lx === -33 || lz === -28 || lz === -15) ? M.metal : -1);
        this.cyl(F, -39, -21, 8.5, 92, 104, (lx, ly, lz, ring) => ring ? (((ly - 92) % 4 === 3) ? M.rust : M.metal) : (ly === 92 ? M.metal : 0));
        for (let k = 0; k < 3; k++) this.cyl(F, -39, -21, 8.5 - k * 3, 104 + k, 105 + k, M.metal);
        for (const x0 of [-10, 12]) {
            F.box(x0 - 1, 86, 9, x0 + 17, 88, 23, M.concrete);
            F.box(x0, 88, 10, x0 + 16, 98, 22, (lx, ly, lz) => {
                const side = lx === x0 || lx === x0 + 15 || lz === 10 || lz === 21;
                if (ly === 97) return M.metal;
                return side && (ly % 2 === 0) && ly > 89 ? M.concrete2 : M.metal;
            });
            this.cyl(F, x0 + 8, 16, 4.5, 97, 98, (lx, ly, lz, ring) => ring ? M.metal : ((lx === x0 + 8 || lz === 16) ? M.metal : M.concrete2));
            F.box(x0 + 16, 89, 15, x0 + 22, 91, 17, M.metal);
        }
    },

    // ---------- леса ----------

    /** Строительные леса вдоль локальной x (длина — scale), глубина 12 по +z: трубы, настилы, связи. */
    scaffoldAt(F, L, lifts) {
        const xs = [];
        for (let lx = -L; lx <= L; lx += 20) xs.push(lx);
        const top = lifts * 20;
        for (const lx of xs) for (const lz of [1, 11]) {
            F.box(lx - 1, 0, lz - 1, lx + 2, 1, lz + 2, M.plank);
            F.box(lx, 1, lz, lx + 1, top + 11, lz + 1, M.metal);
        }
        for (let k = 1; k <= lifts; k++) {
            const y = k * 20;
            F.box(-L, y, 1, L + 1, y + 1, 2, M.metal); F.box(-L, y, 11, L + 1, y + 1, 12, M.metal);
            for (const lx of xs) F.box(lx, y, 1, lx + 1, y + 1, 12, M.metal);
            F.box(-L, y + 1, 2, L + 1, y + 2, 11, (lx, ly, lz) => (lx >= -L + 3 && lx < -L + 8 && lz >= 4 && lz < 8) ? 0 : ((lx + 64) % 24 === 0 ? M.wood : M.plank));
            F.box(-L, y + 6, 11, L + 1, y + 7, 12, M.metal); F.box(-L, y + 11, 11, L + 1, y + 12, 12, M.metal);
            F.box(-L, y + 2, 11, L + 1, y + 3, 12, M.plank);
        }
        F.box(-L, 1, 11, L + 1, 2, 12, M.metal);
        // диагональные связи по наружной плоскости
        for (let i = 0; i + 1 < xs.length; i++) for (let k = 0; k < lifts; k++) {
            const x0 = xs[i], y0 = k * 20 + 1, up = (i + k) % 2 === 0;
            for (let s = 0; s < 19; s++) {
                const yy = y0 + s, xx = up ? x0 + 1 + s : x0 + 19 - s;
                F.put(xx, yy, 12, M.metal); F.put(up ? xx + 1 : xx - 1, yy, 12, M.metal);
            }
        }
        // лестница в проёмах настилов
        F.box(-L + 4, 0, 6, -L + 5, top + 2, 7, M.metal); F.box(-L + 7, 0, 6, -L + 8, top + 2, 7, M.metal);
        for (let ly = 4; ly < top; ly += 4) F.box(-L + 5, ly, 6, -L + 7, ly + 1, 7, M.metal);
    },
    /** Стержень из вокселей от (x0,y0,z0) до (x1,y1,z1), связный по граням (шаг по одной оси). */
    rod(F, x0, y0, z0, x1, y1, z1, v) {
        let x = Math.round(x0), y = Math.round(y0), z = Math.round(z0);
        const X = Math.round(x1), Y = Math.round(y1), Z = Math.round(z1);
        const n = Math.abs(X - x) + Math.abs(Y - y) + Math.abs(Z - z);
        const ax = x, ay = y, az = z, dx = X - x, dy = Y - y, dz = Z - z;
        F.put(x, y, z, v);
        for (let i = 0; i < n; i++) {
            // ось, которая сильнее всех отстаёт от прямой
            const fx = dx ? (x - ax) / dx : 1, fy = dy ? (y - ay) / dy : 1, fz = dz ? (z - az) / dz : 1;
            if (fx <= fy && fx <= fz && x !== X) x += Math.sign(dx);
            else if (fy <= fz && y !== Y) y += Math.sign(dy);
            else if (z !== Z) z += Math.sign(dz);
            else if (x !== X) x += Math.sign(dx);
            else y += Math.sign(dy);
            F.put(x, y, z, v);
        }
    },

    // ---------- канава и мост ----------

    /** Глубина канавы в столбце (вокселей), полудлина L, полуширина 20 по верху и 8 по дну. */
    ditchDepth(lx, lz, L) {
        const e = Math.abs(lx + 0.5);
        if (e >= L) return 0;
        const u = Math.abs(lz + 0.5 - 3 * Math.sin(lx / 23));
        const base = u <= 8 ? 16 : u < 20 ? 16 * (20 - u) / 12 : 0;
        const taper = e > L - 24 ? Math.sqrt((L - e) / 24) : 1;
        return Math.round(base * taper);
    },

    /** Деревянный мост поперёк канавы: устои, бетонные опоры с ригелями, прогоны, настил, перила. */
    bridgeAt(F) {
        F.box(-11, -4, -32, 11, 0, -20, M.concrete); F.box(-11, -4, 20, 11, 0, 32, M.concrete);
        F.box(-12, -1, -36, 12, 0, -32, M.concrete2); F.box(-12, -1, 32, 12, 0, 36, M.concrete2);
        for (const pz of [-10, 8]) {
            for (const px of [-9, 7]) F.box(px, -18, pz, px + 3, -2, pz + 3, (lx, ly) => ly < -15 ? M.concrete2 : M.concrete);
            F.box(-11, -2, pz - 1, 11, 0, pz + 4, M.concrete);
        }
        for (const sx of [-9, -1, 7]) F.box(sx, 0, -32, sx + 2, 2, 32, M.darkwood);
        F.box(-10, 2, -32, 10, 3, 32, (lx, ly, lz) => ((lz + 64) % 3 === 0 ? M.wood : M.plank));
        for (const rx of [-10, 9]) {
            for (let lz = -32; lz < 32; lz++) { F.put(rx, 11, lz, M.darkwood); F.put(rx, 7, lz, M.wood); }
            for (let lz = -32; lz < 32; lz += 6) F.box(rx, 3, lz, rx + 1, 11, lz + 1, M.darkwood);
            F.box(rx, 3, 31, rx + 1, 11, 32, M.darkwood);
        }
    },

    // ---------- водонапорная башня ----------

    /** Вынос ноги башни на высоте ly (ноги сходятся к баку). */
    towerOff(ly) { return 15 - Math.round(4 * Math.max(0, ly - 2) / 48); },

    waterTowerAt(F) {
        const off = ly => this.towerOff(ly);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const o = off(0);
            F.box(sx * o - 3, -1, sz * o - 3, sx * o + 3, 2, sz * o + 3, M.concrete);
            for (let ly = 2; ly < 52; ly++) { const q = off(ly); F.box(sx * q - 1, ly, sz * q - 1, sx * q + 1, ly + 1, sz * q + 1, M.metal); }
        }
        // распорки и крестовые связи по четырём граням
        for (const y of [18, 34]) {
            const q = off(y);
            for (let a = -q; a <= q; a++) { F.put(a, y, -q, M.metal); F.put(a, y, q - 1, M.metal); F.put(-q, y, a, M.metal); F.put(q - 1, y, a, M.metal); }
        }
        for (const [ya, yb] of [[3, 18], [18, 34], [34, 50]]) {
            const qa = off(ya), qb = off(yb);
            for (const s of [-1, 1]) {
                const za = s < 0 ? -qa : qa - 1, zb = s < 0 ? -qb : qb - 1;
                this.rod(F, -qa, ya, za, qb - 1, yb, zb, M.metal); this.rod(F, qa - 1, ya, za, -qb, yb, zb, M.metal);
                this.rod(F, za, ya, -qa, zb, yb, qb - 1, M.metal); this.rod(F, za, ya, qa - 1, zb, yb, -qb, M.metal);
            }
        }
        // площадка: балки, настил, перила
        F.box(-19, 50, -12, 19, 52, -10, M.darkwood); F.box(-19, 50, 9, 19, 52, 11, M.darkwood);
        F.box(-12, 50, -19, -10, 52, 19, M.darkwood); F.box(9, 50, -19, 11, 52, 19, M.darkwood);
        F.box(-19, 52, -19, 19, 53, 19, (lx, ly, lz) => ((lx + 64) % 4 === 0 ? M.wood : M.plank));
        F.box(-19, 53, -19, 19, 61, 19, (lx, ly, lz) => {
            const edge = lx === -19 || lx === 18 || lz === -19 || lz === 18;
            if (!edge || (lz === 18 && lx >= -3 && lx < 2)) return -1;
            return (ly === 60 || ly === 56 || ((lx + lz + 64) % 6 === 0)) ? M.metal : -1;
        });
        // бак: клёпка из досок, обручи, днище; коническая крыша, шпиль
        this.cyl(F, 0, 0, 12, 53, 78, (lx, ly, lz, ring) => {
            if (ly === 53) return M.plank;
            const r = Math.hypot(lx + 0.5, lz + 0.5);
            if (r < 10) return 0;
            return (Math.floor(Math.atan2(lz + 0.5, lx + 0.5) * 13) & 1) ? M.wood : M.plank;
        });
        for (const y of [56, 62, 68, 74]) this.cyl(F, 0, 0, 13, y, y + 1, (lx, ly, lz) => Math.hypot(lx + 0.5, lz + 0.5) > 11.6 ? M.metal : -1);
        for (let k = 0; k < 13; k++) this.cyl(F, 0, 0, 13.5 - k, 78 + k, 79 + k, k % 3 === 2 ? M.roof2 : M.roof);
        F.box(0, 91, 0, 1, 95, 1, M.metal);
        // лестница (+z) и сливная труба из днища
        F.box(-3, -1, 19, 2, 0, 22, M.concrete);
        F.box(-3, 0, 19, -2, 60, 20, M.metal); F.box(1, 0, 19, 2, 60, 20, M.metal);
        for (let ly = 3; ly < 60; ly += 4) F.box(-2, ly, 19, 1, ly + 1, 20, M.metal);
        F.box(0, 12, 0, 1, 53, 1, M.metal); F.box(-1, 12, 0, 2, 13, 1, M.rust);
    },
    builders: {
        /** Кирпичный дом в два этажа: комнаты, лестница, камин, мебель, двускатная крыша с трубой. */
        house(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            this.houseShell(F);
            this.houseOpenings(F);
            this.houseInterior(F);
            this.houseRoof(F);
            this.houseFurniture(F);
        },
        /** Деревянный сарай: каркас из бруса, обшивка досками, сеновал, ворота, тюки и ящики. */
        barn(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            this.barnShell(F);
            this.barnInterior(F);
            this.barnProps(F);
        },
        /** Теплица: металл + стекло, столы, горшки. */
        greenhouse(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            this.greenhouseShell(F);
            this.greenhouseProps(F);
        },
        /** Бетонный офис в 3 этажа: колонны, плиты, витражи, лестничная клетка, бак и кондиционеры на крыше. */
        office(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            for (let f = 0; f <= 3; f++) this.officeStorey(F, f);
            this.officeCore(F);
            this.officeLobby(F);
            this.officeFurniture(F, 1);
            this.officeFurniture(F, 2);
            this.officeRoof(F);
        },
        /** Строительные леса: трубы, настилы, ограждения, диагональные связи, лестница; scale[0] — полудлина (м). */
        scaffold(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const L = Math.round(this.span(mk)[0] / 20) * 20;
            this.scaffoldAt(F, L, 4);
            this.crate(F, -L + 12, 82, 3, 6);
            F.body(-L + 24, 82, 3, -L + 54, 83, 6, M.plank);
            this.crate(F, 4, 42, 4, 5);
        },
        /** Канава в грунте (полудлина — scale[0]) с деревянным мостом на бетонных опорах посередине. */
        ditch(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const L = this.span(mk)[0];
            for (let lz = -22; lz < 22; lz++) for (let lx = -L; lx < L; lx++) {
                const d = this.ditchDepth(lx, lz, L);
                if (!d) continue;
                F.box(lx, -d, lz, lx + 1, 0, lz + 1, 0);
                const h = F.h(lx, 0, lz), top = -d - 1;
                F.put(lx, top, lz, d >= 14 ? (h < 0.25 ? M.sand : h < 0.33 ? M.rock : M.dirt) : d <= 2 ? M.grass : (h < 0.12 ? M.rock : M.dirt));
                if (d >= 11 && d <= 15 && h > 0.95) F.box(lx, top + 1, lz, lx + 1, top + 4 + ((h * 1000) | 0) % 4, lz + 1, M.leaves2);
            }
            this.bridgeAt(F);
        },
        /** Водонапорная башня: деревянный бак на 4 тонких металлических ногах с крестовыми связями. */
        watertower(w, x, z, rot) {
            this.waterTowerAt(this.frame(w, x, z, rot));
        },
        /** Лиственное дерево: ствол с комлем, корни, 4–5 ветвей, кроны-облака листвы (вид — от места маркера). */
        tree(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            const s = this.hash(x, 3, z), H = 34 + Math.round(s * 14);
            const leaf = (lx, ly, lz) => {
                const c = this.hash(lx >> 1, ly >> 1, (lz >> 1) + 77);
                return c < 0.3 ? M.leaves2 : M.leaves;
            };
            // крона сначала — ствол и ветви поверх (видны в просветах)
            const tips = [];
            const nb = 4 + (s > 0.5 ? 1 : 0);
            for (let i = 0; i < nb; i++) {
                const a = s * 6.283 + i * 2.4, y0 = Math.round(H * (0.5 + 0.35 * i / nb)), len = 10 + ((i * 7 + Math.round(s * 10)) % 6);
                tips.push([Math.round(Math.cos(a) * len), y0 + 6 + (i % 3) * 2, Math.round(Math.sin(a) * len), y0]);
            }
            for (const [tx, ty, tz] of tips) this.blob(F, tx, ty + 2, tz, 7 + ((tx + tz + 64) % 3), leaf, 0.3);
            this.blob(F, 0, H + 4, 0, 10 + Math.round(s * 2), leaf, 0.3);
            for (let ly = 0; ly < H + 2; ly++) {
                const r = (ly < 3 ? 3.4 - ly * 0.4 : 2.4) - 1.0 * ly / H;
                this.cyl(F, 0, 0, r, ly, ly + 1, (lx, yy, lz) => F.h(lx, yy >> 2, lz) < 0.2 ? M.wood : M.darkwood);
            }
            for (let i = 0; i < 4; i++) {
                const a = s * 3 + i * 1.57;
                this.rod(F, 0, 0, 0, Math.round(Math.cos(a) * 5), 0, Math.round(Math.sin(a) * 5), M.darkwood);
            }
            for (const [tx, ty, tz, y0] of tips) {
                this.rod(F, 0, y0, 0, tx, ty, tz, M.darkwood);
                this.rod(F, 0, y0 + 1, 0, tx, ty + 1, tz, M.darkwood);
            }
            this.prune(w, x - 34, 2, z - 34, x + 35, this.GROUND + H + 20, z + 35, [M.leaves, M.leaves2]);
        },
        /** Ель: тонкий ствол и ярусы конусов тёмной хвои. */
        pine(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            const s = this.hash(x, 5, z), H = 56 + Math.round(s * 12);
            for (let t = 0; t < 4; t++) {
                const y0 = 10 + t * Math.round((H - 14) / 4), R = 14 - t * 3 + s * 2, h = 16 - t;
                for (let k = 0; k < h; k++) this.cyl(F, 0, 0, Math.max(1, R * (1 - k / h)), y0 + k, y0 + k + 1,
                    (lx, ly, lz) => this.hash(lx, ly, lz + 31) < 0.12 ? M.leaves2 : M.leaves);
            }
            this.cyl(F, 0, 0, 1.6, 0, H, M.darkwood);
            this.cyl(F, 0, 0, 2.4, 0, 2, M.darkwood);
        },
        /** Живая изгородь вдоль локальной x (полудлина — scale[0]) с неровным верхом. */
        hedge(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const L = this.span(mk)[0];
            for (let lx = -L; lx < L; lx++) for (let lz = -4; lz < 4; lz++) {
                const n = this.vnoise(F.wx(lx, lz), F.wz(lx, lz), 6);
                const edge = (lz === -4 || lz === 3) ? 2 : 0, end = Math.max(0, 3 - Math.min(lx + L, L - 1 - lx));
                const h = 10 + Math.round(n * 4) - edge - end;
                F.box(lx, 0, lz, lx + 1, h, lz + 1, (a, ly, b) => this.hash(a, ly, b + 5) < 0.18 ? M.leaves2 : M.leaves);
            }
        },
        /** Группа валунов, частично утопленных в землю. */
        rocks(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            const s = this.hash(x, 9, z);
            const stone = (lx, ly, lz) => this.hash(lx >> 1, ly >> 1, lz >> 1) < 0.15 ? M.concrete2 : M.rock;
            this.blob(F, 0, 1, 0, 6 + s * 2, stone, 0.25);
            this.blob(F, 8, 0, 3, 3.5, stone, 0.3);
            this.blob(F, -6, -1, 6, 3, stone, 0.3);
            if (s > 0.4) this.blob(F, 3, 0, -8, 2.6, stone, 0.3);
            this.prune(w, x - 14, this.GROUND - 8, z - 14, x + 15, this.GROUND + 12, z + 15, [M.rock]);
        },
        // ---------- испытательный двор (тела) ----------

        /** Пирамида ящиков 4-3-2-1 (10 тел по 6³) и два ящика рядом. */
        crates(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            for (let r = 0; r < 4; r++) for (let i = 0; i < 4 - r; i++) this.crate(F, -15 + 4 * r + 8 * i, 6 * r, -3, 6);
            this.crate(F, 20, 0, -2, 5); this.crate(F, 21, 5, -1, 4);
        },
        /** Ряд из 16 доминошек 2 × 12 × 8 с шагом 6 вдоль локальной x (падают в +x). */
        dominoes(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            for (let i = 0; i < 16; i++) {
                const x0 = -46 + 6 * i;
                F.body(x0, 0, -4, x0 + 2, 12, 4, (lx, ly) => ly >= 10 ? M.plaster : M.blue);
            }
        },
        /** Башня из 7 бетонных блоков 8×6×8 и стенка из блоков 8×5×4 рядом. */
        blocktower(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            const shift = [0, 1, 0, -1, 0, 1, 0];
            for (let k = 0; k < 7; k++) {
                const o = shift[k];
                F.body(-4 + o, 6 * k, -4, 4 + o, 6 * k + 6, 4, (lx, ly, lz) => (ly === 6 * k + 5 && (lx + lz) % 3 === 0) ? M.concrete2 : (k & 1 ? M.concrete2 : M.concrete));
            }
            for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
                const x0 = 10 + 4 * row + 8 * i;
                F.body(x0, row * 5, -2, x0 + 8, row * 5 + 5, 2, (lx, ly, lz) => ((lx + ly) % 7 === 0) ? M.concrete2 : M.concrete);
            }
        },
        /** Качели: бетонная опора-клин, доска 50 вокселей, ящик на опёртом конце A, свободный конец B. */
        seesaw(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            for (let k = 0; k < 5; k++) F.box(-5 + k, k, -5, 5 - k, k + 1, 5, k === 4 ? M.metal : M.concrete);
            F.box(-25, 0, -4, -19, 5, 4, (lx, ly) => ly === 4 ? M.hazard : M.concrete2);
            F.body(-25, 5, -4, 25, 7, 4, (lx, ly, lz) => (lx === -25 || lx === 24 || (lx + 64) % 10 === 0) ? M.darkwood : M.plank);
            this.crate(F, -25, 7, -3, 6);
            this.hayBale(F, 14, 0, -12, false);
        },
        /** Поддон с кирпичами (2 слоя перевязкой) и россыпь кирпичей рядом — каждый кирпич отдельное тело. */
        bricks(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            F.body(-6, 0, -5, 6, 2, 5, (lx, ly, lz) => ly === 0 ? ((lz === -5 || lz === -1 || lz === 0 || lz === 4) ? M.darkwood : 0) : ((lz + 64) % 3 === 2 ? M.wood : M.plank));
            const brick = (x0, y0, z0, sx, sz) => F.body(x0, y0, z0, x0 + sx, y0 + 2, z0 + sz, (lx, ly, lz) => this.hash(x0 + 5, y0, z0 + 9) < 0.3 ? M.brick2 : M.brick);
            for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) brick(-6 + 4 * i, 2, -5 + 2 * j, 4, 2);
            for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) brick(-6 + 2 * i, 4, -5 + 4 * j, 2, 4);
            for (let i = 0; i < 3; i++) brick(-6 + 4 * i, 6, -1, 4, 2);
            for (const [bx, bz, a] of [[9, -4, 0], [10, 1, 1], [14, -2, 0], [8, 6, 1], [-11, 3, 0], [-12, -3, 1]]) brick(bx, 0, bz, a ? 2 : 4, a ? 4 : 2);
        },
        /** Взрывные бочки: 2 × 3 стоя, одна сверху, одна лёжа (каждая — тело). */
        barrels(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) this.barrel(F, -10 + 7 * i, 0, -7 + 7 * j);
            this.barrel(F, -3, 9, -7);
            // лежачая бочка вдоль x
            F.body(-10, 0, 9, -1, 6, 15, (lx, ly, lz) => {
                const dy = ly + 0.5 - 3, dz = lz + 0.5 - 12, q = dy * dy + dz * dz;
                if (q > 10.24) return 0;
                const k = lx + 10, ring = q > 4.8;
                if (k === 0 || k === 8) return ring ? M.metal : M.barrel;
                return ((k === 2 || k === 6) && ring) ? M.metal : M.barrel;
            });
        },
        /** Статичная бетонная рампа (подъём 1:3) с площадкой, ящики и блок наверху, лесенка сзади. */
        ramp(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            F.box(-30, 0, -10, 22, 13, 10, (lx, ly, lz) => {
                const top = lx < 6 ? Math.floor((lx + 30) / 3) : 12;
                if (ly > top) return -1;
                if (ly === top && (lz === -10 || lz === 9)) return ((lx + 64) % 4 < 2) ? M.hazard : M.concrete2;
                return ly === top && (lx + 64) % 9 === 0 ? M.concrete2 : M.concrete;
            });
            for (let k = 0; k < 6; k++) F.box(22 + 2 * k, 0, -6, 24 + 2 * k, 12 - 2 * k, 6, M.concrete2);
            for (const lz of [-10, 9]) for (let lx = 6; lx < 22; lx += 5) F.box(lx, 13, lz, lx + 1, 21, lz + 1, M.metal);
            for (const lz of [-10, 9]) F.box(6, 21, lz, 22, 22, lz + 1, M.metal);
            this.crate(F, 7, 13, -8, 6); this.crate(F, 7, 13, 2, 6); this.crate(F, 7, 19, -8, 6);
            this.crate(F, 15, 13, -8, 6);
            F.body(14, 13, 1, 20, 18, 7, (lx, ly, lz) => (lx + ly + lz) % 5 === 0 ? M.concrete2 : M.concrete);
        },
        /** Пригорок с площадкой и склоном в +x, круглый валун на площадке, клин-упор перед ним. */
        boulder(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            for (let lz = -18; lz < 18; lz++) for (let lx = -34; lx < 32; lx++) {
                const H = lx < -2 ? 12 : 12 * (1 - (lx + 2) / 32);
                let h = Math.min(H, (lx + 34) * 0.9, (18 - Math.abs(lz + 0.5)) * 1.3);
                if (h <= 0) continue;
                const flat = lx > -20 && lx < 0 && Math.abs(lz) < 9;
                if (!flat) h += (this.vnoise(F.wx(lx, lz), F.wz(lx, lz), 5) - 0.5) * 2;
                const hi = Math.round(h);
                if (hi <= 0) continue;
                F.box(lx, -1, lz, lx + 1, hi, lz + 1, (a, ly) => ly === hi - 1 ? (F.h(a, 1, lz) < 0.3 ? M.grass2 : M.grass) : M.dirt);
            }
            const stone = (lx, ly, lz) => this.hash(lx >> 1, ly >> 1, lz >> 1) < 0.12 ? M.concrete2 : M.rock;
            this.blob(F, -11, 17.5, 0, 5.5, stone, 0);
            F.dyn(-17, 12, -6, -5, 24, 6);
            F.body(-4, 12, -3, -1, 15, 3, (lx, ly) => (ly === 14 && lx === -2) ? 0 : M.wood);
            this.blob(F, 16, 4, -11, 2.2, stone, 0.2);
        },
        // ---------- обстановка ----------

        /** Асфальтовая дорога вдоль локальной x (scale[0] — полудлина, scale[2] — полуширина, м): разметка, бордюр, люк. */
        road(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const [L, W] = this.span(mk);
            F.box(-L, -2, -W, L, 0, W, (lx, ly, lz) => {
                if (lz === -W || lz === W - 1) return ly === -1 ? M.concrete2 : M.dirt;
                if (ly === -2) return M.asphalt;
                if ((lz === -1 || lz === 0) && ((lx + L) % 30) < 15 && Math.abs(lx) < L - 4) return M.paint;
                if ((lz === -W + 2 || lz === W - 3) && Math.abs(lx) < L - 2) return M.paint;
                return M.asphalt;
            });
            this.cyl(F, 0, Math.round(W / 2), 3, -1, 0, (lx, ly, lz, ring) => ring ? M.concrete2 : M.metal);
        },
        /** Грунтовая тропа (полудлина и полуширина из scale) с рваными краями и гравием. */
        path(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const [L, W] = this.span(mk, 1, 0.8);
            F.box(-L, -1, -W, L, 0, W, (lx, ly, lz) => {
                const h = F.h(lx, 4, lz), e = Math.min(lz + W, W - 1 - lz, lx + L, L - 1 - lx);
                if (e < 2 && h < 0.5) return -1;
                return h < 0.07 ? M.sand : (h > 0.975 ? M.rock : M.dirt);
            });
        },
        /** Площадь из бетонных плит со швами (полуразмеры из scale). */
        plaza(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const [L, W] = this.span(mk);
            F.box(-L, -1, -W, L, 0, W, (lx, ly, lz) => ((lx + L) % 10 === 0 || (lz + W) % 10 === 0) ? M.concrete2 : (F.h(lx >> 1, 0, lz >> 1) < 0.08 ? M.concrete2 : M.concrete));
        },
        /** Жердевой забор вдоль локальной x: столбы 2×2 через 2 м, две жерди. */
        fence(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const L = this.span(mk)[0];
            for (let lx = -L; lx < L; lx += 20) F.box(lx, 0, -1, lx + 2, 13, 1, M.darkwood);
            F.box(L - 2, 0, -1, L, 13, 1, M.darkwood);
            F.box(-L, 4, 0, L, 6, 1, M.plank); F.box(-L, 9, 0, L, 11, 1, (lx) => (lx + 64) % 7 === 0 ? M.wood : M.plank);
        },
        /** Штакетник вдоль локальной x: светлые планки с зазором, две поперечины сзади. */
        picket(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const L = this.span(mk)[0];
            for (let lx = -L; lx < L; lx += 2) F.box(lx, 0, 0, lx + 1, (lx & 2) ? 10 : 11, 1, M.plaster);
            F.box(-L, 3, -1, L, 4, 0, M.wood); F.box(-L, 8, -1, L, 9, 0, M.wood);
            for (let lx = -L; lx < L; lx += 24) F.box(lx, 0, -2, lx + 2, 11, 0, M.wood);
        },
        /** Фонарный столб: бетонный стакан, металлическая труба, вынос по +x, светящийся плафон. */
        lamp(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            F.box(-2, -1, -2, 2, 2, 2, M.concrete);
            F.box(-1, 2, -1, 1, 50, 1, M.metal);
            F.box(-1, 47, -1, 11, 49, 1, M.metal);
            F.box(8, 45, -2, 14, 47, 2, M.metal);
            F.box(9, 44, -1, 13, 45, 1, M.lamp);
            F.box(-2, 10, -2, 2, 11, 2, M.hazard);
        },
        /** Ряд бетонных отбойников (тела) вдоль локальной x: профиль 6/4 вокселя, длина 20, зазор 1. */
        barriers(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const L = this.span(mk)[0], n = Math.max(1, Math.floor((2 * L + 1) / 21));
            for (let i = 0; i < n; i++) {
                const x0 = -Math.floor((n * 21 - 1) / 2) + i * 21;
                F.body(x0, 0, -3, x0 + 20, 8, 3, (lx, ly, lz) => {
                    if (ly >= 3 && (lz < -2 || lz > 1)) return 0;
                    if (ly === 6 && (lx - x0) % 10 < 5) return M.paint;
                    return M.concrete;
                });
            }
        },
        /** Песочница: рамка из досок, яма с песком, горка, мяч (тело) и ведёрко (тело). */
        sandpit(w, x, z, rot, mk) {
            const F = this.frame(w, x, z, rot);
            const [L] = this.span(mk, 2.5);
            F.box(-L, -6, -L, L, 0, L, M.sand);
            F.box(-L, -1, -L, L, 2, L, (lx, ly, lz) => Math.min(lx + L, L - 1 - lx, lz + L, L - 1 - lz) < 2 ? (ly === 1 ? M.darkwood : M.plank) : (ly === -1 ? M.sand : -1));
            for (let lz = -L + 2; lz < L - 2; lz++) for (let lx = -L + 2; lx < L - 2; lx++) {
                const d = Math.hypot(lx + 4, lz - 3), hh = Math.max(0, Math.round(4 - d / 3));
                if (hh > 0) F.box(lx, 0, lz, lx + 1, hh, lz + 1, M.sand);
            }
            this.blob(F, 10, 3, -10, 3, (lx, ly, lz) => ((lx + ly + 64) % 4 < 2) ? M.blue : M.foam, 0);
            F.dyn(6, 0, -14, 14, 7, -6);
            F.body(-18, 0, -16, -14, 4, -12, (lx, ly, lz) => (ly > 0 && lx > -18 && lx < -15 && lz > -16 && lz < -13) ? 0 : M.blue);
        },
        /** Контейнер на прицепе-площадке: шасси, колёса, опоры; гофрированные стенки, двери (одна открыта), груз. */
        trailer(w, x, z, rot) {
            const F = this.frame(w, x, z, rot);
            // шасси, оси, колёса, опорные ноги
            for (const sz of [-9, 7]) F.box(-34, 6, sz, 32, 9, sz + 2, M.metal);
            for (let lx = -32; lx < 32; lx += 8) F.box(lx, 7, -9, lx + 1, 9, 9, M.metal);
            for (const ax of [-27, -17]) {
                F.box(ax, 4, -13, ax + 1, 5, 13, M.metal);
                F.box(ax, 5, -9, ax + 1, 6, 9, M.metal);
                for (const [z0, z1] of [[-13, -10], [10, 13]]) for (let lz = z0; lz < z1; lz++)
                    for (let ly = 0; ly < 9; ly++) for (let lx = ax - 4; lx <= ax + 4; lx++) {
                        const q = (lx + 0.5 - ax - 0.5) ** 2 + (ly + 0.5 - 4.5) ** 2;
                        if (q > 18.5) continue;
                        F.put(lx, ly, lz, q < 3.5 ? M.metal : M.rubber);
                    }
            }
            for (const sz of [-8, 6]) { F.box(20, 0, sz, 22, 6, sz + 2, M.metal); F.box(19, 0, sz - 1, 23, 1, sz + 3, M.metal); }
            F.box(28, 9, -4, 34, 10, 4, M.rust);
            // контейнер 60 × 26 × 24
            const X0 = -32, X1 = 28, Z0 = -12, Z1 = 12, Y0 = 9, Y1 = 35;
            F.box(X0, Y0, Z0, X1, Y1, Z1, (lx, ly, lz) => {
                const ex = lx === X0 || lx === X1 - 1, ey = ly === Y0 || ly === Y1 - 1, ez = lz === Z0 || lz === Z1 - 1;
                if (!ex && !ey && !ez) return ly === Y0 + 1 ? M.plank : -1;
                if ((ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0) >= 2) return M.rust;
                return M.steelg;
            });
            for (let lx = X0 + 2; lx < X1 - 2; lx++) if ((lx + 64) % 4 < 2) for (const lz of [Z0 - 1, Z1]) F.box(lx, Y0 + 2, lz, lx + 1, Y1 - 2, lz + 1, M.steelg);
            // торец с дверями (−x): левая створка закрыта (запорные штанги), правая открыта на 90°
            F.box(X0, Y0 + 2, 0, X0 + 1, Y1 - 2, Z1 - 1, 0);
            for (const bz of [-8, -4]) { F.box(X0 - 1, Y0 + 2, bz, X0, Y1 - 2, bz + 1, M.metal); F.put(X0 - 2, Y0 + 12, bz, M.metal); }
            F.box(X0 - 12, Y0 + 2, Z1 - 1, X0, Y1 - 2, Z1, (lx, ly) => (lx === X0 - 12 || ly === Y0 + 2 || ly === Y1 - 3) ? M.rust : M.steelg);
            for (const bz of [Z1]) F.box(X0 - 8, Y0 + 2, bz, X0 - 7, Y1 - 2, bz + 1, M.metal);
            // груз внутри
            this.crate(F, X0 + 3, Y0 + 2, Z0 + 2, 6); this.crate(F, X0 + 3, Y0 + 8, Z0 + 2, 6); this.crate(F, X0 + 10, Y0 + 2, Z0 + 2, 6);
            this.barrel(F, X0 + 4, Y0 + 2, 2);
            this.crate(F, X0 + 20, Y0 + 2, -5, 8);
        },
    }, // builders
};
