// GameMapsA.js — набор карт A Rubble Lab: «Ферма» (farm), «Пригород» (suburb), «Заправка» (gas-station).
// Строители маркеров (имена с префиксом id карты) дописываются в GameMapBuild.builders.
// Маркер — ЦЕНТР постройки; rot[1] маркера — куда смотрит её перед (фасад, ворота, нос машины):
// 0 — восток, 90 — юг, 180 — запад, −90 — север. Протяжённые маркеры (забор) берут полуразмеры из
// scale: локальная x — scale[0]·10 вокселей, z — scale[2]·10. Первый маркер карты — <id>-terrain
// (земля: дороги, поле, площадки, холмы по краям). Внутри строителя — система PackAKit: перед —
// локальная −z, ly — слой от верха земли (GameMapBuild.GROUND, 0 — первый над травой). Мебель,
// бочки, тюки и машины отмечаются dyn: после загрузки каждый кусок станет спящим твёрдым телом.

/** @typedef {number | ((lx: number, ly: number, lz: number, q?: number) => number)} PackAMat */

/** Повороты четвертями: [a, b, c, d] — мир dx = a·lx + b·lz, dz = c·lx + d·lz (как GameMapBuild.rput). */
const PACKA_R = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0]];
const PACKA_NONE = -1;

/** Локальная система постройки: начало, подъём и поворот; всё — в вокселях. */
class PackAKit {
    /**
     * @param {VoxWorld} w @param {number} ox @param {number} oy @param {number} oz
     * @param {number} a @param {number} b @param {number} c @param {number} d
     */
    constructor(w, ox, oy, oz, a, b, c, d) {
        this.w = w; this.ox = ox; this.oy = oy; this.oz = oz;
        this.a = a; this.b = b; this.c = c; this.d = d;
    }
    /** Система маркера: (x, z) — центр, rot — четверти курса; перед (−z) смотрит по курсу маркера. */
    static at(w, x, z, rot) {
        const R = PACKA_R[(rot + 1) & 3];
        return new PackAKit(w, x, GameMapBuild.GROUND, z, R[0], R[1], R[2], R[3]);
    }
    /** Мировая система: (lx, lz) — воксели карты, ly — от верха земли. */
    static world(w) { return new PackAKit(w, 0, GameMapBuild.GROUND, 0, 1, 0, 0, 1); }
    /** Вложенная система в (lx, ly, lz) с поворотом r: перед вещи смотрит 0 — −z, 1 — +x, 2 — +z, 3 — −x. */
    sub(lx, lz, r = 0, ly = 0) {
        const R = PACKA_R[r & 3];
        return new PackAKit(this.w, this.wx(lx, lz), this.oy + ly, this.wz(lx, lz),
            this.a * R[0] + this.b * R[2], this.a * R[1] + this.b * R[3],
            this.c * R[0] + this.d * R[2], this.c * R[1] + this.d * R[3]);
    }
    wx(lx, lz) { return this.ox + this.a * lx + this.b * lz; }
    wz(lx, lz) { return this.oz + this.c * lx + this.d * lz; }
    /** Поставить воксель (m < 0 — не трогать, 0 — воздух). */
    p(lx, ly, lz, m) { if (m >= 0) this.w.put(this.ox + this.a * lx + this.b * lz, this.oy + ly, this.oz + this.c * lx + this.d * lz, m); }
    g(lx, ly, lz) { return this.w.get(this.ox + this.a * lx + this.b * lz, this.oy + ly, this.oz + this.c * lx + this.d * lz); }
    /** Хэш мировой клетки (не зависит от поворота постройки) -> [0, 1). */
    h(lx, ly, lz) { return PackA.hash(this.wx(lx, lz), this.oy + ly, this.wz(lx, lz)); }

    /** Ящик [x0,x1)×[y0,y1)×[z0,z1): число — быстрый fill, функция (lx, ly, lz) -> материал. @param {PackAMat} m */
    box(x0, y0, z0, x1, y1, z1, m) {
        if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
        const f = typeof m === 'function' ? m : null;
        if (!f) {
            const v = /** @type {number} */ (m);
            if (v < 0) return;
            const ax = this.wx(x0, z0), az = this.wz(x0, z0), bx = this.wx(x1 - 1, z1 - 1), bz = this.wz(x1 - 1, z1 - 1);
            this.w.fill(Math.min(ax, bx), this.oy + y0, Math.min(az, bz), Math.max(ax, bx) + 1, this.oy + y1, Math.max(az, bz) + 1, v);
            return;
        }
        for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
            const v = f(x, y, z);
            if (v >= 0) this.p(x, y, z, v);
        }
    }
    /** Отметить ящик как динамический (все связные куски внутри станут телами). */
    dyn(x0, y0, z0, x1, y1, z1) {
        const ax = this.wx(x0, z0), az = this.wz(x0, z0), bx = this.wx(x1 - 1, z1 - 1), bz = this.wz(x1 - 1, z1 - 1);
        GameMapBuild.dynamic.push([Math.min(ax, bx), this.oy + y0, Math.min(az, bz), Math.max(ax, bx) + 1, this.oy + y1, Math.max(az, bz) + 1]);
    }
    /** @param {PackAMat} m */
    body(x0, y0, z0, x1, y1, z1, m) { this.box(x0, y0, z0, x1, y1, z1, m); this.dyn(x0, y0, z0, x1, y1, z1); }

    /**
     * Цилиндр вдоль оси axis: центр круга (c1, c2) — для 'y' это (lx, lz), для 'x' — (ly, lz), для 'z' — (lx, ly);
     * радиус r, вдоль оси [t0, t1), rin > 0 — полый. Материал-функция получает q — долю радиуса 0..1.
     * @param {'x' | 'y' | 'z'} axis @param {PackAMat} m
     */
    cyl(axis, c1, c2, r, t0, t1, m, rin = -1) {
        const r2 = r * r, ri2 = rin > 0 ? rin * rin : -1;
        const f = typeof m === 'function' ? m : null, v0 = /** @type {number} */ (m);
        for (let u = Math.floor(c1 - r) - 1; u <= Math.ceil(c1 + r); u++) for (let v = Math.floor(c2 - r) - 1; v <= Math.ceil(c2 + r); v++) {
            const du = u + 0.5 - c1, dv = v + 0.5 - c2, q2 = du * du + dv * dv;
            if (q2 > r2 || q2 < ri2) continue;
            const q = Math.sqrt(q2) / r;
            for (let t = t0; t < t1; t++) {
                const lx = axis === 'x' ? t : u, ly = axis === 'y' ? t : axis === 'x' ? u : v, lz = axis === 'z' ? t : v;
                const mm = f ? f(lx, ly, lz, q) : v0;
                if (mm >= 0) this.p(lx, ly, lz, mm);
            }
        }
    }
    /** Эллипсоид с центром (cx, cy, cz), полуосями rx, ry, rz; rough — неровность края (плавный шум). @param {PackAMat} m */
    ell(cx, cy, cz, rx, ry, rz, m, rough = 0) {
        const f = typeof m === 'function' ? m : null, v0 = /** @type {number} */ (m);
        const R = 1 + rough;
        for (let y = Math.floor(cy - ry * R) - 1; y <= Math.ceil(cy + ry * R); y++)
            for (let z = Math.floor(cz - rz * R) - 1; z <= Math.ceil(cz + rz * R); z++)
                for (let x = Math.floor(cx - rx * R) - 1; x <= Math.ceil(cx + rx * R); x++) {
                    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
                    let lim = 1;
                    if (rough) lim += (PackA.vnoise(this.wx(x, z) + y * 0.7, this.wz(x, z) - y * 0.6, 4.5) - 0.5) * 2 * rough;
                    const d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 > lim * lim) continue;
                    const mm = f ? f(x, y, z, Math.sqrt(d2)) : v0;
                    if (mm >= 0) this.p(x, y, z, mm);
                }
    }
    /** Отрезок из вокселей (6-связный, «лесенкой»); t — толщина кубика. @param {PackAMat} m */
    line(x0, y0, z0, x1, y1, z1, m, t = 1) {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1) * 2;
        const o = -Math.floor((t - 1) / 2);
        let cx = Math.round(x0), cy = Math.round(y0), cz = Math.round(z0);
        const put = (x, y, z) => { if (t === 1) { const f = typeof m === 'function' ? m : null; const v = f ? f(x, y, z) : /** @type {number} */ (m); if (v >= 0) this.p(x, y, z, v); } else this.box(x + o, y + o, z + o, x + o + t, y + o + t, z + o + t, m); };
        put(cx, cy, cz);
        for (let i = 1; i <= n; i++) {
            const s = i / n;
            const x = Math.round(x0 + (x1 - x0) * s), y = Math.round(y0 + (y1 - y0) * s), z = Math.round(z0 + (z1 - z0) * s);
            while (cy !== y) { cy += Math.sign(y - cy); put(cx, cy, cz); }
            while (cx !== x) { cx += Math.sign(x - cx); put(cx, cy, cz); }
            while (cz !== z) { cz += Math.sign(z - cz); put(cx, cy, cz); }
        }
    }
    /**
     * Крыша над [x0,x1)×[z0,z1): kind 'x' — конёк вдоль x, 'z' — вдоль z, 'hip' — вальмовая, 'shed' — односкатная
     * (высокая сторона — z0). Поверхность: eave + d·slope (d — от края свеса), толщина th (по нормали, примерно).
     * Материал-функция получает четвёртым аргументом глубину от поверхности. Возвращает низ крыши bot(lx, lz).
     * @param {'x' | 'z' | 'hip' | 'shed'} kind @param {PackAMat} m
     */
    roof(x0, x1, z0, z1, eave, slope, th, kind, m) {
        const top = (lx, lz) => {
            const dx = Math.min(lx - x0, x1 - 1 - lx) + 0.5, dz = Math.min(lz - z0, z1 - 1 - lz) + 0.5;
            const d = kind === 'x' ? dz : kind === 'z' ? dx : kind === 'hip' ? Math.min(dx, dz) : (z1 - 1 - lz) + 0.5;
            return Math.floor(eave + d * slope);
        };
        const thick = th + Math.max(0, Math.ceil(slope) - 1);
        const f = typeof m === 'function' ? m : null, v0 = /** @type {number} */ (m);
        for (let lz = z0; lz < z1; lz++) for (let lx = x0; lx < x1; lx++) {
            const t = top(lx, lz);
            for (let ly = t - thick + 1; ly <= t; ly++) { const v = f ? f(lx, ly, lz, t - ly) : v0; if (v >= 0) this.p(lx, ly, lz, v); }
        }
        return (lx, lz) => top(lx, lz) - thick + 1;
    }
    /**
     * Стены коробки [0,W)×[0,D) толщиной t от y0 до yTop (число или функция (lx, lz) -> верх, не включая).
     * mat(face, u, ly, layer): face 0 — перед (z = 0), 1 — зад, 2 — лево (x = 0), 3 — право; u — вдоль стены,
     * layer 0 — наружный слой.
     */
    walls(W, D, y0, yTop, t, mat) {
        for (let lz = 0; lz < D; lz++) for (let lx = 0; lx < W; lx++) {
            const dx = Math.min(lx, W - 1 - lx), dz = Math.min(lz, D - 1 - lz);
            if (dx >= t && dz >= t) continue;
            let face, u, layer;
            if (dz < t && dz <= dx) { face = lz < D / 2 ? 0 : 1; u = lx; layer = dz; } else { face = lx < W / 2 ? 2 : 3; u = lz; layer = dx; }
            const y1 = typeof yTop === 'number' ? yTop : yTop(lx, lz);
            for (let ly = y0; ly < y1; ly++) { const v = mat(face, u, ly, layer); if (v >= 0) this.p(lx, ly, lz, v); }
        }
    }
    /** Точка стены коробки W×D: (face, u, layer) -> [lx, lz]; layer −1 — на воксель снаружи. */
    fxz(W, D, face, u, layer) {
        return face === 0 ? [u, layer] : face === 1 ? [u, D - 1 - layer] : face === 2 ? [layer, u] : [W - 1 - layer, u];
    }
    /**
     * Проём в стене коробки W×D (толщина t): kind 'win' — стекло во внутреннем слое, переплёт; 'door' — проём,
     * открытая внутрь створка; 'hole' — просто вырез. o: { frame — наличник на воксель наружу, glass, bars,
     * leaf — материал створки, shutter — ставни }.
     */
    hole(W, D, face, u0, u1, y0, y1, t, kind, o = {}) {
        const P = (u, ly, layer, v) => { const [lx, lz] = this.fxz(W, D, face, u, layer); this.p(lx, ly, lz, v); };
        for (let ly = y0; ly < y1; ly++) for (let u = u0; u < u1; u++) for (let l = 0; l < t; l++) P(u, ly, l, 0);
        if (kind === 'win') {
            const gl = o.glass != null ? o.glass : M.glass, gL = Math.min(1, t - 1);
            const um = (u1 - u0) >= 8 ? u0 + ((u1 - u0) >> 1) : -999, ym = (y1 - y0) >= 10 ? y0 + Math.round((y1 - y0) * 0.55) : -999;
            const gr = o.grid || 0;
            for (let ly = y0; ly < y1; ly++) for (let u = u0; u < u1; u++) {
                const bar = o.bars != null && (gr ? ((u - u0) % gr === gr - 1 && u < u1 - 1) || ly === ym : (u === um || ly === ym));
                P(u, ly, gL, bar ? o.bars : gl);
            }
            if (o.sill !== false) for (let u = u0 - 1; u <= u1; u++) P(u, y0 - 1, -1, o.sillMat != null ? o.sillMat : (o.frame != null ? o.frame : M.concrete));
        }
        if (o.frame != null) {
            for (let ly = y0; ly <= y1; ly++) { P(u0 - 1, ly, -1, o.frame); P(u1, ly, -1, o.frame); }
            for (let u = u0 - 1; u <= u1; u++) P(u, y1, -1, o.frame);
        }
        if (o.shutter != null) {
            const sw = Math.max(2, (u1 - u0) >> 1);
            for (let ly = y0; ly < y1; ly++) for (let s = 0; s < sw; s++) {
                const v = (ly - y0) % 2 === 1 && s > 0 && s < sw - 1 ? M.darkwood : o.shutter;
                P(u0 - 2 - s, ly, -1, v); P(u1 + 1 + s, ly, -1, v);
            }
        }
        if (kind === 'door' && o.leaf != null) {
            const L = u1 - u0 - 1;
            for (let ly = y0; ly < y1 - 1; ly++) for (let s = 0; s < L; s++) {
                const edge = s === 0 || s === L - 1 || ly === y0 || ly === y1 - 2 || ly === y0 + Math.round((y1 - y0) * 0.5);
                P(u0, ly, t + s, edge ? (o.leafEdge != null ? o.leafEdge : M.darkwood) : o.leaf);
            }
            P(u0, y0 + 9, t + L - 2, M.metal);
        }
    }
    /** Прямая лестница: ширина [x0,x1), начало z0, ступени вдоль +z (run вокселей), подъём 2 на ступень от ly0 до ly1. */
    stairs(x0, x1, z0, ly0, ly1, run, m) {
        const n = Math.ceil((ly1 - ly0) / 2);
        for (let i = 0; i < n; i++) {
            const top = Math.min(ly1, ly0 + 2 * (i + 1));
            this.box(x0, Math.max(ly0, top - 4), z0 + i * run, x1, top, z0 + (i + 1) * run, m);
        }
    }
    /** Надпись шрифтом 3×5 в плоскости lz = z: первая буква у x0, буквы идут по adv (±1) вдоль x; s — размер пикселя. */
    text(str, x0, y0, z, adv, s, m, depth = 1) {
        let i = 0;
        for (const ch of String(str).toUpperCase()) {
            const g = PackA.FONT[ch];
            if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
                if (g[r][c] !== '1') continue;
                const xa = x0 + adv * ((i * 4 + c) * s), ya = y0 + (4 - r) * s;
                const xs = adv > 0 ? xa : xa - s + 1;
                this.box(xs, ya, z, xs + s, ya + s, z + depth, m);
            }
            i++;
        }
        return (i * 4 - 1) * s;
    }
}

/** @satisfies {Record<string, any>} */
const PackA = {
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
        const a = this.hash(ix, 3, iz), b = this.hash(ix + 1, 3, iz), c = this.hash(ix, 3, iz + 1), d = this.hash(ix + 1, 3, iz + 1);
        return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    },
    /** Шрифт 3×5 для вывесок. */
    FONT: /** @type {Record<string, string[]>} */ ({
        A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
        D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
        G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
        K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'], M: ['101', '111', '111', '101', '101'],
        N: ['110', '101', '101', '101', '101'], O: ['111', '101', '101', '101', '111'], P: ['110', '101', '110', '100', '100'],
        R: ['110', '101', '110', '101', '101'], S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
        U: ['101', '101', '101', '101', '111'], W: ['101', '101', '101', '111', '101'], Y: ['101', '101', '010', '010', '010'],
        0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
        3: ['111', '001', '011', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
        6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
        9: ['111', '101', '111', '001', '111'], '.': ['000', '000', '000', '000', '010'], '-': ['000', '000', '111', '000', '000'],
    }),

    // ---------------------------------------------------------------- земля

    /** Невысокие холмы в полосе band вокселей у краёв карты (высота до H). */
    edgeHills(w, band, H, seed) {
        const G = GameMapBuild.GROUND;
        for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
            const d = Math.min(x, z, w.sx - 1 - x, w.sz - 1 - z);
            if (d >= band) continue;
            const t = 1 - d / band;
            const n = this.vnoise(x + seed * 131, z - seed * 71, 23) * 0.65 + this.vnoise(x, z, 7) * 0.35;
            const h = Math.round(H * t * t * (0.45 + 0.8 * n));
            if (h <= 0) continue;
            w.fill(x, G - 1, z, x + 1, G + h - 1, z + 1, M.dirt);
            w.put(x, G + h - 1, z, n > 0.6 ? M.grass2 : M.grass);
        }
    },
    /** Срезать холм до ровной земли в прямоугольнике мира (дорога через край карты). */
    flatten(w, x0, z0, x1, z1, top) {
        const G = GameMapBuild.GROUND;
        w.fill(x0, G, z0, x1, G + 40, z1, 0);
        if (top) w.fill(x0, G - 1, z0, x1, G, z1, top);
    },

    // ---------------------------------------------------------------- предметы (тела)

    /** Стул 5×5 (тело), спинка сзади (+z). */
    chair(k, lx, lz, face = 0, ly = 0, seat = M.wood) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-2, 0, -2, 3, 11, 3, (x, y, z) => {
            if (y < 4) return (x === -2 || x === 2) && (z === -2 || z === 2) ? M.darkwood : PACKA_NONE;
            if (y === 4) return seat;
            if (z === 2) return (x === -2 || x === 2 || y === 7 || y === 10) ? M.darkwood : PACKA_NONE;
            return PACKA_NONE;
        });
    },
    /** Стол 2hw × 2hd высотой 8 (тело). */
    table(k, lx, lz, hw, hd, face = 0, ly = 0, top = M.wood) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-hw, 0, -hd, hw, 8, hd, (x, y, z) => {
            if (y === 7) return top;
            const ex = x === -hw + 1 || x === hw - 2, ez = z === -hd + 1 || z === hd - 2;
            if (ex && ez) return M.darkwood;
            if (y === 6 && (ex || ez) && x > -hw && x < hw - 1 && z > -hd && z < hd - 1) return M.darkwood;
            return PACKA_NONE;
        });
    },
    /** Кровать (тело): изголовье сзади (+z), ширина 2hw. */
    bed(k, lx, lz, face = 0, ly = 0, hw = 7, blanket = M.fabric) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-hw, 0, -10, hw, 11, 10, (x, y, z) => {
            const edgeX = x === -hw || x === hw - 1;
            if (z === 9) return y < 11 ? M.darkwood : PACKA_NONE;
            if (z === -10) return y < 6 ? M.darkwood : PACKA_NONE;
            if (y < 2) return edgeX && (z === -9 || z === 8) ? M.darkwood : PACKA_NONE;
            if (y === 2) return M.darkwood;
            if (y < 5) return M.foam;
            if (y === 5) return z < 4 ? blanket : (z >= 5 && z < 8 && !edgeX ? M.foam : PACKA_NONE);
            if (y === 6) return z >= 5 && z < 8 && x > -hw + 1 && x < hw - 2 ? M.foam : PACKA_NONE;
            return PACKA_NONE;
        });
    },
    /** Диван длиной len (тело): спинка сзади. */
    sofa(k, lx, lz, len, face = 0, ly = 0, mat = M.fabric) {
        const s = k.sub(lx, lz, face, ly), h = len >> 1;
        s.body(-h, 0, -4, len - h, 10, 4, (x, y, z) => {
            const arm = x < -h + 2 || x >= len - h - 2;
            if (y === 0) return (x === -h || x === len - h - 1) && (z === -4 || z === 3) ? M.darkwood : PACKA_NONE;
            if (y < 4) return mat;
            if (z >= 2) return y < 10 ? mat : PACKA_NONE;
            if (arm) return y < 7 ? mat : PACKA_NONE;
            if (y === 4) return M.canvas2;
            return PACKA_NONE;
        });
    },
    /** Книжный шкаф / стеллаж шириной wd, высотой ht (тело), задняя стенка сзади (+z). */
    bookcase(k, lx, lz, wd, ht, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly), h = wd >> 1;
        const books = [M.canvas, M.carblue, M.goods_g, M.goods_y, M.fabric, M.canvas2, M.darkwood];
        s.body(-h, 0, -1, wd - h, ht, 2, (x, y, z) => {
            if (z === 1 || x === -h || x === wd - h - 1 || y % 5 === 0 || y === ht - 1) return M.darkwood;
            const r = s.h(x, y - (y % 5), 0);
            if (r < 0.12) return PACKA_NONE;
            if (y % 5 === 4 && r < 0.55) return PACKA_NONE;
            return books[Math.floor(s.h(x, 1, 7) * books.length)];
        });
    },
    /** Холодильник 7×6×19 (тело). */
    fridge(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-3, 0, -4, 4, 19, 3, (x, y, z) => {
            if (z === -4) return (x === 2 && ((y >= 5 && y <= 9) || (y >= 14 && y <= 16))) ? M.metal : PACKA_NONE;
            if (y === 0) return x === -3 || x === 3 ? M.rubber : M.carwhite;
            return z === -3 && y === 12 ? M.metal : M.carwhite;
        });
    },
    /** Плита 6×6×9 с духовкой (тело). */
    stove(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-3, 0, -3, 3, 12, 3, (x, y, z) => {
            if (y >= 9) return z === 2 ? M.metal : PACKA_NONE;
            if (y === 8) return ((x === -2 || x === 1) && (z === -2 || z === 1)) ? M.metal : M.rubber;
            if (z === -3 && y >= 2 && y <= 5 && x > -3 && x < 2) return M.glass;
            if (z === -3 && y === 7 && (x + 3) % 2 === 0) return M.metal;
            return M.carwhite;
        });
    },
    /** Телевизор на тумбе (тело). */
    tv(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-6, 0, -2, 6, 13, 2, (x, y, z) => {
            if (y < 5) return y === 0 || y === 4 || x === -6 || x === 5 || z === 1 ? M.darkwood : PACKA_NONE;
            if (z === 0) return M.rubber;
            if (z === -1 && x > -6 && x < 5 && y > 5 && y < 12) return M.glass;
            return PACKA_NONE;
        });
    },
    /** Платяной шкаф 10×5×21 (тело). */
    wardrobe(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-5, 0, -2, 5, 21, 3, (x, y, z) => {
            if (z === -2) return (x === -1 || x === 0) && y > 8 && y < 13 ? M.metal : (x === -5 || x === 4 || y === 0 || y === 20 || x === 0 ? M.darkwood : M.wood);
            return M.darkwood;
        });
    },
    /** Письменный стол с тумбой (тело). */
    desk(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-6, 0, -3, 6, 10, 3, (x, y, z) => {
            if (y === 7) return M.wood;
            if (y > 7) return x === -4 && z === 1 ? (y === 9 ? M.lamp : M.metal) : PACKA_NONE;
            if (x >= 2) return z === -3 && (y === 2 || y === 5) ? M.darkwood : M.wood;
            return x === -6 && (z === -3 || z === 2) ? M.darkwood : PACKA_NONE;
        });
    },
    /** Взрывная бочка 6×9×6 стоя (тело). */
    barrel(k, lx, lz, ly = 0, mat = M.barrel) {
        const s = k.sub(lx, lz, 0, ly);
        s.cyl('y', 0, 0, 3.2, 0, 9, (x, y, z, q) => {
            if (y === 0) return M.metal;
            if (y === 8) return q > 0.7 ? M.metal : mat;
            if ((y === 2 || y === 6) && q > 0.75) return M.metal;
            return mat;
        });
        s.p(1, 8, -1, M.metal);
        s.dyn(-4, 0, -4, 3, 9, 3);
    },
    /** Бочка на боку вдоль x (тело): x [x0, x0+9). */
    barrelSide(k, x0, lz, ly = 0, mat = M.barrel) {
        const s = k.sub(0, lz, 0, ly);
        s.cyl('x', 3, 0, 3.2, x0, x0 + 9, (x, y, z, q) => (x === x0 || x === x0 + 8 || ((x === x0 + 2 || x === x0 + 6) && q > 0.75)) ? M.metal : mat);
        s.dyn(x0, 0, -4, x0 + 9, 7, 3);
    },
    /** Ящик s×s×s (тело), угол в (x0, ly, z0). */
    crate(k, x0, ly, z0, sz = 6) {
        k.body(x0, ly, z0, x0 + sz, ly + sz, z0 + sz, (x, y, z) => {
            const ex = x === x0 || x === x0 + sz - 1, ey = y === ly || y === ly + sz - 1, ez = z === z0 || z === z0 + sz - 1;
            return ((ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0)) >= 2 ? M.darkwood : M.crate;
        });
    },
    /** Прямоугольный тюк сена 10×5×5 (тело), угол в (x0, ly, z0), длинная сторона вдоль x (или z, если alongZ). */
    bale(k, x0, ly, z0, alongZ = false) {
        const X = alongZ ? 5 : 10, Z = alongZ ? 10 : 5;
        k.body(x0, ly, z0, x0 + X, ly + 5, z0 + Z, (x, y, z) => {
            const a = alongZ ? z - z0 : x - x0;
            return a === 2 || a === 7 ? M.crop : M.hay;
        });
    },
    /** Большой тюк 22×9×12 (тело). */
    bigBale(k, x0, ly, z0) {
        k.body(x0, ly, z0, x0 + 22, ly + 9, z0 + 12, (x, y, z) => (x - x0) % 7 === 3 ? M.crop : M.hay);
    },
    /** Рулон сена (тело): лёжа — ось вдоль z, стоя — торцом вниз. */
    roundBale(k, lx, lz, ly = 0, upright = false) {
        const s = k.sub(lx, lz, 0, ly);
        const fn = (x, y, z, q) => {
            const endFace = upright ? (y === 0 || y === 11) : (z === -6 || z === 5);
            return endFace && Math.floor(q * 6) % 2 === 1 ? M.crop : M.hay;
        };
        if (upright) { s.cyl('y', 0, 0, 6.6, 0, 12, fn); s.dyn(-8, 0, -8, 7, 12, 7); }
        else { s.cyl('z', 0, 7, 6.6, -6, 6, fn); s.dyn(-8, 0, -6, 7, 14, 6); }
    },
    /** Мусорный бак на колёсиках (тело). */
    bin(k, lx, lz, face = 0, ly = 0, mat = M.cargreen) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-3, 0, -3, 3, 11, 4, (x, y, z) => {
            if (z === 3) return y === 10 ? mat : PACKA_NONE;
            if (y < 2) return (z === 2 && (x === -3 || x === 2)) ? M.rubber : (y === 1 ? mat : PACKA_NONE);
            if (y === 10) return z >= -3 ? M.rubber : PACKA_NONE;
            if (x === -3 || x === 2 || z === -3 || z === 2) return mat;
            return y < 4 ? M.crate : PACKA_NONE;
        });
    },
    /** Скамейка 16×5 (тело). */
    bench(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-8, 0, -2, 8, 9, 3, (x, y, z) => {
            if (x === -7 || x === 6) return y < 5 || (z === 2 && y < 9) ? M.metal : PACKA_NONE;
            if (y === 4 && z < 2) return M.wood;
            if (z === 2 && (y === 6 || y === 8)) return M.wood;
            return PACKA_NONE;
        });
    },
    /**
     * Легковая машина (тело) 18×44: перед — −z. style 'sedan' | 'hatch' | 'pickup' | 'van'.
     */
    car(k, lx, lz, face, paint, style = 'sedan', ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        const W = 9, F = -22, B = 22;
        const cab0 = -9, cab1 = style === 'pickup' ? 3 : style === 'hatch' ? 14 : style === 'van' ? 21 : 10;
        const roofY = style === 'van' ? 19 : 15;
        const wheelZ = [-14, 14];
        const arch = (y, z) => { for (const wz of wheelZ) { const dy = y + 0.5 - 3.5, dz = z + 0.5 - (wz + 0.5); if (dy * dy + dz * dz < 4.6 * 4.6) return true; } return false; };
        s.box(-W, 2, F, W, roofY + 1, B, (x, y, z) => {
            const side = x === -W || x === W - 1, endF = z === F, endB = z === B - 1;
            const shell = side || endF || endB;
            if (y < 9) {
                if (Math.abs(x + 0.5) > 5.5 && arch(y, z)) return PACKA_NONE;
                if (y === 2) return Math.abs(x + 0.5) < 7 && z > F + 1 && z < B - 2 ? M.rubber : PACKA_NONE;
                if (endF) { if (y < 5) return M.metal; if (y < 8 && Math.abs(x + 0.5) > 5) return M.lamp; if (y < 8 && Math.abs(x + 0.5) < 5) return M.cable; return paint; }
                if (endB) { if (y < 5) return M.metal; if (y < 8 && Math.abs(x + 0.5) > 5) return M.neonred; if (y === 5 && Math.abs(x + 0.5) < 2) return M.paint; return paint; }
                if (y === 3 || shell) return paint;
                const seatX = Math.abs(x + 0.5) > 1 && Math.abs(x + 0.5) < 7;
                if (y === 8) {
                    if (style === 'pickup' && z >= cab1) return x === -W + 1 || x === W - 2 ? paint : PACKA_NONE;
                    if (z === 0 && seatX) return M.fabric;
                    return z < cab0 || z >= cab1 ? paint : PACKA_NONE;
                }
                if (style === 'pickup' && z > cab1 && y === 4) return M.metal;
                // сиденья
                if (z >= -3 && z < 1 && (y < 7 || z === 0) && seatX) return M.fabric;
                if (z >= -7 && z < -5 && y >= 6 && Math.abs(x + 0.5) < 8) return M.cable;
                if (style !== 'pickup' && z >= 5 && z < 9 && y < 7 && Math.abs(x + 0.5) < 7) return M.fabric;
                return PACKA_NONE;
            }
            // кузов выше пояса
            if (style === 'pickup' && z >= cab1) return (side || endB) && y < 12 ? paint : PACKA_NONE;
            if (z < cab0 || z >= cab1 + (style === 'sedan' ? 0 : 0)) return PACKA_NONE;
            const ws = cab0 + Math.floor((y - 9) / (style === 'van' ? 4 : 2));    // лобовое
            const rs = cab1 - 1 - Math.floor((y - 9) / 2);                        // заднее
            if (y === roofY) return z >= ws && z <= (style === 'sedan' ? rs : cab1 - 1) ? paint : PACKA_NONE;
            if (z < ws) return PACKA_NONE;
            if (z === ws) return side ? paint : M.glass;
            if (style === 'sedan' && z > rs) return PACKA_NONE;
            if ((style === 'sedan' && z === rs) || ((style !== 'sedan') && z === cab1 - 1)) return side ? paint : M.glass;
            if (side) return (z === 1 || z === 2 || (style !== 'sedan' && z === cab1 - 2)) ? paint : M.glass;
            if (z >= -3 && z < 1 && y < 13 && z === 0 && Math.abs(x + 0.5) > 1 && Math.abs(x + 0.5) < 7) return M.fabric;
            return PACKA_NONE;
        });
        for (const wz of wheelZ) for (const [x0, x1] of [[-W, -W + 3], [W - 3, W]]) {
            s.cyl('x', 3.5, wz + 0.5, 3.6, x0, x1, (x, y, z, q) => q < 0.45 ? M.tin : M.rubber);
        }
        s.dyn(-W, 0, F, W, roofY + 1, B);
    },

    // ---------------------------------------------------------------- статичные мелочи

    /** Дерево: ствол, ветви, крона из нескольких «облаков» листвы. */
    tree(k, lx, lz, H = 40, R = 12, seed = 1, leaf = M.leaves) {
        const E = R * 2 + 4;
        this.isolated(k.sub(lx, lz), -E, 0, -E, E + 1, H + R * 2 + 4, E + 1, 0, 0, 0, s => this._tree(s, H, R, seed, leaf));
    },
    _tree(s, H, R, seed, leaf) {
        s.cyl('y', 0.5, 0.5, 3.4, 0, 3, M.darkwood);
        s.cyl('y', 0.5, 0.5, 2.3, 3, H + 4, M.darkwood);
        /** @type {number[][]} */
        const blobs = [[0, H + R * 0.35, 0, R]];
        const n = 5;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + PackA.hash(seed, i, 3) * 1.1;
            const rr = R * (0.55 + 0.22 * PackA.hash(seed, i, 5));
            const bx = Math.round(Math.cos(a) * R * 0.75), bz = Math.round(Math.sin(a) * R * 0.75), by = Math.round(H - 3 + PackA.hash(seed, i, 7) * 6);
            s.line(0, H - 9 - (i % 3) * 3, 0, bx, by, bz, M.darkwood, 2);
            blobs.push([bx, by, bz, rr]);
        }
        const other = leaf === M.leaves ? M.leaves2 : M.leaves;
        for (const [bx, by, bz, rr] of blobs) {
            s.ell(bx + 0.5, by, bz + 0.5, rr, rr * 0.72, rr, (x, y, z) => s.g(x, y, z) ? PACKA_NONE : (s.h(x, y, z) < 0.22 ? other : leaf), 0.22);
        }
    },
    /**
     * Построить fn(kk) во временной сетке (локальный ящик k [x0,x1)×[y0,y1)×[z0,z1)) и перенести в мир только
     * воксели, связные с затравкой (sx, sy, sz) — без висящих клочков; занятые клетки мира не трогаются.
     */
    isolated(k, x0, y0, z0, x1, y1, z1, sx, sy, sz, fn) {
        const ax = k.wx(x0, z0), az = k.wz(x0, z0), bx = k.wx(x1 - 1, z1 - 1), bz = k.wz(x1 - 1, z1 - 1);
        const X0 = Math.min(ax, bx), Z0 = Math.min(az, bz), X = Math.abs(bx - ax) + 1, Z = Math.abs(bz - az) + 1, Y0 = k.oy + y0, Y = y1 - y0;
        const data = new Uint8Array(X * Y * Z);
        const inb = (x, y, z) => x >= X0 && y >= Y0 && z >= Z0 && x < X0 + X && y < Y0 + Y && z < Z0 + Z;
        const at = (x, y, z) => (x - X0) + X * ((z - Z0) + Z * (y - Y0));
        const fake = {
            put(x, y, z, v) { if (inb(x, y, z)) data[at(x, y, z)] = v; },
            get(x, y, z) { return inb(x, y, z) ? data[at(x, y, z)] : 0; },
            fill(a0, b0, c0, a1, b1, c1, v) { for (let y = b0; y < b1; y++) for (let z = c0; z < c1; z++) for (let x = a0; x < a1; x++) this.put(x, y, z, v); },
        };
        fn(new PackAKit(/** @type {any} */ (fake), k.ox, k.oy, k.oz, k.a, k.b, k.c, k.d));
        const s0 = [k.wx(sx, sz), k.oy + sy, k.wz(sx, sz)];
        if (!fake.get(s0[0], s0[1], s0[2])) return;
        const seen = new Uint8Array(X * Y * Z), q = [s0[0], s0[1], s0[2]];
        seen[at(s0[0], s0[1], s0[2])] = 1;
        for (let i = 0; i < q.length; i += 3) {
            const x = q[i], y = q[i + 1], z = q[i + 2];
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                const nx = x + dx, ny = y + dy, nz = z + dz;
                if (!inb(nx, ny, nz)) continue;
                const j = at(nx, ny, nz);
                if (seen[j] || !data[j]) continue;
                seen[j] = 1; q.push(nx, ny, nz);
            }
        }
        const w = k.w;
        for (let i = 0; i < q.length; i += 3) if (!w.get(q[i], q[i + 1], q[i + 2])) w.put(q[i], q[i + 1], q[i + 2], data[at(q[i], q[i + 1], q[i + 2])]);
    },
    /** Куст: низкий шар листвы на земле. */
    bush(k, lx, lz, r = 6, leaf = M.leaves) {
        const s = k.sub(lx, lz);
        s.ell(0.5, r * 0.55, 0.5, r, r * 0.75, r, (x, y, z) => y < 0 ? PACKA_NONE : (s.h(x, y, z) < 0.25 ? M.leaves2 : leaf), 0.2);
    },
    /** Фонарный столб высотой H: столб 2×2, кронштейн вперёд (−z), плафон. */
    lampPost(k, lx, lz, face = 0, H = 56) {
        const s = k.sub(lx, lz, face);
        s.box(-2, 0, -2, 2, 2, 2, M.concrete2);
        s.box(-1, 2, -1, 1, H, 1, M.metal);
        s.box(-1, H - 3, -12, 1, H - 1, -1, M.metal);
        s.box(-2, H - 4, -16, 2, H - 1, -10, M.cable);
        s.box(-1, H - 5, -15, 1, H - 4, -11, M.lamp);
    },
    /**
     * Забор вдоль отрезка (x0, z0) — (x1, z1) по оси: kind 'picket' | 'privacy' | 'rail'; gaps — [a0, a1) вдоль отрезка без забора.
     */
    fence(k, x0, z0, x1, z1, kind = 'picket', gaps = [], mat = M.trim) {
        const alongX = z0 === z1, n = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), sg = alongX ? Math.sign(x1 - x0) : Math.sign(z1 - z0);
        const H = kind === 'privacy' ? 18 : kind === 'rail' ? 12 : 9, step = kind === 'rail' ? 24 : 20;
        const P = (a, y, v) => { const x = alongX ? x0 + a * sg : x0, z = alongX ? z0 : z0 + a * sg; k.p(x, y, z, v); };
        for (let a = 0; a <= n; a++) {
            if (gaps.some(g => a >= g[0] && a < g[1])) continue;
            const post = a % step === 0 || a === n;
            for (let y = 0; y < H + (post ? 1 : 0); y++) {
                if (post) { P(a, y, kind === 'picket' ? mat : M.darkwood); continue; }
                if (kind === 'picket') { if ((a % 2 === 0 && y < H - (a % 4 === 0 ? 0 : 1)) || y === 3 || y === H - 3) P(a, y, mat); }
                else if (kind === 'privacy') P(a, y, (a % 3 === 0) ? M.wood : (y === 4 || y === 14 ? M.darkwood : mat));
                else if (y === 4 || y === 5 || y === 9 || y === 10) P(a, y, M.wood);
            }
        }
    },
    /**
     * Коробка дома в системе k ([0,W)×[0,D), перед — z = 0): фундамент и пол, стены до низа крыши (bot) или до top,
     * перекрытия, перегородки, проёмы, светильники. o: { W, D, t, base, top, bot(lx, lz), wall(face, u, ly, layer),
     * slabs: [[y0, y1, [[x0, x1, z0, z1] — дыры], mat?]], parts: [[x0, y0, z0, x1, y1, z1, mat]], cuts: [[x0, y0, z0, x1, y1, z1]],
     * holes: [[face, u0, u1, y0, y1, kind, opts]], lamps: [[lx, ly, lz]], floor: mat-функция пола }
     */
    shell(k, o) {
        const W = o.W, D = o.D, t = o.t || 2, base = o.base != null ? o.base : 2;
        const floor = o.floor || ((lx) => lx % 5 === 0 ? M.wood : M.plank);
        k.box(0, 0, 0, W, base, D, (lx, ly, lz) => Math.min(lx, lz, W - 1 - lx, D - 1 - lz) < t ? M.concrete2 : (ly === base - 1 ? floor(lx, ly, lz) : PACKA_NONE));
        k.walls(W, D, base, o.bot || o.top, t, o.wall);
        for (const [y0, y1, holes, mat] of o.slabs || []) {
            const f = mat || floor;
            k.box(t, y0, t, W - t, y1, D - t, (lx, ly, lz) => (holes || []).some(h => lx >= h[0] && lx < h[1] && lz >= h[2] && lz < h[3]) ? PACKA_NONE : f(lx, ly, lz));
        }
        for (const [x0, y0, z0, x1, y1, z1, m] of o.parts || []) k.box(x0, y0, z0, x1, y1, z1, m);
        for (const [x0, y0, z0, x1, y1, z1] of o.cuts || []) k.box(x0, y0, z0, x1, y1, z1, 0);
        for (const [face, u0, u1, y0, y1, kind, opts] of o.holes || []) k.hole(W, D, face, u0, u1, y0, y1, t, kind, opts || {});
        for (const [lx, ly, lz] of o.lamps || []) k.box(lx, ly, lz, lx + 2, ly + 1, lz + 2, M.lamp);
    },
    /** Подвесной светильник: трос от низа крыши bot(lx, lz) до плафона на высоте ly. */
    hang(k, lx, lz, ly, bot) {
        const top = bot(lx, lz);
        if (top > ly + 2) k.box(lx, ly + 2, lz, lx + 1, top, lz + 1, M.cable);
        k.box(lx - 1, ly, lz - 1, lx + 2, ly + 2, lz + 2, M.lamp);
    },
    /** Кладка: растворные швы, перевязка рядов, редкие тёмные кирпичи; base — высота цоколя. */
    brickWall(base = 4, belt = -1) {
        return (face, u, ly, layer) => {
            if (ly < base) return M.concrete2;
            if (layer === 0 && (ly === belt || ly === belt + 1)) return M.concrete;
            if (layer > 0) return M.brick;
            if (ly % 3 === 2) return M.mortar;
            const off = (Math.floor(ly / 3) & 1) * 3;
            if ((u + off) % 6 === 0) return M.mortar;
            return PackA.hash(face * 131 + Math.floor((u + off) / 6), ly, 7) < 0.18 ? M.brick2 : M.brick;
        };
    },
    /** Обшивка внахлёст (тень каждого третьего ряда), углы — наличник. */
    sidingWall(mat, W, D, base = 4, corner = M.trim) {
        return (face, u, ly, layer) => {
            if (ly < base) return M.concrete2;
            const len = face < 2 ? W : D;
            if (u < 2 || u >= len - 2) return corner;
            if (layer === 0 && ly % 3 === 0) return 0;
            return mat;
        };
    },
    /** Газовый гриль на тележке (тело). */
    grill(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-6, 0, -3, 6, 15, 3, (x, y, z) => {
            if (y < 8) {
                if ((x === -5 || x === 4) && (z === -3 || z === 2)) return y === 0 ? M.rubber : M.metal;
                return y === 2 && x > -5 && x < 4 ? M.metal : PACKA_NONE;
            }
            if (y === 8) return M.metal;
            if (x < -4 || x > 3) return y === 9 ? M.metal : PACKA_NONE;
            if (y < 12) return M.rubber;
            if (y < 14) return z > -3 ? M.rubber : (y === 12 && x > -4 && x < 3 ? M.metal : PACKA_NONE);
            return z === 2 ? M.rubber : PACKA_NONE;
        });
    },
    /** Баллон с газом (тело, взрывается). */
    propane(k, lx, lz, ly = 0) {
        const s = k.sub(lx, lz, 0, ly);
        s.cyl('y', 0, 0, 2.3, 0, 9, (x, y) => y === 0 ? M.metal : M.fueltank);
        s.cyl('y', 0, 0, 2.3, 9, 11, (x, y, z, q) => q > 0.6 ? M.metal : PACKA_NONE);
        s.box(-1, 9, -1, 1, 11, 1, M.metal);
        s.dyn(-3, 0, -3, 3, 11, 3);
    },
    /** Газонокосилка (тело). */
    mower(k, lx, lz, face = 0, ly = 0) {
        const s = k.sub(lx, lz, face, ly);
        s.body(-3, 0, -4, 4, 11, 9, (x, y, z) => {
            if (z >= 4) return (x === -3 || x === 3) && y >= Math.round(3 + (z - 4) * 1.4) && y <= Math.round(3 + (z - 3) * 1.4) ? M.metal : (z === 8 && y === 10 ? M.rubber : PACKA_NONE);
            if (y < 2) return (x === -3 || x === 3) && (z === -4 || z === 3) ? M.rubber : PACKA_NONE;
            if (y < 4) return M.cargreen;
            return y === 4 && x > -2 && x < 2 && z > -3 && z < 2 ? M.cable : PACKA_NONE;
        });
    },
    /** Почтовый ящик на столбике. */
    mailbox(k, lx, lz, face = 0, mat = M.metal) {
        const s = k.sub(lx, lz, face);
        s.box(0, 0, 0, 1, 11, 1, M.darkwood);
        s.box(-1, 11, -3, 2, 14, 3, mat);
        s.box(0, 14, -3, 1, 15, 3, mat);
        s.box(2, 12, 1, 3, 16, 2, M.carred);
    },
};

// ======================================================================== ФЕРМА

Object.assign(GameMapBuild.builders, {
    /** Земля фермы: холмы по краям, гравийный двор, колея к югу, пашня с пшеницей, тропа к дому. */
    'farm-terrain'(w) {
        const G = GameMapBuild.GROUND;
        PackA.edgeHills(w, 30, 16, 3);
        // двор
        for (let z = 128; z < 350; z++) for (let x = 190; x < 352; x++) {
            const dx = (x - 272) / 80, dz = (z - 236) / 108;
            const e = dx * dx + dz * dz + (PackA.vnoise(x, z, 9) - 0.5) * 0.35;
            if (e < 1) w.put(x, G - 1, z, e > 0.82 && PackA.hash(x, 3, z) < 0.5 ? M.dirt : M.gravel);
        }
        // колея: от южного края к двору
        for (let z = 300; z < 512; z++) {
            const cx = 280 + Math.sin((z - 300) / 38) * 7;
            for (let x = Math.floor(cx - 17); x <= cx + 17; x++) {
                const d = Math.abs(x + 0.5 - cx);
                if (z >= 482) PackA.flatten(w, x, z, x + 1, z + 1, M.dirt);
                if (d > 15) { if (PackA.hash(x, 5, z) < 0.5) w.put(x, G - 1, z, M.dirt); continue; }
                if (d < 3) { w.put(x, G - 1, z, M.grass2); continue; }
                if (d >= 6 && d < 10) { w.put(x, G - 1, z, 0); w.put(x, G - 2, z, M.soil); continue; }
                w.put(x, G - 1, z, M.dirt);
            }
        }
        // пашня: борозды с юга на север, пшеница, сжатая полоса и вспаханный край
        for (let z = 338; z < 482; z++) for (let x = 365; x < 482; x++) {
            const ph = (x - 365) % 6;
            w.put(x, G - 1, z, M.soil); w.put(x, G - 2, z, M.soil);
            if (ph < 2) { w.put(x, G - 1, z, 0); continue; }
            if (x >= 458 || ph === 2 || ph === 5) continue;
            const harvested = z >= 452;
            const h = harvested ? 1 : 5 + Math.floor(PackA.hash(x, 9, z) * 3 + PackA.vnoise(x, z, 14) * 4);
            w.fill(x, G, z, x + 1, G + h, z + 1, M.crop);
        }
        // грязь у поилки на выгоне
        for (let z = 380; z < 450; z++) for (let x = 160; x < 230; x++) {
            const dx = (x - 195) / 32, dz = (z - 420) / 26;
            if (dx * dx + dz * dz + (PackA.vnoise(x, z, 6) - 0.5) * 0.5 < 1) w.put(x, G - 1, z, M.mud);
        }
    },

    /** Большой красный амбар: двускатная ломаная крыша, сеновал на столбах, стойла, ворота, сенная «шляпа». */
    'farm-barn'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot), P = PackA;
        const top = ax => ax >= 35 ? 40 + (55 - ax) * 1.6 : 72 + (35 - ax) * (20 / 35);
        const thickAt = ax => ax >= 35 ? 3 : 2;
        const roofBot = lx => { const ax = Math.abs(lx + 0.5); return Math.floor(top(ax)) - thickAt(ax) + 1; };
        // фундамент и пол
        k.box(-55, 0, -80, 55, 5, 80, (lx, ly, lz) => {
            const d = Math.min(lx + 55, 54 - lx, lz + 80, 79 - lz);
            return d >= 3 ? PACKA_NONE : (k.h(lx, ly * 3, lz) < 0.35 ? M.stone2 : M.stone);
        });
        k.box(-52, 0, -77, 52, 1, 77, (lx, ly, lz) => ((lx + 200) % 40 === 0 || (lz + 200) % 40 === 0) ? M.concrete2 : M.concrete);
        // стены: красные доски, белые углы и пояс под свесом, фронтоны до крыши
        const wk = k.sub(-55, -80);
        wk.walls(110, 160, 5, (lx, lz) => roofBot(lx - 55), 2, (face, u, ly, layer) => {
            const len = face < 2 ? 110 : 160;
            if (u < 2 || u >= len - 2) return M.trim;
            if (face >= 2 && ly >= 34) return M.trim;
            if (face < 2 && ly >= roofBot(u - 55) - 2) return M.trim;
            if (face < 2 && ly >= 38 && ly < 40) return M.trim;
            return M.barnred;
        });
        // нащельники на боковых стенах
        for (const sx of [-56, 55]) for (let lz = -78; lz < 78; lz += 8) k.box(sx, 5, lz, sx + 1, 34, lz + 1, M.barnred);
        // проёмы: ворота, задняя дверь, окна, дверь сеновала
        k.box(-20, 1, -80, 20, 37, -77, 0);
        k.box(28, 1, 77, 38, 22, 80, 0);
        k.box(27, 1, 80, 28, 23, 81, M.trim); k.box(38, 1, 80, 39, 23, 81, M.trim); k.box(27, 22, 80, 39, 23, 81, M.trim);
        for (const c of [-60, -30, 0, 30, 60]) for (const face of [2, 3]) {
            wk.hole(110, 160, face, c + 76, c + 84, 18, 26, 2, 'win', { frame: M.trim, bars: M.trim, sillMat: M.trim });
        }
        wk.hole(110, 160, 0, 45, 65, 48, 68, 2, 'hole', { frame: M.trim });
        wk.hole(110, 160, 1, 49, 61, 55, 65, 2, 'win', { frame: M.trim, bars: M.trim, sillMat: M.trim });
        // ставни сеновала (открыты) и откатные ворота на рельсе
        for (const [x0, x1] of [[-20, -10], [10, 20]]) k.box(x0, 48, -81, x1, 68, -80, (lx, ly) => {
            const u = lx - x0, v = ly - 48;
            if (u === 0 || u === 9 || v === 0 || v === 19) return M.trim;
            return Math.abs(u - v * 0.47) < 1 || Math.abs(9 - u - v * 0.47) < 1 ? M.trim : M.barnred;
        });
        for (const [x0, x1] of [[-41, -20], [20, 41]]) k.box(x0, 1, -81, x1, 37, -80, (lx, ly) => {
            const u = lx - x0, Wd = x1 - x0, v = ly - 1, H = 36;
            if (u < 2 || u >= Wd - 2 || v < 2 || v >= H - 2 || Math.abs(v + 0.5 - H / 2) < 1) return M.trim;
            const half = v < H / 2 ? v - 2 : v - H / 2 - 1, hh = H / 2 - 3;
            const t = half / hh * (Wd - 5);
            if (Math.abs(u - 2 - t) < 1.1 || Math.abs(Wd - 3 - u - t) < 1.1) return M.trim;
            return M.barnred;
        });
        k.box(-43, 37, -82, 43, 39, -80, M.metal);
        // крыша: оцинкованный лист с фальцами, конёк, сенная «шляпа» над воротами сеновала
        for (let lz = -96; lz < 84; lz++) for (let lx = -58; lx < 58; lx++) {
            const ax = Math.abs(lx + 0.5);
            if (lz < -84 && ax > 21) continue;
            const t = Math.floor(top(ax)), th = thickAt(ax);
            for (let ly = t - th + 1; ly <= t; ly++) {
                const edge = lz === -96 || (lz === -84 && ax > 21) || lz === 83 || ax > 57;
                k.p(lx, ly, lz, edge ? M.trim : (ax < 1.5 || (lz & 7) === 0 || Math.abs(ax - 35) < 1 ? M.metal : M.tin));
            }
        }
        k.box(-1, 77, -95, 1, 79, -60, M.darkwood);                 // балка сенного блока
        k.box(-2, 74, -94, 1, 77, -91, M.metal);
        k.box(0, 64, -93, 1, 74, -92, M.cable);
        k.box(-1, 62, -93, 2, 64, -92, M.metal);
        // купол-вентилятор на коньке и флюгер
        k.box(-6, 86, -6, 6, 104, 6, (lx, ly, lz) => {
            const edge = lx === -6 || lx === 5 || lz === -6 || lz === 5;
            if (!edge) return ly < 90 ? M.darkwood : PACKA_NONE;
            const corner = (lx === -6 || lx === 5) && (lz === -6 || lz === 5);
            if (corner || ly < 92 || ly > 101) return M.trim;
            return ly % 2 === 0 ? M.barnred : 0;
        });
        k.roof(-8, 8, -8, 8, 103, 0.8, 2, 'hip', M.tin);
        k.box(0, 109, 0, 1, 124, 1, M.metal);
        k.box(-4, 116, 0, 5, 117, 1, M.metal); k.box(0, 116, -4, 1, 117, 5, M.metal);
        k.box(0, 120, -7, 1, 121, 7, M.metal);
        k.box(0, 119, 4, 1, 123, 7, M.tin);
        k.box(0, 119, -7, 1, 122, -6, M.metal); k.box(0, 121, -8, 1, 122, -7, M.metal);
        // сеновал: столбы, прогоны, балки, настил (с зазором от стен — держится только на столбах)
        for (const px of [-24, 21]) {
            for (const pz of [-62, -20, 20, 62]) {
                k.box(px, 1, pz - 1, px + 3, 34, pz + 2, M.darkwood);
                k.line(px + 1, 24, pz, px + 1, 33, pz - 9, M.darkwood, 2);
                k.line(px + 1, 24, pz, px + 1, 33, pz + 9, M.darkwood, 2);
            }
            k.box(px, 34, -77, px + 3, 37, 77, M.darkwood);
        }
        for (const bz of [-74, -50, -26, -2, 22, 46, 70]) k.box(-52, 37, bz, 52, 40, bz + 3, M.darkwood);
        k.box(-52, 40, -77, 52, 42, 77, (lx, ly, lz) => {
            if (lx >= -8 && lx < 8 && lz >= -40 && lz < -28) return PACKA_NONE;
            if (lx >= -38 && lx < -30 && lz >= 64 && lz < 72) return PACKA_NONE;
            return (lx + 60) % 5 === 0 ? M.wood : M.plank;
        });
        // лестница-стремянка сквозь люк (не касается настила)
        for (const rx of [-37, -32]) k.box(rx, 1, 66, rx + 1, 47, 67, M.darkwood);
        for (let ly = 4; ly < 46; ly += 4) k.box(-36, ly, 66, -32, ly + 1, 67, M.wood);
        // сено на сеновале: стог у задней стены и россыпь
        for (let lz = 26; lz < 76; lz++) for (let lx = -49; lx < 49; lx++) {
            if (lx >= -40 && lx < -28 && lz >= 62 && lz < 74) continue;
            const ax = Math.abs(lx + 0.5) / 50;
            let hgt = Math.min(26, (lz - 26) * 0.9) * (1 - ax * ax * ax * ax) + (PackA.vnoise(k.wx(lx, lz), k.wz(lx, lz), 6) - 0.5) * 6;
            hgt = Math.min(hgt, roofBot(lx) - 44);
            if (hgt < 1) continue;
            k.box(lx, 42, lz, lx + 1, 42 + Math.round(hgt), lz + 1, M.hay);
        }
        for (let lz = -60; lz < 20; lz++) for (let lx = -48; lx < 48; lx++) if (k.h(lx, 0, lz) < 0.05 && !(lx >= -8 && lx < 8 && lz >= -40 && lz < -28)) k.p(lx, 42, lz, M.hay);
        // тюки на сеновале
        for (const bx of [-50, -40, -30]) for (const bz of [-74, -69]) { P.bale(k, bx, 42, bz); P.bale(k, bx, 47, bz); }
        P.bale(k, 22, 42, -74); P.bale(k, 32, 42, -74); P.bale(k, 27, 47, -74);
        // стойла по бокам прохода
        for (const sz of [-54, -26, 2, 30, 58]) {
            k.box(-53, 1, sz, -31, 14, sz + 2, (lx, ly) => ly === 13 || (lx + 60) % 6 === 0 ? M.wood : M.plank);
            k.box(31, 1, sz, 53, 14, sz + 2, (lx, ly) => ly === 13 || (lx + 60) % 6 === 0 ? M.wood : M.plank);
            for (const px of [-31, 29]) k.box(px, 1, sz, px + 2, 18, sz + 2, M.darkwood);
            if (sz < 58) for (const tx of [-52, 46]) {
                k.box(tx, 1, sz + 6, tx + 6, 6, sz + 20, (lx, ly, lz) => (ly === 1 || lx === tx || lx === tx + 5 || lz === sz + 6 || lz === sz + 19) ? M.plank : (ly < 4 ? M.hay : PACKA_NONE));
            }
        }
        for (const px of [-31, 29]) k.box(px, 16, -54, px + 2, 18, 60, M.darkwood);
        for (let lz = -76; lz < 76; lz++) for (let lx = -52; lx < 52; lx++) {
            const ax = Math.abs(lx);
            if (ax > 32 && PackA.vnoise(k.wx(lx, lz), k.wz(lx, lz), 5) > 0.55 && !k.g(lx, 1, lz)) k.p(lx, 1, lz, M.hay);
        }
        // куча сена под люком
        k.ell(0, 0, -34, 9, 7, 7, (lx, ly, lz) => ly < 1 || k.g(lx, ly, lz) ? PACKA_NONE : M.hay, 0.2);
        // фонари на тросах под сеновалом
        for (const lz of [-55, 10, 50]) { k.box(0, 34, lz, 1, 40, lz + 1, M.cable); k.box(-1, 32, lz - 1, 2, 34, lz + 2, M.lamp); }
        // верстак у задней двери и вещи в проходе (тела)
        k.box(38, 1, 70, 52, 9, 76, (lx, ly, lz) => ly === 8 ? M.plank : ((lx === 38 || lx === 51) && (lz === 70 || lz === 75) ? M.darkwood : (ly === 3 ? M.wood : PACKA_NONE)));
        P.crate(k, 8, 1, 52); P.crate(k, 14, 1, 52); P.crate(k, 10, 7, 52);
        P.barrel(k, -12, 60, 1, M.darkwood); P.barrel(k, -12, 50, 1, M.darkwood);
        P.bale(k, 8, 1, -66); P.bale(k, 8, 1, -61); P.bale(k, 8, 6, -64);
    },

    /** Высокий зерновой силос: гофрированная оболочка, конусная крыша, лестница с клеткой, труба загрузки. */
    'farm-silo'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.cyl('y', 0, 0, 28, 0, 2, M.concrete);
        k.cyl('y', 0, 0, 24, 2, 142, (lx, ly) => ly % 4 === 0 ? M.metal : M.tin, 22.4);
        for (const y of [40, 80, 120]) k.cyl('y', 0, 0, 25, y, y + 2, M.metal, 23.5);
        k.cyl('y', 0, 0, 25.5, 142, 162, (lx, ly, lz, q) => {
            const d = q * 25.5, t = Math.floor(142 + (25.5 - d) * 0.72);
            return ly <= t && ly > t - 3 ? (d < 4 ? M.metal : ((Math.floor(Math.atan2(lz + 0.5, lx + 0.5) * 8) & 1) ? M.tin : M.metal)) : PACKA_NONE;
        });
        k.cyl('y', 0, 0, 3.5, 159, 162, M.metal);
        k.cyl('y', 0, 0, 4.5, 162, 163, M.tin);
        // люк у земли
        k.box(-5, 2, -25, 5, 14, -24, (lx, ly) => lx === -5 || lx === 4 || ly === 2 || ly === 13 ? M.metal : M.hazard);
        // лестница с клеткой (перед, −z)
        for (const rx of [-4, 3]) k.box(rx, 4, -26, rx + 1, 146, -25, M.metal);
        for (let ly = 6; ly < 146; ly += 3) k.box(-3, ly, -26, 3, ly + 1, -25, M.metal);
        for (let ly = 26; ly < 144; ly += 8) for (let a = 0; a < 12; a++) {
            const t0 = a / 12 * Math.PI, t1 = (a + 1) / 12 * Math.PI;
            k.line(Math.round(-0.5 + Math.cos(t0) * 4.5), ly, Math.round(-25.5 - Math.sin(t0) * 4.5), Math.round(-0.5 + Math.cos(t1) * 4.5), ly, Math.round(-25.5 - Math.sin(t1) * 4.5), M.metal);
        }
        for (const [cx, cz] of [[-5, -27], [4, -27], [-3, -29], [2, -29], [0, -30]]) k.box(cx, 26, cz, cx + 1, 139, cz + 1, M.metal);
        for (let ly = 26; ly < 144; ly += 8) { k.box(-5, ly, -28, -4, ly + 1, -26, M.metal); k.box(4, ly, -28, 5, ly + 1, -26, M.metal); }
        // труба загрузки сбоку
        k.box(23, 2, -1, 25, 150, 1, M.metal);
        k.box(5, 148, -1, 25, 150, 1, M.metal);
        k.box(22, 2, -3, 27, 5, 3, M.hazard);
    },

    /** Бункер на шести ногах: конус снизу, гофрированный бак, связи-раскосы. Подрежь ноги — упадёт. */
    'farm-hopper'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        const legs = [];
        for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * Math.PI * 2; legs.push([Math.round(Math.cos(a) * 16), Math.round(Math.sin(a) * 16)]); }
        for (const [lx, lz] of legs) { k.box(lx - 2, 0, lz - 2, lx + 2, 2, lz + 2, M.concrete); k.box(lx - 1, 2, lz - 1, lx + 1, 36, lz + 1, M.metal); }
        for (let i = 0; i < 6; i++) {
            const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 6];
            k.line(ax, 5, az, bx, 31, bz, M.metal); k.line(bx, 5, bz, ax, 31, az, M.metal);
            k.line(ax, 18, az, bx, 18, bz, M.metal);
        }
        k.cyl('y', 0, 0, 18, 34, 36, M.metal, 12.5);
        for (let ly = 14; ly < 34; ly++) { const r = 3 + (ly - 14) * 0.72; k.cyl('y', 0, 0, r, ly, ly + 1, M.tin, r - 2.2); }
        k.cyl('y', 0, 0, 17, 36, 82, (lx, ly) => ly % 4 === 1 ? M.metal : M.tin, 15.4);
        k.cyl('y', 0, 0, 17.5, 82, 96, (lx, ly, lz, q) => {
            const d = q * 17.5, t = Math.floor(82 + (17.5 - d) * 0.75);
            return ly <= t && ly > t - 3 ? M.tin : PACKA_NONE;
        });
        k.cyl('y', 0, 0, 2.5, 6, 15, M.metal);
        k.box(-3, 9, -3, 3, 10, 3, M.hazard);
        k.cyl('y', 0, 0, 3, 94, 97, M.metal);
    },

    /** Мастерская-навес: столбы спереди, гофро-стены, односкатная крыша, верстак, пикап внутри;
     *  у входа — паллеты с взрывными бочками и бак солярки на опорах (цепная реакция). */
    'farm-shed'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot), P = PackA;
        k.box(-68, 0, -35, 68, 1, 35, (lx, ly, lz) => (lx + 70) % 34 === 0 ? M.concrete2 : M.concrete);
        const bot = k.roof(-70, 70, -38, 37, 45.6, 0.1, 2, 'shed', (lx, ly, lz, d) => (lx + 70) % 6 === 0 ? M.metal : (lz === -38 ? M.trim : M.tin));
        const sk = k.sub(-68, -35);
        sk.walls(136, 70, 1, (lx, lz) => bot(lx - 68, lz - 35), 2, (face, u, ly, layer) => {
            if (face === 0) return PACKA_NONE;
            if (ly < 4) return M.concrete2;
            if (layer === 0) return (u % 4 < 2) ? M.tin : PACKA_NONE;
            return M.tin;
        });
        for (const px of [-68, -35, -1, 33, 66]) k.box(px, 1, -35, px + 2, 41, -33, M.rust);
        k.box(-68, 41, -35, 68, 44, -33, M.rust);
        // верстак, стенд с инструментом, плуг
        k.box(-60, 1, 26, -20, 10, 33, (lx, ly, lz) => ly === 9 ? M.plank : (((lx === -60 || lx === -21) && (lz === 26 || lz === 32)) ? M.darkwood : (ly === 3 ? M.wood : PACKA_NONE)));
        k.box(-40, 10, 29, -36, 13, 32, M.metal);
        k.box(-60, 14, 32, -20, 30, 33, (lx, ly) => (lx + ly) % 7 === 0 ? M.wood : M.plank);
        for (const [tx, tl] of [[-56, 9], [-52, 7], [-47, 11], [-31, 8], [-27, 10]]) k.box(tx, 28 - tl, 31, tx + 1, 28, 32, M.metal);
        k.box(-8, 1, -4, -6, 8, 22, M.rust); k.box(6, 1, -4, 8, 8, 22, M.rust); k.box(-8, 8, -4, 8, 10, 22, M.rust);
        for (const pz of [0, 8, 16]) k.line(-6, 7, pz, -10, 1, pz + 4, M.metal, 2);
        // пикап в правом пролёте
        P.car(k, 44, 4, 0, M.carblue, 'pickup', 1);
        // ящики и инструментальный шкаф (тела)
        P.crate(k, -64, 1, 18); P.crate(k, -64, 1, 11); P.crate(k, -64, 7, 15);
        k.body(-16, 1, 26, -8, 13, 32, (lx, ly) => ly === 12 ? M.metal : (ly % 3 === 0 ? M.metal : M.carred));
        // паллеты с бочками у входа
        for (const px of [6, 20]) {
            k.box(px, 0, -50, px + 12, 1, -38, (lx, ly, lz) => (lz + 50) % 3 === 2 ? PACKA_NONE : M.plank);
            for (const [bx, bz] of [[3, 3], [9, 3], [3, 9], [9, 9]]) if (!(px === 20 && bx === 9 && bz === 9)) P.barrel(k, px + bx, -50 + bz, 1);
        }
        P.barrelSide(k, 34, -43, 0);
        P.barrel(k, -4, -44, 0);
        // бак солярки на опорах
        for (const lx of [38, 60]) for (const lz of [-60, -50]) k.box(lx, 0, lz, lx + 2, 21, lz + 2, M.rust);
        for (const lx of [37, 59]) k.box(lx, 20, -61, lx + 4, 22, -47, M.metal);
        k.cyl('x', 30, -54, 7.6, 36, 64, (lx, ly, lz, q) => (lx === 36 || lx === 63) && q > 0.85 ? M.metal : M.barrel);
        k.box(48, 37, -55, 51, 39, -52, M.metal);
        k.line(63, 24, -54, 67, 16, -54, M.rubber);
        k.line(67, 16, -54, 67, 9, -54, M.rubber);
        k.box(66, 7, -55, 69, 9, -53, M.metal);
    },

    /** Двухэтажный фермерский дом: крыльцо с качелями, камин и труба, комнаты с мебелью. */
    'farm-house'(w, x, z, rot) {
        const k0 = PackAKit.at(w, x, z, rot), P = PackA;
        const k = k0.sub(-50, -40);
        const W = 100, D = 80;
        // фундамент, полы
        k.box(0, 0, 0, W, 4, D, (lx, ly, lz) => Math.min(lx, lz, W - 1 - lx, D - 1 - lz) < 3 ? (k.h(lx, ly * 5, lz) < 0.3 ? M.stone2 : M.stone) : (ly === 3 ? ((lx % 5 === 0) ? M.wood : M.plank) : PACKA_NONE));
        // крыша (конёк вдоль x), стены под ней
        const bot = k.roof(-3, W + 3, -3, D + 3, 63.2, 0.8, 2, 'x', (lx, ly, lz, d) => (lz === -3 || lz === D + 2) ? M.trim : (Math.abs(lz - 39.5) < 1 ? M.stone2 : M.slate));
        k.walls(W, D, 4, bot, 2, (face, u, ly, layer) => {
            const len = face < 2 ? W : D;
            if (u < 2 || u >= len - 2) return M.trim;
            if (face < 2 && ly >= 62 && ly < 64) return M.trim;
            if (layer === 0 && ly % 3 === 0) return 0;
            return M.siding;
        });
        // перекрытия
        k.box(2, 32, 2, W - 2, 34, D - 2, (lx, ly, lz) => (lx >= 41 && lx < 51 && lz >= 30 && lz < 65) ? PACKA_NONE : ((lx % 5 === 0) ? M.wood : M.plank));
        k.box(2, 62, 2, W - 2, 64, D - 2, (lx) => lx % 5 === 0 ? M.wood : M.plank);
        // перегородки (доска) с проёмами
        for (const px of [38, 60]) {
            k.box(px, 4, 2, px + 2, 32, D - 2, M.plank);
            k.box(px, 34, 2, px + 2, 62, D - 2, M.plank);
            k.box(px, 4, 8, px + 2, 25, 18, 0);
            k.box(px, 34, 66, px + 2, 55, 76, 0);
            k.box(px, 34, 10, px + 2, 55, 20, 0);
        }
        k.box(60, 4, 66, 62, 25, 76, 0);
        k.box(62, 34, 40, W - 2, 62, 42, M.plank);
        k.box(51, 34, 30, 52, 44, 65, (lx, ly, lz) => ly === 43 || lz % 3 === 0 ? M.trim : PACKA_NONE);
        // лестница
        k.stairs(41, 51, 20, 4, 34, 3, M.wood);
        // окна и двери
        const win = { frame: M.trim, bars: M.trim, shutter: M.cargreen };
        for (const [u0, u1] of [[10, 20], [24, 34], [66, 76], [82, 92]]) k.hole(W, D, 0, u0, u1, 12, 26, 2, 'win', win);
        for (const [u0, u1] of [[10, 20], [24, 34], [66, 76], [82, 92]]) k.hole(W, D, 0, u0, u1, 42, 56, 2, 'win', win);
        k.hole(W, D, 0, 46, 54, 44, 54, 2, 'win', { frame: M.trim, bars: M.trim });
        k.hole(W, D, 0, 45, 55, 4, 25, 2, 'door', { frame: M.trim, leaf: M.cargreen, leafEdge: M.trim });
        for (const [u0, u1] of [[14, 24], [24, 34]]) { k.hole(W, D, 1, u0 + (u0 === 24 ? 2 : 0), u1, 12, 26, 2, 'win', { frame: M.trim, bars: M.trim }); k.hole(W, D, 1, u0 + (u0 === 24 ? 2 : 0), u1, 42, 56, 2, 'win', { frame: M.trim, bars: M.trim }); }
        k.hole(W, D, 1, 76, 86, 16, 26, 2, 'win', { frame: M.trim, bars: M.trim });
        k.hole(W, D, 1, 76, 84, 46, 54, 2, 'win', { frame: M.trim });
        for (const face of [2, 3]) {
            k.hole(W, D, face, 16, 26, 12, 26, 2, 'win', win);
            k.hole(W, D, face, 16, 26, 42, 56, 2, 'win', win);
            k.hole(W, D, face, 36, 44, 70, 78, 2, 'win', { frame: M.trim, bars: M.trim });
        }
        k.hole(W, D, 2, 56, 66, 12, 26, 2, 'win', win);
        k.hole(W, D, 2, 56, 66, 42, 56, 2, 'win', win);
        k.hole(W, D, 3, 56, 64, 46, 54, 2, 'win', { frame: M.trim });
        k.hole(W, D, 3, 56, 66, 4, 25, 2, 'door', { frame: M.trim, leaf: M.wood });
        k.box(W, 0, 54, W + 4, 3, 68, M.stone);
        // камин и труба (снаружи у левого фронтона)
        const chim = (lx, ly, lz) => ly % 3 === 2 ? M.brick2 : (k.h(lx, ly, lz) < 0.1 ? M.mortar : M.brick);
        k.box(-6, 0, 36, 0, 70, 44, chim);
        k.box(-5, 70, 37, -1, 108, 43, chim);
        k.box(-6, 106, 36, 0, 108, 44, M.concrete2);
        k.box(-4, 100, 39, -2, 108, 41, 0);
        k.box(2, 4, 34, 8, 20, 46, chim);
        k.box(2, 4, 37, 7, 12, 43, 0);
        k.box(2, 20, 33, 10, 21, 47, M.darkwood);
        k.box(8, 3, 34, 12, 4, 46, M.stone2);
        k.box(3, 4, 38, 6, 6, 42, (lx, ly) => ly === 4 ? M.darkwood : M.wood);
        // крыльцо: настил, решётка, столбы, перила, навес, качели
        k.box(0, 0, -22, W, 3, 0, (lx, ly, lz) => (lz === -22 || lx === 0 || lx === W - 1) ? ((ly === 1 || (lx + lz) % 3 === 0) ? M.trim : PACKA_NONE) : PACKA_NONE);
        k.box(0, 3, -22, W, 4, 0, (lx) => lx % 4 === 0 ? M.wood : M.plank);
        k.box(42, 0, -25, 58, 2, -22, M.plank);
        for (const px of [1, 24, 74, 97]) k.box(px, 4, -21, px + 2, 30, -19, M.trim);
        k.box(0, 28, -21, W, 30, -19, M.trim);
        for (let lx = 1; lx < W - 1; lx++) {
            if (lx >= 40 && lx < 60) continue;
            k.p(lx, 12, -20, M.trim); if (lx % 3 === 0) k.box(lx, 4, -20, lx + 1, 12, -19, M.trim);
        }
        for (const px of [1, W - 2]) for (let lz = -19; lz < 0; lz++) { k.p(px, 12, lz, M.trim); if (lz % 3 === 0) k.box(px, 4, lz, px + 1, 12, lz + 1, M.trim); }
        k.roof(-1, W + 1, -24, 0, 30, 0.25, 2, 'shed', (lx, ly, lz) => lz === -24 ? M.trim : M.slate);
        for (const sx of [62, 77]) k.box(sx, 13, -10, sx + 1, 32, -9, M.cable);
        k.box(62, 12, -12, 78, 13, -7, M.plank);
        k.box(62, 13, -8, 78, 19, -7, (lx, ly) => ly === 18 || lx % 3 === 0 ? M.wood : PACKA_NONE);
        P.chair(k, 20, -12, 0, 4, M.wood);
        P.chair(k, 32, -12, 0, 4, M.wood);
        P.table(k, 26, -14, 3, 3, 0, 4);
        // гостиная
        P.sofa(k, 26, 40, 24, 3, 4, M.fabric);
        P.table(k, 16, 40, 4, 7, 0, 4);
        P.chair(k, 18, 60, 3, 4, M.canvas);
        P.bookcase(k, 26, 76, 14, 22, 0, 4);
        P.tv(k, 26, 6, 2, 4);
        // кухня и столовая
        k.box(64, 4, 70, W - 2, 14, 78, (lx, ly, lz) => {
            if (lx >= 80 && lx < 86) return PACKA_NONE;
            if (lx >= 64 && lx < 72) return PACKA_NONE;
            if (ly === 13) return (lx >= 88 && lx < 94 && lz < 76) ? PACKA_NONE : M.tile;
            if (ly === 12 && lx >= 88 && lx < 94 && lz < 76) return M.metal;
            return lz === 70 && (lx % 6 === 0 || ly === 4) ? M.wood : M.darkwood;
        });
        k.box(72, 22, 74, W - 2, 30, 78, (lx, ly, lz) => lz === 74 && (lx % 7 === 0) ? M.wood : M.darkwood);
        P.stove(k, 83, 74, 0, 4);
        P.fridge(k, 67, 74, 0, 4);
        P.table(k, 80, 20, 8, 5, 0, 4);
        for (const [cx, cz, f] of [[74, 12, 2], [84, 12, 2], [74, 28, 0], [84, 28, 0]]) P.chair(k, cx, cz, f, 4, M.wood);
        // спальни наверху
        P.bed(k, 14, 50, 3, 34, 7, M.canvas);
        P.wardrobe(k, 30, 75, 0, 34);
        P.table(k, 6, 64, 2, 2, 0, 34);
        P.bed(k, 88, 16, 1, 34, 5, M.carblue);
        P.desk(k, 80, 34, 0, 34);
        P.chair(k, 80, 29, 2, 34, M.wood);
        // ванная: ванна и раковина
        k.box(64, 34, 66, 90, 40, 76, (lx, ly, lz) => (lx === 64 || lx === 89 || lz === 66 || lz === 75 || ly === 34) ? M.tile : (ly < 37 ? M.water : PACKA_NONE));
        k.box(92, 34, 60, 96, 43, 64, M.tile);
        // светильники
        for (const [lx, lz] of [[19, 40], [80, 22], [80, 60], [50, 10]]) k.box(lx, 31, lz, lx + 2, 32, lz + 2, M.lamp);
        for (const [lx, lz] of [[19, 40], [80, 20], [80, 58]]) k.box(lx, 61, lz, lx + 2, 62, lz + 2, M.lamp);
    },

    /** Трактор с прицепом, гружёным большими тюками (все — тела). */
    'farm-tractor'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot), P = PackA;
        // трактор: перед −z
        const T = k;
        T.box(-11, 0, -23, 11, 33, 22, (lx, ly, lz) => {
            const ax = Math.abs(lx + 0.5);
            // задние колёса
            { const dy = ly + 0.5 - 8.5, dz = lz + 0.5 - 10.5, q = Math.sqrt(dy * dy + dz * dz);
                if (ax >= 6 && ax < 11 && q <= 8.6) return q < 4.5 ? (ax < 8 ? M.caryellow : M.tin) : (q > 7.6 && ax > 9 && (Math.floor(Math.atan2(dy, dz) * 4) & 1) ? PACKA_NONE : M.rubber);
                if (ax > 6.5 && ax < 11 && q <= 10.4 && dy > -1) return q >= 8.6 ? M.cargreen : PACKA_NONE; }
            // передние колёса
            { const dy = ly + 0.5 - 5.5, dz = lz + 0.5 - (-12.5), q = Math.sqrt(dy * dy + dz * dz);
                if (ax >= 5 && ax < 9 && q <= 5.6) return q < 2.8 ? M.caryellow : M.rubber; }
            if (ax < 1.5 && ly >= 4 && ly < 7 && lz >= -13 && lz < -11) return M.metal;            // передний мост
            if (ax < 6.5 && ly >= 7 && ly < 10 && lz >= 9 && lz < 12) return M.metal;             // задний мост
            if (lz < -19 && lz >= -23) return ax < 4 && ly >= 3 && ly < 9 ? M.cable : PACKA_NONE;    // грузы
            if (ax < 4 && ly >= 3 && ly < 9 && lz >= -19 && lz < 10) return M.cable;               // рама
            if (ax < 5 && ly >= 9 && ly < 16 && lz >= -19 && lz < -2) {                            // капот
                if (lz === -19) return ly % 2 ? M.metal : M.cable;
                if (ly === 15 && ax < 3) return M.cargreen;
                return ax > 4 && ly < 14 && (lz % 3 === 0) ? M.cable : M.cargreen;
            }
            if (ax < 5 && ly === 14 && lz === -19) return M.lamp;
            if (lx >= 2 && lx < 4 && lz >= -8 && lz < -6 && ly >= 16 && ly < 26) return M.metal;     // выхлоп
            if (ax < 7 && ly === 10 && lz >= -2 && lz < 13) return M.metal;                         // пол кабины
            if (ax < 4 && lz >= 7 && lz < 10 && ly >= 11 && ly < 14) return M.rubber;               // сиденье
            if (ax < 4 && lz >= 9 && lz < 11 && ly >= 14 && ly < 19) return M.rubber;
            if (ax < 1 && lz >= -2 && lz < 0 && ly >= 11 && ly < 18) return M.metal;                 // руль
            if (ax < 3 && lz >= -1 && lz < 1 && ly === 18) return M.rubber;
            const post = (ax >= 6 && ax < 7) && (lz === -2 || lz === 12);
            if (post && ly >= 11 && ly < 30) return M.cargreen;
            if (ax < 7.5 && ly === 30 && lz >= -3 && lz < 14) return M.cargreen;
            if (ax < 6 && lz === -2 && ly >= 16 && ly < 30) return M.glass;
            if (ax < 6 && lz === 12 && ly >= 18 && ly < 30) return M.glass;
            if (ax < 1 && lz >= 18 && lz < 22 && ly >= 6 && ly < 8) return M.metal;                  // сцепка
            if (ax < 2 && lz >= 12 && lz < 18 && ly >= 6 && ly < 9) return M.metal;
            return PACKA_NONE;
        });
        T.dyn(-11, 0, -23, 11, 33, 22);
        // прицеп (за трактором, +z)
        const R = k.sub(0, 58);
        R.box(-11, 0, -36, 11, 24, 26, (lx, ly, lz) => {
            const ax = Math.abs(lx + 0.5);
            for (const wz of [-15, 15]) { const dy = ly + 0.5 - 4.5, dz = lz + 0.5 - (wz + 0.5), q = Math.sqrt(dy * dy + dz * dz); if (ax >= 7 && ax < 10 && q <= 4.6) return q < 2 ? M.tin : M.rubber; }
            if (ax < 7 && ly >= 4 && ly < 5 && (lz === -15 || lz === 15)) return M.metal;
            if (lz < -25) return ax < 1 && ly >= 6 && ly < 8 ? M.metal : PACKA_NONE;                // дышло
            if (lz >= -25 && lz < -22 && ax < 6 && ly >= 6 && ly < 8 && Math.abs(ax - (lz + 25) * 2) < 2.3) return M.metal;
            if (lz >= -25 && lz < 25 && ly >= 5 && ly < 9 && (ax >= 5 && ax < 7)) return M.metal;  // рама
            if (lz >= -25 && lz < 25 && ly >= 9 && ly < 11) return (lx + 40) % 4 === 0 ? M.wood : M.plank;  // настил
            const edge = ax >= 10 || lz === -25 || lz === 24;
            if (edge && ly >= 11 && ly < 20 && lz >= -25 && lz < 25) return ((lz + 40) % 10 === 0 || ly === 19 || ((lx + 40) % 10 === 0 && (lz === -25 || lz === 24))) ? M.darkwood : PACKA_NONE;
            return PACKA_NONE;
        });
        R.dyn(-11, 0, -36, 11, 20, 26);
        for (const bz of [-24, -12, 0, 12]) { P.bigBale(R, -11, 11, bz); if (bz < 12) P.bigBale(R, -11, 20, bz + 6); }
    },

    /** Ветряк-насос на решётчатой башне: ротор из лопастей, хвост-флюгер, насос и поилка. */
    'farm-windpump'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        const off = y => 15 - (y - 2) * (12 / 98);
        const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [sx, sz] of C) {
            k.box(sx * 15 - 2, 0, sz * 15 - 2, sx * 15 + 3, 2, sz * 15 + 3, M.concrete);
            k.line(sx * 15, 2, sz * 15, sx * 3, 100, sz * 3, M.tin, 2);
        }
        const lv = [2, 18, 34, 50, 66, 82, 99];
        for (let i = 0; i < lv.length; i++) {
            const y = lv[i], o = Math.round(off(y));
            for (let e = 0; e < 4; e++) {
                const [ax, az] = C[e], [bx, bz] = C[(e + 1) % 4];
                if (i > 0) k.line(ax * o, y, az * o, bx * o, y, bz * o, M.tin);
                if (i < lv.length - 1) {
                    const y2 = lv[i + 1], o2 = Math.round(off(y2));
                    k.line(ax * o, y, az * o, bx * o2, y2, bz * o2, M.tin);
                    k.line(bx * o, y, bz * o, ax * o2, y2, az * o2, M.tin);
                }
            }
        }
        k.box(-6, 100, -6, 6, 101, 6, (lx, ly, lz) => (lx + lz) % 4 === 0 ? M.wood : M.plank);
        k.box(-2, 101, -4, 3, 107, 5, M.metal);
        k.cyl('z', 0.5, 106.5, 2.5, -12, -4, M.metal);
        // ротор: внутреннее и внешнее кольцо, 16 лопастей
        k.cyl('z', 0.5, 106.5, 20, -11, -9, M.tin, 18.3);
        k.cyl('z', 0.5, 106.5, 8.2, -11, -9, M.tin, 6.5);
        for (let i = 0; i < 16; i++) {
            const a = i / 16 * Math.PI * 2;
            k.line(Math.round(Math.cos(a) * 2), Math.round(106 + Math.sin(a) * 2), -10, Math.round(Math.cos(a) * 19), Math.round(106 + Math.sin(a) * 19), -10, i % 4 === 0 ? M.carred : M.tin, 2);
        }
        // хвост
        k.box(0, 105, 4, 1, 107, 30, M.metal);
        k.box(0, 98, 22, 1, 114, 42, (lx, ly, lz) => {
            const t = (lz - 22) / 20, h = 4 + t * 4;
            if (Math.abs(ly + 0.5 - 106) > h) return PACKA_NONE;
            return lz > 38 || Math.abs(ly + 0.5 - 106) > h - 1.2 ? M.carred : M.tin;
        });
        // насос и поилка (шток не касается насоса — башня держится только на ногах)
        k.box(0, 13, 0, 1, 100, 1, M.metal);
        k.box(-2, 0, -2, 3, 11, 3, M.rust);
        k.box(3, 8, 0, 22, 9, 1, M.metal);
        k.box(18, 0, -6, 40, 6, 6, (lx, ly, lz) => (lx === 18 || lx === 39 || lz === -6 || lz === 5 || ly === 0) ? M.metal : (ly < 4 ? M.water : PACKA_NONE));
    },

    /** Водонапорный бак на деревянных опорах: клёпки обручей, конусная крыша, лестница. */
    'farm-watertank'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        const S = [[-13, -13], [10, -13], [10, 10], [-13, 10]];
        for (const [sx, sz] of S) { k.box(sx - 1, 0, sz - 1, sx + 4, 2, sz + 4, M.concrete); k.box(sx, 2, sz, sx + 3, 44, sz + 3, M.darkwood); }
        for (let e = 0; e < 4; e++) {
            const [ax, az] = S[e], [bx, bz] = S[(e + 1) % 4];
            k.line(ax + 1, 6, az + 1, bx + 1, 40, bz + 1, M.plank);
            k.line(bx + 1, 6, bz + 1, ax + 1, 40, az + 1, M.plank);
            k.line(ax + 1, 23, az + 1, bx + 1, 23, bz + 1, M.wood, 2);
        }
        k.box(-13, 42, -13, 13, 44, -10, M.darkwood); k.box(-13, 42, 10, 13, 44, 13, M.darkwood);
        k.box(-16, 44, -16, 16, 46, 16, (lx) => (lx + 16) % 4 === 0 ? M.wood : M.plank);
        k.cyl('y', 0, 0, 15, 46, 47, M.plank);
        k.cyl('y', 0, 0, 15, 47, 75, (lx, ly, lz) => (Math.floor((Math.atan2(lz + 0.5, lx + 0.5) + 4) * 12 / Math.PI) & 1) ? M.plank : M.wood, 13.4);
        for (const y of [50, 58, 66, 73]) k.cyl('y', 0, 0, 15.8, y, y + 1, M.metal, 14.6);
        k.cyl('y', 0, 0, 13.5, 47, 66, M.water);
        k.cyl('y', 0, 0, 16.5, 75, 86, (lx, ly, lz, q) => {
            const d = q * 16.5, t = Math.floor(75 + (16.5 - d) * 0.62);
            return ly <= t && ly > t - 2 ? M.slate : PACKA_NONE;
        });
        k.box(0, 85, 0, 1, 90, 1, M.metal);
        // лестница и труба
        for (const rz of [-3, 2]) k.box(14, 0, rz, 15, 50, rz + 1, M.darkwood);
        for (let ly = 3; ly < 50; ly += 4) k.box(14, ly, -2, 15, ly + 1, 2, M.wood);
        k.box(13, 44, -3, 14, 46, 3, M.darkwood);
        k.box(4, 5, 4, 6, 44, 6, M.metal);
        k.box(4, 5, 6, 6, 7, 10, M.metal);
    },

    /** Большой стог сена с шестом (статичный, горит). */
    'farm-haystack'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        for (let lz = -26; lz < 26; lz++) for (let lx = -26; lx < 26; lx++) {
            const d = Math.hypot(lx + 0.5, lz + 0.5) / 24;
            if (d > 1.05) continue;
            const hgt = Math.round(40 * (1 - Math.pow(Math.min(1, d), 1.7)) + (PackA.vnoise(k.wx(lx, lz), k.wz(lx, lz), 5) - 0.5) * 5);
            if (hgt > 0) k.box(lx, 0, lz, lx + 1, hgt, lz + 1, (a, ly) => PackA.hash(lx, ly, lz) < 0.15 ? M.crop : M.hay);
        }
        k.box(0, 0, 0, 1, 48, 1, M.darkwood);
    },

    /** Рулоны сена у амбара: ряд лёжа, стопка стоя и тюки (тела). */
    'farm-bales'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot), P = PackA;
        for (const bx of [-40, -24, -8]) P.roundBale(k, bx, 0, 0, false);
        P.roundBale(k, 10, 0, 0, true); P.roundBale(k, 10, 0, 12, true);
        P.roundBale(k, 26, 0, 0, true);
        for (const [bx, bz, ly] of [[36, -5, 0], [36, 0, 0], [36, -3, 5]]) P.bale(k, bx, ly, bz);
    },

    /** Курятник на ножках с трапом и гнёздами. */
    'farm-coop'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        for (const [lx, lz] of [[-10, -7], [8, -7], [-10, 5], [8, 5]]) k.box(lx, 0, lz, lx + 2, 9, lz + 2, M.darkwood);
        k.box(-10, 8, -7, 10, 9, 7, M.plank);
        const top = k.roof(-12, 12, -9, 9, 20, 0.9, 2, 'x', M.tin);
        k.sub(-10, -7).walls(20, 14, 9, (lx, lz) => top(lx - 10, lz - 7), 1, (face, u, ly) => (face < 2 ? (u === 0 || u === 19) : (u === 0 || u === 13)) ? M.trim : M.barnred);
        k.box(-3, 9, -7, 3, 18, -6, 0);
        k.box(5, 12, -7, 8, 16, -6, M.glass);
        k.box(10, 9, -4, 14, 14, 4, (lx, ly, lz) => ly === 13 || lx === 13 || lz === -4 || lz === 3 || ly === 9 ? M.barnred : (ly === 10 ? M.hay : PACKA_NONE));
        k.line(0, 8, -8, 0, 0, -20, M.plank, 2);
        k.line(-2, 8, -8, -2, 0, -20, M.plank, 2);
        k.line(1, 8, -8, 1, 0, -20, M.plank, 2);
    },

    /** Поленница под навесом, колода с топором. */
    'farm-woodpile'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.box(-15, 0, -3, 15, 12, 3, (lx, ly, lz) => {
            const cy = ly % 3, cz = (lz + 3) % 3;
            if ((cy === 0 || cy === 2) && (cz === 0 || cz === 2) && ly > 0 && PackA.hash(Math.floor(ly / 3), lz, 7) < 0.7) return PACKA_NONE;
            if (lx === -15 || lx === 14) return cy === 1 && cz === 1 ? M.plank : M.wood;
            return M.darkwood;
        });
        for (const px of [-17, 15]) k.box(px, 0, -4, px + 2, 18, -2, M.darkwood);
        k.box(-17, 18, -6, 17, 19, 5, M.tin);
        for (const px of [-17, 15]) k.box(px, 0, 2, px + 2, 18, 4, M.darkwood);
        k.cyl('y', 0, -12, 3, 0, 5, (lx, ly, lz, q) => ly === 4 && q < 0.6 ? M.plank : M.wood);
        k.box(1, 5, -12, 2, 9, -11, M.darkwood);
        k.box(0, 5, -13, 3, 6, -12, M.metal);
    },

    /** Пастбищная изгородь из жердей: прямоугольник по scale, калитка у переднего угла. */
    'farm-fence'(w, x, z, rot, mk) {
        const k = PackAKit.at(w, x, z, rot), P = PackA;
        const s = (mk && mk.scale) || [1, 1, 1];
        const hx = Math.round((s[0] || 1) * 10), hz = Math.round((s[2] || 1) * 10);
        P.fence(k, -hx, -hz, hx, -hz, 'rail', [[10, 42]]);
        P.fence(k, hx, -hz, hx, hz, 'rail');
        P.fence(k, hx, hz, -hx, hz, 'rail');
        P.fence(k, -hx, hz, -hx, -hz, 'rail');
        k.box(-hx + 10, 0, -hz - 6, -hx + 11, 13, -hz, M.darkwood);
        k.box(-hx + 10, 4, -hz - 6, -hx + 11, 11, -hz - 5, M.wood);
    },

    /** Пугало посреди пшеницы. */
    'farm-scarecrow'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.box(0, 0, 0, 2, 24, 2, M.darkwood);
        k.box(-9, 17, 0, 11, 19, 2, M.plank);
        k.box(-4, 8, -1, 6, 19, 3, (lx, ly) => ly % 3 === 0 ? M.darkwood : M.canvas);
        k.box(-9, 15, -1, 11, 19, 3, (lx, ly, lz) => lx < -4 || lx > 5 ? (lx === -9 || lx === 10 ? M.hay : M.canvas) : PACKA_NONE);
        k.ell(1, 23, 1, 3.5, 3.5, 3.5, M.hay);
        k.cyl('y', 1, 1, 5, 26, 27, M.darkwood);
        k.cyl('y', 1, 1, 2.8, 27, 31, M.darkwood);
    },

    /** Дерево фермы: размер — scale[1]. */
    'farm-tree'(w, x, z, rot, mk) {
        const k = PackAKit.at(w, x, z, rot);
        const s = (mk && mk.scale && mk.scale[1]) || 1;
        PackA.tree(k, 0, 0, Math.round(38 * s), Math.round(13 * s), x * 7 + z, PackA.hash(x, 1, z) < 0.5 ? M.leaves : M.leaves2);
    },

    'farm-mailbox'(w, x, z, rot) { PackA.mailbox(PackAKit.at(w, x, z, rot), 0, 0, 0, M.metal); },
});

// ======================================================================== ПРИГОРОД

Object.assign(GameMapBuild.builders, {
    /** Земля пригорода: улица с разметкой и зеброй, бордюры, тротуары, дорожки и въезды, клумбы, холмы по краям. */
    'suburb-terrain'(w) {
        const K = PackAKit.world(w);
        PackA.edgeHills(w, 30, 14, 7);
        PackA.flatten(w, 0, 200, 512, 330, M.grass);
        K.box(0, -1, 230, 512, 0, 300, (x, y, z) => {
            if (z >= 264 && z < 266 && (x % 40) < 22) return M.paint;
            if (x >= 440 && x < 470 && z >= 234 && z < 296 && (z % 8) < 4) return M.paint;
            if ((x === 438 || x === 471) && z >= 232 && z < 298) return M.paint;
            return PackA.hash(x, 1, z) < 0.015 ? M.concrete2 : M.asphalt;
        });
        const walk = (x0, z0, x1, z1) => K.box(x0, -1, z0, x1, 0, z1, (x, y, z) => ((x + z) % 20 === 0) ? M.concrete2 : M.concrete);
        walk(0, 208, 512, 228); walk(0, 302, 512, 322);
        K.box(0, 0, 228, 512, 1, 230, M.concrete2); K.box(0, 0, 300, 512, 1, 302, M.concrete2);
        // въезды (бордюр срезан) и дорожки к дверям
        for (const [x0, x1, z0, z1] of [[148, 172, 96, 230], [184, 220, 158, 230], [335, 371, 158, 230], [138, 170, 300, 387], [340, 376, 300, 388]]) {
            K.box(x0, -1, z0, x1, 0, z1, (x, y, z) => (z % 24 === 0) ? M.concrete2 : M.concrete);
            K.box(x0, 0, z0 < 230 ? 228 : 300, x1, 1, z0 < 230 ? 230 : 302, 0);
        }
        for (const [x0, x1, z0, z1] of [[90, 100, 158, 208], [266, 276, 158, 208], [407, 417, 158, 208], [94, 104, 322, 377], [428, 438, 322, 378]]) K.box(x0, -1, z0, x1, 0, z1, M.stone);
        // люки и решётки ливнёвки
        K.cyl('y', 150, 250, 3.2, -1, 0, M.metal); K.cyl('y', 380, 282, 3.2, -1, 0, M.metal);
        for (const gx of [60, 300, 470]) { K.box(gx, -1, 230, gx + 6, 0, 232, M.cable); K.box(gx, -1, 298, gx + 6, 0, 300, M.cable); }
        // клумбы вдоль фасадов
        for (const [x0, x1, z0, z1] of [[48, 88, 160, 166], [102, 142, 160, 166], [226, 264, 160, 166], [376, 404, 160, 166], [50, 92, 370, 376], [440, 466, 364, 370]]) {
            K.box(x0, -1, z0, x1, 0, z1, M.soil);
            for (let bx = x0 + 3; bx < x1 - 2; bx += 7) PackA.bush(K, bx, (z0 + z1) >> 1, 3.2, PackA.hash(bx, 2, z0) < 0.5 ? M.leaves : M.leaves2);
        }
    },

    /** Дом A: двухэтажный кирпичный с портиком, ставнями и вальмовой крышей. */
    'suburb-houseA'(w, x, z, rot) {
        const P = PackA, W = 96, D = 76, k = PackAKit.at(w, x, z, rot).sub(-48, -38);
        const bot = k.roof(-4, W + 4, -4, D + 4, 60.5, 0.55, 2, 'hip', (lx, ly, lz) => Math.min(lx + 4, W + 3 - lx, lz + 4, D + 3 - lz) < 1 ? M.trim : M.slate);
        const win = { frame: M.trim, bars: M.trim, shutter: M.carblue, sillMat: M.concrete };
        const holes = [];
        for (const u of [10, 26, 58, 74]) holes.push([0, u, u + 12, 9, 24, 'win', win]);
        for (const u of [10, 26, 42, 58, 74]) holes.push([0, u, u + 12, 39, 54, 'win', win]);
        holes.push([0, 43, 53, 2, 23, 'door', { frame: M.trim, leaf: M.carred, leafEdge: M.trim }]);
        for (const u of [12, 76]) { holes.push([1, u, u + 10, 9, 24, 'win', win]); holes.push([1, u, u + 10, 39, 54, 'win', win]); }
        holes.push([1, 30, 40, 13, 24, 'win', { frame: M.trim, bars: M.trim }]);
        holes.push([1, 60, 70, 39, 54, 'win', win]);
        holes.push([1, 46, 56, 2, 23, 'door', { frame: M.trim, leaf: M.wood }]);
        for (const f of [2, 3]) for (const u of [18, 48]) { holes.push([f, u, u + 10, 9, 24, 'win', win]); holes.push([f, u, u + 10, 39, 54, 'win', win]); }
        const rail = (lx, ly, lz) => ly === 41 || lz % 3 === 0 ? M.trim : PACKA_NONE;
        P.shell(k, {
            W, D, t: 3, base: 2, bot, wall: P.brickWall(4, 30),
            slabs: [[30, 32, [[40, 50, 28, 65]]], [60, 62]],
            parts: [[36, 2, 3, 38, 60, 73, M.plank], [58, 2, 3, 60, 60, 73, M.plank], [3, 32, 36, 36, 60, 38, M.plank], [60, 32, 36, 93, 60, 38, M.plank], [50, 32, 28, 51, 42, 65, rail]],
            cuts: [[36, 2, 6, 38, 23, 16], [58, 2, 6, 60, 23, 16], [36, 2, 56, 38, 23, 66], [58, 2, 56, 60, 23, 66],
                [36, 32, 8, 38, 53, 18], [58, 32, 8, 60, 53, 18], [36, 32, 56, 38, 53, 66], [58, 32, 56, 60, 53, 66]],
            holes, lamps: [[18, 29, 36], [76, 29, 20], [76, 29, 56], [47, 29, 8], [18, 59, 18], [18, 59, 56], [76, 59, 18], [76, 59, 56]],
        });
        k.stairs(40, 50, 20, 2, 32, 3, M.wood);
        // портик: ступени, колонны, фронтон
        k.box(38, 0, -12, 58, 1, 0, M.concrete); k.box(40, 1, -7, 56, 2, 0, M.concrete);
        for (const cx of [40, 55]) k.cyl('y', cx + 0.5, -9.5, 1.7, 1, 28, M.trim);
        k.box(37, 28, -12, 59, 30, 0, M.trim);
        const pb = k.roof(36, 60, -14, 1, 29, 0.6, 2, 'z', M.slate);
        for (let lx = 37; lx < 59; lx++) k.box(lx, 30, -13, lx + 1, pb(lx, -13), -12, M.trim);
        // мебель: гостиная, столовая, кухня
        P.tv(k, 18, 6, 2, 2); P.sofa(k, 18, 26, 22, 0, 2, M.fabric); P.table(k, 18, 17, 4, 3, 0, 2); P.chair(k, 31, 16, 3, 2, M.canvas); P.bookcase(k, 5, 50, 16, 22, 1, 2);
        P.table(k, 74, 18, 7, 4, 0, 2);
        for (const [cx, cz, f] of [[70, 12, 2], [78, 12, 2], [70, 24, 0], [78, 24, 0]]) P.chair(k, cx, cz, f, 2);
        k.box(61, 2, 66, 93, 11, 73, (lx, ly, lz) => (lx < 68 || (lx >= 78 && lx < 84)) ? PACKA_NONE : ly === 10 ? M.tile : (lz === 66 && lx % 6 === 0 ? M.wood : M.darkwood));
        k.box(68, 20, 70, 93, 27, 73, M.darkwood);
        P.fridge(k, 64, 69, 0, 2); P.stove(k, 81, 70, 0, 2);
        // спальни и ванная
        P.bed(k, 24, 16, 3, 32, 7, M.canvas); P.wardrobe(k, 10, 32, 0, 32);
        k.box(5, 32, 58, 30, 38, 71, (lx, ly, lz) => (lx === 5 || lx === 29 || lz === 58 || lz === 70 || ly === 32) ? M.tile : (ly < 35 ? M.water : PACKA_NONE));
        k.box(6, 32, 42, 11, 38, 48, M.tile);
        P.bed(k, 70, 16, 1, 32, 5, M.carblue); P.desk(k, 86, 30, 0, 32); P.chair(k, 86, 25, 2, 32);
        P.bed(k, 78, 60, 0, 32, 6, M.goods_g); P.bookcase(k, 90, 46, 12, 18, 3, 32);
    },

    /** Дом B: одноэтажное ранчо с обшивкой, панорамным окном и гаражом (машина, стеллаж, косилка), баскетбольное кольцо. */
    'suburb-houseB'(w, x, z, rot) {
        const P = PackA, k = PackAKit.at(w, x, z, rot).sub(-67, -35), W = 90, D = 70;
        const edge = (W2, D2, o) => (lx, ly, lz) => Math.min(lx + o, W2 + o - 1 - lx, lz + o, D2 + o - 1 - lz) < 1 ? M.trim : M.roof;
        const bot = k.roof(-4, W + 4, -4, D + 4, 29, 0.45, 2, 'hip', edge(W, D, 4));
        const win = { frame: M.trim, bars: M.trim, sillMat: M.trim };
        P.shell(k, {
            W, D, t: 2, base: 2, bot, wall: P.sidingWall(M.siding2, W, D, 4),
            slabs: [[28, 30]],
            parts: [[2, 2, 40, 88, 28, 42, M.plank], [50, 2, 2, 52, 28, 40, M.plank], [44, 2, 42, 46, 28, 68, M.plank]],
            cuts: [[20, 2, 40, 30, 23, 42], [60, 2, 40, 70, 23, 42], [50, 2, 8, 52, 24, 34], [88, 2, 40, 92, 23, 50]],
            holes: [[0, 8, 36, 8, 26, 'win', { ...win, grid: 9 }], [0, 38, 48, 2, 23, 'door', { frame: M.trim, leaf: M.carred, leafEdge: M.trim }],
                [0, 62, 72, 10, 24, 'win', win], [0, 76, 86, 10, 24, 'win', win],
                [1, 10, 28, 10, 24, 'win', { ...win, grid: 9 }], [1, 58, 76, 10, 24, 'win', { ...win, grid: 9 }], [1, 34, 40, 16, 24, 'win', win],
                [2, 18, 30, 10, 24, 'win', win], [2, 48, 60, 10, 24, 'win', win]],
            lamps: [[22, 27, 20], [70, 27, 20], [22, 27, 54], [66, 27, 54]],
        });
        k.box(36, 0, -10, 50, 2, 0, M.concrete);
        k.box(48, 18, -1, 50, 20, 0, M.lamp);
        // гараж
        const g = k.sub(90, 10);
        const gb = g.roof(-2, 48, -4, 64, 27, 0.45, 2, 'hip', edge(44, 60, 2));
        P.shell(g, {
            W: 44, D: 60, t: 2, base: 2, bot: gb, wall: P.sidingWall(M.siding2, 44, 60, 4), floor: () => M.concrete,
            holes: [[0, 6, 38, 2, 24, 'hole', { frame: M.trim }], [3, 20, 30, 10, 20, 'win', win]],
        });
        P.hang(g, 21, 30, 24, gb);
        g.box(6, 24, 2, 38, 25, 24, (lx) => lx % 4 === 0 ? M.metal : M.carwhite);
        P.car(g, 22, 32, 0, M.carred, 'sedan', 2);
        P.bookcase(g, 10, 56, 14, 20, 0, 2);
        P.mower(g, 37, 48, 0, 2);
        g.box(38, 2, 8, 42, 11, 26, (lx, ly, lz) => ly === 10 ? M.plank : (ly === 4 ? M.wood : ((lz === 8 || lz === 25) ? M.darkwood : PACKA_NONE)));
        P.crate(g, 37, 11, 14, 4);
        // баскетбольная стойка у въезда
        g.box(40, 0, -32, 42, 36, -30, M.metal);
        g.box(28, 34, -32, 40, 36, -30, M.metal);
        g.box(22, 32, -31, 34, 40, -30, (lx, ly) => (ly === 32 || ly === 39 || lx === 22 || lx === 33 || ((lx === 25 || lx === 30) && ly < 37 && ly > 33) || (ly === 34 && lx > 24 && lx < 31)) ? M.carred : M.trim);
        g.cyl('y', 28, -27.5, 3.1, 32, 33, M.carred, 1.6);
        for (const [nx, nz] of [[25, -28], [30, -28], [27, -25], [28, -30]]) g.box(nx, 28, nz, nx + 1, 32, nz + 1, M.trim);
        // кухня, гостиная, спальни
        k.box(81, 2, 4, 88, 11, 32, (lx, ly, lz) => (lz >= 14 && lz < 20) ? PACKA_NONE : (ly === 10 ? M.tile : (lx === 81 && lz % 6 === 0 ? M.wood : M.darkwood)));
        P.stove(k, 84, 17, 3, 2); P.fridge(k, 84, 36, 3, 2);
        P.table(k, 66, 22, 6, 4, 0, 2);
        for (const [cx, cz, f] of [[63, 16, 2], [69, 16, 2], [63, 28, 0], [69, 28, 0]]) P.chair(k, cx, cz, f, 2);
        P.tv(k, 5, 20, 1, 2); P.sofa(k, 30, 20, 20, 3, 2, M.canvas); P.table(k, 18, 20, 3, 4, 0, 2);
        P.bed(k, 13, 55, 1, 2, 7, M.fabric); P.wardrobe(k, 34, 64, 0, 2);
        P.bed(k, 66, 57, 0, 2, 5, M.goods_y); P.desk(k, 82, 46, 3, 2);
    },

    /** Дом C: современный двухэтажный (штукатурка и дерево), плоские крыши с парапетом, консольный балкон со
     *  стеклянным ограждением, панорамное остекление, гараж с террасой, кондиционер и солнечные панели. */
    'suburb-houseC'(w, x, z, rot) {
        const P = PackA, k = PackAKit.at(w, x, z, rot).sub(-70, -36), W = 100, D = 72;
        const wall = (face, u, ly, layer) => {
            if (ly < 4) return M.concrete2;
            if (ly >= 62) return ly === 65 ? M.concrete : M.plaster;
            if (ly >= 30 && ly < 32) return M.concrete;
            if (ly >= 32) return u % 4 === 0 ? M.darkwood : M.wood;
            return M.plaster;
        };
        const glass = { frame: M.metal, bars: M.metal, grid: 10, sill: false };
        P.shell(k, {
            W, D, t: 2, base: 2, top: 66, wall,
            slabs: [[30, 32, [[88, 98, 14, 51]]], [60, 62, null, (lx, ly) => ly === 60 ? M.plaster : M.concrete2]],
            parts: [[64, 2, 48, 84, 30, 50, M.plaster], [64, 2, 50, 66, 30, 70, M.plaster],
                [84, 32, 2, 86, 60, 51, M.plaster], [2, 32, 36, 84, 60, 38, M.plaster], [40, 32, 38, 42, 60, 70, M.plaster]],
            cuts: [[64, 2, 54, 66, 23, 64], [84, 32, 40, 86, 53, 50], [60, 32, 36, 70, 53, 38], [40, 32, 50, 42, 53, 60]],
            holes: [[0, 6, 52, 2, 28, 'win', glass], [0, 58, 68, 2, 23, 'door', { frame: M.metal, leaf: M.darkwood }], [0, 74, 94, 10, 24, 'win', glass],
                [0, 6, 40, 40, 52, 'win', { ...glass, grid: 9 }], [0, 56, 66, 32, 54, 'win', glass], [0, 66, 76, 32, 54, 'hole', { frame: M.metal }], [0, 80, 94, 40, 52, 'win', { ...glass, grid: 7 }],
                [1, 20, 50, 2, 26, 'win', glass], [1, 60, 70, 12, 24, 'win', glass], [1, 10, 30, 40, 52, 'win', glass], [1, 50, 70, 40, 52, 'win', glass], [1, 80, 92, 44, 50, 'win', glass],
                [2, 20, 50, 12, 24, 'win', glass], [2, 20, 40, 40, 52, 'win', glass], [3, 4, 10, 12, 24, 'win', glass], [3, 18, 28, 32, 54, 'hole', { frame: M.metal }], [3, 40, 60, 40, 52, 'win', glass]],
            lamps: [[24, 29, 30], [54, 29, 54], [24, 29, 60], [30, 59, 18], [60, 59, 54], [20, 59, 54], [90, 59, 60]],
            floor: (lx) => lx % 6 === 0 ? M.darkwood : M.wood,
        });
        k.stairs(88, 98, 6, 2, 32, 3, M.concrete);
        // консольный балкон
        k.box(50, 30, -16, 96, 32, 0, M.concrete);
        const rail = (lx, ly) => ly === 41 || lx === 50 || lx === 95 || (lx - 50) % 15 === 0 ? M.metal : M.glass;
        k.box(50, 32, -16, 96, 42, -15, rail);
        k.box(50, 32, -15, 51, 42, 0, (lx, ly, lz) => ly === 41 || lz % 5 === 0 ? M.metal : M.glass);
        k.box(95, 32, -15, 96, 42, 0, (lx, ly, lz) => ly === 41 || lz % 5 === 0 ? M.metal : M.glass);
        P.chair(k, 60, -8, 0, 32, M.metal); P.chair(k, 72, -8, 0, 32, M.metal); P.table(k, 66, -12, 3, 2, 0, 32, M.glass);
        // крыша: кондиционер и солнечные панели
        k.body(70, 62, 40, 82, 70, 50, (lx, ly, lz) => ly === 69 && (lx + lz) % 2 === 0 ? M.cable : M.metal);
        for (let lz = 8; lz < 30; lz++) {
            const y = 63 + Math.floor((lz - 8) * 0.4);
            k.box(8, y, lz, 44, y + 2, lz + 1, (lx, ly) => ly === y + 1 ? M.stained2 : M.metal);
        }
        for (const lx of [8, 25, 43]) for (const lz of [8, 29]) k.box(lx, 62, lz, lx + 1, 63 + Math.floor((lz - 8) * 0.4), lz + 1, M.metal);
        // гараж-крыло с террасой
        const g = k.sub(100, 12);
        P.shell(g, {
            W: 40, D: 60, t: 2, base: 2, top: 32, wall: (face, u, ly) => ly < 4 ? M.concrete2 : (ly >= 30 ? M.concrete : M.plaster2), floor: () => M.concrete,
            slabs: [[30, 32]], holes: [[0, 6, 36, 2, 24, 'hole', {}], [3, 20, 34, 12, 24, 'win', glass]],
        });
        g.box(6, 2, 1, 36, 24, 2, (lx, ly) => ly % 4 === 0 ? M.metal : M.carwhite);
        g.box(0, 32, 0, 40, 33, 60, (lx) => lx % 3 === 0 ? M.darkwood : M.wood);
        g.box(0, 33, 0, 40, 42, 60, (lx, ly, lz) => {
            const e = lx === 39 || lz === 0 || lz === 59;
            if (!e) return PACKA_NONE;
            return ly === 41 || (lx + lz) % 6 === 0 ? M.metal : PACKA_NONE;
        });
        P.crate(g, 4, 2, 50); P.crate(g, 10, 2, 50); P.crate(g, 6, 8, 50); P.bin(g, 32, 52, 0, 2, M.carblue);
        // интерьер: гостиная, кухня с островом, спальня, кабинет, ванная
        P.tv(k, 6, 32, 1, 2); P.sofa(k, 30, 32, 24, 3, 2, M.canvas2); P.table(k, 18, 32, 4, 5, 0, 2, M.glass);
        P.table(k, 52, 54, 6, 4, 0, 2);
        for (const [cx, cz, f] of [[49, 48, 2], [55, 48, 2], [49, 60, 0], [55, 60, 0]]) P.chair(k, cx, cz, f, 2);
        k.box(14, 2, 52, 40, 11, 58, (lx, ly) => ly === 10 ? M.tile : M.carwhite);
        k.box(4, 2, 64, 40, 11, 70, (lx, ly, lz) => (lx >= 24 && lx < 30) ? PACKA_NONE : (ly === 10 ? M.tile : M.carwhite));
        P.fridge(k, 46, 67, 0, 2); P.stove(k, 27, 67, 0, 2);
        P.bed(k, 13, 18, 1, 32, 8, M.canvas2); P.wardrobe(k, 36, 32, 0, 32); P.tv(k, 70, 4, 2, 32);
        P.desk(k, 60, 66, 0, 32); P.chair(k, 60, 60, 2, 32); P.bookcase(k, 76, 66, 12, 20, 0, 32);
        k.box(4, 32, 58, 38, 38, 69, (lx, ly, lz) => (lx === 4 || lx === 37 || lz === 58 || lz === 68 || ly === 32) ? M.tile : (ly < 35 ? M.water : PACKA_NONE));
    },

    /** Дом D: полуторный коттедж с крутой крышей, мансардными окнами, красной дверью и отдельным гаражом. */
    'suburb-houseD'(w, x, z, rot) {
        const P = PackA, k = PackAKit.at(w, x, z, rot).sub(-42, -33), W = 84, D = 66;
        const bot = k.roof(-3, W + 3, -3, D + 3, 29, 1.15, 2, 'x', (lx, ly, lz) => lz === -3 || lz === D + 2 ? M.trim : M.roof2);
        const win = { frame: M.trim, bars: M.trim, shutter: M.cargreen, sillMat: M.trim };
        P.shell(k, {
            W, D, t: 2, base: 2, bot, wall: P.sidingWall(M.siding, W, D, 4),
            slabs: [[30, 32, [[48, 58, 26, 63]]]],
            parts: [[44, 2, 2, 46, 30, 64, M.plank]],
            cuts: [[44, 2, 20, 46, 23, 30]],
            holes: [[0, 8, 20, 9, 24, 'win', win], [0, 24, 36, 9, 24, 'win', win], [0, 46, 56, 2, 23, 'door', { frame: M.trim, leaf: M.carred, leafEdge: M.trim }], [0, 62, 74, 9, 24, 'win', win],
                [1, 10, 22, 9, 24, 'win', win], [1, 60, 72, 9, 24, 'win', win], [1, 30, 40, 2, 23, 'door', { frame: M.trim, leaf: M.wood }],
                [2, 20, 32, 9, 24, 'win', win], [2, 26, 40, 40, 52, 'win', { frame: M.trim, bars: M.trim }], [3, 20, 32, 9, 24, 'win', win], [3, 26, 40, 40, 52, 'win', { frame: M.trim, bars: M.trim }]],
            lamps: [[22, 29, 30], [64, 29, 36], [30, 66, 32]],
        });
        k.stairs(48, 58, 18, 2, 32, 3, M.wood);
        // мансардные окна
        for (const u0 of [10, 58]) {
            k.box(u0, 32, 3, u0 + 16, 75, 17, 0);
            k.box(u0, 32, 3, u0 + 16, 48, 18, (lx, ly, lz) => (lx === u0 || lx === u0 + 15 || lz <= 4) ? (ly % 3 === 0 && lz === 3 ? 0 : M.siding) : PACKA_NONE);
            k.roof(u0 - 1, u0 + 17, 1, 19, 46, 0.9, 2, 'z', (lx, ly, lz) => lz === 1 ? M.trim : M.roof2);
            k.box(u0 + 4, 36, 3, u0 + 12, 45, 5, (lx, ly, lz) => lz === 4 ? (lx === u0 + 8 ? M.trim : M.glass) : 0);
            k.box(u0 + 3, 35, 2, u0 + 13, 46, 3, (lx, ly) => (lx === u0 + 3 || lx === u0 + 12 || ly === 35 || ly === 45) ? M.trim : PACKA_NONE);
        }
        // крыльцо
        k.box(42, 0, -10, 60, 2, 0, (lx) => lx % 3 === 0 ? M.wood : M.plank);
        for (const px of [43, 57]) k.box(px, 2, -9, px + 2, 26, -7, M.trim);
        const pb = k.roof(40, 62, -12, 1, 25, 0.55, 2, 'z', M.roof2);
        for (let lx = 41; lx < 61; lx++) k.box(lx, 26, -11, lx + 1, pb(lx, -11), -10, M.trim);
        k.box(41, 24, -10, 61, 26, -8, M.trim);
        // мебель
        P.tv(k, 24, 5, 2, 2); P.sofa(k, 24, 24, 20, 0, 2, M.fabric); P.chair(k, 8, 14, 1, 2, M.canvas); P.bookcase(k, 24, 61, 16, 22, 0, 2); P.table(k, 24, 15, 3, 2, 0, 2);
        k.box(76, 2, 6, 82, 11, 46, (lx, ly, lz) => (lz >= 16 && lz < 22) ? PACKA_NONE : (ly === 10 ? M.tile : M.darkwood));
        P.stove(k, 79, 19, 3, 2); P.fridge(k, 78, 52, 3, 2);
        P.table(k, 66, 14, 5, 4, 0, 2); P.chair(k, 66, 8, 2, 2); P.chair(k, 66, 20, 0, 2);
        P.bed(k, 24, 40, 0, 32, 7, M.goods_g); P.crate(k, 64, 32, 36); P.crate(k, 64, 38, 36); P.crate(k, 70, 32, 40); P.chair(k, 14, 44, 1, 32);
        // отдельный гараж
        const g = k.sub(88, 10);
        const gb = g.roof(-2, 38, -3, 49, 24, 0.6, 2, 'z', (lx, ly, lz) => lz === -3 ? M.trim : M.roof2);
        P.shell(g, {
            W: 36, D: 46, t: 2, base: 1, bot: gb, wall: P.sidingWall(M.siding, 36, 46, 3), floor: () => M.concrete,
            holes: [[0, 4, 32, 1, 21, 'hole', { frame: M.trim }], [2, 16, 26, 8, 16, 'win', { frame: M.trim, bars: M.trim }], [3, 16, 26, 8, 16, 'win', { frame: M.trim, bars: M.trim }]],
        });
        P.hang(g, 17, 22, 18, gb);
        g.box(4, 21, 2, 32, 22, 22, (lx) => lx % 4 === 0 ? M.trim : M.carwhite);
        g.box(28, 1, 26, 34, 10, 44, (lx, ly, lz) => ly === 9 ? M.plank : ((lz === 26 || lz === 43) ? M.darkwood : (ly === 3 ? M.wood : PACKA_NONE)));
        P.barrel(g, 8, 40, 1, M.carblue); P.bin(g, 16, 41, 0, 1, M.cargreen); P.crate(g, 4, 1, 26);
    },

    /** Дом E: кирпичный низ, нависающий второй этаж в обшивке, фронтонная крыша, гараж, задняя веранда с грилем и баллоном. */
    'suburb-houseE'(w, x, z, rot) {
        const P = PackA, k = PackAKit.at(w, x, z, rot).sub(-21, -35), W = 86, D = 70;
        const ku = k.sub(0, -8), DU = D + 8;
        const bot = ku.roof(-3, W + 3, -3, DU + 3, 58.4, 0.75, 2, 'z', (lx, ly, lz) => lx === -3 || lx === W + 2 ? M.trim : M.slate);
        const win = { frame: M.trim, bars: M.trim, sillMat: M.concrete };
        P.shell(k, {
            W, D, t: 3, base: 2, top: 30, wall: P.brickWall(4),
            parts: [[42, 2, 3, 44, 30, 67, M.plank]],
            cuts: [[42, 2, 10, 44, 23, 20], [42, 2, 50, 44, 23, 60], [0, 2, 40, 3, 23, 50]],
            holes: [[0, 8, 22, 9, 24, 'win', win], [0, 26, 38, 9, 24, 'win', win], [0, 48, 58, 2, 23, 'door', { frame: M.trim, leaf: M.carblue, leafEdge: M.trim }], [0, 64, 78, 9, 24, 'win', win],
                [1, 10, 22, 9, 24, 'win', win], [1, 60, 74, 9, 24, 'win', win], [1, 36, 46, 2, 23, 'door', { frame: M.trim, leaf: M.wood }],
                [3, 20, 32, 9, 24, 'win', win], [3, 46, 58, 9, 24, 'win', win]],
            lamps: [[22, 29, 34], [60, 29, 20], [60, 29, 50]],
        });
        // второй этаж (нависает на 8 вокселей вперёд)
        ku.box(0, 30, 0, W, 32, DU, (lx, ly, lz) => (lx >= 72 && lx < 82 && lz >= 26 && lz < 63) ? PACKA_NONE : (lx % 5 === 0 ? M.wood : M.plank));
        ku.walls(W, DU, 32, bot, 2, P.sidingWall(M.siding2, W, DU, 0));
        for (const [face, u0, u1, y0, y1] of [[0, 8, 22, 40, 54], [0, 30, 44, 40, 54], [0, 52, 66, 40, 54], [0, 70, 80, 40, 54], [0, 36, 50, 66, 76], [1, 10, 24, 40, 54], [1, 60, 74, 40, 54], [1, 36, 50, 66, 76], [2, 60, 74, 40, 54], [3, 20, 34, 40, 54], [3, 50, 64, 40, 54]]) {
            ku.hole(W, DU, face, u0, u1, y0, y1, 2, 'win', { frame: M.trim, bars: M.trim });
        }
        ku.box(42, 32, 2, 44, 58, 76, M.plank); ku.box(2, 32, 40, 42, 58, 42, M.plank);
        ku.box(42, 32, 56, 44, 53, 66, 0); ku.box(42, 32, 20, 44, 53, 30, 0); ku.box(20, 32, 40, 30, 53, 42, 0);
        k.stairs(72, 82, 10, 2, 32, 3, M.wood);
        // гараж слева
        const g = k.sub(-44, 10);
        const gb = g.roof(-2, 46, -3, 63, 27, 0.5, 2, 'x', (lx, ly, lz) => lz === -3 || lz === 62 ? M.trim : M.slate);
        P.shell(g, { W: 44, D: 60, t: 2, base: 2, bot: gb, wall: P.sidingWall(M.siding2, 44, 60, 4), floor: () => M.concrete, holes: [[0, 6, 38, 2, 22, 'hole', {}], [2, 24, 34, 10, 20, 'win', win]] });
        P.hang(g, 21, 30, 24, gb);
        g.box(6, 2, 1, 38, 22, 2, (lx, ly) => ly % 4 === 0 ? M.metal : (ly >= 16 && ly < 19 && lx % 5 !== 0 ? M.glass : M.carwhite));
        g.box(20, 23, -1, 24, 25, 0, M.lamp);
        P.bookcase(g, 10, 56, 14, 18, 0, 2); P.fridge(g, 38, 54, 0, 2); P.crate(g, 4, 2, 4); P.crate(g, 4, 8, 4); P.mower(g, 30, 8, 2, 2);
        // задняя веранда: гриль, баллон, стол с зонтом
        k.box(10, 0, 70, 70, 3, 92, (lx, ly, lz) => ly === 2 ? (lx % 4 === 0 ? M.wood : M.plank) : (((lx - 10) % 20 === 0 || lx === 69) && ((lz - 70) % 10 === 0 || lz === 91) ? M.darkwood : PACKA_NONE));
        for (let lx = 10; lx < 70; lx++) { if (lx >= 36 && lx < 46) continue; k.p(lx, 11, 91, M.trim); if (lx % 4 === 0) k.box(lx, 3, 91, lx + 1, 11, 92, M.trim); }
        for (const lx of [10, 69]) for (let lz = 71; lz < 91; lz++) { k.p(lx, 11, lz, M.trim); if (lz % 4 === 0) k.box(lx, 3, lz, lx + 1, 11, lz + 1, M.trim); }
        k.box(36, 0, 92, 46, 1, 96, M.plank);
        P.grill(k, 20, 83, 2, 3); P.propane(k, 29, 85, 3);
        k.body(44, 3, 75, 58, 31, 89, (lx, ly, lz) => {
            const dx = lx - 51, dz = lz - 82, r2 = dx * dx + dz * dz;
            if (ly === 10) return r2 <= 18 ? M.wood : PACKA_NONE;
            if (ly < 10) return (dx === 0 && dz === 0) || (ly === 3 && r2 <= 5 && (dx === 0 || dz === 0)) ? M.metal : PACKA_NONE;
            if (ly >= 28) { const rr = 7.5 - (ly - 28) * 2.5; return r2 <= rr * rr ? (((Math.floor(Math.atan2(dz, dx) * 4 / Math.PI) & 1) ? M.canvas : M.canvas2)) : PACKA_NONE; }
            return dx === 0 && dz === 0 ? M.metal : PACKA_NONE;
        });
        for (const [cx, cz, f] of [[51, 76, 2], [51, 88, 0], [45, 82, 1], [57, 82, 3]]) P.chair(k, cx, cz, f, 3, M.metal);
        // мебель
        P.tv(k, 22, 6, 2, 2); P.sofa(k, 22, 28, 22, 0, 2, M.fabric); P.chair(k, 36, 16, 3, 2, M.canvas); P.bookcase(k, 6, 50, 14, 20, 1, 2);
        P.table(k, 56, 46, 6, 4, 0, 2);
        for (const [cx, cz, f] of [[53, 40, 2], [59, 40, 2], [53, 52, 0], [59, 52, 0]]) P.chair(k, cx, cz, f, 2);
        k.box(46, 2, 60, 70, 11, 67, (lx, ly) => (lx >= 57 && lx < 63) || lx < 50 ? PACKA_NONE : (ly === 10 ? M.tile : M.darkwood));
        P.fridge(k, 47, 64, 0, 2); P.stove(k, 60, 64, 0, 2);
        P.bed(ku, 20, 20, 1, 32, 7, M.canvas); P.wardrobe(ku, 32, 37, 0, 32);
        P.bed(ku, 22, 62, 0, 32, 5, M.carblue); P.desk(ku, 60, 20, 3, 32); P.bookcase(ku, 60, 70, 12, 18, 0, 32);
    },

    /** Детская площадка: качели на цепях, горка с башенкой, купол-паутинка, балансир, карусель, песочница. */
    'suburb-playground'(w, x, z, rot) {
        const P = PackA, k = PackAKit.at(w, x, z, rot);
        k.box(-62, -1, -52, -2, 0, -8, M.rubber);
        k.box(14, -1, -46, 46, 0, 18, M.crate);
        P.fence(k, -70, -76, 71, -76, 'picket', [[64, 78]]);
        P.fence(k, 71, -76, 71, 76, 'picket'); P.fence(k, 71, 76, -70, 76, 'picket'); P.fence(k, -70, 76, -70, -76, 'picket');
        // качели
        for (const xa of [-58, -6]) { k.line(xa, 0, -42, xa, 40, -30, M.carblue, 2); k.line(xa, 0, -18, xa, 40, -30, M.carblue, 2); }
        k.box(-58, 40, -31, -4, 42, -29, M.carblue);
        for (const [a, b] of [[-50, -44], [-36, -30], [-22, -16]]) {
            for (const cx of [a, b]) k.box(cx, 9, -30, cx + 1, 40, -29, M.cable);
            k.box(a, 8, -31, b + 1, 9, -28, M.rubber);
        }
        // башенка с горкой
        for (const px of [20, 37]) for (const pz of [-40, -23]) k.box(px, 0, pz, px + 3, 31, pz + 3, M.wood);
        k.box(20, 15, -40, 40, 17, -20, (lx) => lx % 3 === 0 ? M.wood : M.plank);
        k.box(20, 17, -40, 40, 26, -20, (lx, ly, lz) => {
            const e = lx === 20 || lx === 39 || lz === -40 || lz === -21;
            if (!e) return PACKA_NONE;
            if (lz === -21 && lx >= 26 && lx < 34) return PACKA_NONE;
            if (lx === 20 && lz >= -36 && lz < -30) return PACKA_NONE;
            return ly === 25 || (lx + lz) % 3 === 0 ? M.plank : PACKA_NONE;
        });
        k.roof(18, 42, -42, -18, 30, 0.7, 2, 'x', (lx) => (lx & 3) < 2 ? M.canvas : M.canvas2);
        for (const rz of [-36, -31]) k.box(18, 0, rz, 19, 27, rz + 1, M.wood);
        for (let ly = 3; ly < 26; ly += 4) k.box(18, ly, -35, 19, ly + 1, -31, M.wood);
        for (let lz = -20; lz < 14; lz++) {
            const y = lz < 10 ? Math.floor(16 - (lz + 20) * (14 / 30)) : 2;
            k.box(27, y - 1, lz, 33, y + 1, lz + 1, M.caryellow);
            k.box(26, y - 1, lz, 27, y + 3, lz + 1, M.caryellow); k.box(33, y - 1, lz, 34, y + 3, lz + 1, M.caryellow);
        }
        k.box(29, 0, 10, 31, 1, 13, M.metal);
        k.box(40, 0, -40, 41, 15, -20, M.plank);
        for (let i = 0; i < 14; i++) { const hz = -39 + Math.floor(PackA.hash(i, 3, 9) * 18), hy = 1 + i; k.p(41, hy, hz, [M.goods_y, M.goods_g, M.canvas][i % 3]); }
        // купол-паутинка
        P.isolated(k, -46, 0, 22, -14, 16, 55, -17, 0, 38, kk => kk.ell(-30, 0, 38, 14, 14, 14, (lx, ly, lz, d) => {
            if (ly < 0 || d < 0.9) return PACKA_NONE;
            return ((lx + 64) % 5 === 0 || (lz + 64) % 5 === 0 || ly % 5 === 0) ? M.carred : PACKA_NONE;
        }));
        // балансир, карусель, песочница
        k.box(-41, 0, 63, -39, 5, 67, M.metal);
        k.body(-60, 5, 64, -20, 9, 66, (lx, ly) => ly === 5 ? M.carblue : ((lx === -57 || lx === -23) ? (ly < 8 ? M.metal : M.rubber) : PACKA_NONE));
        k.box(-1, 0, 49, 1, 4, 51, M.metal);
        k.cyl('y', 0, 50, 13, 2, 3, (lx, ly, lz) => ((lx + 64) % 6 === 0 || (lz + 64) % 6 === 0) ? M.carred : M.tin);
        for (const [dx, dz] of [[10, 0], [-10, 0], [0, 10], [0, -10]]) { k.line(0, 3, 50, dx, 3, 50 + dz, M.metal); k.box(dx, 3, 50 + dz, dx + 1, 9, 50 + dz + 1, M.metal); }
        k.box(-1, 3, 49, 1, 9, 51, M.metal);
        k.box(20, 0, 30, 50, 3, 60, (lx, ly, lz) => (lx < 22 || lx >= 48 || lz < 32 || lz >= 58) ? M.plank : (ly === 0 ? M.sand : PACKA_NONE));
        k.box(22, -1, 32, 48, 0, 58, M.sand);
        k.box(40, 1, 40, 42, 3, 42, M.carred);
        // скамейки, урна, деревья
        P.bench(k, -10, 68, 0, 0); P.bench(k, 20, 68, 0, 0); P.bin(k, 60, 66, 0, 0, M.cargreen);
        P.tree(k, -50, 50, 38, 11, 77, M.leaves2);
        P.tree(k, 62, -60, 30, 9, 41, M.leaves);
    },

    /** Остановка: стеклянный павильон, скамья, табличка BUS. */
    'suburb-busstop'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        for (const [px, pz] of [[-25, -7], [23, -7], [-25, 5], [23, 5]]) k.box(px, 0, pz, px + 2, 26, pz + 2, M.metal);
        k.box(-27, 26, -9, 27, 28, 8, (lx, ly, lz) => ly === 26 && (lz === -9 || lz === 7) ? M.metal : M.tin);
        k.box(-23, 1, 5, 23, 25, 6, (lx, ly) => ly === 1 || ly === 24 ? M.metal : M.glass);
        for (const sx of [-25, 24]) k.box(sx, 1, -5, sx + 1, 25, 5, (lx, ly) => ly === 1 || ly === 24 ? M.metal : M.glass);
        k.box(-18, 0, 2, 18, 5, 5, (lx, ly) => ly === 4 ? M.wood : ((lx === -18 || lx === 17) ? M.metal : PACKA_NONE));
        k.box(25, 3, -4, 26, 22, 4, M.lamp);
        k.box(30, 0, -6, 31, 40, -5, M.metal);
        k.box(21, 32, -6, 36, 40, -5, M.carblue);
        k.text('BUS', 33, 34, -7, -1, 1, M.trim);
    },

    /** Фонарь у тротуара: кронштейн тянется по курсу маркера. */
    'suburb-lamp'(w, x, z, rot) { PackA.lampPost(PackAKit.at(w, x, z, rot), 0, 0, 0, 56); },
    /** Припаркованная машина: цвет и кузов — по номеру маркера. */
    'suburb-car'(w, x, z, rot, mk) {
        const n = parseInt(String(mk && mk.name || '').replace(/^.*-/, ''), 10) || 1;
        const paints = [M.carblue, M.carwhite, M.caryellow, M.cargreen, M.carred, M.carwhite];
        const styles = ['sedan', 'hatch', 'van', 'sedan', 'pickup', 'hatch'];
        PackA.car(PackAKit.at(w, x, z, rot), 0, 0, 0, paints[(n - 1) % 6], styles[(n - 1) % 6]);
    },
    'suburb-tree'(w, x, z, rot, mk) {
        const s = (mk && mk.scale && mk.scale[1]) || 1;
        PackA.tree(PackAKit.at(w, x, z, rot), 0, 0, Math.round(36 * s), Math.round(12 * s), x * 3 + z * 7, PackA.hash(x, 4, z) < 0.5 ? M.leaves : M.leaves2);
    },
    /** Пожарный гидрант. */
    'suburb-hydrant'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.cyl('y', 0, 0, 2.2, 0, 8, M.carred); k.cyl('y', 0, 0, 2.8, 0, 1, M.carred); k.cyl('y', 0, 0, 1.6, 8, 10, M.carred);
        k.box(-3, 4, -1, 3, 6, 1, M.metal); k.box(-1, 4, -3, 1, 6, -2, M.metal);
    },
    'suburb-bin'(w, x, z, rot) { PackA.bin(PackAKit.at(w, x, z, rot), 0, 0, 0, 0, PackA.hash(x, 7, z) < 0.5 ? M.cargreen : M.carblue); },
    /** Заборы участков: глухие сзади и между дворами, штакетник вдоль тротуаров (с проходами), почтовые ящики. */
    'suburb-fences'(w) {
        const K = PackAKit.world(w), P = PackA;
        P.fence(K, 30, 32, 482, 32, 'privacy', [], M.plank);
        P.fence(K, 30, 479, 482, 479, 'privacy', [], M.plank);
        P.fence(K, 30, 32, 30, 206, 'privacy', [], M.plank); P.fence(K, 482, 32, 482, 206, 'privacy', [], M.plank);
        P.fence(K, 30, 324, 30, 479, 'privacy', [], M.plank); P.fence(K, 482, 324, 482, 479, 'privacy', [], M.plank);
        for (const fx of [175, 320]) P.fence(K, fx, 32, fx, 82, 'privacy', [], M.plank);
        P.fence(K, 175, 446, 175, 479, 'privacy', [], M.plank); P.fence(K, 320, 450, 320, 479, 'privacy', [], M.plank);
        P.fence(K, 30, 206, 482, 206, 'picket', [[58, 72], [116, 144], [152, 192], [234, 248], [303, 343], [375, 389]]);
        P.fence(K, 30, 324, 145, 324, 'picket', [[62, 76], [106, 116]]);
        P.fence(K, 322, 324, 482, 324, 'picket', [[16, 56], [104, 118]]);
        for (const [mx, mz, f] of [[104, 204, 2], [280, 204, 2], [421, 204, 2], [108, 326, 0], [442, 326, 0]]) P.mailbox(K, mx, mz, f, PackA.hash(mx, 1, mz) < 0.5 ? M.metal : M.carblue);
    },
});

// ======================================================================== ЗАПРАВКА

Object.assign(GameMapBuild.builders, {
    /** Земля заправки: шоссе с разметкой, тротуар и въезды, бетонная площадка с швами и пятнами масла,
     *  разметка парковки, газон-островок; под площадкой — два подземных бака с топливом (взрываются). */
    'gas-terrain'(w) {
        const G = GameMapBuild.GROUND, K = PackAKit.world(w);
        PackA.edgeHills(w, 30, 15, 11);
        PackA.flatten(w, 0, 396, 512, 488, M.grass);
        K.box(0, -1, 420, 512, 0, 486, (x, y, z) => {
            if ((z === 422 || z === 483) && x % 3 !== 0) return M.paint;
            if (z >= 452 && z < 454 && (x % 40) < 22) return M.caryellow;
            return PackA.hash(x, 1, z) < 0.015 ? M.concrete2 : M.asphalt;
        });
        K.box(0, -1, 404, 512, 0, 418, (x, y, z) => (x % 20 === 0) ? M.concrete2 : M.concrete);
        K.box(0, 0, 418, 512, 1, 420, (x) => (x >= 68 && x < 150) || (x >= 336 && x < 420) ? PACKA_NONE : M.concrete2);
        // площадка
        K.box(36, -1, 30, 476, 0, 404, (x, y, z) => {
            if (z < 140 && !(x >= 40 && x < 125) && !(x >= 222 && x < 418) && !(x >= 418 && x < 458 && z >= 54 && z < 92)) return PACKA_NONE;
            if (x % 40 === 0 || z % 40 === 0) return M.concrete2;
            if (PackA.vnoise(x, z, 7) > 0.88 && PackA.hash(x, 2, z) < 0.3) return M.concrete2;
            return M.concrete;
        });
        for (let i = 0; i <= 5; i++) K.box(256 + i * 26, -1, 152, 257 + i * 26, 0, 190, M.paint);
        K.box(130, -1, 322, 372, 0, 324, M.caryellow);
        // газон-островок у дороги
        K.box(170, -1, 330, 232, 0, 396, M.grass);
        K.box(170, 0, 330, 232, 1, 396, (x, y, z) => (x === 170 || x === 231 || z === 330 || z === 395) ? M.concrete2 : PACKA_NONE);
        // подземные баки и крышки заливных горловин
        for (const tx of [405, 445]) {
            K.cyl('z', tx + 0.5, 10 - G, 7.2, 192, 292, M.barrel);
            for (const cz of [200, 284]) { K.cyl('y', tx + 0.5, cz + 0.5, 3.4, -1, 0, M.hazard); K.cyl('y', tx + 0.5, cz + 0.5, 2.2, -1, 0, M.metal); K.box(tx, -10, cz, tx + 1, -1, cz + 1, M.metal); }
        }
        K.box(452, -9, 230, 464, -7, 232, M.metal);
    },

    /** Навес над колонками: тонкие колонны по центру островков, полый короб с фризом и светильниками,
     *  у каждой колонки — топливное нутро (взрывается). Подорви оба насоса островка — колонна перебита. */
    'gas-canopy'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot), P = PackA;
        for (const ix of [-90, 0, 90]) {
            k.box(ix - 10, 0, -45, ix + 10, 2, 45, (lx, ly, lz) => (lx === ix - 10 || lx === ix + 9 || lz === -45 || lz === 44) ? M.caryellow : M.concrete);
            for (const bz of [-49, 47]) for (const bx of [ix - 6, ix + 4]) k.box(bx, 0, bz, bx + 2, 10, bz + 2, (lx, ly) => (ly >> 1) & 1 ? M.cable : M.hazard);
            k.box(ix - 3, 2, -3, ix + 3, 48, 3, M.carwhite);
            k.box(ix - 4, 2, -4, ix + 4, 10, 4, M.brandteal);
            for (const c of [-14, 14]) {
                k.box(ix - 6, 2, c - 8, ix + 6, 4, c + 8, M.concrete2);
                k.box(ix - 4, 4, c - 7, ix + 4, 24, c + 7, (lx, ly, lz) => {
                    if (Math.abs(lx - ix + 0.5) < 2.5 && Math.abs(lz - c + 0.5) < 4.5 && ly >= 6 && ly < 16) return M.barrel;
                    const face = lx === ix - 4 || lx === ix + 3;
                    if (face && ly >= 16 && ly < 21 && Math.abs(lz - c + 0.5) < 5) return ly === 16 || ly === 20 ? M.cable : M.neongreen;
                    if (face && ly >= 8 && ly < 13 && (lz === c - 4 || lz === c + 3)) return M.rubber;
                    return ly < 6 ? M.cable : M.brandteal;
                });
                k.box(ix - 4, 24, c - 7, ix + 4, 28, c + 7, (lx, ly) => ly === 25 ? M.brandorange : M.carwhite);
                for (const sx of [-1, 1]) {
                    const fx = sx < 0 ? ix - 5 : ix + 4;
                    for (const hz of [c - 4, c + 3]) { k.box(fx, 9, hz, fx + 1, 13, hz + 1, M.metal); k.line(fx, 13, hz, fx, 19, hz + (hz < c ? -2 : 2), M.rubber); }
                }
            }
            P.bin(k, ix + 6, -40, 1, 2, M.brandteal);
        }
        // короб навеса
        k.box(-110, 48, -60, 110, 58, 60, (lx, ly, lz) => {
            const edge = Math.min(lx + 110, 109 - lx, lz + 60, 59 - lz) < 2;
            if (edge) return ly === 48 ? M.carwhite : (ly < 51 ? M.brandorange : M.brandteal);
            if (ly === 48) return ((lx + 110) % 30 >= 12 && (lx + 110) % 30 < 18 && (lz + 60) % 24 >= 9 && (lz + 60) % 24 < 15) ? M.lamp : M.carwhite;
            if (ly === 57) return (lx + 110) % 8 === 0 ? M.metal : M.tin;
            if (Math.abs(lz + 0.5) < 2 && ly < 57) return M.metal;
            return PACKA_NONE;
        });
        k.text('RUBBLE FUEL', -21, 52, 60, 1, 1, M.carwhite);
        k.text('RUBBLE FUEL', 21, 52, -61, -1, 1, M.carwhite);
    },

    /** Магазин при заправке: стеклянный фасад, вывеска, стеллажи с товаром (тела), холодильники, касса,
     *  кофейная стойка, склад; снаружи — клетка с газовыми баллонами, ларь со льдом, столбики. */
    'gas-store'(w, x, z, rot) {
        const P = PackA, W = 180, D = 100, k = PackAKit.at(w, x, z, rot).sub(-90, -50);
        const glass = { frame: M.metal, bars: M.metal, grid: 24, sill: false };
        P.shell(k, {
            W, D, t: 2, base: 1, top: 46,
            wall: (face, u, ly, layer) => ly < 4 ? M.concrete2 : (ly >= 34 ? (ly === 45 ? M.metal : M.brandteal) : (ly === 33 ? M.brandorange : M.plaster)),
            slabs: [[42, 44, null, (lx, ly) => ly === 42 ? M.plaster : M.concrete2]],
            floor: (lx, ly, lz) => (((lx >> 2) + (lz >> 2)) & 1) ? M.tile : M.concrete,
            parts: [[140, 1, 60, 142, 42, 98, M.plaster], [142, 1, 60, 178, 42, 62, M.plaster]],
            cuts: [[140, 1, 70, 142, 22, 80]],
            holes: [[0, 6, 78, 2, 32, 'win', glass], [0, 102, 174, 2, 32, 'win', glass], [0, 78, 102, 1, 28, 'hole', { frame: M.metal }],
                [1, 150, 160, 1, 22, 'door', { frame: M.metal, leaf: M.metal }], [2, 10, 40, 14, 30, 'win', { ...glass, grid: 10 }]],
        });
        k.box(78, 28, 0, 102, 32, 2, M.metal);
        for (const [lx0, lx1] of [[78, 84], [96, 102]]) k.box(lx0, 1, 2, lx1, 28, 3, (lx, ly) => ly === 1 || ly === 27 || lx === lx0 ? M.metal : M.glass);
        // фриз-вывеска
        k.box(0, 34, -2, W, 46, 0, (lx, ly) => ly === 34 || ly === 45 ? M.brandorange : M.brandteal);
        k.text('RUBBLE MART', 133, 35, -3, -1, 2, M.carwhite);
        for (let lx = 6; lx < W; lx += 30) for (let lz = 12; lz < D - 10; lz += 25) k.box(lx, 41, lz, lx + 6, 42, lz + 3, M.lamp);
        // стеллажи-«горки» с товаром (тела)
        const goods = [M.goods_y, M.goods_g, M.canvas, M.carblue, M.canvas2, M.brandorange];
        for (const [gx, gz0, gz1] of [[22, 20, 70], [48, 20, 70], [100, 40, 80], [128, 36, 80]]) {
            k.body(gx - 5, 1, gz0, gx + 5, 17, gz1, (lx, ly, lz) => {
                const c = lx - gx;
                if (ly === 1 || c === 0 || c === -1 || ly % 5 === 0 || lz === gz0 || lz === gz1 - 1) return (lz === gz0 || lz === gz1 - 1) && ly > 1 && c !== 0 && c !== -1 && ly % 5 !== 0 ? M.brandteal : M.metal;
                const r = PackA.hash(lx, ly - (ly % 5), Math.floor(lz / 3));
                if (r < 0.14 || (ly % 5 === 4 && r < 0.6)) return PACKA_NONE;
                return goods[Math.floor(PackA.hash(lx > gx ? 1 : 0, ly - (ly % 5), Math.floor(lz / 3)) * goods.length)];
            });
        }
        // холодильники у задней стены
        k.box(8, 1, 86, 122, 26, 98, (lx, ly, lz) => {
            const u = lx - 8;
            if (ly === 1 || ly >= 24 || u % 19 === 0) return M.metal;
            if (lz === 86) return ly >= 3 && ly < 23 && u % 19 !== 9 ? M.glass : M.metal;
            if (lz >= 94) return M.carwhite;
            if (ly === 23) return M.lamp;
            if (ly % 6 === 2) return M.metal;
            if (lz < 88) return PACKA_NONE;
            return PackA.hash(lx, Math.floor(ly / 6), 3) < 0.15 ? PACKA_NONE : goods[(lx * 7 + Math.floor(ly / 6) * 3) % goods.length];
        });
        // касса
        k.box(122, 1, 18, 170, 11, 30, (lx, ly, lz) => ly === 10 ? M.tile : (lz === 18 ? (ly === 4 ? M.brandorange : M.brandteal) : M.darkwood));
        k.box(160, 1, 30, 170, 11, 50, (lx, ly) => ly === 10 ? M.tile : M.darkwood);
        k.box(136, 11, 22, 144, 14, 28, M.rubber); k.box(137, 14, 24, 143, 18, 25, M.glass); k.box(150, 11, 22, 154, 13, 26, M.cable);
        k.box(172, 12, 10, 178, 30, 50, (lx, ly, lz) => (ly % 4 === 0 || lx === 177) ? M.darkwood : (PackA.hash(lz, ly, 5) < 0.1 ? PACKA_NONE : goods[(lz + ly) % goods.length]));
        // кофейная стойка
        k.box(2, 1, 20, 9, 11, 62, (lx, ly) => ly === 10 ? M.tile : M.darkwood);
        k.box(2, 11, 24, 7, 20, 32, M.metal); k.box(2, 11, 36, 7, 18, 44, M.rubber); k.box(6, 14, 38, 7, 15, 40, M.neonred);
        k.box(2, 11, 50, 6, 16, 58, (lx, ly) => ly % 2 ? M.canvas2 : M.carwhite);
        // склад: ящики и бойлер
        for (const [cx, cz, cy] of [[146, 66, 1], [146, 73, 1], [153, 66, 1], [146, 66, 7], [160, 90, 1], [167, 90, 1]]) P.crate(k, cx, cy, cz);
        k.cyl('y', 170.5, 72.5, 4, 1, 22, M.carwhite);
        // ларь с мороженым, банкомат (тела)
        k.body(56, 1, 10, 74, 10, 18, (lx, ly) => ly === 9 ? M.glass : (ly === 1 ? M.cable : M.carwhite));
        k.body(104, 1, 5, 112, 17, 11, (lx, ly, lz) => lz === 5 && ly >= 10 && ly < 14 && lx > 105 && lx < 110 ? M.neongreen : (ly === 16 ? M.brandteal : M.metal));
        // крыша: кондиционеры (тела) и вытяжка
        for (const ax of [30, 120]) k.body(ax, 44, 40, ax + 14, 54, 52, (lx, ly, lz) => ly === 53 && ((lx + lz) & 1) ? M.cable : (ly === 44 ? M.cable : M.metal));
        k.cyl('y', 80.5, 70.5, 2.5, 44, 52, M.metal); k.cyl('y', 80.5, 70.5, 4, 52, 54, M.metal);
        // снаружи: столбики, ларь со льдом, клетка с баллонами
        for (let lx = 30; lx < 160; lx += 22) if (lx < 76 || lx > 104) k.box(lx, 0, -9, lx + 2, 10, -7, (a, ly) => (ly >> 1) & 1 ? M.cable : M.hazard);
        k.body(160, 0, -14, 176, 12, -4, (lx, ly, lz) => ly === 11 ? M.brandteal : (lz === -14 && ly > 2 && ly < 10 ? M.brandteal : M.carwhite));
        k.text('ICE', 173, 4, -14, -1, 1, M.carwhite);
        k.box(4, 0, -16, 26, 1, -2, M.metal);
        k.box(4, 1, -16, 26, 18, -2, (lx, ly, lz) => {
            const e = lx === 4 || lx === 25 || lz === -16 || lz === -3;
            if (ly === 17) return M.metal;
            if (!e) return PACKA_NONE;
            const corner = (lx === 4 || lx === 25) && (lz === -16 || lz === -3);
            return corner || ly % 6 === 0 || ((lx + lz) & 1) === 0 ? M.metal : PACKA_NONE;
        });
        for (const bx of [8, 14, 20]) for (const bz of [-12, -7]) P.propane(k, bx, bz, 1);
    },

    /** Автомойка-тоннель: блочные стены со стеклянной лентой, плоская крыша, вывеска WASH, портал с щётками,
     *  дуги-распылители, машина внутри. */
    'gas-carwash'(w, x, z, rot) {
        const P = PackA, W = 64, D = 124, k = PackAKit.at(w, x, z, rot).sub(-32, -62);
        const block = (face, u, ly) => (ly % 4 === 0 || (u + ((ly >> 2) & 1) * 4) % 8 === 0) ? M.concrete2 : M.concrete;
        k.box(0, -1, 0, W, 0, D, (lx, ly, lz) => Math.abs(lx - 31.5) < 1.5 ? M.cable : M.concrete);
        for (const sx of [0, W - 3]) k.box(sx, 0, 0, sx + 3, 46, D, (lx, ly, lz) => {
            if (ly >= 30 && ly < 38 && lz >= 8 && lz < D - 8) return (lz - 8) % 12 === 0 ? M.metal : (lx === sx + 1 ? M.glass : 0);
            return block(0, lz, ly);
        });
        k.box(0, 44, 0, W, 46, D, M.concrete2);
        for (const fz of [0, D - 3]) k.box(3, 32, fz, W - 3, 44, fz + 3, (lx, ly) => ly === 32 || ly === 43 ? M.brandorange : M.brandteal);
        k.text('WASH', 47, 34, -1, -1, 2, M.carwhite);
        k.text('WASH', 17, 34, D, 1, 2, M.carwhite);
        // направляющие
        for (const gx of [20, 43]) k.box(gx, 0, 4, gx + 1, 1, D - 4, M.metal);
        // портал со щётками
        k.box(3, 38, 56, W - 3, 42, 62, M.metal);
        for (const px of [3, W - 5]) k.box(px, 0, 56, px + 2, 38, 62, M.metal);
        for (const bx of [15, 49]) {
            k.box(bx, 34, 58, bx + 1, 38, 59, M.metal);
            k.cyl('y', bx + 0.5, 58.5, 6, 3, 34, (lx, ly, lz) => ly % 4 === 0 ? M.foam : M.blue);
        }
        k.box(12, 29, 74, 14, 38, 76, M.metal); k.box(50, 29, 74, 52, 38, 76, M.metal);
        k.box(3, 38, 74, W - 3, 40, 76, M.metal);
        k.cyl('x', 29.5, 75.5, 5, 14, 50, (lx, ly) => lx % 4 === 0 ? M.foam : M.blue);
        // дуги-распылители
        for (const az of [28, 96]) {
            k.box(5, 0, az, 7, 34, az + 2, M.metal); k.box(57, 0, az, 59, 34, az + 2, M.metal); k.box(5, 34, az, 59, 36, az + 2, M.metal);
            for (let lx = 10; lx < 56; lx += 6) k.box(lx, 33, az, lx + 1, 34, az + 1, M.carblue);
        }
        // касса-автомат у въезда и машина в тоннеле
        k.box(W + 4, 0, -14, W + 10, 14, -8, (lx, ly, lz) => ly >= 8 && ly < 12 && lz === -14 ? M.neongreen : (ly === 13 ? M.brandteal : M.metal));
        P.car(k, 32, 40, 2, M.carred, 'sedan');
    },

    /** Высокий ценник-пилон на двух ногах: шапка с логотипом, три строки цен со светящимися цифрами (две стороны). */
    'gas-pylon'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        for (const lx of [-13, 10]) { k.box(lx - 2, 0, -4, lx + 5, 2, 3, M.concrete); k.box(lx, 2, -2, lx + 3, 72, 1, M.metal); }
        k.box(-18, 70, -3, 18, 128, 3, (lx, ly, lz) => {
            const edge = lx === -18 || lx === 17 || ly === 70 || ly === 127;
            if (edge) return M.metal;
            if (lz !== -3 && lz !== 2) return ly % 12 === 0 ? M.metal : PACKA_NONE;
            if (ly >= 112) return ly === 112 || ly === 113 ? M.brandorange : M.brandteal;
            return (ly - 71) % 13 === 0 ? M.metal : M.cable;
        });
        k.text('RUBBLE', 11, 116, -4, -1, 1, M.carwhite);
        k.text('RUBBLE', -11, 116, 3, 1, 1, M.carwhite);
        const rows = [{ t: '3.49', m: M.goods_g }, { t: '3.79', m: M.brandorange }, { t: '4.19', m: M.canvas }];
        for (let i = 0; i < 3; i++) {
            const y0 = 99 - i * 13;
            k.box(-16, y0 - 1, -4, -11, y0 + 6, -3, rows[i].m); k.box(10, y0 - 1, 3, 15, y0 + 6, 4, rows[i].m);
            k.text(rows[i].t, 7, y0, -4, -1, 1, M.neongreen);
            k.text(rows[i].t, -7, y0, 3, 1, 1, M.neongreen);
        }
    },

    /** Рекламный щит на одной мачте: ферма, мостик с прожекторами, плакат. Подрежь мачту — рухнет. */
    'gas-billboard'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.cyl('y', 0.5, 0.5, 5, 0, 3, M.concrete);
        k.cyl('y', 0.5, 0.5, 2.6, 3, 90, M.metal);
        k.box(-40, 86, -1, 41, 90, 2, M.metal);
        k.line(0, 70, 0, -30, 86, 0, M.metal, 2); k.line(1, 70, 0, 31, 86, 0, M.metal, 2);
        k.box(-41, 89, -7, 42, 90, -1, (lx) => lx % 2 === 0 ? M.metal : M.cable);
        k.box(-41, 90, -7, 42, 96, -6, (lx, ly) => ly === 95 || lx % 10 === 0 ? M.metal : PACKA_NONE);
        k.box(-41, 90, -3, 42, 122, -1, (lx, ly, lz) => {
            if (lz === -2) return (lx + ly) % 6 === 0 ? M.metal : M.cable;
            const edge = lx === -41 || lx === 41 || ly === 90 || ly === 121;
            if (edge) return M.carwhite;
            if (ly < 97) return M.brandteal;
            return ly > 116 ? M.caryellow : M.brandorange;
        });
        k.text('RUBBLE', 34, 100, -4, -1, 3, M.carwhite);
        for (const sx of [-30, 0, 30]) { k.box(sx, 90, -10, sx + 1, 92, -7, M.metal); k.box(sx - 1, 91, -12, sx + 2, 93, -10, M.lamp); }
    },

    /** Бензовоз (тело): кабина, рама, цистерна из взрывоопасного топлива — от одного выстрела цепная реакция. */
    'gas-tanker'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        const wheel = (wz, dual) => {
            const xs = dual ? [[-12, -7], [7, 12]] : [[-12, -9], [9, 12]];
            for (const [x0, x1] of xs) k.cyl('x', 5.5, wz + 0.5, 5.6, x0, x1, (lx, ly, lz, q) => q < 0.45 ? M.tin : M.rubber);
            k.box(-9, 4, wz, 9, 8, wz + 1, M.cable);
        };
        // тягач
        wheel(-56, false); wheel(-36, true); wheel(-24, true);
        k.box(-8, 8, -64, 8, 12, -14, (lx) => Math.abs(lx + 0.5) > 5 ? M.cable : PACKA_NONE);
        k.box(-5, 8, -64, 5, 12, -14, (lx, ly, lz) => lz % 10 === 0 ? M.cable : PACKA_NONE);
        k.box(-12, 5, -68, 12, 10, -65, M.metal);
        k.box(-11, 10, -66, 11, 40, -44, (lx, ly, lz) => {
            const ax = Math.abs(lx + 0.5), side = ax > 10, front = lz === -66;
            if (ly === 39) return M.carwhite;
            if (front) {
                if (ly < 24) return ax < 7 ? (ly % 2 ? M.metal : M.cable) : (ly > 18 && ly < 22 ? M.lamp : M.carwhite);
                if (ly < 36) return ax < 10 ? M.glass : M.carwhite;
                return M.carwhite;
            }
            if (side) {
                if (ly >= 24 && ly < 35 && lz > -63 && lz < -52) return M.glass;
                if (ly >= 14 && ly < 18) return M.brandteal;
                if (ly === 18) return M.brandorange;
                return M.carwhite;
            }
            if (lz === -45) return ly > 26 && ly < 35 && ax < 8 ? M.glass : M.carwhite;
            if (ly === 10) return M.cable;
            if (lz > -60 && lz < -56 && ly < 18 && ax > 2 && ax < 9) return M.fabric;
            if (lz > -63 && lz < -61 && ly >= 18 && ly < 23) return M.cable;
            return PACKA_NONE;
        });
        k.box(-11, 40, -58, 11, 46, -44, (lx, ly, lz) => ly === 45 || Math.abs(lx + 0.5) > 10 || lz === -44 || lz === -58 ? M.carwhite : PACKA_NONE);
        for (const sx of [-13, 12]) { k.box(sx, 26, -66, sx + 1, 34, -64, M.metal); k.box(sx < 0 ? -13 : 11, 25, -65, sx < 0 ? -11 : 13, 26, -62, M.metal); }
        for (const sx of [-1, 1]) {
            const ex = sx < 0 ? -12 : 10;
            k.box(ex, 12, -43, ex + 2, 50, -41, M.metal);
            k.cyl('z', sx < 0 ? -9.5 : 9.5, 10.5, 3, -50, -42, M.metal);
            k.box(sx < 0 ? -12 : 11, 8, -50, sx < 0 ? -11 : 12, 10, -45, M.metal);
        }
        k.box(-9, 12, -38, 9, 14, -22, M.metal);
        // полуприцеп-цистерна
        wheel(42, true); wheel(54, true);
        k.box(-7, 10, -30, 7, 15, 62, (lx, ly, lz) => (Math.abs(lx + 0.5) > 4.5 || ly === 14) ? M.cable : PACKA_NONE);
        k.box(-3, 14, -20, 3, 16, -14, M.metal);
        for (const lx of [-7, 6]) k.box(lx, 5, -6, lx + 1, 15, -5, M.metal);
        k.cyl('z', 0, 27, 12.2, -16, 60, (lx, ly, lz, q) => {
            if (q > 0.88) return ((lz + 16) % 19 === 0) ? M.metal : (Math.abs(ly - 21) < 1 && q > 0.95 ? M.brandteal : M.fueltank);
            return M.barrel;
        });
        for (const [cz, sg] of [[-16, -1], [59, 1]]) for (let d = 1; d <= 3; d++) k.cyl('z', 0, 27, 12.2 - d * 3, cz + sg * d, cz + sg * d + 1, d === 3 ? M.metal : M.fueltank);
        k.box(-2, 39, -12, 2, 40, 56, (lx, ly, lz) => lz % 2 ? M.metal : M.cable);
        for (const hz of [-6, 14, 34, 50]) k.cyl('y', 0, hz + 0.5, 2.5, 39, 41, M.metal);
        for (const sx of [-2, 1]) for (let lz = -10; lz < 56; lz += 6) k.box(sx, 40, lz, sx + 1, 44, lz + 1, M.metal);
        k.box(-2, 43, -10, -1, 44, 56, M.metal); k.box(1, 43, -10, 2, 44, 56, M.metal);
        for (const sx of [-3, 2]) k.box(sx, 10, 61, sx + 1, 40, 62, M.metal);
        for (let ly = 16; ly < 40; ly += 4) k.box(-3, ly, 61, 3, ly + 1, 62, M.metal);
        k.box(-12, 5, 60, 12, 10, 63, (lx, ly) => Math.abs(lx + 0.5) > 8 && ly > 6 ? M.neonred : M.metal);
        k.box(-12, 14, 8, -10, 22, 26, (lx, ly, lz) => lz === 8 || lz === 25 || ly === 14 || ly === 21 ? M.metal : M.carwhite);
        k.box(-13, 18, 14, -12, 26, 22, (lx, ly, lz) => Math.abs(ly - 21.5) + Math.abs(lz - 17.5) < 4.5 ? M.brandorange : PACKA_NONE);
        k.box(11, 18, 14, 12, 26, 22, (lx, ly, lz) => Math.abs(ly - 21.5) + Math.abs(lz - 17.5) < 4.5 ? M.brandorange : PACKA_NONE);
        k.dyn(-13, 0, -68, 13, 51, 64);
        // шланги от цистерны к горловинам (лежат на земле, не касаются машины)
        k.box(-20, 0, 16, -14, 1, 17, M.rubber); k.box(-20, 0, 17, -19, 1, 42, M.rubber);
        k.box(14, 0, 20, 21, 1, 21, M.rubber); k.box(20, 0, 21, 21, 1, 42, M.rubber);
    },

    /** Вентиляционные стояки подземных баков на бетонной тумбе. */
    'gas-vents'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.box(-4, 0, -6, 4, 3, 10, M.concrete);
        for (const vz of [-4, 2, 8]) {
            k.box(-1, -9, vz - 1, 1, 46, vz + 1, M.metal);
            k.box(-2, 46, vz - 2, 2, 48, vz + 2, M.metal);
            k.box(-1, 48, vz - 1, 1, 49, vz + 1, M.cable);
        }
        k.box(-1, 30, -5, 1, 32, 9, M.metal);
        k.box(-1, 3, -5, 1, 5, 9, M.hazard);
    },

    /** Мусорный контейнер (тело) с крышками. */
    'gas-dumpster'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.body(-10, 0, -6, 10, 14, 7, (lx, ly, lz) => {
            if (ly < 2) return (lx === -9 || lx === 8) && (lz === -5 || lz === 5) ? M.rubber : PACKA_NONE;
            if (lz === 6) return ly < 13 && (lx === -9 || lx === 8) ? M.metal : PACKA_NONE;
            if (ly === 13) return lx === 0 ? M.metal : M.cargreen;
            const shell = lx === -10 || lx === 9 || lz === -6 || lz === 5 || ly === 2;
            if (shell) return ly === 8 ? M.metal : M.cargreen;
            return ly < 6 ? M.crate : PACKA_NONE;
        });
    },

    /** Колонка подкачки шин на тумбе. */
    'gas-airpump'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot);
        k.box(-5, 0, -4, 5, 2, 4, M.concrete);
        k.box(-3, 2, -2, 3, 18, 2, (lx, ly, lz) => lz === -2 && ly > 11 && ly < 15 && lx > -2 && lx < 2 ? M.neongreen : (ly === 17 ? M.brandteal : M.carred));
        k.box(-2, 6, -3, 2, 8, -2, M.metal);
        k.line(3, 10, 0, 6, 4, -3, M.rubber); k.line(6, 4, -3, 4, 2, -6, M.rubber);
    },

    /** Фонарь площадки (кронштейн по курсу маркера). */
    'gas-lamp'(w, x, z, rot) { PackA.lampPost(PackAKit.at(w, x, z, rot), 0, 0, 0, 62); },
    /** Машина у колонки или на парковке: цвет и кузов по номеру маркера. */
    'gas-car'(w, x, z, rot, mk) {
        const n = parseInt(String(mk && mk.name || '').replace(/^.*-/, ''), 10) || 1;
        const paints = [M.carwhite, M.carblue, M.caryellow, M.cargreen];
        const styles = ['sedan', 'van', 'hatch', 'pickup'];
        PackA.car(PackAKit.at(w, x, z, rot), 0, 0, 0, paints[(n - 1) % 4], styles[(n - 1) % 4]);
    },
    /** Островок с деревом и кустами. */
    'gas-planter'(w, x, z, rot) {
        const k = PackAKit.at(w, x, z, rot), P = PackA;
        P.tree(k, 0, 0, 34, 11, 13, M.leaves);
        for (const [bx, bz] of [[-22, -24], [20, -24], [-22, 24], [22, 22], [0, 26]]) P.bush(k, bx, bz, 4, M.leaves2);
    },
    'gas-tree'(w, x, z, rot, mk) {
        const s = (mk && mk.scale && mk.scale[1]) || 1;
        PackA.tree(PackAKit.at(w, x, z, rot), 0, 0, Math.round(36 * s), Math.round(12 * s), x + z * 5, M.leaves2);
    },
});
