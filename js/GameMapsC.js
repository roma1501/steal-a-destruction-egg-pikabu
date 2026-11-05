// GameMapsC.js — набор карт C Rubble Lab: «Центр города» (downtown), «Горная деревня» (village),
// «Пустынный аванпост» (desert). Строители маркеров (имена с префиксом id карты) дописываются в
// GameMapBuild.builders. Постройки строятся от ЦЕНТРА маркера, локальная +x — курс маркера (rot[1]),
// y — от GameMapBuild.GROUND. Первый маркер карты — <id>-terrain (рельеф, дороги, верх земли).
// Общие помощники — GMC: рамка постройки с поворотом, шум, цилиндры, тросы, пиксельный шрифт вывесок,
// мебель, машины. Динамика (машины, урны, бочки) — GameMapBuild.rdyn: тела стоят ровно на опоре.

/** @typedef {{ w: VoxWorld, x: number, z: number, rot: number,
 *   put(lx: number, ly: number, lz: number, v: number): void,
 *   box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, v: any): void,
 *   get(lx: number, ly: number, lz: number): number,
 *   dyn(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void,
 *   at(lx: number, lz: number): number[],
 *   sub(lx: number, lz: number, dr?: number): GMCFrame }} GMCFrame */

/** @satisfies {Record<string, any>} */
const GMC = {
    // ------------------------------------------------------------------ шум
    hash(x, y, z) {
        let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    },
    noise(x, z, s, seed) {
        const fx = x / s, fz = z / s, ix = Math.floor(fx), iz = Math.floor(fz);
        let u = fx - ix, v = fz - iz;
        u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
        const a = this.hash(ix, seed, iz), b = this.hash(ix + 1, seed, iz), c = this.hash(ix, seed, iz + 1), d = this.hash(ix + 1, seed, iz + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    },
    fbm(x, z, s, seed) { return this.noise(x, z, s, seed) * 0.57 + this.noise(x, z, s / 2, seed + 11) * 0.29 + this.noise(x, z, s / 4, seed + 23) * 0.14; },
    smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); },
    /** Число маркера name-N (1, если без номера). */
    num(mk) { const m = /-(\d+)$/.exec(String(mk && mk.name || '')); return m ? +m[1] : 1; },

    // ------------------------------------------------------------------ рамка постройки
    /** Рамка постройки: начало (x, z) в вокселях мира, rot — четверти; локальные (lx, ly, lz), ly от GROUND.
     *  @returns {GMCFrame} */
    frame(w, x, z, rot) {
        const B = GameMapBuild, G = B.GROUND;
        const r = (((rot | 0) % 4) + 4) % 4;
        const map = (lx, lz) => r === 0 ? [x + lx, z + lz] : r === 1 ? [x - lz, z + lx] : r === 2 ? [x - lx, z - lz] : [x + lz, z - lx];
        return {
            w, x, z, rot: r,
            put(lx, ly, lz, v) { if (v >= 0) B.rput(w, x, z, r, lx, ly, lz, v); },
            box(x0, y0, z0, x1, y1, z1, v) { B.rbox(w, x, z, r, x0, y0, z0, x1, y1, z1, v); },
            get(lx, ly, lz) { const p = map(lx, lz); return w.get(p[0], G + ly, p[1]); },
            dyn(x0, y0, z0, x1, y1, z1) { B.rdyn(w, x, z, r, x0, y0, z0, x1, y1, z1); },
            at(lx, lz) { return map(lx, lz); },
            sub(lx, lz, dr) { const p = map(lx, lz); return GMC.frame(w, p[0], p[1], r + (dr || 0)); },
        };
    },
    /** Ящик в координатах стены: axis 'x' — стена вдоль x (u = lx, d = lz), 'z' — вдоль z (u = lz, d = lx). */
    wbox(F, axis, u0, y0, d0, u1, y1, d1, v) {
        if (axis === 'x') F.box(u0, y0, d0, u1, y1, d1, typeof v === 'function' ? (lx, ly, lz) => v(lx, ly, lz) : v);
        else F.box(d0, y0, u0, d1, y1, u1, typeof v === 'function' ? (lx, ly, lz) => v(lz, ly, lx) : v);
    },
    /** Четыре стены коробки [x0,x1)×[z0,z1) толщиной t, y0..y1; v — материал или (lx, ly, lz) => материал. */
    walls(F, x0, z0, x1, z1, y0, y1, t, v) {
        F.box(x0, y0, z0, x1, y1, z0 + t, v);
        F.box(x0, y0, z1 - t, x1, y1, z1, v);
        F.box(x0, y0, z0 + t, x0 + t, y1, z1 - t, v);
        F.box(x1 - t, y0, z0 + t, x1, y1, z1 - t, v);
    },
    /**
     * Окно: проём [u0,u1)×[y0,y1) сквозь стену [d0,d1) (воздух), в слое gd — рама o.frame и стекло o.glass;
     * o.mullion — средник, o.transom — y форточки; o.sill — слой d подоконника снаружи (y0 - 1).
     */
    window(F, axis, u0, u1, y0, y1, d0, d1, gd, o = {}) {
        const fr = o.frame != null ? o.frame : M.plaster, gl = o.glass != null ? o.glass : M.glass;
        const mid = o.mullion ? Math.floor((u0 + u1) / 2) : -999;
        this.wbox(F, axis, u0, y0, d0, u1, y1, d1, (u, y, d) => {
            if (d !== gd) return 0;
            if (u === u0 || u === u1 - 1 || y === y0 || y === y1 - 1 || u === mid || y === o.transom) return fr;
            return gl;
        });
        if (o.sill != null) this.wbox(F, axis, u0 - 1, y0 - 1, o.sill, u1 + 1, y0, o.sill + 1, o.sillMat != null ? o.sillMat : M.concrete);
    },
    /** Кирпичная кладка: ряды по 4 (3 кирпича + шов), перевязка, два тона кирпича. */
    brick(lx, ly, lz, a, b, m) {
        const course = Math.floor(ly / 4), r = ly - course * 4;
        if (r === 3) return m;
        const u = lx + lz + (course & 1) * 4 + 4000;
        if (u % 8 === 0) return m;
        return GMC.hash(Math.floor(u / 8), course, 7) < 0.3 ? b : a;
    },
    /** Каменная кладка: блоки разного размера, швы раствором, два тона. */
    stonework(lx, ly, lz, a, b, m) {
        const course = Math.floor(ly / 6), r = ly - course * 6;
        if (r === 5) return m;
        const u = lx + lz + 4000 + course * 7;
        const len = 7 + Math.floor(GMC.hash(course, 3, 1) * 5);
        if (u % len === 0) return m;
        return GMC.hash(Math.floor(u / len), course, 11) < 0.35 ? b : a;
    },

    // ------------------------------------------------------------------ фигуры
    /** Вертикальный цилиндр: центр (cx, cz), радиус r, [y0, y1); shell — толщина стенки (0 — сплошной). */
    cyl(F, cx, cz, r, y0, y1, v, shell = 0) {
        const R = Math.ceil(r);
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d > r || (shell && d < r - shell)) continue;
            for (let y = y0; y < y1; y++) F.put(cx + dx, y, cz + dz, typeof v === 'function' ? v(cx + dx, y, cz + dz, d) : v);
        }
    },
    /** Цилиндр по оси x: [x0, x1), центр сечения (cy, cz). */
    cylX(F, x0, x1, cy, cz, r, v, shell = 0) {
        const R = Math.ceil(r);
        for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
            const d = Math.sqrt(dy * dy + dz * dz);
            if (d > r || (shell && d < r - shell)) continue;
            for (let x = x0; x < x1; x++) F.put(x, cy + dy, cz + dz, typeof v === 'function' ? v(x, cy + dy, cz + dz, d) : v);
        }
    },
    /** Цилиндр по оси z: [z0, z1), центр сечения (cx, cy). */
    cylZ(F, z0, z1, cx, cy, r, v, shell = 0) {
        const R = Math.ceil(r);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            const d = Math.sqrt(dy * dy + dx * dx);
            if (d > r || (shell && d < r - shell)) continue;
            for (let z = z0; z < z1; z++) F.put(cx + dx, cy + dy, z, typeof v === 'function' ? v(cx + dx, cy + dy, z, d) : v);
        }
    },
    /** Эллипсоид; shell — толщина оболочки в долях радиуса (0 — сплошной). v — материал или (x,y,z,t) => материал. */
    ell(F, cx, cy, cz, rx, ry, rz, v, shell = 0) {
        for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let z = Math.floor(cz - rz); z <= cz + rz; z++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
            const t = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
            if (t > 1 || (shell && t < (1 - shell) * (1 - shell))) continue;
            F.put(x, y, z, typeof v === 'function' ? v(x, y, z, t) : v);
        }
    },
    /** Линия вокселей мира со связностью по граням (трос, растяжка): концы включительно. */
    line(w, x0, y0, z0, x1, y1, z1, v) {
        x0 = Math.round(x0); y0 = Math.round(y0); z0 = Math.round(z0); x1 = Math.round(x1); y1 = Math.round(y1); z1 = Math.round(z1);
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), dz = Math.abs(z1 - z0);
        const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0), sz = Math.sign(z1 - z0);
        let x = x0, y = y0, z = z0, ix = 0, iy = 0, iz = 0;
        w.put(x, y, z, v);
        for (let i = 0, n = dx + dy + dz; i < n; i++) {
            const tx = dx ? (ix + 0.5) / dx : 9, ty = dy ? (iy + 0.5) / dy : 9, tz = dz ? (iz + 0.5) / dz : 9;
            if (tx <= ty && tx <= tz) { x += sx; ix++; } else if (ty <= tz) { y += sy; iy++; } else { z += sz; iz++; }
            w.put(x, y, z, v);
        }
    },
    /** Линия в локальных координатах рамки (ly от GROUND). */
    lineF(F, ax, ay, az, bx, by, bz, v) {
        const G = GameMapBuild.GROUND, a = F.at(ax, az), b = F.at(bx, bz);
        this.line(F.w, a[0], G + ay, a[1], b[0], G + by, b[1], v);
    },
    /** Провисающий трос между точками рамки: sag — провис в вокселях посередине. */
    sagF(F, ax, ay, az, bx, by, bz, sag, v) {
        const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
        let px = ax, py = ay, pz = az;
        for (let i = 1; i <= n; i++) {
            const t = i / n;
            const qx = ax + (bx - ax) * t, qz = az + (bz - az) * t, qy = ay + (by - ay) * t - sag * 4 * t * (1 - t);
            this.lineF(F, px, py, pz, qx, qy, qz, v);
            px = qx; py = qy; pz = qz;
        }
    },
    /** Самая высокая твёрдая клетка столбца мира (y) или -1. */
    top(w, x, z) {
        for (let y = w.sy - 1; y >= 0; y--) if (w.get(x, y, z)) return y;
        return -1;
    },

    // ------------------------------------------------------------------ вывески: шрифт 3×5
    FONT: {
        A: '.#./#.#/###/#.#/#.#', B: '##./#.#/##./#.#/##.', C: '.##/#../#../#../.##', D: '##./#.#/#.#/#.#/##.',
        E: '###/#../##./#../###', F: '###/#../##./#../#..', G: '.##/#../#.#/#.#/.##', H: '#.#/#.#/###/#.#/#.#',
        I: '###/.#./.#./.#./###', K: '#.#/#.#/##./#.#/#.#', L: '#../#../#../#../###', M: '#.#/###/###/#.#/#.#',
        N: '##./#.#/#.#/#.#/#.#', O: '.#./#.#/#.#/#.#/.#.', P: '##./#.#/##./#../#..', R: '##./#.#/##./#.#/#.#',
        S: '.##/#../.#./..#/##.', T: '###/.#./.#./.#./.#.', U: '#.#/#.#/#.#/#.#/###', V: '#.#/#.#/#.#/#.#/.#.',
        W: '#.#/#.#/###/###/#.#', X: '#.#/#.#/.#./#.#/#.#', Y: '#.#/#.#/.#./.#./.#.', '0': '###/#.#/#.#/#.#/###',
        '1': '.#./##./.#./.#./###', '2': '##./..#/.#./#../###', '4': '#.#/#.#/###/..#/..#', '7': '###/..#/.#./.#./.#.',
        ' ': '.../.../.../.../...',
    },
    /**
     * Надпись в рамке: левый нижний угол (lx, ly, lz), буквы идут по (ax, az) (вправо для смотрящего),
     * высота 5·s вокселей; dz — сдвиг выступа (буквы ставятся одним слоем).
     */
    text(F, str, lx, ly, lz, ax, az, v, s = 1) {
        let cx = 0;
        for (const ch of String(str).toUpperCase()) {
            const g = (this.FONT[ch] || this.FONT[' ']).split('/');
            for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
                if (g[r][c] !== '#') continue;
                for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) {
                    const u = (cx + c) * s + a;
                    F.put(lx + ax * u, ly + (4 - r) * s + b, lz + az * u, v);
                }
            }
            cx += 4;
        }
        return cx * s - s;
    },
    textWidth(str, s = 1) { return String(str).length * 4 * s - s; },

    // ------------------------------------------------------------------ мебель (y — пол, локально)
    table(F, x0, y, z0, x1, z1, h, top, leg) {
        F.box(x0, y + h - 1, z0, x1, y + h, z1, top);
        for (const [lx, lz] of [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]]) F.box(lx, y, lz, lx + 1, y + h - 1, lz + 1, leg);
    },
    /** Стул: сиденье 4×4 в (x, z), спинка с края back ('x0'|'x1'|'z0'|'z1'). */
    chair(F, x, y, z, back, seat, leg) {
        F.box(x, y + 4, z, x + 4, y + 5, z + 4, seat);
        F.box(x + 1, y, z + 1, x + 3, y + 4, z + 3, leg);
        if (back === 'x0') F.box(x, y + 5, z, x + 1, y + 10, z + 4, seat);
        if (back === 'x1') F.box(x + 3, y + 5, z, x + 4, y + 10, z + 4, seat);
        if (back === 'z0') F.box(x, y + 5, z, x + 4, y + 10, z + 1, seat);
        if (back === 'z1') F.box(x, y + 5, z + 3, x + 4, y + 10, z + 4, seat);
    },
    sofa(F, x0, y, z0, x1, z1, back, mat) {
        F.box(x0, y, z0, x1, y + 4, z1, mat);
        if (back === 'z0') F.box(x0, y + 4, z0, x1, y + 9, z0 + 2, mat);
        if (back === 'z1') F.box(x0, y + 4, z1 - 2, x1, y + 9, z1, mat);
        if (back === 'x0') F.box(x0, y + 4, z0, x0 + 2, y + 9, z1, mat);
        if (back === 'x1') F.box(x1 - 2, y + 4, z0, x1, y + 9, z1, mat);
    },
    bed(F, x0, y, z0, x1, z1) {
        F.box(x0, y, z0, x1, y + 3, z1, M.darkwood);
        F.box(x0, y + 3, z0, x1, y + 5, z1, M.canvas2);
        F.box(x0, y + 5, z0 + 2, x1, y + 6, z1, M.fabric);
        F.box(x0, y, z0 - 1, x1, y + 10, z0, M.darkwood);
    },
    plant(F, x, y, z, big) {
        const r = big ? 3 : 2;
        this.cyl(F, x, z, r, y, y + (big ? 6 : 4), M.terracotta);
        this.ell(F, x, y + (big ? 12 : 7), z, r + 2, big ? 7 : 4, r + 2, M.leaves2, 0.5);
    },
    shelf(F, x0, y, z0, x1, z1, h, seed) {
        const cols = [M.carred, M.caryellow, M.blue, M.carwhite, M.canvas, M.leaves2, M.terracotta, M.fabric, M.neongreen];
        F.box(x0, y, z0, x1, y + h, z0 + 1, M.plank);
        for (let s = 0; s < h; s += 5) {
            F.box(x0, y + s, z0, x1, y + s + 1, z1, M.plank);
            if (s + 3 < h) for (let lx = x0; lx < x1; lx++) for (let lz = z0 + 1; lz < z1; lz++) {
                const hh = this.hash(lx, s + seed, lz);
                if (hh < 0.6) F.box(lx, y + s + 1, lz, lx + 1, y + s + 1 + (hh < 0.3 ? 3 : 2), lz + 1, cols[Math.floor(this.hash(lx >> 1, s, seed) * cols.length)]);
            }
        }
        F.box(x0, y, z0, x0 + 1, y + h, z1, M.plank);
        F.box(x1 - 1, y, z0, x1, y + h, z1, M.plank);
    },

    // ------------------------------------------------------------------ транспорт
    /** Легковая машина вокруг начала рамки (курс +x), динамическое тело; paint — материал кузова. */
    car(F, paint, taxi) {
        const b = F.get(0, -1, 0) ? 0 : -1;   // проезжая часть на воксель ниже тротуара
        const P = paint, D = M.concrete2;
        const L0 = -21, L1 = 21, W0 = -9, W1 = 9, wheels = [-13, 12];
        F.box(L0, b, W0, L1, b + 18, W1, 0);
        const inArch = (lx, ly) => wheels.some(c => (lx - c) ** 2 + (ly - (b + 3)) ** 2 <= 21);
        F.box(L0, b + 3, W0, L1, b + 8, W1, (lx, ly, lz) => {
            if ((lz < W0 + 3 || lz >= W1 - 3) && inArch(lx, ly)) return -1;
            if (lx === L0 || lx === L1 - 1) return ly <= b + 4 ? D : P;
            if (ly === b + 3) return D;
            return P;
        });
        F.box(-9, b + 2, -6, 9, b + 3, 6, D);
        for (const c of wheels) for (const [z0, z1, hub] of [[W0, W0 + 3, W0], [W1 - 3, W1, W1 - 1]]) {
            for (let ly = b; ly < b + 7; ly++) for (let lx = c - 3; lx <= c + 3; lx++) {
                const d2 = (lx - c) ** 2 + (ly - (b + 3)) ** 2;
                if (d2 > 12.25) continue;
                for (let lz = z0; lz < z1; lz++) F.put(lx, ly, lz, (lz === hub && d2 <= 2) ? M.metal : M.rubber);
            }
        }
        // фары, номера, решётка
        F.box(L1 - 1, b + 6, W0 + 1, L1, b + 7, W0 + 4, M.lamp); F.box(L1 - 1, b + 6, W1 - 4, L1, b + 7, W1 - 1, M.lamp);
        F.box(L0, b + 6, W0 + 1, L0 + 1, b + 7, W0 + 4, M.neonred); F.box(L0, b + 6, W1 - 4, L0 + 1, b + 7, W1 - 1, M.neonred);
        F.box(L1 - 1, b + 4, -3, L1, b + 5, 3, M.carwhite); F.box(L0, b + 4, -3, L0 + 1, b + 5, 3, M.carwhite);
        F.box(L1 - 1, b + 5, -5, L1, b + 6, 5, D);
        // салон: стёкла, стойки, крыша, сиденья
        const cb = b + 8, ch = 6;
        const xf = i => 7 - i, xr = i => -14 + (i >> 1);
        for (let i = 0; i < ch; i++) {
            const f = xf(i), r = xr(i);
            F.box(r, cb + i, W0 + 1, f + 1, cb + i + 1, W1 - 1, (lx, ly, lz) => {
                const side = lz === W0 + 1 || lz === W1 - 2;
                const end = lx >= f - 1 || lx <= r + 1;
                if (!side && !end) return -1;
                if (i === 0) return P;
                if (side && (lx >= f - 1 || lx <= r + 1 || lx === -3)) return P;
                return M.glass;
            });
        }
        F.box(xr(ch - 1), cb + ch, W0 + 1, xf(ch - 1) + 1, cb + ch + 1, W1 - 1, P);
        F.box(-1, cb, W0 + 2, 3, cb + 2, -1, M.fabric); F.box(-1, cb, 1, 3, cb + 2, W1 - 2, M.fabric);
        F.box(-2, cb + 2, W0 + 2, -1, cb + 5, -1, M.fabric); F.box(-2, cb + 2, 1, -1, cb + 5, W1 - 2, M.fabric);
        F.box(-11, cb, W0 + 2, -7, cb + 2, W1 - 2, M.fabric); F.box(-12, cb + 2, W0 + 2, -11, cb + 5, W1 - 2, M.fabric);
        F.box(4, cb + 1, 3, 5, cb + 3, 6, D);
        F.box(6, cb, W0, 8, cb + 2, W0 + 1, P); F.box(6, cb, W1 - 1, 8, cb + 2, W1, P);
        if (taxi) { F.box(-6, cb + ch + 1, -3, -1, cb + ch + 3, 3, M.neonamber); }
        F.dyn(L0, b, W0, L1, cb + ch + 4, W1);
    },
    /** Городской автобус (курс +x, двери справа: +z), динамическое тело. */
    bus(F) {
        const b = F.get(0, -1, 0) ? 0 : -1;
        const L0 = -55, L1 = 55, W0 = -12, W1 = 12, wheels = [-36, 33], P = M.carred, T = M.carwhite;
        F.box(L0, b, W0, L1, b + 34, W1, 0);
        const inArch = (lx, ly) => wheels.some(c => (lx - c) ** 2 + (ly - (b + 5)) ** 2 <= 42);
        const band = lz => lz < W0 + 3 || lz >= W1 - 3;
        // пол и стенки
        F.box(L0, b + 4, W0, L1, b + 7, W1, (lx, ly, lz) => band(lz) && inArch(lx, ly) ? -1 : (ly === b + 4 ? M.concrete2 : P));
        const doors = lx => (lx >= 40 && lx < 50) || (lx >= -6 && lx < 4);
        F.box(L0, b + 7, W0, L1, b + 30, W1, (lx, ly, lz) => {
            const side = lz === W0 || lz === W1 - 1, end = lx === L0 || lx === L1 - 1;
            if (!side && !end) return ly >= b + 28 ? (ly === b + 29 ? T : P) : -1;
            if (side && band(lz) && inArch(lx, ly)) return -1;
            if (end && lx === L1 - 1) {             // перёд: лобовое стекло, табло
                if (ly >= b + 11 && ly < b + 25 && lz > W0 + 1 && lz < W1 - 2) return M.glass;
                if (ly >= b + 25 && ly < b + 27 && lz > W0 + 3 && lz < W1 - 4) return M.neonamber;
                if (ly === b + 8 && (lz === W0 + 2 || lz === W1 - 3)) return M.lamp;
                return ly > b + 25 ? T : P;
            }
            if (end) {
                if (ly >= b + 14 && ly < b + 24 && lz > W0 + 2 && lz < W1 - 3) return M.glass;
                if (ly === b + 9 && (lz === W0 + 1 || lz === W1 - 2)) return M.neonred;
                return ly > b + 25 ? T : P;
            }
            if (lz === W1 - 1 && doors(lx) && ly < b + 26) return (lx === 44 || lx === -2) ? M.metal : M.glass;
            if (ly >= b + 13 && ly < b + 25) return (((lx + 1000) % 12) < 2) ? P : M.glass;
            return ly >= b + 25 ? T : P;
        });
        // колёса
        for (const c of wheels) for (const [z0, z1, hub] of [[W0, W0 + 3, W0], [W1 - 3, W1, W1 - 1]]) {
            for (let ly = b; ly < b + 11; ly++) for (let lx = c - 5; lx <= c + 5; lx++) {
                const d2 = (lx - c) ** 2 + (ly - (b + 5)) ** 2;
                if (d2 > 27) continue;
                for (let lz = z0; lz < z1; lz++) F.put(lx, ly, lz, (lz === hub && d2 <= 5) ? M.metal : M.rubber);
            }
        }
        // сиденья, поручни, водитель
        for (let lx = -50; lx < 36; lx += 9) {
            if (doors(lx) || doors(lx + 4)) continue;
            for (const [z0, z1] of [[W0 + 1, W0 + 8], [W1 - 8, W1 - 1]]) {
                F.box(lx, b + 7, z0, lx + 4, b + 10, z1, M.blue);
                F.box(lx, b + 10, z0, lx + 1, b + 15, z1, M.blue);
            }
        }
        for (const lx of [-30, -8, 6, 30]) F.box(lx, b + 7, 0, lx + 1, b + 28, 1, M.metal);
        F.box(44, b + 7, W0 + 2, 49, b + 10, W0 + 7, M.fabric); F.box(50, b + 7, W0 + 1, 54, b + 13, W1 - 1, M.concrete2);
        F.box(-30, b + 30, -6, -10, b + 33, 6, T);
        F.dyn(L0, b, W0, L1, b + 34, W1);
    },
};

// ============================================================================ ЦЕНТР ГОРОДА
// Сетка улиц (воксели от центра карты 256,256): проспект — z 248..338 (асфальт на слой ниже тротуара),
// улица — x 290..350; тротуары и площадь — плиты. Кварталы: NW — офисная башня и площадь с фонтаном,
// NE — угловой магазин и парковка, SW — кирпичный жилой дом, SE — стройка с башенным краном.

Object.assign(GameMapBuild.builders, {
    /** Земля центра: плитка тротуаров, асфальт с разметкой, бордюры, зебры, люки; газонные валы у краёв. */
    'downtown-terrain'(w, x, z) {
        const G = GameMapBuild.GROUND, ox = x - 256, oz = z - 256;
        const AV0 = 248 + oz, AV1 = 338 + oz, ST0 = 290 + ox, ST1 = 350 + ox;
        const zebraAv = xx => (xx >= ST0 - 26 && xx < ST0 - 2) || (xx >= ST1 + 2 && xx < ST1 + 26);
        const zebraSt = zz => (zz >= AV0 - 26 && zz < AV0 - 2) || (zz >= AV1 + 2 && zz < AV1 + 26);
        for (let zz = 0; zz < w.sz; zz++) for (let xx = 0; xx < w.sx; xx++) {
            const onAv = zz >= AV0 && zz < AV1, onSt = xx >= ST0 && xx < ST1;
            if (onAv || onSt) {
                w.put(xx, G - 1, zz, 0);
                let m = GMC.noise(xx, zz, 9, 5) > 0.82 ? M.concrete2 : M.asphalt;
                const cross = onAv && onSt;
                if (onAv && !onSt) {
                    const lz = zz - AV0;
                    if (zebraAv(xx)) { if (lz % 10 < 5 && lz > 1 && lz < 88) m = M.paint; }
                    else if ((lz === 44 || lz === 45) && ((xx + 1000) % 50) < 28) m = M.paint;                 // осевая
                    else if ((lz === 20 || lz === 69) && ((xx + 1000) % 60) > 4) m = M.paint;                  // край полос стоянки
                    else if ((xx === ST0 - 30 || xx === ST0 - 31) && lz > 45 && lz < 69) m = M.paint;          // стоп-линии
                    else if ((xx === ST1 + 29 || xx === ST1 + 30) && lz > 20 && lz < 44) m = M.paint;
                }
                if (onSt && !onAv) {
                    const lx = xx - ST0;
                    if (zebraSt(zz)) { if (lx % 10 < 5 && lx > 1 && lx < 58) m = M.paint; }
                    else if ((lx === 29 || lx === 30) && ((zz + 1000) % 50) < 28) m = M.paint;
                    else if ((zz === AV0 - 30 || zz === AV0 - 31) && lx > 30 && lx < 58) m = M.paint;
                    else if ((zz === AV1 + 29 || zz === AV1 + 30) && lx > 2 && lx < 29) m = M.paint;
                }
                if (cross && GMC.noise(xx, zz, 6, 9) > 0.86) m = M.concrete2;
                w.put(xx, G - 2, zz, m);
            } else {
                // бордюр — 2 вокселя у проезжей части, дальше плиты 1 × 1 м со швами
                const nearAv = (zz >= AV0 - 2 && zz < AV0) || (zz >= AV1 && zz < AV1 + 2);
                const nearSt = (xx >= ST0 - 2 && xx < ST0) || (xx >= ST1 && xx < ST1 + 2);
                let m;
                if (nearAv || nearSt) m = M.stone;
                else if (((xx + 1000) % 10) === 0 || ((zz + 1000) % 10) === 0) m = M.concrete2;
                else m = GMC.hash(Math.floor(xx / 10), 3, Math.floor(zz / 10)) < 0.25 ? M.paint : M.concrete;
                w.put(xx, G - 1, zz, m);
            }
        }
        // люки и решётки ливнёвки
        for (const [mx, mz] of [[200 + ox, 300 + oz], [320 + ox, 150 + oz], [420 + ox, 280 + oz], [320 + ox, 420 + oz], [80 + ox, 292 + oz]]) {
            for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dz * dz <= 10) w.put(mx + dx, G - 2, mz + dz, M.metal);
        }
        for (let xx = 40; xx < 480; xx += 70) for (const zz of [AV0, AV1 - 2]) if (xx < ST0 - 30 || xx > ST1 + 30) w.fill(xx + ox, G - 2, zz, xx + ox + 6, G - 1, zz + 2, M.rust);
        // газонные валы с живой изгородью вдоль краёв карты (не на проезжей части)
        for (let zz = 0; zz < w.sz; zz++) for (let xx = 0; xx < w.sx; xx++) {
            const d = Math.min(xx, zz, w.sx - 1 - xx, w.sz - 1 - zz);
            if (d >= 26) continue;
            if ((zz >= AV0 - 4 && zz < AV1 + 4) || (xx >= ST0 - 4 && xx < ST1 + 4)) continue;
            const h = Math.round(GMC.smooth((26 - d) / 22) * (8 + GMC.fbm(xx, zz, 40, 3) * 8));
            for (let y = G - 1; y < G + h; y++) w.put(xx, y, zz, y === G + h - 1 ? M.grass : M.dirt);
            if (d >= 8 && d < 13) for (let y = G + h; y < G + h + 9; y++) if (GMC.hash(xx, y, zz) < 0.85) w.put(xx, y, zz, GMC.hash(xx >> 2, y >> 2, zz >> 2) < 0.4 ? M.leaves2 : M.leaves);
        }
    },

    /** Офисная башня: 5 этажей, стеклянная навесная стена с импостами, бетонное ядро с лестницей и лифтом,
     *  open space с рабочими местами, переговорные, лобби, козырёк «NOVA», крыша с вентустановками и люлькой. */
    'downtown-office'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const X0 = -75, X1 = 75, Z0 = -65, Z1 = 65, FH = 30, NF = 5, TOP = NF * FH;
        const CX0 = -18, CX1 = 18, CZ0 = -14, CZ1 = 14;
        // перекрытия: бетон + покрытие (лобби — плитка с рамкой, этажи — ковролин)
        for (let f = 0; f <= NF; f++) {
            const y = f * FH;
            F.box(X0, y, Z0, X1, y + 2, Z1, M.concrete);
            if (f === NF) { F.box(X0 + 1, y + 2, Z0 + 1, X1 - 1, y + 3, Z1 - 1, M.asphalt); continue; }
            F.box(X0 + 1, y + 2, Z0 + 1, X1 - 1, y + 3, Z1 - 1, (lx, ly, lz) => {
                if (f === 0) return (lx < X0 + 6 || lx >= X1 - 6 || lz < Z0 + 6 || lz >= Z1 - 6) ? M.stone2 : ((((lx >> 3) + (lz >> 3)) & 1) ? M.tile : M.paint);
                return GMC.hash(lx >> 2, f, lz >> 2) < 0.5 ? M.concrete2 : M.fabric;
            });
        }
        // навесная стена: стекло, вертикальные импосты, глухие пояса у перекрытий
        GMC.walls(F, X0, Z0, X1, Z1, 0, TOP + 2, 1, (lx, ly, lz) => {
            const ex = lx === X0 || lx === X1 - 1, ez = lz === Z0 || lz === Z1 - 1;
            const yy = ly % FH, along = ex ? lz : lx;
            if (ex && ez) return M.metal;
            if (yy < 3 || yy >= 28) return M.concrete2;
            if (((along + 1000) % 15) === 0) return M.metal;
            if (yy === 16 && ((along + 1000) % 15) < 2) return M.metal;
            return M.glass;
        });
        // вход: двери в стеклянной раме, козырёк на двух тонких стойках, буквы
        F.box(-12, 3, Z1 - 1, 12, 25, Z1, (lx, ly) => (lx === -12 || lx === 11 || lx === -1 || lx === 0 || ly === 24) ? M.metal : (ly === 12 && (lx === -3 || lx === 2) ? M.metal : M.glass));
        F.box(-24, 27, Z1, 24, 29, Z1 + 20, M.concrete);
        F.box(-24, 26, Z1 + 18, 24, 27, Z1 + 20, M.metal);
        for (const sx of [-21, 19]) F.box(sx, 0, Z1 + 16, sx + 2, 26, Z1 + 18, M.metal);
        F.box(-9, 29, Z1 + 17, 9, 35, Z1 + 18, M.metal);
        GMC.text(F, 'NOVA', -7, 29, Z1 + 18, 1, 0, M.neonamber, 1);
        for (let lx = -20; lx < 20; lx += 8) F.box(lx, 26, Z1 + 4, lx + 3, 27, Z1 + 6, M.lamp);
        // колонны
        for (const cx of [-30, 26]) for (const cz of [-34, -2, 30]) for (let f = 0; f < NF; f++) F.box(cx, f * FH + 2, cz, cx + 4, (f + 1) * FH, cz + 4, M.concrete);
        // ядро: стены, двери лифта (юг) и лестницы (север), шахта, марши, кабина лифта на тросе
        for (let f = 0; f < NF; f++) {
            const y = f * FH;
            GMC.walls(F, CX0, CZ0, CX1, CZ1, y + 2, y + FH, 3, M.concrete2);
            F.box(-11, y + 3, CZ1 - 3, -3, y + 24, CZ1, (lx) => lx === -7 ? M.concrete2 : M.metal);
            F.box(3, y + 3, CZ0, 11, y + 24, CZ0 + 3, 0);
            F.box(-3, y + 14, CZ1, -1, y + 16, CZ1 + 1, M.neonamber);
        }
        for (let f = 1; f <= NF; f++) F.box(CX0 + 3, f * FH, CZ0 + 3, -1, f * FH + 3, CZ1 - 3, 0);            // шахта лифта
        for (let f = 0; f < NF; f++) {
            const base = f * FH + 3;
            if (f + 1 <= NF) F.box(8, (f + 1) * FH, CZ0 + 3, CX1 - 3, (f + 1) * FH + 3, 4, 0);                 // проём под маршем
            for (let i = 0; i < 14; i++) F.box(1, base + i, CZ0 + 3 + i, 8, base + i + 1, CZ0 + 5 + i, M.concrete);
            F.box(1, base + 14, 3, CX1 - 3, base + 15, CZ1 - 3, M.concrete);
            for (let i = 0; i < 13; i++) F.box(8, base + 15 + i, 1 - i, CX1 - 3, base + 16 + i, 3 - i, M.concrete);
        }
        const cabY = 2 * FH + 3;
        F.box(CX0 + 4, cabY, CZ0 + 4, -2, cabY + 24, CZ1 - 4, (lx, ly, lz) => {
            const e = lx === CX0 + 4 || lx === -3 || lz === CZ0 + 4 || lz === CZ1 - 5 || ly === cabY || ly === cabY + 23;
            if (!e) return -1;
            if (lz === CZ1 - 5 && lx > CX0 + 6 && lx < -4 && ly > cabY) return 0;
            return M.metal;
        });
        F.box(-10, cabY + 24, -1, -9, TOP + 24, 1, M.cable);
        // будка выхода на крышу над ядром
        GMC.walls(F, CX0, CZ0, CX1, CZ1, TOP + 3, TOP + 24, 2, M.concrete2);
        F.box(CX0, TOP + 24, CZ0, CX1, TOP + 26, CZ1, M.concrete);
        F.box(3, TOP + 3, CZ0, 11, TOP + 24, CZ0 + 2, M.metal);
        // интерьер
        const desk = (cx, y, cz, seed) => {
            for (const [dx, dz, face] of [[-14, -7, 1], [0, -7, 1], [-14, 0, -1], [0, 0, -1]]) {
                const x0 = cx + dx, z0 = cz + dz;
                GMC.table(F, x0, y, z0, x0 + 14, z0 + 7, 8, M.plank, M.metal);
                const sz = face > 0 ? z0 : z0 + 6;
                F.box(x0 + 4, y + 8, sz, x0 + 10, y + 12, sz + 1, GMC.hash(x0, y, seed) < 0.5 ? M.concrete2 : M.blue);
                F.box(x0 + 6, y + 8, sz + face, x0 + 8, y + 9, sz + face + 1, M.concrete2);
                if (GMC.hash(x0, seed, z0) < 0.8) GMC.chair(F, x0 + 5, y, face > 0 ? z0 - 3 : z0 + 6, face > 0 ? 'z0' : 'z1', GMC.hash(x0, z0, y) < 0.5 ? M.fabric : M.blue, M.metal);
            }
        };
        for (let f = 0; f < NF; f++) {
            const y = f * FH + 3, ceil = (f + 1) * FH - 1;
            // светильники
            for (let lx = X0 + 10; lx < X1 - 12; lx += 24) for (let lz = Z0 + 10; lz < Z1 - 8; lz += 20) {
                if (lx + 10 > CX0 - 2 && lx < CX1 + 2 && lz > CZ0 - 2 && lz < CZ1 + 2) continue;
                F.box(lx, ceil, lz, lx + 10, ceil + 1, lz + 2, M.lamp);
            }
            if (f === 0) {
                // лобби: ресепшн, турникеты, диваны, большие растения
                F.box(-22, y, 24, 22, y + 10, 30, M.darkwood);
                F.box(-23, y + 10, 23, 23, y + 11, 31, M.tile);
                F.box(-10, y + 11, 25, -4, y + 15, 26, M.concrete2);
                for (const tx of [-16, -8, 8, 16]) F.box(tx, y, 18, tx + 1, y + 10, 21, M.metal);
                GMC.sofa(F, -66, y, 30, -40, 40, 'z1', M.fabric); GMC.sofa(F, 40, y, 30, 66, 40, 'z1', M.fabric);
                GMC.table(F, -60, y, 44, -46, 52, 4, M.glass, M.metal); GMC.table(F, 46, y, 44, 60, 52, 4, M.glass, M.metal);
                for (const [px, pz] of [[-68, 56], [66, 56], [-68, -56], [66, -56], [-30, 56], [28, 56]]) GMC.plant(F, px, y, pz, true);
                for (let lx = -56; lx < -30; lx += 8) GMC.chair(F, lx, y, -58, 'z0', M.blue, M.metal);
                continue;
            }
            for (const cx of [-48, 48]) for (const cz of [-44, -14, 16, 46]) {
                if (cx > 0 && f % 2 === 0 && cz < 0) continue;
                desk(cx, y, cz, f);
            }
            if (f % 2 === 0) {
                // переговорная: стеклянные перегородки, длинный стол, кресла
                F.box(24, y, Z0 + 2, X1 - 2, y + 27, -4, (lx, ly, lz) => {
                    if (!(lx === 24 || lz === -5)) return -1;
                    if ((lx === 24 && lz > -18 && lz < -8 && ly < 22) ) return 0;
                    return ((lx + lz) % 12 === 0 || ly === 26) ? M.metal : M.glass;
                });
                GMC.table(F, 36, y, -44, 64, -26, 8, M.darkwood, M.metal);
                for (let lx = 37; lx < 62; lx += 6) { GMC.chair(F, lx, y, -49, 'z0', M.fabric, M.metal); GMC.chair(F, lx, y, -25, 'z1', M.fabric, M.metal); }
                F.box(X1 - 3, y + 8, -44, X1 - 2, y + 20, -26, M.carwhite);
            }
            // кухня (север центра) и зона отдыха (юг центра)
            F.box(-16, y, Z0 + 2, 16, y + 9, Z0 + 8, M.plank);
            F.box(-16, y + 9, Z0 + 2, 16, y + 10, Z0 + 8, M.tile);
            F.box(10, y, Z0 + 2, 16, y + 20, Z0 + 8, M.carwhite);
            GMC.table(F, -8, y, -40, 8, -28, 8, M.plank, M.metal);
            GMC.sofa(F, -16, y, 44, 16, 52, 'z1', M.fabric);
            GMC.plant(F, -20, y, 56, true); GMC.plant(F, 20, y, 56, true);
            for (let lz = -60; lz < 60; lz += 14) if (lz < -20 || lz > 20) F.box(X0 + 2, y, lz, X0 + 6, y + 13, lz + 8, M.metal);
        }
        // крыша: парапет, вентустановки, бак, антенна, кронштейн с люлькой мойщиков на тросах
        F.box(X0, TOP + 2, Z0, X1, TOP + 8, Z1, (lx, ly, lz) => (lx < X0 + 2 || lx >= X1 - 2 || lz < Z0 + 2 || lz >= Z1 - 2) ? M.concrete : -1);
        for (const [hx, hz] of [[-60, -50], [-60, 20], [30, -50]]) {
            F.box(hx, TOP + 3, hz, hx + 22, TOP + 14, hz + 16, M.metal);
            GMC.cyl(F, hx + 6, hz + 8, 4, TOP + 14, TOP + 15, M.concrete2); GMC.cyl(F, hx + 16, hz + 8, 4, TOP + 14, TOP + 15, M.concrete2);
            F.box(hx + 2, TOP + 3, hz - 2, hx + 20, TOP + 4, hz, M.metal);
        }
        GMC.cyl(F, 50, 30, 9, TOP + 3, TOP + 22, M.rust, 1.6); GMC.cyl(F, 50, 30, 9, TOP + 22, TOP + 23, M.rust);
        for (const [lx, lz] of [[43, 23], [57, 23], [43, 37], [57, 37]]) F.box(lx, TOP + 3, lz, lx + 1, TOP + 4, lz + 1, M.metal);
        F.box(0, TOP + 26, 0, 2, TOP + 40, 2, M.metal);
        F.box(-4, TOP + 34, 0, 6, TOP + 35, 2, M.metal); F.box(-2, TOP + 38, 0, 4, TOP + 39, 2, M.metal);
        F.put(0, TOP + 40, 0, M.neonred);
        F.box(-30, TOP + 8, Z1 - 4, -28, TOP + 14, Z1 + 6, M.hazard); F.box(14, TOP + 8, Z1 - 4, 16, TOP + 14, Z1 + 6, M.hazard);
        F.box(-30, TOP + 14, Z1 - 4, 16, TOP + 15, Z1 + 6, M.hazard);
        const gy = 3 * FH + 8;
        F.box(-31, gy, Z1 + 1, 17, gy + 1, Z1 + 6, M.metal);
        F.box(-31, gy + 1, Z1 + 5, 17, gy + 8, Z1 + 6, (lx, ly) => ly === gy + 7 || lx === -31 || lx === 16 || (lx + 1000) % 6 === 0 ? M.metal : -1);
        F.box(-30, gy + 1, Z1 + 1, -24, gy + 4, Z1 + 4, M.concrete2);
        F.box(-29, gy + 8, Z1 + 3, -28, TOP + 14, Z1 + 4, M.cable); F.box(14, gy + 8, Z1 + 3, 15, TOP + 14, Z1 + 4, M.cable);
        F.box(-29, gy + 1, Z1 + 3, -28, gy + 8, Z1 + 4, M.metal); F.box(14, gy + 1, Z1 + 3, 15, gy + 8, Z1 + 4, M.metal);
    },

    /** Площадь: гранитные кольца мощения, круглый фонтан с водой, постамент с бронзовой статуей
     *  (тонкие щиколотки — подрежь, и она рухнет), скамейки и фонари. */
    'downtown-fountain'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot), G = GameMapBuild.GROUND;
        for (let dz = -62; dz <= 62; dz++) for (let dx = -62; dx <= 62; dx++) {
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d > 62 || F.get(dx, -1, dz) === 0) continue;
            const ring = Math.floor(d / 8), a = Math.floor((Math.atan2(dz, dx) + Math.PI) * (ring + 2));
            F.put(dx, -1, dz, (d % 8) < 1 ? M.stone2 : (((ring + a) & 1) ? M.stone : M.concrete));
        }
        GMC.cyl(F, 0, 0, 31, 0, 6, (lx, ly, lz, d) => d > 27 ? (ly === 5 ? M.stone2 : M.stone) : (ly < 4 ? M.water : -1));
        GMC.cyl(F, 0, 0, 32, 5, 6, (lx, ly, lz, d) => d > 27 ? M.stone2 : -1);
        GMC.cyl(F, 0, 0, 31, -1, 0, M.stone2);
        // постамент: ступень, тело, карниз, табличка
        F.box(-10, 0, -10, 11, 4, 11, M.stone2);
        F.box(-7, 4, -7, 8, 28, 8, (lx, ly, lz) => GMC.stonework(lx, ly, lz, M.stone, M.stone2, M.mortar));
        F.box(-9, 28, -9, 10, 31, 10, M.stone2);
        F.box(-4, 12, 8, 5, 18, 9, M.bronze);
        // носики фонтана
        for (const [sx, sz] of [[0, 8], [0, -8], [8, 0], [-8, 0]]) {
            F.box(sx - 1, 6, sz - 1, sx + 2, 8, sz + 2, M.stone2);
            const ox = Math.sign(sx), oz = Math.sign(sz);
            F.box(sx + ox * 2, 6, sz + oz * 2, sx + ox * 2 + 1, 7, sz + oz * 2 + 1, M.stone2);
            F.box(sx + ox * 14, 4, sz + oz * 14, sx + ox * 14 + 1, 12, sz + oz * 14 + 1, M.water);
        }
        // статуя: основатель города со свитком (смотрит на +z)
        const B = M.bronze, s = 31;
        F.box(-5, s, -5, 6, s + 2, 6, B);
        F.box(-4, s + 2, -2, -1, s + 3, 4, B); F.box(2, s + 2, -2, 5, s + 3, 4, B);       // ступни
        F.box(-3, s + 3, -1, -1, s + 5, 1, B); F.box(2, s + 3, -1, 4, s + 5, 1, B);       // щиколотки 2×2
        F.box(-4, s + 5, -2, -1, s + 14, 1, B); F.box(2, s + 5, -2, 5, s + 14, 1, B);      // ноги
        F.box(-5, s + 11, -3, 6, s + 23, 2, B);                                             // сюртук
        F.box(-4, s + 23, -2, 5, s + 25, 2, B);
        F.box(-1, s + 25, -1, 2, s + 26, 1, B);
        F.box(-2, s + 26, -2, 3, s + 31, 3, B);                                             // голова
        F.box(-7, s + 15, -1, -5, s + 24, 1, B);                                            // левая рука вниз
        for (let i = 0; i < 9; i++) F.box(6 + (i >> 2), s + 21 + (i >> 1), -1 + i, 8 + (i >> 2), s + 23 + (i >> 1), 1 + i, B);  // правая — вперёд и вверх
        F.box(7, s + 25, 8, 11, s + 27, 11, B);
        // скамейки и фонари вокруг
        for (const [bx, bz, r] of [[-46, 0, 1], [46, 0, 1], [0, -46, 0], [0, 46, 0]]) {
            const S = F.sub(bx, bz, r);
            S.box(-12, 4, -2, 12, 5, 3, M.plank); S.box(-12, 5, 2, 12, 10, 3, M.plank);
            S.box(-10, 0, -2, -8, 4, 3, M.stone2); S.box(8, 0, -2, 10, 4, 3, M.stone2);
        }
        for (const [lx, lz] of [[-40, -40], [40, -40], [-40, 40], [40, 40]]) {
            F.box(lx, 0, lz, lx + 2, 40, lz + 2, M.metal);
            F.box(lx - 2, 40, lz - 2, lx + 4, 41, lz + 4, M.metal);
            F.box(lx - 1, 36, lz - 1, lx + 3, 40, lz + 3, M.lamp);
        }
        void G;
    },

    /** Кирпичный жилой дом: 5 этажей, окна с рамами и подоконниками, балконы на консолях (фасад −z),
     *  подъезд с козырьком, лестница, квартиры с мебелью, плоская крыша с трубами и антеннами,
     *  пожарная лестница на заднем фасаде. */
    'downtown-apartments'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const X0 = -110, X1 = 110, Z0 = -48, Z1 = 48, FH = 29, NF = 5, TOP = NF * FH, T = 3;
        const brick = (lx, ly, lz) => {
            if (ly < 7) return M.stone2;
            const yy = ly % FH;
            if (yy === 0 && ly > 7) return M.concrete;
            return GMC.brick(lx, ly, lz, M.brick, M.brick2, M.mortar);
        };
        GMC.walls(F, X0, Z0, X1, Z1, 0, TOP + 2, T, brick);
        // карниз и парапет
        F.box(X0 - 1, TOP, Z0 - 1, X1 + 1, TOP + 2, Z1 + 1, (lx, ly, lz) => (lx < X0 + T || lx >= X1 - T || lz < Z0 + T || lz >= Z1 - T) ? M.concrete : -1);
        GMC.walls(F, X0, Z0, X1, Z1, TOP + 2, TOP + 7, 2, brick);
        F.box(X0, TOP + 7, Z0, X1, TOP + 8, Z1, (lx, ly, lz) => (lx < X0 + 2 || lx >= X1 - 2 || lz < Z0 + 2 || lz >= Z1 - 2) ? M.concrete : -1);
        // перекрытия: бетон + доска; крыша — рубероид
        for (let f = 0; f <= NF; f++) {
            const y = f * FH;
            F.box(X0 + T, y, Z0 + T, X1 - T, y + 2, Z1 - T, M.concrete);
            F.box(X0 + T, y + 2, Z0 + T, X1 - T, y + 3, Z1 - T, f === NF ? M.asphalt : ((lx) => ((lx + 1000) % 5 === 0 ? M.darkwood : M.plank)));
        }
        // окна: 10 осей по фасадам, 3 — по торцам; балконы (этажи 1–4) на осях 1, 3, 6, 8
        const bays = []; for (let i = 0; i < 10; i++) bays.push(X0 + 11 + i * 22);
        const balc = new Set([1, 3, 6, 8]);
        for (let f = 0; f < NF; f++) {
            const y = f * FH;
            bays.forEach((c, i) => {
                const front = !(f === 0 && (i === 4 || i === 5));
                if (front) {
                    if (f > 0 && balc.has(i)) GMC.window(F, 'x', c - 6, c + 6, y + 3, y + 25, Z0, Z0 + T, Z0 + 1, { mullion: true, transom: y + 19 });
                    else GMC.window(F, 'x', c - 6, c + 6, y + 9, y + 24, Z0, Z0 + T, Z0 + 1, { mullion: true, transom: y + 19, sill: Z0 - 1 });
                }
                const fireDoor = f > 0 && (i === 6 || i === 7) ;
                if (fireDoor && i === 7) GMC.window(F, 'x', c - 5, c + 5, y + 3, y + 24, Z1 - T, Z1, Z1 - 2, { frame: M.darkwood });
                else GMC.window(F, 'x', c - 6, c + 6, y + 9, y + 24, Z1 - T, Z1, Z1 - 2, { mullion: true, transom: y + 19, sill: Z1 });
            });
            for (const c of [-24, 0, 24]) for (const [d0, gd, sd] of [[X0, X0 + 1, X0 - 1], [X1 - T, X1 - 2, X1]]) GMC.window(F, 'z', c - 6, c + 6, y + 9, y + 24, d0, d0 + T, gd, { mullion: true, sill: sd });
        }
        // подъезд
        F.box(-8, 3, Z0, 8, 25, Z0 + T, (lx, ly, lz) => lz !== Z0 + 1 ? 0 : ((lx === -8 || lx === 7 || lx === 0 || ly === 24) ? M.darkwood : (ly > 12 && ly < 22 && lx !== -1 ? M.glass : M.darkwood)));
        F.box(-14, 27, Z0 - 10, 14, 29, Z0, M.concrete);
        F.box(-12, 0, Z0 - 6, 12, 1, Z0, M.concrete); F.box(-12, 1, Z0 - 3, 12, 2, Z0, M.concrete);
        F.box(-3, 30, Z0 - 1, 4, 34, Z0, M.blue); GMC.text(F, '24', 2, 30, Z0 - 2, -1, 0, M.carwhite, 1);
        F.box(-1, 25, Z0 - 2, 1, 27, Z0 - 1, M.lamp);
        // балконы: консольная плита, решётка, вещи
        for (let f = 1; f < NF; f++) for (const i of balc) {
            const c = bays[i], y = f * FH;
            F.box(c - 11, y, Z0 - 12, c + 11, y + 2, Z0, M.concrete);
            F.box(c - 11, y + 2, Z0 - 12, c + 11, y + 12, Z0, (lx, ly, lz) => {
                const edge = lx === c - 11 || lx === c + 10 || lz === Z0 - 12;
                if (!edge) return -1;
                if (ly === y + 11 || ly === y + 2) return M.metal;
                return ((lx + lz) % 2 === 0) ? M.metal : -1;
            });
            const h = GMC.hash(i, f, 5);
            if (h < 0.35) { GMC.plant(F, c - 8, y + 2, Z0 - 9, false); GMC.plant(F, c + 7, y + 2, Z0 - 9, false); }
            else if (h < 0.6) { GMC.chair(F, c - 8, y + 2, Z0 - 8, 'z1', M.plank, M.plank); GMC.table(F, c - 3, y + 2, Z0 - 9, c + 3, Z0 - 4, 7, M.plank, M.metal); }
            else if (h < 0.8) {
                F.box(c - 9, y + 2, Z0 - 10, c - 8, y + 18, Z0 - 9, M.metal); F.box(c + 8, y + 2, Z0 - 10, c + 9, y + 18, Z0 - 9, M.metal);
                F.box(c - 8, y + 17, Z0 - 10, c + 8, y + 18, Z0 - 9, M.cable);
                F.box(c - 7, y + 10, Z0 - 10, c - 1, y + 17, Z0 - 9, M.canvas2); F.box(c + 1, y + 12, Z0 - 10, c + 6, y + 17, Z0 - 9, M.canvas);
            } else { F.box(c - 9, y + 2, Z0 - 10, c + 9, y + 14, Z0 - 2, M.crate); }
        }
        // интерьер: коридор вдоль x, квартиры спереди и сзади, лестница в центре сзади
        const IZ0 = Z0 + T, IZ1 = Z1 - T;
        for (let f = 0; f < NF; f++) {
            const y = f * FH, base = y + 3, ceil = (f + 1) * FH;
            F.box(X0 + T, base, -8, X1 - T, ceil, -6, M.plaster); F.box(X0 + T, base, 6, X1 - T, ceil, 8, M.plaster);
            for (const cx of [-66, -22, 22, 66]) { F.box(cx, base, IZ0, cx + 2, ceil, -8, M.plaster); F.box(cx, base, 8, cx + 2, ceil, IZ1, M.plaster); }
            for (const cx of [-88, -44, 0, 44, 88]) {
                F.box(cx - 6, base, -8, cx + 6, base + 22, -6, (lx) => lx === cx - 6 || lx === cx + 5 ? M.darkwood : 0);
                if (cx !== 0) F.box(cx - 6, base, 6, cx + 6, base + 22, 8, (lx) => lx === cx - 6 || lx === cx + 5 ? M.darkwood : 0);
                for (const [z0, z1, s] of [[IZ0, -8, -1], [8, IZ1, 1]]) {
                    if (cx === 0 && s > 0) continue;
                    if (cx === 0 && f === 0) continue;
                    const h = GMC.hash(cx, f, s);
                    const fz = s < 0 ? z0 + 2 : z1 - 2;
                    F.box(cx - 2, ceil - 1, Math.floor((z0 + z1) / 2) - 1, cx + 2, ceil, Math.floor((z0 + z1) / 2) + 1, M.lamp);
                    if (h < 0.33) {
                        GMC.sofa(F, cx - 14, base, s < 0 ? z0 + 1 : z1 - 9, cx + 6, s < 0 ? z0 + 9 : z1 - 1, s < 0 ? 'z0' : 'z1', M.fabric);
                        GMC.table(F, cx - 10, base, s < 0 ? z0 + 13 : z1 - 18, cx + 2, s < 0 ? z0 + 18 : z1 - 13, 4, M.plank, M.plank);
                        F.box(cx + 12, base, fz - 2, cx + 20, base + 22, fz + 1, M.darkwood);
                        for (let k = 0; k < 6; k++) F.box(cx + 13 + k, base + 6, fz - 1, cx + 14 + k, base + 10 + (k % 3), fz, [M.carred, M.blue, M.caryellow, M.leaves2][k % 4]);
                    } else if (h < 0.66) {
                        GMC.bed(F, cx - 16, base, s < 0 ? z0 + 3 : z1 - 22, cx - 2, s < 0 ? z0 + 22 : z1 - 3);
                        F.box(cx + 6, base, fz - 3, cx + 18, base + 22, fz + 2, M.darkwood);
                    } else {
                        F.box(cx - 18, base, fz - 3, cx + 4, base + 9, fz + 2, M.plank);
                        F.box(cx - 18, base + 9, fz - 3, cx + 4, base + 10, fz + 2, M.tile);
                        F.box(cx + 6, base, fz - 3, cx + 12, base + 20, fz + 2, M.carwhite);
                        GMC.table(F, cx - 10, base, s < 0 ? z0 + 14 : z1 - 22, cx + 2, s < 0 ? z0 + 22 : z1 - 14, 8, M.plank, M.darkwood);
                        GMC.chair(F, cx - 15, base, s < 0 ? z0 + 16 : z1 - 20, 'x0', M.plank, M.darkwood);
                        GMC.chair(F, cx + 3, base, s < 0 ? z0 + 16 : z1 - 20, 'x1', M.plank, M.darkwood);
                    }
                }
            }
            // лестница: марш вдоль +z, площадка, марш назад; проём в перекрытии
            if (f + 1 <= NF) F.box(1, ceil, 9, 11, ceil + 3, 26, 0);
            for (let i = 0; i < 14; i++) F.box(-10, base + i, 10 + i, -1, base + i + 1, 12 + i, M.concrete);
            F.box(-10, base + 14, 24, 11, base + 15, IZ1, M.concrete);
            for (let i = 0; i < 14; i++) F.box(1, base + 15 + i, 22 - i, 11, base + 16 + i, 24 - i, M.concrete);
            F.box(-12, base, 8, -10, ceil, IZ1, M.plaster); F.box(11, base, 8, 13, ceil, IZ1, M.plaster);
        }
        // крыша: трубы, антенны, тарелки, будка лестницы
        for (const [cx, cz] of [[-66, -20], [-22, 20], [22, -20], [66, 20], [-100, 0]]) {
            F.box(cx, TOP + 3, cz, cx + 6, TOP + 22, cz + 6, (lx, ly, lz) => GMC.brick(lx, ly, lz, M.brick2, M.brick, M.mortar));
            F.box(cx - 1, TOP + 22, cz - 1, cx + 7, TOP + 24, cz + 7, M.concrete);
            F.box(cx + 2, TOP + 22, cz + 2, cx + 4, TOP + 24, cz + 4, 0);
        }
        for (const [ax, az] of [[-40, -30], [40, 30], [80, -30]]) {
            F.box(ax, TOP + 3, az, ax + 1, TOP + 26, az + 1, M.metal);
            for (const yy of [16, 20, 24]) F.box(ax - 5, TOP + yy, az, ax + 6, TOP + yy + 1, az + 1, M.metal);
        }
        for (const [dx, dz] of [[-80, -40], [50, -40], [-30, 40]]) {
            F.box(dx, TOP + 3, dz, dx + 1, TOP + 9, dz + 1, M.metal);
            GMC.cylZ(F, dz - 2, dz - 1, dx, TOP + 10, 4, M.carwhite);
        }
        GMC.walls(F, -12, 8, 14, 44, TOP + 3, TOP + 25, 2, brick);
        F.box(-12, TOP + 25, 8, 14, TOP + 27, 44, M.concrete);
        F.box(-2, TOP + 3, 8, 6, TOP + 23, 10, M.darkwood);
        // пожарная лестница на заднем фасаде: площадки и марши на кронштейнах
        for (let f = 1; f < NF; f++) {
            const y = f * FH + 2;
            F.box(20, y, Z1, 76, y + 1, Z1 + 10, (lx, ly, lz) => (lx + lz) % 3 === 0 ? -1 : M.rust);
            F.box(20, y + 1, Z1 + 9, 76, y + 11, Z1 + 10, (lx, ly) => ly === y + 10 || lx % 4 === 0 ? M.rust : -1);
            F.box(20, y + 1, Z1, 21, y + 11, Z1 + 10, (lx, ly, lz) => ly === y + 10 || lz % 4 === 0 ? M.rust : -1);
            F.box(75, y + 1, Z1, 76, y + 11, Z1 + 10, (lx, ly, lz) => ly === y + 10 || lz % 4 === 0 ? M.rust : -1);
            for (const bx of [24, 48, 72]) GMC.lineF(F, bx, y - 1, Z1 + 7, bx, y - 8, Z1, M.rust);
            if (f > 1) for (let i = 0; i < FH - 1; i++) { const sx = (f % 2) ? 40 + i : 68 - i; F.box(sx, y - FH + 1 + i, Z1 + 2, sx + 2, y - FH + 2 + i, Z1 + 8, M.rust); }
        }
    },

    /** Угловой магазин «MARKET 24»: витрины между пилонами, неон на фризе, полосатая маркиза,
     *  вход в угловой нише с колонной, стеллажи с товаром, холодильники, газовые баллоны (!),
     *  квартира наверху, щит рекламы на крыше на двух тонких ногах. Фасады +z и −x. */
    'downtown-shop'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const X0 = -46, X1 = 46, Z0 = -46, Z1 = 46, H0 = 34, H1 = 62, T = 3, NX = X0 + 16, NZ = Z1 - 16;
        const brick = (lx, ly, lz) => ly < 3 ? M.stone2 : GMC.brick(lx, ly, lz, M.brick2, M.brick, M.mortar);
        const notch = (lx, lz) => lx < NX && lz >= NZ;
        // стены первого этажа: витрины на фасадах, ниша входа
        F.box(X0, 0, Z0, X1, H0, Z1, (lx, ly, lz) => {
            if (notch(lx, lz)) {
                if (lx < X0 + 4 && lz >= Z1 - 4) return brick(lx, ly, lz);                 // угловая колонна
                const onX = lx >= NX - 2 && lx < NX + 1 && lz >= NZ, onZ = lz >= NZ - 1 && lz < NZ + 2 && lx < NX;
                if (!onX && !onZ) return -1;
                if (ly >= 26) return M.plaster2;
                return (lx === NX - 1 || lz === NZ) ? ((lx + lz) % 8 === 0 || ly === 25 ? M.metal : M.glass) : -1;
            }
            const front = lz >= Z1 - T, side = lx < X0 + T, back = lz < Z0 + T || lx >= X1 - T;
            if (!front && !side && !back) return -1;
            if (back) return brick(lx, ly, lz);
            if (ly >= 26) return M.plaster2;                                                  // фриз
            const u = front ? lx - NX : (NZ - 1 - lz);
            if (u < 0) return brick(lx, ly, lz);
            if (u % 24 < 4) return brick(lx, ly, lz);                                         // пилоны
            if (ly < 3) return M.stone2;
            const d = front ? lz - (Z1 - T) : lx - X0;
            return d === 1 ? (ly === 3 || ly === 25 ? M.metal : M.glass) : 0;
        });
        // неон на фризе
        GMC.text(F, 'MARKET', NX + 8, 27, Z1, 1, 0, M.neonred, 1);
        GMC.text(F, '24', 18, 27, Z1, 1, 0, M.neonamber, 1);
        GMC.text(F, 'OPEN', X0 - 1, 27, Z0 + 12, 0, 1, M.neongreen, 1);
        // маркиза: полосы, наклон, подзор
        for (let d = 0; d < 14; d++) {
            const yt = 25 - Math.floor(d * 5 / 14), yp = d ? 25 - Math.floor((d - 1) * 5 / 14) : yt;
            F.box(NX + 4, yt, Z1 + d, X1 - 4, yp + 1, Z1 + d + 1, (lx) => ((lx >> 2) & 1) ? M.canvas : M.canvas2);
        }
        F.box(NX + 4, 18, Z1 + 13, X1 - 4, 21, Z1 + 14, (lx) => ((lx >> 2) & 1) ? M.canvas : M.canvas2);
        for (const ax of [NX + 6, 10, X1 - 6]) GMC.lineF(F, ax, 13, Z1, ax, 20, Z1 + 12, M.metal);
        // второй этаж: штукатурка, окна с ящиками цветов, угловой балкон
        F.box(X0, H0, Z0, X1, H1, Z1, (lx, ly, lz) => (lx < X0 + T || lx >= X1 - T || lz < Z0 + T || lz >= Z1 - T) ? (ly < H0 + 2 ? M.concrete : M.plaster) : -1);
        for (const c of [-30, -8, 14, 34]) {
            GMC.window(F, 'x', c - 5, c + 5, H0 + 8, H0 + 22, Z1 - T, Z1, Z1 - 2, { mullion: true, sill: Z1 });
            F.box(c - 5, H0 + 7, Z1 + 1, c + 5, H0 + 9, Z1 + 3, M.terracotta);
            for (let lx = c - 5; lx < c + 5; lx++) if (GMC.hash(lx, c, 3) < 0.7) F.put(lx, H0 + 9, Z1 + 2, GMC.hash(lx, 1, c) < 0.4 ? M.neonred : M.leaves2);
            GMC.window(F, 'z', c - 5, c + 5, H0 + 8, H0 + 22, X0, X0 + T, X0 + 1, { mullion: true, sill: X0 - 1 });
            GMC.window(F, 'x', c - 5, c + 5, H0 + 8, H0 + 22, Z0, Z0 + T, Z0 + 1, { sill: Z0 - 1 });
        }
        F.box(X0 - 8, H0, Z1 - 20, X0 + 14, H0 + 2, Z1 + 8, (lx, ly, lz) => (lx >= X0 && lz < Z1) ? -1 : M.concrete);
        F.box(X0 - 8, H0 + 2, Z1 - 20, X0 + 14, H0 + 12, Z1 + 8, (lx, ly, lz) => {
            if (lx >= X0 && lz < Z1) return -1;
            const e = lx === X0 - 8 || lz === Z1 + 7 || (lz === Z1 - 20 && lx < X0) || (lx === X0 + 13 && lz >= Z1);
            return e && (ly === H0 + 11 || (lx + lz) % 2 === 0) ? M.metal : -1;
        });
        // перекрытия и крыша
        F.box(X0 + T, 0, Z0 + T, X1 - T, 2, Z1 - T, (lx, ly, lz) => notch(lx, lz) ? -1 : M.concrete);
        F.box(X0 + T, 2, Z0 + T, X1 - T, 3, Z1 - T, (lx, ly, lz) => notch(lx, lz) ? -1 : ((((lx >> 2) + (lz >> 2)) & 1) ? M.tile : M.paint));
        F.box(NX - 2, 0, NZ, NX + 1, 3, Z1, M.stone2); F.box(X0, 0, NZ - 1, NX, 3, NZ + 2, M.stone2);
        F.box(X0, H0, Z0, X1, H0 + 2, Z1, (lx, ly, lz) => (lx >= X0 + T && lx < X1 - T && lz >= Z0 + T && lz < Z1 - T) || notch(lx, lz) ? M.concrete : -1);
        F.box(X0 + T, H0 + 2, Z0 + T, X1 - T, H0 + 3, Z1 - T, M.plank);
        F.box(X0, H1, Z0, X1, H1 + 3, Z1, M.concrete);
        F.box(X0 + 1, H1 + 3, Z0 + 1, X1 - 1, H1 + 4, Z1 - 1, M.asphalt);
        GMC.walls(F, X0, Z0, X1, Z1, H1 + 3, H1 + 7, 2, brick);
        // торговый зал: стеллажи, касса, холодильники, баллоны, склад
        for (const sz of [-26, -12, 2, 16]) { GMC.shelf(F, -18, 3, sz, 10, sz + 3, 16, sz); GMC.shelf(F, -18, 3, sz + 3, 10, sz + 6, 16, sz + 50); }
        F.box(NX + 2, 3, NZ - 14, NX + 6, 13, NZ - 2, M.darkwood); F.box(NX + 1, 13, NZ - 14, NX + 7, 14, NZ - 2, M.tile);
        F.box(NX + 3, 14, NZ - 9, NX + 6, 17, NZ - 5, M.concrete2); F.box(NX + 3, 16, NZ - 9, NX + 4, 17, NZ - 5, M.neongreen);
        for (let lx = -40; lx < 20; lx += 10) {
            F.box(lx, 3, Z0 + T, lx + 10, 24, Z0 + T + 8, (px, py, pz) => (px === lx || px === lx + 9 || py === 3 || py === 23) ? M.carwhite : (pz === Z0 + T + 7 ? M.glass : (py % 5 === 0 ? M.metal : (py % 5 === 1 && GMC.hash(px, py, pz) < 0.6 ? (GMC.hash(px, pz, 1) < 0.5 ? M.neongreen : M.carred) : -1))));
            F.box(lx + 1, 22, Z0 + T + 1, lx + 9, 23, Z0 + T + 6, M.lamp);
        }
        for (const [bx, bz] of [[16, -20], [20, -20], [16, -16]]) GMC.cyl(F, bx, bz, 1.5, 3, 11, M.barrel);
        GMC.walls(F, 22, Z0 + T, X1 - T, 0, 3, H0, 2, M.plaster);
        F.box(22, 3, -20, 24, 24, -10, 0);
        for (let cx = 28; cx < 40; cx += 7) for (let cz = -40; cz < -8; cz += 7) for (let k = 0; k < 1 + ((cx + cz) & 1) + (cz > -30 ? 1 : 0); k++) F.box(cx, 3 + k * 6, cz, cx + 6, 9 + k * 6, cz + 6, M.crate);
        for (let lx = -30; lx < 20; lx += 16) for (let lz = -30; lz < 30; lz += 16) F.box(lx, H0 - 1, lz, lx + 8, H0, lz + 2, M.lamp);
        // квартира наверху
        const ub = H0 + 3;
        F.box(0, ub, Z0 + T, 2, H1, Z1 - T, M.plaster);
        F.box(0, ub, -6, 2, ub + 22, 6, 0);
        GMC.bed(F, 10, ub, -36, 30, -14); F.box(32, ub, -40, 40, ub + 22, -30, M.darkwood);
        GMC.sofa(F, -40, ub, 20, -16, 28, 'z1', M.blue); GMC.table(F, -34, ub, 6, -22, 14, 5, M.plank, M.plank);
        F.box(-40, ub, -40, -20, ub + 9, -34, M.plank); F.box(-40, ub + 9, -40, -20, ub + 10, -34, M.tile); F.box(-18, ub, -40, -12, ub + 20, -34, M.carwhite);
        F.box(-4, H1 - 1, -2, 4, H1, 2, M.lamp); F.box(18, H1 - 1, -2, 26, H1, 2, M.lamp);
        // рекламный щит на крыше: две тонкие ноги, подкосы, площадка, подсветка
        const ry = H1 + 4;
        for (const lx of [-20, 18]) {
            F.box(lx, ry, 0, lx + 2, ry + 22, 2, M.metal);
            GMC.lineF(F, lx + 1, ry, -16, lx + 1, ry + 16, 0, M.metal);
        }
        F.box(-34, ry + 20, 2, 34, ry + 21, 8, (lx, ly, lz) => (lx % 3 === 0 && lz % 2 === 1) ? -1 : M.metal);
        F.box(-34, ry + 21, 7, 34, ry + 25, 8, (lx, ly) => ly === ry + 24 || lx % 6 === 0 ? M.metal : -1);
        F.box(-34, ry + 22, 0, 34, ry + 48, 2, (lx, ly, lz) => {
            if (lz === 0) return (lx === -34 || lx === 33 || ly === ry + 22 || ly === ry + 47) ? M.metal : M.plank;
            const u = lx + 34, v = ly - ry - 22;
            if (lx === -34 || lx === 33 || ly === ry + 22 || ly === ry + 47) return M.metal;
            if ((u - 14) ** 2 + (v - 13) ** 2 < 64) return M.carred;
            if (v < 6) return M.caryellow;
            return v > 18 ? M.blue : M.carwhite;
        });
        GMC.text(F, 'SALE', -4, ry + 30, 2, 1, 0, M.carred, 2);
        for (const lx of [-26, 0, 24]) { F.box(lx, ry + 20, 8, lx + 1, ry + 21, 14, M.metal); F.box(lx - 1, ry + 21, 12, lx + 2, ry + 23, 14, M.lamp); }
    },

    /** Стройка: каркас из колонн и плит (верхняя плита — на опалубке и тонких стойках), недостроенная
     *  кладка, леса из труб и досок, забор, бытовка, газовые баллоны, бетономешалка, поддоны кирпича,
     *  башенный кран: решётчатая мачта, стрела над улицей с грузом на тросе, противовес. */
    'downtown-construction'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const X0 = -48, X1 = 48, Z0 = -54, Z1 = 54;
        // забор-ограждение по фасадам (−z и −x), ворота
        F.box(X0, 0, Z0, X1, 20, Z0 + 1, (lx, ly) => (lx >= -2 && lx < 22) ? (ly < 18 && ((lx + 1000) % 3 === 0 || ly === 1 || ly === 17) ? M.metal : -1) : ((lx >> 2) & 1 ? M.plank : M.wood));
        F.box(X0, 0, Z0, X0 + 1, 20, Z1, (lx, ly, lz) => ((lz >> 2) & 1 ? M.plank : M.wood));
        F.box(X1 - 1, 0, Z0, X1, 20, Z1, (lx, ly, lz) => ((lz >> 2) & 1 ? M.plank : M.wood));
        F.box(X0, 0, Z1 - 1, X1, 20, Z1, (lx) => ((lx >> 2) & 1 ? M.plank : M.wood));
        F.box(-25, 2, Z0 - 1, -3, 16, Z0, M.hazard);
        GMC.text(F, 'KEEP', -7, 9, Z0 - 2, -1, 0, M.concrete2, 1);
        GMC.text(F, 'OUT', -9, 3, Z0 - 2, -1, 0, M.concrete2, 1);
        // каркас: колонны 5×5 сеткой 3×3, плиты, недостроенный верх
        const CX = [-40, -10, 22], CZ = [-34, -4, 28], B0 = -40, B1 = 27, C0 = -34, C1 = 33;
        F.box(B0, 0, C0, B1 + 5, 2, C1, M.concrete);
        for (let lv = 0; lv < 3; lv++) {
            const y = lv * 30;
            for (const cx of CX) for (const cz of CZ) {
                const top = lv === 2 ? (GMC.hash(cx, cz, 2) < 0.5 ? 14 : 30) : 30;
                F.box(cx, y + 2, cz, cx + 5, y + top, cz + 5, M.concrete);
                if (lv === 2) for (const [rx, rz] of [[cx, cz], [cx + 4, cz], [cx, cz + 4], [cx + 4, cz + 4]]) F.box(rx, y + top, rz, rx + 1, y + top + 8, rz + 1, M.rust);
            }
            if (lv === 0) continue;
            if (lv === 1) F.box(B0, y, C0, B1 + 5, y + 2, C1, M.concrete);
            if (lv === 2) {
                F.box(B0, y, C0, B1 + 5, y + 2, C1, (lx, ly, lz) => (lx > -10 && lz < -4) ? -1 : M.concrete);
                // ненабранный угол: арматурная сетка на опалубке, под ней тонкие стойки
                F.box(-9, y - 1, C0, B1 + 5, y, -4, M.plank);
                for (let lx = -9; lx < B1 + 5; lx += 4) F.box(lx, y, C0, lx + 1, y + 1, -4, M.rust);
                for (let lz = C0; lz < -4; lz += 4) F.box(-9, y, lz, B1 + 5, y + 1, lz + 1, M.rust);
                for (let lx = -6; lx < B1 + 2; lx += 9) for (let lz = C0 + 3; lz < -6; lz += 9) F.box(lx, 32, lz, lx + 1, y - 1, lz + 1, M.metal);
            }
        }
        // кладка первого этажа: южная и восточная стены целиком, западная — ступенькой
        F.box(B0 + 5, 2, C1 - 3, B1, 30, C1, (lx, ly, lz) => GMC.brick(lx, ly, lz, M.brick, M.brick2, M.mortar));
        F.box(B1 + 2, 2, C0 + 5, B1 + 5, 30, C1 - 3, (lx, ly, lz) => GMC.brick(lx, ly, lz, M.brick, M.brick2, M.mortar));
        F.box(B0 + 1, 2, C0 + 5, B0 + 4, 30, C1 - 3, (lx, ly, lz) => (ly < 2 + Math.max(0, (C1 - 3 - lz)) * 0.6 + 4 ? GMC.brick(lx, ly, lz, M.brick, M.brick2, M.mortar) : -1));
        for (let i = 0; i < 27; i++) F.box(-8, 2 + i, 5 + i, 4, 3 + i, 7 + i, M.concrete);
        // леса вдоль фасада −z
        const SZ0 = C0 - 8, SZ1 = C0 - 2;
        for (let lx = B0 - 2; lx <= B1 + 6; lx += 18) for (const lz of [SZ0, SZ1]) F.box(lx, 0, lz, lx + 1, 96, lz + 1, M.metal);
        for (const ly of [28, 58, 88]) {
            F.box(B0 - 2, ly, SZ0, B1 + 7, ly + 1, SZ0 + 1, M.metal); F.box(B0 - 2, ly, SZ1, B1 + 7, ly + 1, SZ1 + 1, M.metal);
            F.box(B0 - 2, ly + 1, SZ0 + 1, B1 + 7, ly + 2, SZ1, M.plank);
            F.box(B0 - 2, ly + 10, SZ0, B1 + 7, ly + 11, SZ0 + 1, M.metal);
            for (let lx = B0 - 2; lx <= B1 + 6; lx += 18) F.box(lx, ly, SZ1 + 1, lx + 1, ly + 1, C0, M.metal);
        }
        for (let lx = B0 - 2; lx < B1 - 12; lx += 36) for (const ly of [0, 30, 60]) GMC.lineF(F, lx, ly + 1, SZ0, lx + 18, ly + 28, SZ0, M.metal);
        // бытовка-контейнер, кабинка, баллоны, бетономешалка, песок, поддоны кирпича, мусорный контейнер
        F.box(10, 0, 36, 46, 26, 52, (lx, ly, lz) => {
            const e = lx === 10 || lx === 45 || lz === 36 || lz === 51 || ly === 0 || ly === 25;
            if (!e) return -1;
            if (lz === 36 && lx > 14 && lx < 26 && ly > 9 && ly < 19) return M.glass;
            if (lz === 36 && lx > 32 && lx < 40 && ly > 0 && ly < 21) return M.darkwood;
            return ((lx + lz) & 1) ? M.blue : M.steelg;
        });
        F.box(-46, 0, 40, -36, 24, 50, (lx, ly, lz) => (lx === -46 || lx === -37 || lz === 40 || lz === 49 || ly === 23) ? M.blue : -1);
        for (const [bx, bz] of [[4, 40], [4, 45], [7, 42]]) GMC.cyl(F, bx, bz, 1.6, 0, 12, M.barrel);
        GMC.cylX(F, -30, -18, 12, 12, 6, M.caryellow, 1.6); GMC.cylX(F, -31, -30, 12, 12, 4, M.caryellow);
        F.box(-30, 0, 6, -18, 6, 18, (lx, ly, lz) => (ly === 5 || lx === -30 || lx === -19) && (lz === 6 || lz === 17 || ly === 5) ? M.hazard : -1);
        F.box(-26, 0, 7, -22, 6, 17, M.hazard);
        GMC.ell(F, -2, 0, 16, 12, 8, 10, (lx, ly) => ly < 0 ? -1 : M.sand);
        for (const [px, pz] of [[-38, -48], [-24, -48], [30, -30]]) {
            F.box(px, 0, pz, px + 12, 2, pz + 12, M.crate);
            F.box(px, 2, pz, px + 12, 12, pz + 12, (lx, ly, lz) => GMC.brick(lx, ly, lz, M.brick, M.brick2, M.brick));
        }
        F.box(28, 0, -50, 46, 12, -38, (lx, ly, lz) => (lx === 28 || lx === 45 || lz === -50 || lz === -39 || ly === 0) ? M.hazard : (ly < 7 + GMC.hash(lx >> 1, 1, lz >> 1) * 5 ? (GMC.hash(lz >> 1, lx >> 1, ly >> 1) < 0.5 ? M.brick2 : M.concrete2) : -1));
        // башенный кран: фундамент, решётчатая мачта, поворотная часть, стрела на −x, противовес на +x
        const KX = -38, KZ = 40, MY = 140;
        F.box(KX - 7, 0, KZ - 7, KX + 8, 3, KZ + 8, M.concrete);
        const mast = (lx, ly, lz) => {
            const ex = lx === KX - 4 || lx === KX + 3, ez = lz === KZ - 4 || lz === KZ + 3;
            if (ex && ez) return M.hazard;
            const yy = ly % 8;
            if ((ex || ez) && yy === 0) return M.hazard;
            const u0 = ex ? lz - (KZ - 4) : lx - (KX - 4), u = (ly % 16) < 8 ? u0 : 7 - u0;
            if ((ex || ez) && (u === yy || u === yy + 1)) return M.hazard;
            return -1;
        };
        F.box(KX - 4, 3, KZ - 4, KX + 4, MY, KZ + 4, mast);
        F.box(KX - 6, MY, KZ - 6, KX + 6, MY + 3, KZ + 6, M.hazard);
        F.box(KX + 2, MY + 3, KZ + 4, KX + 9, MY + 11, KZ + 10, (lx, ly, lz) => (lz === KZ + 4 || lx === KX + 2) && ly > MY + 5 && ly < MY + 10 ? M.glass : M.carwhite);
        for (const [cx, cz] of [[KX - 4, KZ - 4], [KX + 3, KZ - 4], [KX - 4, KZ + 3], [KX + 3, KZ + 3]]) GMC.lineF(F, cx, MY + 3, cz, KX, MY + 26, KZ, M.hazard);
        F.box(KX - 1, MY + 25, KZ - 1, KX + 1, MY + 28, KZ + 1, M.hazard);
        const J0 = MY + 3, JL = 120;
        F.box(KX - JL, J0, KZ - 3, KX + 46, J0 + 1, KZ - 2, M.hazard); F.box(KX - JL, J0, KZ + 3, KX + 46, J0 + 1, KZ + 4, M.hazard);
        F.box(KX - JL, J0 + 7, KZ, KX + 46, J0 + 8, KZ + 1, M.hazard);
        for (let lx = KX - JL; lx < KX + 40; lx += 10) {
            F.box(lx, J0, KZ - 3, lx + 1, J0 + 1, KZ + 4, M.hazard);
            for (const sz of [-3, 3]) { GMC.lineF(F, lx, J0, KZ + sz, lx + 5, J0 + 7, KZ, M.hazard); GMC.lineF(F, lx + 5, J0 + 7, KZ, lx + 10, J0, KZ + sz, M.hazard); }
        }
        F.box(KX + 4, J0 + 1, KZ - 2, KX + 46, J0 + 2, KZ + 3, M.metal);
        for (let i = 0; i < 3; i++) F.box(KX + 30 + i * 5, J0 - 8, KZ - 4, KX + 34 + i * 5, J0, KZ + 5, M.concrete);
        GMC.lineF(F, KX, MY + 27, KZ, KX - 80, J0 + 7, KZ, M.cable);
        GMC.lineF(F, KX, MY + 27, KZ, KX + 44, J0 + 2, KZ, M.cable);
        // тележка, крюк на двух тросах, поддон кирпича на стропах
        const TX = KX - 100, LY = 60;
        F.box(TX - 3, J0 - 3, KZ - 2, TX + 4, J0, KZ + 3, M.hazard);
        F.box(TX - 1, LY + 16, KZ - 1, TX + 2, J0 - 3, KZ, M.cable);
        F.box(TX - 2, LY + 12, KZ - 2, TX + 3, LY + 16, KZ + 3, M.hazard);
        for (const [sx, sz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) GMC.lineF(F, TX, LY + 12, KZ, TX + sx, LY + 1, KZ + sz, M.cable);
        F.box(TX - 6, LY - 10, KZ - 6, TX + 7, LY - 8, KZ + 7, M.crate);
        F.box(TX - 6, LY - 8, KZ - 6, TX + 7, LY + 1, KZ + 7, (lx, ly, lz) => GMC.brick(lx, ly, lz, M.brick, M.brick2, M.brick));
    },

    /** Парковка у магазина: разметка мест, мусорный бак, газетный киоск. */
    'downtown-parking'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        for (let lz = -40; lz < 40; lz++) for (let lx = -45; lx < 45; lx++) F.put(lx, -1, lz, ((lx + 1000) % 30 === 0 && lz > -36 && lz < 6) || (lz === 6 && lx > -40 && lx < 40) ? M.paint : M.asphalt);
        F.box(-44, 0, -38, -43, 26, -37, M.metal);
        F.box(-48, 18, -39, -39, 29, -38, M.blue);
        GMC.text(F, 'P', -45, 21, -40, -1, 0, M.carwhite, 1);
        F.box(26, 0, 14, 44, 12, 26, (lx, ly, lz) => ly === 0 ? M.rubber : ((lx === 26 || lx === 43 || lz === 14 || lz === 25) ? M.steelg : (ly < 6 + ((lx * 3 + lz) % 4) ? (GMC.hash(lx >> 1, ly, lz >> 1) < 0.5 ? M.crate : M.canvas2) : -1)));
        F.box(25, 11, 13, 45, 12, 20, M.steelg);
        F.dyn(26, 0, 14, 44, 13, 26);
    },

    /** Киоск: стеклянная витрина, окошко, журналы, козырёк с вывеской (news | cafe). */
    'downtown-kiosk'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), cafe = GMC.num(mk) % 2 === 0;
        const P = cafe ? M.canvas2 : M.steelg;
        F.box(-15, 0, -11, 15, 26, 11, (lx, ly, lz) => {
            const e = lx === -15 || lx === 14 || lz === -11 || lz === 10;
            if (ly === 0) return M.concrete2;
            if (!e) return -1;
            if (lz === 10 && ly > 6 && ly < 22 && lx > -13 && lx < 12) return (lx > -3 && lx < 4 && ly < 16) ? 0 : (lx % 6 === 0 ? P : M.glass);
            if (lz === -11 && lx > -5 && lx < 3 && ly < 21) return ly === 10 && lx === 1 ? M.metal : M.darkwood;
            if ((lx === -15 || lx === 14) && lz > -8 && lz < 7 && ly > 6 && ly < 22) return [M.caryellow, M.carred, M.blue, M.carwhite][((lz + 8) >> 2) & 3];
            return P;
        });
        F.box(-17, 26, -13, 17, 28, 16, M.carred);
        F.box(-15, 28, 12, 15, 34, 13, P);
        GMC.text(F, cafe ? 'CAFE' : 'NEWS', -7, 28, 13, 1, 0, M.neonamber, 1);
        F.box(-12, 6, 6, 12, 7, 10, M.plank);
        for (let lx = -12; lx < 12; lx += 3) {
            F.box(lx, 7, 7, lx + 2, 8, 9, [M.carred, M.caryellow, M.blue, M.carwhite][(lx >> 1) & 3]);
            for (const ly of [6, 13]) F.box(lx, ly, -10, lx + 2, ly + 5, -9, [M.carred, M.caryellow, M.blue, M.carwhite][((lx + ly) >> 1) & 3]);
        }
        F.box(-3, 6, 10, 4, 7, 13, M.plank);
        if (cafe) for (const [tx, tz] of [[-10, 26], [10, 26]]) {
            GMC.table(F, tx - 3, 0, tz - 3, tx + 3, tz + 3, 8, M.plank, M.metal);
            GMC.chair(F, tx - 8, 0, tz - 2, 'x0', M.plank, M.metal); GMC.chair(F, tx + 4, 0, tz - 2, 'x1', M.plank, M.metal);
            F.box(tx, 8, tz, tx + 1, 22, tz + 1, M.metal); GMC.cyl(F, tx, tz, 7, 22, 23, (lx) => (lx >> 1) & 1 ? M.canvas : M.canvas2);
        }
    },

    /** Остановка: стеклянный павильон, скамья, светящийся рекламный короб, табличка «BUS». Дорога — на −z. */
    'downtown-busstop'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        for (const [px, pz] of [[-20, -6], [19, -6], [-20, 6], [19, 6]]) F.box(px, 0, pz, px + 1, 26, pz + 1, M.metal);
        F.box(-22, 26, -8, 22, 27, 8, M.metal);
        F.box(-21, 27, -7, 21, 28, 7, M.glass);
        F.box(-20, 2, 6, 20, 25, 7, (lx, ly) => (lx === -20 || lx === 19 || ly === 2 || ly === 24 || lx === 0) ? M.metal : M.glass);
        F.box(-20, 2, -5, -19, 25, 6, (lx, ly, lz) => (lz === -5 || ly === 2 || ly === 24) ? M.metal : M.glass);
        F.box(19, 2, -5, 20, 25, 6, (lx, ly, lz) => (lz === -5 || ly === 2 || ly === 24) ? M.metal : (ly > 4 && ly < 23 && lz > -3 && lz < 5 ? M.lamp : M.metal));
        F.box(-16, 5, 2, 14, 6, 5, M.plank); F.box(-15, 0, 3, -13, 5, 4, M.metal); F.box(11, 0, 3, 13, 5, 4, M.metal);
        F.box(-30, 0, -8, -28, 34, -6, M.metal);
        F.box(-38, 30, -8, -23, 38, -7, M.carwhite);
        GMC.text(F, 'BUS', -25, 32, -9, -1, 0, M.blue, 1);
        F.box(14, 0, -10, 18, 10, -6, M.steelg);
    },

    /** Светофор: столб, вылет над проезжей частью (+x), три секции, кнопка для пешеходов. */
    'downtown-lights'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        F.box(-1, 0, -1, 2, 2, 2, M.concrete2);
        F.box(0, 0, 0, 2, 46, 2, M.concrete2);
        F.box(0, 44, 0, 30, 46, 2, M.concrete2);
        GMC.lineF(F, 2, 36, 1, 10, 44, 1, M.concrete2);
        for (const hx of [16, 28]) {
            F.box(hx - 2, 31, -1, hx + 2, 44, 3, M.concrete2);
            F.box(hx - 1, 40, -2, hx + 1, 43, -1, M.neonred); F.box(hx - 1, 36, -2, hx + 1, 39, -1, M.neonamber); F.box(hx - 1, 32, -2, hx + 1, 35, -1, M.neongreen);
        }
        F.box(-2, 16, -1, 0, 26, 2, M.concrete2); F.box(-3, 21, 0, -2, 25, 2, M.neonred); F.box(-3, 17, 0, -2, 20, 2, M.neongreen);
        F.box(2, 9, 0, 4, 13, 2, M.caryellow);
    },

    /** Уличный фонарь: столб, изогнутый вылет, плафон. */
    'downtown-lamp'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        F.box(-1, 0, -1, 2, 3, 2, M.concrete2);
        F.box(0, 0, 0, 1, 55, 1, M.metal);
        F.box(1, 54, 0, 4, 55, 1, M.metal);
        F.box(4, 54, -1, 12, 55, 2, M.metal);
        F.box(5, 53, -1, 11, 54, 2, M.lamp);
    },

    /** Дерево в приствольной решётке: ствол, ветви, крона-оболочка. */
    'downtown-tree'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), n = GMC.num(mk);
        for (let lz = -5; lz < 5; lz++) for (let lx = -5; lx < 5; lx++) F.put(lx, -1, lz, (lx === -5 || lx === 4 || lz === -5 || lz === 4) ? M.rust : M.dirt);
        const h = 30 + (n % 3) * 4;
        F.box(-1, 0, -1, 2, h, 2, M.wood);
        for (const [bx, bz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) GMC.lineF(F, bx, h - 6, bz, bx * 8, h + 1, bz * 8, M.wood);
        const leaf = (lx, ly, lz) => GMC.hash(lx >> 1, ly >> 1, lz >> 1) < 0.35 ? M.leaves2 : M.leaves;
        GMC.ell(F, 0, h + 4, 0, 13, 10, 13, leaf, 0.35);
        GMC.ell(F, 6, h + 1, 4, 7, 6, 7, leaf, 0.5); GMC.ell(F, -6, h + 2, -5, 7, 6, 7, leaf, 0.5);
    },

    /** Мелочь у тротуара: урна (динамическая), гидрант, скамейка — по номеру маркера. */
    'downtown-prop'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), k = GMC.num(mk) % 3;
        if (k === 0) { GMC.cyl(F, 0, 0, 3, 0, 10, (lx, ly) => ly === 9 ? M.concrete2 : M.steelg, 1.6); GMC.cyl(F, 0, 0, 3, 0, 1, M.steelg); F.dyn(-3, 0, -3, 4, 10, 4); }
        else if (k === 1) { GMC.cyl(F, 0, 0, 2, 0, 8, M.carred); GMC.cyl(F, 0, 0, 2.6, 8, 9, M.carred); F.box(-3, 4, 0, 4, 6, 1, M.carred); F.put(0, 9, 0, M.carred); }
        else {
            F.box(-12, 4, -2, 12, 5, 3, M.plank); F.box(-12, 5, 2, 12, 11, 3, M.plank);
            for (const lx of [-10, 9]) { F.box(lx, 0, -2, lx + 1, 4, 3, M.metal); F.box(lx, 4, 2, lx + 1, 11, 3, M.metal); }
        }
    },

    /** Машина: цвет по номеру маркера (6 — такси); динамическое тело. */
    'downtown-car'(w, x, z, rot, mk) {
        const n = GMC.num(mk);
        const paints = [M.carred, M.carred, M.carwhite, M.blue, M.steelg, M.concrete2, M.caryellow, M.carwhite, M.carred];
        GMC.car(GMC.frame(w, x, z, rot), paints[n % paints.length], n === 6);
    },
    'downtown-bus'(w, x, z, rot) { GMC.bus(GMC.frame(w, x, z, rot)); },
});

// ============================================================================ ГОРНАЯ ДЕРЕВНЯ
// Снег. Овраг с замёрзшим ручьём идёт с севера на юг (x ≈ 340) между скальными гребнями; через него —
// крытый деревянный мост. Запад — деревня: каменная часовня с колокольней, шале, гостиница с газовым
// баком, поленницы, пруд подо льдом, сосны. Восток — склон с канатной дорогой (опоры, кресла на тросе).

/** Рельеф деревни (абсолютный y верхнего вокселя) — общий для земли, моста и канатки.
 *  @satisfies {Record<string, any>} */
const GMV = {
    ox: 0, oz: 0,
    xc(z) { return 340 + this.ox + 12 * Math.sin(z * 0.012); },
    ridge(z) {
        const zb = 250 + this.oz;
        const r = 10 + 8 * GMC.fbm(7, z, 60, 41);
        const k = GMC.smooth((Math.abs(z - zb) - 22) / 30);
        return Math.round(14 + (r - 14) * k);
    },
    /** Верх земли (y) в столбце и материал верхнего слоя. */
    height(x, z) {
        const G = GameMapBuild.GROUND, d = Math.abs(x - this.xc(z)), R = this.ridge(z);
        let h = G - 1;
        if (d < 10) h = 2;
        else if (d < 34) h = Math.round(2 + (G - 1 + R - 2) * Math.pow(GMC.smooth((d - 10) / 24), 0.8) + (GMC.noise(x, z, 5, 3) - 0.5) * 5);
        else if (d < 64) h = Math.round(G - 1 + R * GMC.smooth((64 - d) / 30));
        if (d >= 30) h = Math.max(h, Math.round(G - 1 + this.mount(x, z)));
        return Math.min(h, 150);
    },
    /** Горы вокруг долины: склон канатки на северо-востоке, хребет по северному краю, валы по краям
     *  карты (с перевалом, по которому тропа входит в деревню с запада). Высота над землёй, воксели. */
    mount(x, z) {
        const hill = 42 * GMC.smooth((330 + this.oz - z) / 230) * GMC.smooth((x - 398 - this.ox) / 50) * (0.85 + 0.3 * GMC.fbm(x, z, 70, 5));
        const north = 30 * GMC.smooth((70 - z) / 60) * (0.55 + 0.6 * GMC.fbm(x, z, 50, 9));
        const e = Math.min(x, z, 511 - x, 511 - z);
        const pass = x < 60 ? GMC.smooth((Math.abs(z - 258 - this.oz) - 14) / 40) : 1;
        const rim = e < 34 ? 36 * GMC.smooth((34 - e) / 34) * (0.6 + 0.6 * GMC.fbm(x, z, 40, 13)) * pass : 0;
        return Math.max(hill, north, rim);
    },
    /** Столбец горы можно делать коркой (пусто внутри): далеко от оврага и не на самом краю карты. */
    crust(x, z) {
        const e = Math.min(x, z, 511 - x, 511 - z);
        return e >= 2 && Math.abs(x - this.xc(z)) >= 70;
    },
};

Object.assign(GameMapBuild.builders, {
    /** Земля деревни: снег, утоптанные тропы, овраг со скальными стенками и льдом, гребни, склон, горы. */
    'village-terrain'(w, x, z) {
        const V = GMV, G = GameMapBuild.GROUND, SX = w.sx;
        V.ox = x - 256; V.oz = z - 256;
        const zb = 250 + V.oz;
        const Hm = new Int16Array(w.sx * w.sz);
        for (let zz = 0; zz < w.sz; zz++) for (let xx = 0; xx < w.sx; xx++) Hm[xx + zz * SX] = V.height(xx, zz);
        const H = (xx, zz) => Hm[Math.max(0, Math.min(SX - 1, xx)) + Math.max(0, Math.min(w.sz - 1, zz)) * SX];
        const bx0 = V.xc(zb) + 56;
        for (let zz = 0; zz < w.sz; zz++) for (let xx = 0; xx < w.sx; xx++) {
            const h = H(xx, zz), d = Math.abs(xx - V.xc(zz));
            // тропы: деревенская (запад, к мосту) и к нижней станции канатки (восток)
            const pathW = Math.abs(zz - (zb + 8 + 6 * Math.sin(xx * 0.02))) < 9 + GMC.noise(xx, zz, 6, 2) * 3 && xx > 36 && d > 30;
            const pe = (xx - bx0) / 42, pathE = pe > -0.1 && pe < 1 && Math.abs(zz - (zb + 12 + Math.max(0, pe) * 118)) < 9;
            if (h < G - 1) {
                for (let y = h + 1; y < G; y++) w.put(xx, y, zz, 0);
                for (let y = 1; y <= h; y++) w.put(xx, y, zz, (y + Math.floor(GMC.noise(xx, zz, 14, 8) * 6)) % 7 < 2 ? M.stone2 : M.rock);
                const flat = Math.abs(H(xx + 1, zz) - h) + Math.abs(H(xx, zz + 1) - h) < 2;
                if (d < 7) w.put(xx, h, zz, M.ice);
                else if (flat) w.put(xx, h, zz, M.snow);
            } else {
                const y0 = (h > G + 10 && V.crust(xx, zz)) ? h - 9 : G - 1;
                for (let y = y0; y <= h; y++) w.put(xx, y, zz, y === h ? M.snow : (d < 40 || y > h - 3 || y === y0 ? M.rock : M.dirt));
                if (h > G + 2 && d < 40) {
                    const steep = Math.abs(H(xx + 1, zz) - h) + Math.abs(H(xx - 1, zz) - h) > 3;
                    if (steep) w.put(xx, h, zz, M.rock);
                }
                if ((pathW || pathE) && h === G - 1) w.put(xx, h, zz, GMC.hash(xx, 1, zz) < 0.15 ? M.snow : M.snow2);
                if ((pathW || pathE) && h > G - 1) w.put(xx, h, zz, M.snow2);
            }
            // валуны в русле
            if (d < 9 && GMC.hash(xx >> 3, 5, zz >> 3) < 0.08 && GMC.noise(xx, zz, 4, 6) > 0.55) w.put(xx, h + 1, zz, M.rock);
        }
    },

    /** Каменная часовня: неф с контрфорсами и стрельчатыми витражами, апсида, крутая сланцевая крыша,
     *  колокольня со звонницей, колоколом на балке, часами и шпилем с крестом; скамьи, алтарь, люстра на цепи. */
    'village-chapel'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const NX0 = -40, NX1 = 60, NZ0 = -35, NZ1 = 35, WH = 60, T = 3;
        const st = (lx, ly, lz) => ly < 4 ? M.stone2 : GMC.stonework(lx, ly, lz, M.stone, M.stone2, M.mortar);
        // неф
        GMC.walls(F, NX0, NZ0, NX1, NZ1, 0, WH, T, st);
        F.box(NX0 - 1, 0, NZ0 - 1, NX1 + 1, 4, NZ1 + 1, (lx, ly, lz) => (lx < NX0 + T || lx >= NX1 - T || lz < NZ0 + T || lz >= NZ1 - T || lx < NX0 || lx >= NX1 || lz < NZ0 || lz >= NZ1) ? M.stone2 : -1);
        // апсида — полукруг на востоке
        GMC.cyl(F, NX1, 0, 26, 0, WH, (lx, ly, lz) => lx < NX1 ? -1 : st(lx, ly, lz), 3);
        F.box(NX1 - 3, 4, -23, NX1, WH, 23, 0);
        // контрфорсы и окна между ними
        for (let bx = NX0 + 12; bx < NX1; bx += 24) for (const s of [-1, 1]) {
            const zf = s < 0 ? NZ0 : NZ1;
            F.box(bx, 0, s < 0 ? zf - 5 : zf, bx + 4, 44, s < 0 ? zf : zf + 5, (lx, ly, lz) => {
                const dd = s < 0 ? zf - lz : lz - zf + 1;
                return dd > 5 - Math.floor(ly / 11) ? -1 : st(lx, ly, lz);
            });
        }
        const lancet = (c, s) => {
            const zf = s < 0 ? NZ0 : NZ1 - T, gd = s < 0 ? NZ0 + 1 : NZ1 - 2;
            F.box(c - 4, 18, zf, c + 4, 50, zf + T, (lx, ly, lz) => {
                const u = lx - c + 0.5, top = 44 + Math.round(6 * Math.sqrt(Math.max(0, 1 - (u / 4) ** 2)));
                if (ly > top) return -1;
                if (lz !== gd) return 0;
                if (Math.abs(u) > 3.4 || ly === 18 || ly === top) return M.stone2;
                return ((Math.floor(lx / 2) + Math.floor(ly / 3)) % 3 === 0) ? M.stained2 : (((lx + ly) % 4 === 0) ? M.stained : M.glass);
            });
        };
        for (let c = NX0 + 26; c < NX1 - 6; c += 24) { lancet(c, -1); lancet(c, 1); }
        for (const a of [-0.9, 0, 0.9]) {
            const cx = Math.round(NX1 + Math.cos(a) * 24.5), cz = Math.round(Math.sin(a) * 24.5);
            F.box(cx - 2, 20, cz - 2, cx + 3, 46, cz + 3, (lx, ly, lz) => {
                const dd = Math.hypot(lx - NX1, lz);
                if (dd < 23 || dd > 26.5) return -1;
                return dd > 24 && dd < 25.5 && ly > 20 && ly < 45 ? (ly % 5 === 0 ? M.stone2 : M.stained) : 0;
            });
        }
        // боковая дверь (юг локальный +z)
        F.box(NX0 + 8, 4, NZ1 - T, NX0 + 18, 26, NZ1, (lx, ly, lz) => lz === NZ1 - 2 ? ((lx === NX0 + 8 || lx === NX0 + 17 || ly === 25) ? M.stone2 : (ly % 6 === 0 ? M.metal : M.darkwood)) : 0);
        // пол, скамьи, алтарь, свечи
        F.box(NX0 + T, 0, NZ0 + T, NX1 + 22, 4, NZ1 - T, (lx, ly, lz) => (lx >= NX1 && Math.hypot(lx - NX1, lz) > 23) ? -1 : (ly < 3 ? M.stone : ((((lx >> 2) + (lz >> 2)) & 1) ? M.stone2 : M.tile)));
        for (let px = NX0 + 8; px < NX1 - 14; px += 9) for (const [z0, z1] of [[NZ0 + 6, -5], [5, NZ1 - 6]]) {
            F.box(px, 4, z0, px + 5, 8, z1, M.plank);
            F.box(px + 4, 8, z0, px + 5, 13, z1, M.plank);
            F.box(px, 4, z0, px + 5, 10, z0 + 1, M.darkwood); F.box(px, 4, z1 - 1, px + 5, 10, z1, M.darkwood);
        }
        F.box(NX1 + 4, 4, -10, NX1 + 12, 13, 10, M.stone);
        F.box(NX1 + 3, 13, -11, NX1 + 13, 14, 11, M.canvas2);
        F.box(NX1 + 7, 14, -1, NX1 + 8, 24, 1, M.bronze); F.box(NX1 + 7, 20, -4, NX1 + 8, 21, 4, M.bronze);
        for (const cz of [-18, 18]) { F.box(NX1 + 2, 4, cz, NX1 + 3, 20, cz + 1, M.metal); F.box(NX1 + 2, 20, cz, NX1 + 3, 22, cz + 1, M.lamp); }
        // стропильные затяжки и люстра на цепи
        for (let bx = NX0 + 12; bx < NX1; bx += 24) F.box(bx, WH - 3, NZ0 + T, bx + 3, WH, NZ1 - T, M.darkwood);
        // крыша: крутой скат вдоль x, сланец; фронтоны — камень
        const roofY = (lz) => WH + Math.floor((39 - Math.abs(lz)) * 1.2);
        F.box(NX0 - 2, WH, NZ0 - 4, NX1 + 3, roofY(0) + 3, NZ1 + 4, (lx, ly, lz) => {
            const t = roofY(lz);
            if (ly > t || ly < t - 3) {
                if ((lx < NX0 + T || lx >= NX1 - T) && ly < t - 3 && lz > NZ0 - 1 && lz < NZ1) return lx >= NX0 && lx < NX1 ? st(lx, ly, lz) : -1;
                return -1;
            }
            return ly === t ? M.slate : M.darkwood;
        });
        const ch = roofY(0) - 14;
        F.box(-1, ch, -1, 1, roofY(0) - 1, 1, M.cable);
        F.box(-6, ch - 2, -6, 7, ch, 7, (lx, ly, lz) => (Math.hypot(lx, lz) > 6.5 || Math.hypot(lx, lz) < 5) ? -1 : M.metal);
        for (const [cx, cz] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) { F.box(cx, ch, cz, cx + 1, ch + 2, cz + 1, M.lamp); }
        F.box(-1, ch - 2, -6, 1, ch - 1, 7, M.metal); F.box(-6, ch - 2, -1, 7, ch - 1, 1, M.metal);
        // крыша апсиды — полуконус
        for (let ly = WH; ly < WH + 30; ly++) {
            const r = 28 * (1 - (ly - WH) / 30);
            GMC.cyl(F, NX1, 0, r, ly, ly + 1, (lx, yy, lz, d) => (lx < NX1 - 2 || d < r - 3) ? -1 : M.slate);
        }
        // колокольня: стены, ярусы, звонница, часы, шпиль
        const TX0 = -76, TX1 = -40, TZ0 = -18, TZ1 = 18, TH = 120;
        GMC.walls(F, TX0, TZ0, TX1, TZ1, 0, TH, T, st);
        F.box(TX0 - 2, 0, TZ0 - 2, TX1 + 2, 6, TZ1 + 2, (lx, ly, lz) => (lx < TX0 || lx >= TX1 || lz < TZ0 || lz >= TZ1) ? M.stone2 : -1);
        for (const [cx, cz] of [[TX0 - 2, TZ0 - 2], [TX1 - 3, TZ0 - 2], [TX0 - 2, TZ1 - 3], [TX1 - 3, TZ1 - 3]]) F.box(cx, 0, cz, cx + 5, 90, cz + 5, st);
        for (const fy of [36, 66, 95]) {
            F.box(TX0 + T, fy, TZ0 + T, TX1 - T, fy + 2, TZ1 - T, M.plank);
            F.box(TX0 + T + 2, fy, TZ0 + T, TX0 + T + 8, fy + 2, TZ0 + T + 6, 0);
            for (let ly = fy - 30; ly < fy + 2; ly += 3) if (ly > 4) F.box(TX0 + T + 3, ly, TZ0 + T, TX0 + T + 7, ly + 1, TZ0 + T + 1, M.wood);
        }
        // главный вход (в нефе — арка из башни), дверь на локальной −x
        F.box(TX0, 4, -6, TX0 + T, 30, 6, (lx, ly, lz) => {
            const top = 24 + Math.round(5 * Math.sqrt(Math.max(0, 1 - ((lz + 0.5) / 6) ** 2)));
            if (ly > top) return -1;
            if (lx !== TX0 + 1) return 0;
            if (Math.abs(lz + 0.5) > 5 || ly === top) return M.stone2;
            return (ly % 7 === 0 || lz === 0) ? M.metal : M.darkwood;
        });
        F.box(TX1 - T, 4, -6, NX0 + T, 28, 6, 0);
        F.box(TX0 - 10, 0, -9, TX0, 2, 9, M.stone2); F.box(TX0 - 6, 2, -8, TX0, 3, 8, M.stone2);
        // окна-бойницы и звонница
        /** @type {[string, number][]} */
        const faces = [['x', TZ0], ['x', TZ1 - T], ['z', TX0], ['z', TX1 - T]];
        for (const ly0 of [44, 74]) for (const [ax, d0] of faces) {
            const c = ax === 'x' ? -58 : 0;
            GMC.window(F, ax, c - 2, c + 2, ly0, ly0 + 12, d0, d0 + T, d0 + 1, { frame: M.stone2 });
        }
        for (const [ax, d0] of faces) for (const c of ax === 'x' ? [-66, -50] : [-8, 8]) {
            GMC.wbox(F, ax, c - 4, 98, d0, c + 4, 118, d0 + T, (u, y) => {
                const top = 113 + Math.round(4 * Math.sqrt(Math.max(0, 1 - ((u - c + 0.5) / 4) ** 2)));
                return y > top ? -1 : 0;
            });
        }
        F.box(TX0 - 1, 97, TZ0 - 1, TX1 + 1, 99, TZ1 + 1, (lx, ly, lz) => (lx < TX0 || lx >= TX1 || lz < TZ0 || lz >= TZ1) ? M.stone2 : -1);
        // колокол на дубовой балке
        const BX = -58, BY = 114;
        F.box(TX0 + T, BY, -2, TX1 - T, BY + 4, 2, M.darkwood);
        F.box(BX - 2, BY - 3, -2, BX + 3, BY, 3, M.darkwood);
        for (let ly = BY - 15; ly < BY - 3; ly++) {
            const t = (BY - 3 - ly) / 12, r = 3.5 + t * t * 4;
            GMC.cyl(F, BX, 0, r, ly, ly + 1, M.bronze, ly < BY - 13 ? 1.2 : (ly > BY - 6 ? 0 : 1.6));
        }
        F.box(BX, BY - 16, 0, BX + 1, BY - 4, 1, M.metal); F.box(BX - 1, BY - 18, -1, BX + 2, BY - 16, 2, M.metal);
        // часы
        /** @type {[string, number][]} */
        const clocks = [['x', TZ1], ['z', TX0 - 1]];
        for (const [ax, d] of clocks) {
            for (let dv = -6; dv <= 6; dv++) for (let du = -6; du <= 6; du++) {
                const r = Math.hypot(du, dv);
                if (r > 6.3) continue;
                const v = r > 5.4 ? M.bronze : ((du === 0 && dv >= 0 && dv < 5) || (dv === 0 && du >= 0 && du < 4) ? M.concrete2 : M.carwhite);
                if (ax === 'x') F.put(-58 + du, 84 + dv, d, v); else F.put(d, 84 + dv, du, v);
            }
        }
        // зубцы и угловые пинакли, шпиль, крест
        F.box(TX0, TH, TZ0, TX1, TH + 6, TZ1, (lx, ly, lz) => (lx < TX0 + 2 || lx >= TX1 - 2 || lz < TZ0 + 2 || lz >= TZ1 - 2) ? ((((lx + lz) >> 2) & 1) || ly < TH + 3 ? M.stone : -1) : -1);
        F.box(TX0, TH, TZ0, TX1, TH + 1, TZ1, M.stone2);
        const SX = (TX0 + TX1) / 2 - 0.5, SH = 40;
        for (let ly = TH + 1; ly < TH + SH; ly++) {
            const r = 16 * (1 - (ly - TH - 1) / SH) + 0.6;
            F.box(Math.floor(SX - r), ly, Math.floor(-0.5 - r), Math.ceil(SX + r) + 1, ly + 1, Math.ceil(-0.5 + r) + 1, (lx, yy, lz) => {
                const a = Math.max(Math.abs(lx - SX), Math.abs(lz + 0.5));
                if (a > r || a < r - 2) return -1;
                return ((lx + yy + lz) % 9 === 0) ? M.stone2 : M.slate;
            });
        }
        const SY = TH + SH;
        F.box(-59, SY - 2, -1, -57, SY + 11, 1, M.metal);
        F.box(-62, SY + 6, -1, -54, SY + 8, 1, M.metal);
    },

    /** Шале: каменный цоколь, бревенчатый второй этаж с выпусками углов, балкон на кронштейнах,
     *  крутая двускатная крыша с большим свесом, труба, ставни, интерьер с камином и лестницей. Фасад +z. */
    'village-chalet'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), n = GMC.num(mk);
        const X0 = -40, X1 = 40, Z0 = -32, Z1 = 32, H0 = 28, H1 = 56, T = 3;
        const shut = [M.carred, M.steelg, M.blue][n % 3];
        const st = (lx, ly, lz) => GMC.stonework(lx, ly, lz, M.stone, M.stone2, M.mortar);
        const logs = (lx, ly, lz) => {
            const row = Math.floor((ly - H0) / 3);
            return (ly - H0) % 3 === 2 ? M.darkwood : (row & 1 ? M.wood : M.plank);
        };
        GMC.walls(F, X0, Z0, X1, Z1, 0, H0, T, st);
        GMC.walls(F, X0, Z0, X1, Z1, H0, H1, T, logs);
        for (const [cx, cz] of [[X0, Z0], [X1 - T, Z0], [X0, Z1 - T], [X1 - T, Z1 - T]]) for (let ly = H0; ly < H1; ly += 6) {
            F.box(cx - 2, ly, cz, cx + T + 2, ly + 3, cz + T, M.wood);
            F.box(cx, ly + 3, cz - 2, cx + T, ly + 6, cz + T + 2, M.wood);
        }
        // окна с рамой и ставнями
        const win = (ax, c, y0, d0, gd, out) => {
            GMC.window(F, ax, c - 5, c + 5, y0, y0 + 13, d0, d0 + T, gd, { frame: M.darkwood, mullion: true, sill: out });
            for (const su of [c - 8, c + 5]) GMC.wbox(F, ax, su, y0, out, su + 3, y0 + 13, out + 1, (u, y) => y % 3 === 0 ? M.darkwood : shut);
        };
        for (const c of [-24, 22]) { win('x', c, 9, Z1 - T, Z1 - 2, Z1); win('x', c, H0 + 9, Z1 - T, Z1 - 2, Z1); win('x', c, 9, Z0, Z0 + 1, Z0 - 1); win('x', c, H0 + 9, Z0, Z0 + 1, Z0 - 1); }
        for (const c of [-14, 14]) { win('z', c, 9, X0, X0 + 1, X0 - 1); win('z', c, 9, X1 - T, X1 - 2, X1); win('z', c, H0 + 9, X0, X0 + 1, X0 - 1); win('z', c, H0 + 9, X1 - T, X1 - 2, X1); }
        // дверь и крыльцо
        F.box(-6, 3, Z1 - T, 6, 24, Z1, (lx, ly, lz) => lz !== Z1 - 2 ? 0 : (lx === -6 || lx === 5 || ly === 23 ? M.darkwood : (ly > 14 && ly < 20 && lx > -4 && lx < 3 ? M.glass : (ly % 4 === 0 ? M.darkwood : M.plank))));
        F.box(-10, 0, Z1, 10, 3, Z1 + 8, M.stone2); F.box(-10, 0, Z1 + 8, 10, 1, Z1 + 12, M.stone2);
        // балкон второго этажа: консольный настил, кронштейны, резная балюстрада, дверь
        F.box(X0 - 2, H0, Z1, X1 + 2, H0 + 2, Z1 + 14, M.plank);
        for (const bx of [-30, -10, 10, 30]) { F.box(bx, H0 - 2, Z1, bx + 2, H0, Z1 + 12, M.darkwood); GMC.lineF(F, bx, H0 - 12, Z1, bx, H0 - 1, Z1 + 11, M.darkwood); }
        F.box(X0 - 2, H0 + 2, Z1, X1 + 2, H0 + 13, Z1 + 14, (lx, ly, lz) => {
            const e = lz === Z1 + 13 || lx === X0 - 2 || lx === X1 + 1;
            if (!e) return -1;
            if (ly === H0 + 12 || ly === H0 + 2) return M.darkwood;
            const u = lz === Z1 + 13 ? lx : lz;
            return ((u + 1000) % 4 === 0) || (((u + 1000) % 4 === 2) && ly > H0 + 5 && ly < H0 + 9) ? -1 : M.plank;
        });
        GMC.window(F, 'x', -6, 6, H0 + 3, H0 + 25, Z1 - T, Z1, Z1 - 2, { frame: M.darkwood, mullion: true });
        F.box(-38, H0 + 2, Z1 + 8, -34, H0 + 6, Z1 + 12, M.terracotta);
        F.box(30, H0 + 2, Z1 + 4, 36, H0 + 3, Z1 + 12, M.plank);
        // перекрытия
        F.box(X0 + T, 2, Z0 + T, X1 - T, 3, Z1 - T, (lx) => (lx + 1000) % 6 === 0 ? M.darkwood : M.plank);
        F.box(X0 + T, H0 + 1, Z0 + T, X1 - T, H0 + 3, Z1 - T, (lx) => (lx + 1000) % 6 === 0 ? M.darkwood : M.plank);
        F.box(X0 + T, H1, Z0 + T, X1 - T, H1 + 1, Z1 - T, M.plank);
        F.box(20, H0, -22, 34, H0 + 3, 9, 0);
        for (let i = 0; i < 28; i++) F.box(20, 3 + i, -20 + i, 34, 4 + i, -18 + i, M.darkwood);
        // крыша: конёк вдоль z, скат 1:1, свес 12, гонт + обрешётка; фронтоны — доска
        const RX = 52, roofT = lx => H1 + (RX - Math.abs(lx + 0.5)) | 0;
        F.box(-RX, H1, Z0 - 12, RX, roofT(0) + 2, Z1 + 12, (lx, ly, lz) => {
            const t = roofT(lx);
            if (ly <= t && ly > t - 3) return ly === t ? ((lz & 3) === 0 ? M.wood : M.darkwood) : M.plank;
            if (ly < t - 2 && (lz === Z0 || lz === Z0 + 1 || lz === Z1 - 1 || lz === Z1 - 2) && Math.abs(lx) < X1) return ((lx + 1000) % 5 === 0) ? M.darkwood : M.plank;
            return -1;
        });
        GMC.window(F, 'x', -5, 5, H1 + 10, H1 + 22, Z1 - 2, Z1, Z1 - 1, { frame: M.darkwood, mullion: true });
        GMC.window(F, 'x', -5, 5, H1 + 10, H1 + 22, Z0, Z0 + 2, Z0, { frame: M.darkwood, mullion: true });
        // труба с камином внутри
        F.box(-30, 3, -14, -20, 20, -4, st);
        F.box(-28, 3, -5, -22, 10, -3, 0); F.box(-27, 3, -6, -23, 5, -4, M.neonamber);
        F.box(-28, 20, -12, -22, roofT(-25) + 10, -6, st);
        F.box(-29, roofT(-25) + 10, -13, -21, roofT(-25) + 12, -5, M.stone2);
        // мебель
        GMC.table(F, -6, 3, -16, 10, -4, 8, M.plank, M.darkwood);
        for (const cx of [-4, 4]) { GMC.chair(F, cx, 3, -21, 'z0', M.plank, M.darkwood); GMC.chair(F, cx, 3, -3, 'z1', M.plank, M.darkwood); }
        GMC.sofa(F, -36, 3, 6, -14, 14, 'x0', M.fabric);
        F.box(4, 3, Z0 + T, 18, 12, Z0 + T + 6, M.plank); F.box(4, 12, Z0 + T, 18, 13, Z0 + T + 6, M.tile);
        GMC.bed(F, -36, H0 + 3, -20, -20, 2); GMC.bed(F, -12, H0 + 3, -20, 4, 2);
        F.box(-36, H0 + 3, 16, -26, H0 + 24, 26, M.darkwood);
        for (const [lx, lz] of [[0, 0], [-20, -16], [0, 20]]) F.box(lx, H0 - 1, lz, lx + 2, H0, lz + 2, M.lamp);
        // поленница под свесом сбоку
        for (let ly = 0; ly < 18; ly += 4) for (let lz = -24; lz < 24; lz += 4) GMC.cylX(F, X1, X1 + 8, ly + 2, lz + ((ly >> 2) & 1) * 2, 2, (lx) => lx === X1 || lx === X1 + 7 ? M.plank : M.wood);
    },

    /** Гостиница «LODGE»: три этажа (камень + брус), длинный фасад +z с балконами, терраса на столбах,
     *  вывеска, крыша вдоль x. Рядом ставят газовый бак. */
    'village-lodge'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const X0 = -70, X1 = 70, Z0 = -40, Z1 = 40, FH = 28, T = 3, TOP = 3 * FH;
        const st = (lx, ly, lz) => GMC.stonework(lx, ly, lz, M.stone, M.stone2, M.mortar);
        const logs = (lx, ly, lz) => (ly % 3 === 2 ? M.darkwood : (Math.floor(ly / 3) & 1 ? M.wood : M.plank));
        GMC.walls(F, X0, Z0, X1, Z1, 0, FH, T, st);
        GMC.walls(F, X0, Z0, X1, Z1, FH, TOP, T, logs);
        for (let f = 0; f < 3; f++) {
            const y = f * FH;
            F.box(X0 + T, y + (f ? 1 : 2), Z0 + T, X1 - T, y + 3, Z1 - T, (lx) => (lx + 1000) % 6 === 0 ? M.darkwood : M.plank);
            for (let c = X0 + 14; c < X1 - 6; c += 20) {
                if (f === 0 && Math.abs(c) < 8) continue;
                const door = f > 0 && ((c + 1000) % 40 === 4);
                if (door) GMC.window(F, 'x', c - 5, c + 5, y + 3, y + 24, Z1 - T, Z1, Z1 - 2, { frame: M.darkwood, mullion: true });
                else GMC.window(F, 'x', c - 6, c + 6, y + 9, y + 23, Z1 - T, Z1, Z1 - 2, { frame: M.darkwood, mullion: true, sill: Z1 });
                GMC.window(F, 'x', c - 6, c + 6, y + 9, y + 23, Z0, Z0 + T, Z0 + 1, { frame: M.darkwood, mullion: true, sill: Z0 - 1 });
            }
            for (const c of [-20, 0, 20]) { GMC.window(F, 'z', c - 5, c + 5, y + 9, y + 23, X0, X0 + T, X0 + 1, { frame: M.darkwood, sill: X0 - 1 }); GMC.window(F, 'z', c - 5, c + 5, y + 9, y + 23, X1 - T, X1, X1 - 2, { frame: M.darkwood, sill: X1 }); }
            if (f > 0) {
                const BD = f === 1 ? 20 : 12;
                F.box(X0, y, Z1, X1, y + 2, Z1 + BD, M.plank);
                F.box(X0, y + 2, Z1, X1, y + 12, Z1 + BD, (lx, ly, lz) => (lz === Z1 + BD - 1 || lx === X0 || lx === X1 - 1) ? (ly === y + 11 || ((lx + lz) & 1) === 0 ? M.darkwood : -1) : -1);
                if (f > 1) for (let bx = X0 + 4; bx < X1; bx += 20) GMC.lineF(F, bx, y - 10, Z1, bx, y - 1, Z1 + 10, M.darkwood);
            }
            // комнаты: перегородки, кровати, лампы
            if (f > 0) for (let c = X0 + 28; c < X1 - 4; c += 28) F.box(c, y + 3, Z0 + T, c + 2, y + FH, Z1 - T, (lx, ly, lz) => (lz > -4 && lz < 6 && ly < y + 24) ? 0 : M.plaster);
            for (let c = X0 + 14; c < X1 - 6; c += 28) {
                F.box(c, y + FH - 1, -1, c + 2, y + FH, 1, M.lamp);
                if (f > 0) { GMC.bed(F, c - 8, y + 3, Z0 + 6, c + 6, Z0 + 22); F.box(c - 8, y + 3, 26, c + 2, y + 22, 34, M.darkwood); }
            }
        }
        // зал первого этажа: стойка, столы, камин
        F.box(-30, 3, -20, -6, 13, -14, M.darkwood); F.box(-31, 13, -21, -5, 14, -13, M.plank);
        for (const [tx, tz] of [[20, -10], [40, -10], [20, 14], [40, 14], [-50, 12]]) {
            GMC.table(F, tx - 4, 3, tz - 4, tx + 4, tz + 4, 8, M.plank, M.darkwood);
            GMC.chair(F, tx - 9, 3, tz - 2, 'x0', M.plank, M.darkwood); GMC.chair(F, tx + 5, 3, tz - 2, 'x1', M.plank, M.darkwood);
        }
        F.box(X0 + T, 3, -10, X0 + T + 6, 22, 10, st); F.box(X0 + T, 3, -5, X0 + T + 5, 10, 5, 0); F.box(X0 + T, 3, -4, X0 + T + 4, 5, 4, M.neonamber);
        // вход, крыльцо-терраса на столбах, вывеска
        F.box(-7, 3, Z1 - T, 7, 25, Z1, (lx, ly, lz) => lz !== Z1 - 2 ? 0 : (lx === -7 || lx === 6 || lx === 0 || ly === 24 ? M.darkwood : (ly > 12 ? M.glass : M.plank)));
        F.box(X0, 0, Z1, X1, 3, Z1 + 20, (lx, ly, lz) => ly < 2 ? M.stone2 : M.plank);
        for (let bx = X0; bx < X1; bx += 20) F.box(bx, 3, Z1 + 18, bx + 2, FH, Z1 + 20, M.darkwood);
        F.box(X0, 3, Z1 + 19, X1, 12, Z1 + 20, (lx, ly) => (ly === 11 || (lx & 1) === 0) && Math.abs(lx) > 8 ? M.darkwood : -1);
        F.box(-24, FH, Z1 + 20, 24, FH + 16, Z1 + 21, M.darkwood);
        GMC.text(F, 'LODGE', -19, FH + 3, Z1 + 21, 1, 0, M.neonamber, 2);
        // крыша вдоль x
        const RZ = 52, roofT = lz => TOP + Math.floor((RZ - Math.abs(lz + 0.5)) * 0.9);
        F.box(X0 - 8, TOP, -RZ, X1 + 8, roofT(0) + 2, RZ, (lx, ly, lz) => {
            const t = roofT(lz);
            if (ly <= t && ly > t - 3) return ly === t ? ((lx & 3) === 0 ? M.wood : M.darkwood) : M.plank;
            if (ly < t - 2 && (lx === X0 || lx === X0 + 1 || lx === X1 - 1 || lx === X1 - 2) && Math.abs(lz) < Z1) return M.plank;
            return -1;
        });
        F.box(X0 + T, TOP, Z0 + T, X1 - T, TOP + 1, Z1 - T, M.plank);
        // мансардные окна-слуховые и трубы
        for (const c of [-40, 0, 40]) {
            F.box(c - 8, TOP + 10, 26, c + 8, TOP + 26, 40, (lx, ly, lz) => {
                const t = TOP + 26 - Math.abs(lx - c);
                if (ly > t) return -1;
                if (lz === 39) return (Math.abs(lx - c) < 5 && ly > TOP + 12 && ly < TOP + 22) ? M.glass : M.plank;
                return ly >= t - 1 ? M.darkwood : (Math.abs(lx - c) > 6 ? M.plank : -1);
            });
        }
        for (const cx of [-55, 50]) { F.box(cx, TOP, -6, cx + 8, roofT(0) + 10, 2, st); F.box(cx - 1, roofT(0) + 10, -7, cx + 9, roofT(0) + 12, 3, M.stone2); }
    },

    /** Газовый бак у гостиницы: горизонтальный цилиндр из взрывоопасного материала на бетонных ложементах,
     *  вентиль, табличка, ограждение. Взрыв — цепная реакция и пожар. */
    'village-gastank'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const L = 26, R = 11, CY = 16;
        GMC.cylX(F, -L, L, CY, 0, R, M.fueltank, 1.8);
        GMC.ell(F, -L, CY, 0, 6, R, R, (lx) => lx >= -L ? -1 : M.fueltank, 0.3);
        GMC.ell(F, L - 1, CY, 0, 6, R, R, (lx) => lx < L ? -1 : M.fueltank, 0.3);
        for (const sx of [-16, 14]) F.box(sx, 0, -8, sx + 4, CY - 6, 9, (lx, ly, lz) => Math.hypot(ly - CY, lz) < R + 0.5 ? -1 : M.concrete);
        F.box(-3, CY + R, -2, 3, CY + R + 2, 3, M.metal); F.box(-1, CY + R + 2, 0, 1, CY + R + 6, 1, M.metal);
        GMC.cyl(F, 0, 0, 2.5, CY + R + 6, CY + R + 7, M.carred);
        F.box(-L - 6, 0, -1, -L + 1, 1, 1, M.metal); F.box(-L, 1, -1, -L + 1, CY - R + 1, 1, M.metal);
        F.box(-6, CY - 2, R, 6, CY + 4, R + 1, M.hazard);
        GMC.text(F, 'GAS', -5, CY - 1, R + 1, 1, 0, M.carred, 1);
        for (let lx = -L - 8; lx <= L + 8; lx += 13) for (const lz of [-R - 6, R + 6]) F.box(lx, 0, lz, lx + 1, 14, lz + 1, M.metal);
        for (const lz of [-R - 6, R + 6]) for (const ly of [6, 13]) F.box(-L - 8, ly, lz, L + 6, ly + 1, lz + 1, M.cable);
    },

    /** Крытый деревянный мост через овраг: настил на прогонах, решётчатые фермы стен с окнами, двускатная
     *  крыша, порталы с фонарями, каменные устои на гребнях. Держится только на устоях. */
    'village-bridge'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const L = 56, HW = 19, B = 14, WH = 26;
        // устои
        for (const s of [-1, 1]) {
            F.box(s < 0 ? -L - 2 : 26, -16, -HW - 3, s < 0 ? -26 : L + 2, B, HW + 3, (lx, ly, lz) => GMC.stonework(lx, ly, lz, M.stone, M.stone2, M.mortar));
        }
        // прогоны и настил
        for (const sz of [-HW + 1, -6, 6, HW - 4]) F.box(-L, B, sz, L, B + 3, sz + 3, M.darkwood);
        F.box(-L, B + 3, -HW, L, B + 5, HW, (lx) => (lx + 1000) % 5 === 0 ? M.darkwood : M.plank);
        // стены-фермы
        for (const s of [-1, 1]) {
            const lz0 = s < 0 ? -HW : HW - 2;
            F.box(-L, B + 5, lz0, L, B + 5 + WH, lz0 + 2, (lx, ly) => {
                const yy = ly - B - 5;
                if (yy < 3 || yy >= WH - 3 || Math.abs(lx) > L - 3) return M.darkwood;
                const win = yy > 10 && yy < 19 && ((lx + 1000) % 24) > 8 && ((lx + 1000) % 24) < 20;
                if (win) return 0;
                const a = (lx + yy + 1000) % 12, b = (lx - yy + 1000) % 12;
                return (a < 2 || b < 2) ? M.plank : ((lx + 1000) % 24 === 0 ? M.darkwood : -1);
            });
        }
        F.box(-L, B + 5, -HW + 2, L, B + 8, -HW + 3, M.darkwood); F.box(-L, B + 5, HW - 3, L, B + 8, HW - 2, M.darkwood);
        // крыша
        const top = B + 5 + WH, roofT = lz => top + Math.floor((HW + 5 - Math.abs(lz + 0.5)) * 0.75);
        F.box(-L - 3, top, -HW - 5, L + 3, roofT(0) + 2, HW + 5, (lx, ly, lz) => {
            const t = roofT(lz);
            if (ly <= t && ly > t - 3) return ly === t ? ((lx & 3) === 0 ? M.wood : M.darkwood) : M.plank;
            if (Math.abs(lx) >= L - 1 && ly <= t - 3) return Math.abs(lx) >= L ? -1 : M.plank;
            return -1;
        });
        F.box(-L, top, -HW, L, top + 2, HW, (lx) => (lx + 1000) % 12 < 2 ? M.darkwood : -1);
        // порталы: вывеска и фонари
        for (const s of [-1, 1]) {
            const px = s < 0 ? -L : L;
            F.box(px, top + 4, -10, px + 1, top + 10, 11, M.darkwood);
            GMC.text(F, 'LIFT', px + s, top + 5, s < 0 ? -7 : 7, 0, s < 0 ? 1 : -1, M.canvas2, 1);
            for (const lz of [-HW - 1, HW]) { F.box(px, B + 5, lz, px + 1, B + 22, lz + 1, M.darkwood); F.box(px - 1, B + 20, lz - 1, px + 2, B + 24, lz + 2, M.lamp); }
        }
    },

    /** Канатная дорога вверх по склону (локальная +x): нижняя станция с бычьим колесом и будкой,
     *  опоры-трубы с траверсами, два троса с провисом, кресла на подвесах, верхняя станция. */
    'village-skilift'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot), G = GameMapBuild.GROUND;
        const ground = lx => { const p = F.at(lx, 0); return GMC.top(w, p[0], p[1]) - G + 1; };
        const LEN = 290, PYL = [52, 108, 164, 220], CZ = 15;
        const station = (lx, top) => {
            const g = ground(lx), y0 = g;
            F.box(lx - 24, y0 - 6, -24, lx + 24, y0 + 2, 24, M.concrete);
            for (const [cx, cz] of [[-12, -12], [10, -12], [-12, 10], [10, 10]]) F.box(lx + cx, y0 + 2, cz, lx + cx + 3, y0 + 44, cz + 3, M.hazard);
            GMC.cyl(F, lx, 0, CZ + 1, y0 + 28, y0 + 31, M.metal, 2.5);
            F.box(lx - 2, y0 + 28, -CZ, lx + 2, y0 + 31, CZ, M.metal);
            F.box(lx - 3, y0 + 31, -3, lx + 3, y0 + 44, 3, M.hazard);
            F.box(lx - 22, y0 + 44, -22, lx + 22, y0 + 46, 22, (px, py, pz) => (((px + pz) >> 2) & 1) ? M.carred : M.carwhite);
            const hx = top ? lx - 6 : lx - 34, hz = -44;
            F.box(hx, y0 + 2, hz, hx + 18, y0 + 26, hz + 16, (px, py, pz) => {
                const e = px === hx || px === hx + 17 || pz === hz || pz === hz + 15 || py === y0 + 2 || py === y0 + 25;
                if (!e) return -1;
                if (py > y0 + 10 && py < y0 + 20 && (pz === hz || px === hx + 17) && ((px + pz) % 6) > 1) return M.glass;
                if (pz === hz && px > hx + 3 && px < hx + 9 && py < y0 + 22) return py === y0 + 2 ? M.plank : 0;
                return py === y0 + 25 ? M.carred : M.plank;
            });
            GMC.text(F, top ? 'TOP' : 'LIFT', hx + 15, y0 + 20, hz - 1, -1, 0, M.carred, 1);
            return y0 + 29;
        };
        const y0 = station(0, false), y1 = station(LEN, true);
        // опоры
        const sup = [[0, y0]];
        for (const px of PYL) {
            const g = ground(px), h = g + 68;
            F.box(px - 4, g - 4, -4, px + 4, g + 2, 4, M.concrete);
            F.box(px - 1, g + 2, -1, px + 2, h, 2, M.hazard);
            F.box(px - 1, h, -CZ - 3, px + 2, h + 2, CZ + 4, M.hazard);
            for (const sz of [-CZ, CZ]) F.box(px - 3, h - 3, sz - 1, px + 4, h, sz + 2, M.metal);
            for (let ly = g + 6; ly < h - 2; ly += 4) F.box(px + 2, ly, 0, px + 3, ly + 1, 2, M.metal);
            sup.push([px, h - 4]);
        }
        sup.push([LEN, y1]);
        // тросы и кресла
        const SAG = 4;
        const cableY = lx => {
            for (let i = 0; i + 1 < sup.length; i++) {
                const [xa, ya] = sup[i], [xb, yb] = sup[i + 1];
                if (lx < xa || lx > xb) continue;
                const n = Math.max(2, Math.ceil((xb - xa) / 10)), t = (lx - xa) / (xb - xa);
                const k = Math.floor(t * n), t0 = k / n, t1 = (k + 1) / n;
                const f = tt => ya + (yb - ya) * tt - SAG * 4 * tt * (1 - tt);
                return f(t0) + (f(t1) - f(t0)) * ((t - t0) * n);
            }
            return y0;
        };
        for (const sz of [-CZ, CZ]) for (let i = 0; i + 1 < sup.length; i++) GMC.sagF(F, sup[i][0], sup[i][1], sz, sup[i + 1][0], sup[i + 1][1], sz, SAG, M.cable);
        let k = 0;
        for (let lx = 30; lx < LEN - 20; lx += 34) for (const sz of [-CZ, CZ]) {
            if (PYL.some(px => Math.abs(px - lx) < 8)) continue;
            const cy = Math.round(cableY(lx));
            const cm = (k++ % 2) ? M.carred : M.blue;
            F.box(lx - 1, cy - 1, sz, lx + 2, cy + 2, sz + 1, M.metal);
            F.box(lx, cy - 16, sz, lx + 1, cy - 1, sz + 1, M.metal);
            F.box(lx - 3, cy - 17, sz - 5, lx + 4, cy - 16, sz + 6, M.metal);
            for (const ez of [sz - 5, sz + 5]) F.box(lx - 3, cy - 24, ez, lx - 2, cy - 17, ez + 1, M.metal);
            F.box(lx - 4, cy - 25, sz - 5, lx + 2, cy - 24, sz + 6, cm);
            F.box(lx - 4, cy - 24, sz - 5, lx - 3, cy - 18, sz + 6, cm);
            F.box(lx + 2, cy - 22, sz - 5, lx + 3, cy - 21, sz + 6, M.metal);
        }
    },

    /** Пруд подо льдом: чаша, тёмная вода, лёд вровень с землёй, лунка, мостки, камни по берегу. */
    'village-pond'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot), RX = 36, RZ = 26;
        for (let lz = -RZ - 4; lz <= RZ + 4; lz++) for (let lx = -RX - 4; lx <= RX + 4; lx++) {
            const t = (lx / RX) ** 2 + (lz / RZ) ** 2;
            if (t > 1.25) continue;
            if (t > 1) { if (GMC.hash(lx >> 2, 7, lz >> 2) < 0.3) F.box(lx, 0, lz, lx + 1, 1 + Math.floor(GMC.hash(lx, 1, lz) * 3), lz + 1, M.rock); continue; }
            const depth = Math.round(5 * (1 - t)) + 1;
            for (let ly = -1 - depth; ly < 0; ly++) F.put(lx, ly, lz, ly >= -2 ? M.ice : M.water);
            F.put(lx, -2 - depth, lz, M.rock);
        }
        GMC.cyl(F, 12, 6, 2.5, -2, 0, 0);
        F.box(-RX - 12, 1, -4, -RX + 18, 3, 4, (lx) => (lx & 3) === 0 ? M.darkwood : M.plank);
        for (const px of [-RX - 10, -RX + 2, -RX + 14]) for (const pz of [-4, 3]) F.box(px, -3, pz, px + 1, 1, pz + 1, M.darkwood);
        F.box(10, 0, 8, 14, 3, 11, M.crate); F.box(13, 0, 4, 14, 8, 5, M.darkwood);
    },

    /** Сосна: ствол и ярусы хвои (полые конусы), высота по номеру маркера; на склоне встаёт на рельеф. */
    'village-pine'(w, x, z, rot, mk) {
        const n = GMC.num(mk), G = GameMapBuild.GROUND;
        const base = GMC.top(w, x, z) - G + 1;
        const F = GMC.frame(w, x, z, rot);
        const H = 70 + ((n * 37) % 50), tiers = 5 + (n % 3), R0 = 13 + (n % 4) * 2;
        F.box(-1, base - 3, -1, 2, base + H - 6, 2, M.darkwood);
        F.box(-2, base - 3, -1, 3, base + 8, 2, M.wood); F.box(-1, base - 3, -2, 2, base + 8, 3, M.wood);
        const t0 = base + 14, step = (H - 14) / tiers;
        for (let k = 0; k < tiers; k++) {
            const yb = Math.round(t0 + k * step * 0.92), hgt = Math.round(step * 1.5), rb = R0 * (1 - k / (tiers + 1.2));
            for (let ly = yb; ly < yb + hgt; ly++) {
                const r = rb * (1 - (ly - yb) / hgt) + 1;
                GMC.cyl(F, 0, 0, r, ly, ly + 1, (lx, yy, lz, d) => {
                    if (d < r - (ly > yb ? 2.2 : 4.5)) return -1;
                    if (d > r - 1 && GMC.hash(lx, yy, lz) < 0.18) return -1;
                    return GMC.hash(lx >> 1, yy >> 1, lz >> 1) < 0.25 ? M.leaves : M.pine;
                });
            }
        }
        F.box(0, base + H - 6, 0, 1, base + H, 1, M.pine);
    },

    /** Поленница под навесом: брёвна-цилиндры, столбы, крыша, колода с топором. */
    'village-firewood'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        for (let ly = 0; ly < 16; ly += 4) for (let lx = -16; lx < 16; lx += 4) GMC.cylZ(F, -5, 5, lx + ((ly >> 2) & 1) * 2, ly + 2, 2, (px, py, pz) => (pz === -5 || pz === 4) ? M.plank : M.wood);
        for (const [px, pz] of [[-19, -7], [18, -7], [-19, 6], [18, 6]]) F.box(px, 0, pz, px + 2, pz < 0 ? 26 : 22, pz + 2, M.darkwood);
        for (let lz = -9; lz < 10; lz++) { const yy = 26 - Math.floor((lz + 9) / 4.5); F.box(-21, yy - 1, lz, 22, yy + 1, lz + 1, (lx) => (lx & 7) === 0 ? M.darkwood : M.plank); }
        GMC.cyl(F, 26, 12, 3.5, 0, 6, M.wood);
        F.box(26, 6, 11, 27, 13, 12, M.darkwood); F.box(24, 11, 11, 29, 14, 12, M.metal);
    },

    /** Снеговик (динамический): три кома, угольки, нос, руки-ветки, ведро. */
    'village-snowman'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        GMC.ell(F, 0, 7, 0, 8, 7.5, 8, M.snow); GMC.ell(F, 0, 19, 0, 6, 5.5, 6, M.snow); GMC.ell(F, 0, 28, 0, 4.5, 4.5, 4.5, M.snow);
        for (const ly of [16, 19, 22]) F.put(0, ly, 6, M.concrete2);
        F.put(-2, 30, 4, M.concrete2); F.put(2, 30, 4, M.concrete2);
        F.box(0, 28, 4, 1, 29, 8, M.terracotta);
        GMC.lineF(F, -5, 20, 0, -12, 26, 0, M.darkwood); GMC.lineF(F, 5, 20, 0, 12, 25, 1, M.darkwood);
        GMC.cyl(F, 0, 0, 3.5, 32, 37, M.blue);
        F.dyn(-13, 0, -9, 14, 38, 10);
    },

    /** Санки (динамические): полозья и сиденье из досок. */
    'village-sled'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        for (const lz of [-4, 3]) { F.box(-8, 0, lz, 9, 1, lz + 1, M.metal); F.box(9, 1, lz, 10, 4, lz + 1, M.metal); F.box(-6, 1, lz, -5, 4, lz + 1, M.metal); F.box(5, 1, lz, 6, 4, lz + 1, M.metal); }
        F.box(-7, 4, -4, 9, 5, 4, (lx) => lx & 1 ? M.plank : M.carred);
        F.dyn(-8, 0, -4, 11, 7, 4);
    },

    /** Фонарь на деревянном столбе. */
    'village-lantern'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot), G = GameMapBuild.GROUND;
        const b = GMC.top(w, x, z) - G + 1;
        F.box(-1, b, -1, 2, b + 36, 2, M.darkwood);
        F.box(0, b + 36, 0, 7, b + 38, 1, M.darkwood);
        F.box(5, b + 29, -1, 8, b + 33, 2, M.lamp); F.box(4, b + 33, -2, 9, b + 34, 3, M.metal); F.box(6, b + 34, 0, 7, b + 36, 1, M.metal);
    },

    /** Снегопад (последний маркер): слой снега на всё открытое сверху, сосульки по краям свесов. */
    'village-snowfall'(w) {
        const G = GameMapBuild.GROUND, d = w.data, bx = w.bx, by = w.by, sy = w.sy;
        const skip = new Uint8Array(256);
        for (const k of ['glass', 'ice', 'water', 'cable', 'lamp', 'neonamber', 'neonred', 'neongreen', 'stained', 'stained2', 'snow', 'snow2', 'metal', 'hazard', 'bronze', 'rock']) if (M[k]) skip[M[k]] = 1;
        const eave = new Uint8Array(256);
        for (const k of ['darkwood', 'plank', 'wood', 'slate', 'stone2']) eave[M[k]] = 1;
        const solid = (x, y, z) => x >= 0 && z >= 0 && x < w.sx && z < w.sz && d[x + (z << bx) + (y << by)] !== 0;
        for (let z = 1; z < w.sz - 1; z++) for (let x = 1; x < w.sx - 1; x++) {
            let y = sy - 2;
            while (y >= G && !d[x + (z << bx) + (y << by)]) y--;
            if (y < G) continue;
            const v = d[x + (z << bx) + (y << by)];
            if (skip[v & 127]) continue;
            d[x + (z << bx) + ((y + 1) << by)] = M.snow;
            // сосулька: низ свеса, под ним пусто, сосед сбоку — пустой столбец
            let yb = y;
            while (yb > G && d[x + (z << bx) + ((yb - 1) << by)]) yb--;
            if (yb < G + 10 || !eave[d[x + (z << bx) + (yb << by)] & 127]) continue;
            let air = true;
            for (let k = 1; k <= 8 && air; k++) if (solid(x, yb - k, z)) air = false;
            if (!air || GMC.hash(x, yb, z) > 0.3) continue;
            let edge = false;
            for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                let empty = true;
                for (let k = -3; k <= 3 && empty; k++) if (solid(x + ex, yb + k, z + ez)) empty = false;
                if (empty) edge = true;
            }
            if (!edge) continue;
            const len = 2 + Math.floor(GMC.hash(z, x, yb) * 5);
            for (let k = 1; k <= len; k++) d[x + (z << bx) + ((yb - k) << by)] = M.ice;
        }
    },
});

// ============================================================================ ПУСТЫННЫЙ АВАНПОСТ
// Песок, дюны по краям. Грунтовая дорога с запада на восток (z ≈ 267). Север: глинобитные дома за
// дувалом, рынок с навесами, деревянная водонапорная башня, радиомачта на растяжках (стоит на
// изоляторе — держат только тросы!). Юг: топливный склад (баки, бочки, бензовоз), руины с арками,
// перевёрнутый автобус, скалы с аркой, пальмы и колодец.

/** @satisfies {Record<string, any>} */
const GMD = {
    /** Высота дюн над землёй у краёв карты (с проходом для дороги). */
    dune(x, z, oz) {
        const e = Math.min(x, z, 511 - x, 511 - z);
        if (e >= 40) return 0;
        const road = (x < 60 || x > 452) ? GMC.smooth((Math.abs(z - 267 - oz) - 26) / 30) : 1;
        const wave = 0.55 + 0.45 * Math.sin(x * 0.045 + z * 0.03 + GMC.noise(x, z, 30, 4) * 3);
        return 34 * GMC.smooth((40 - e) / 40) * wave * (0.7 + 0.5 * GMC.fbm(x, z, 45, 8)) * road;
    },
    /** Глинобитная стена/фасад: штукатурка с пятнами осыпавшейся глины. */
    adobe(lx, ly, lz) {
        const n = GMC.noise(lx + lz * 0.7, ly, 7, 17);
        if (n > 0.72) return ((ly & 3) === 3) ? M.mortar : M.adobe;
        return n < 0.12 ? M.sand : M.adobe2;
    },
};

Object.assign(GameMapBuild.builders, {
    /** Земля аванпоста: песок в три слоя, укатанная дорога с колеями, дюны по краям, кустики сухой травы. */
    'desert-terrain'(w, x, z) {
        const G = GameMapBuild.GROUND, oz = z - 256;
        for (let zz = 0; zz < w.sz; zz++) for (let xx = 0; xx < w.sx; xx++) {
            const road = Math.abs(zz - 267 - oz) < 22 + GMC.noise(xx, zz, 9, 3) * 3;
            const track = xx > 400 && xx < 418 && zz > 285 + oz && zz < 322 + oz;
            for (let y = G - 4; y < G; y++) w.put(xx, y, zz, M.sand);
            if (road || track) {
                const rut = Math.abs(Math.abs(zz - 267 - oz) - 9) < 2;
                w.put(xx, G - 1, zz, rut ? M.dirt : (GMC.hash(xx, 2, zz) < 0.2 ? M.sand : M.adobe2));
                continue;
            }
            const h = Math.round(GMD.dune(xx, zz, oz));
            if (h > 0) {
                const e = Math.min(xx, zz, 511 - xx, 511 - zz);
                const y0 = (h > 10 && e >= 2) ? G + h - 8 : G;
                for (let y = y0; y < G + h; y++) w.put(xx, y, zz, y < G + h - 3 && y > y0 ? M.sandstone : M.sand);
            } else if (GMC.hash(xx >> 1, 9, zz >> 1) < 0.012 && GMC.noise(xx, zz, 20, 5) > 0.5) {
                const k = 1 + Math.floor(GMC.hash(xx, 3, zz) * 3);
                for (let y = G; y < G + k; y++) w.put(xx, y, zz, M.hay);
            } else if (GMC.noise(xx, zz, 14, 12) > 0.78) w.put(xx, G, zz, M.sand);
        }
    },

    /** Глинобитный дом: стены с осыпью, скруглённый парапет, балки-выпуски, синие двери и ставни,
     *  наружная лестница на крышу, у n % 3 === 0 — второй этаж; кувшины, ковры, бак, тарелка; интерьер. */
    'desert-house'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), n = GMC.num(mk);
        const W = n % 3 === 1 ? 30 : 36, D = n % 3 === 1 ? 26 : 30, H = 32, T = 3, two = n % 3 === 0;
        const X0 = -W, X1 = W, Z0 = -D, Z1 = D, A = GMD.adobe;
        const shell = (x0, z0, x1, z1, y0, y1) => {
            GMC.walls(F, x0, z0, x1, z1, y0, y1, T, A);
            // парапет со скруглёнными углами и прорезями-водостоками
            F.box(x0, y1, z0, x1, y1 + 5, z1, (lx, ly, lz) => {
                const e = lx < x0 + 2 || lx >= x1 - 2 || lz < z0 + 2 || lz >= z1 - 2;
                if (!e) return -1;
                const cx = Math.min(lx - x0, x1 - 1 - lx), cz = Math.min(lz - z0, z1 - 1 - lz);
                if (cx < 3 && cz < 3 && (3 - cx) + (3 - cz) + (ly - y1) > 7) return -1;
                if (ly === y1 + 4 && ((lx + lz) & 7) < 2) return -1;
                return M.adobe2;
            });
            F.box(x0 + T, y1 - 3, z0 + T, x1 - T, y1 - 1, z1 - T, M.plank);
            F.box(x0 + T, y1 - 1, z0 + T, x1 - T, y1, z1 - T, M.adobe2);
            for (let bx = x0 + 6; bx < x1 - 4; bx += 10) for (const [zA, zB] of [[z0 - 4, z0], [z1, z1 + 4]]) F.box(bx, y1 - 4, zA, bx + 2, y1 - 2, zB, M.darkwood);
        };
        shell(X0, Z0, X1, Z1, 0, H);
        F.box(X0 + T, 0, Z0 + T, X1 - T, 1, Z1 - T, M.adobe);
        // дверь (+z) под тентом, окна с решётками и ставнями
        F.box(-5, 1, Z1 - T, 5, 22, Z1, (lx, ly, lz) => lz !== Z1 - 2 ? 0 : ((lx === -5 || lx === 4 || ly === 21) ? M.darkwood : ((ly % 5 === 0) ? M.darkwood : M.blue)));
        F.box(-8, 22, Z1, 8, 23, Z1 + 8, (lx) => ((lx >> 1) & 1) ? M.canvas : M.canvas2);
        for (const px of [-8, 7]) F.box(px, 0, Z1 + 7, px + 1, 22, Z1 + 8, M.wood);
        const lattice = (ax, c, y0, d0, gd, out) => {
            GMC.wbox(F, ax, c - 4, y0, d0, c + 4, y0 + 10, d0 + T, (u, y, d) => d !== gd ? 0 : (((u - c) & 1) === 0 || (y - y0) % 3 === 0 || u === c + 3 ? M.darkwood : 0));
            for (const su of [c - 7, c + 4]) GMC.wbox(F, ax, su, y0, out, su + 3, y0 + 10, out + 1, (u, y) => y % 3 === 0 ? M.darkwood : M.blue);
        };
        for (const c of [-W + 12, W - 12]) { lattice('x', c, 9, Z1 - T, Z1 - 2, Z1); lattice('x', c, 9, Z0, Z0 + 1, Z0 - 1); }
        lattice('z', 0, 9, X0, X0 + 1, X0 - 1); lattice('z', 0, 9, X1 - T, X1 - 2, X1);
        // наружная лестница вдоль стены −x на крышу
        for (let i = 0; i < H; i++) F.box(X0 - 6, i, Z1 - 6 - i, X0, i + 1, Z1 - 3 - i, A);
        // второй этаж на задней половине
        if (two) {
            const bz1 = 2;
            shell(X0 + 4, Z0, X1 - 10, bz1, H, H + 28);
            F.box(-4, H + 1, bz1 - T, 4, H + 21, bz1, (lx, ly, lz) => lz !== bz1 - 2 ? 0 : ((lx === -4 || lx === 3 || ly === H + 20) ? M.darkwood : M.blue));
            lattice('x', -18, H + 9, Z0, Z0 + 1, Z0 - 1); lattice('x', 12, H + 9, Z0, Z0 + 1, Z0 - 1);
            lattice('x', -18, H + 9, bz1 - T, bz1 - 2, bz1);
        }
        // крыша: бак, тарелка; ковёр на парапете, кувшины у двери
        const ry = two ? H + 28 : H;
        GMC.cyl(F, X1 - 12 - (two ? 10 : 0), Z0 + 10, 5, ry, ry + 10, M.rubber, 1.6); GMC.cyl(F, X1 - 12 - (two ? 10 : 0), Z0 + 10, 5, ry + 10, ry + 11, M.rubber);
        if (n % 2) { F.box(X0 + 10, ry, Z0 + 8, X0 + 11, ry + 6, Z0 + 9, M.metal); GMC.cylZ(F, Z0 + 9, Z0 + 10, X0 + 10, ry + 8, 4, M.carwhite); }
        F.box(10, H - 8, Z1, 22, H + 3, Z1 + 1, (lx, ly) => [M.canvas, M.fabric, M.canvas2, M.terracotta][((lx >> 2) + (ly >> 2)) & 3]);
        for (const [jx, jz] of [[9, Z1 + 3], [13, Z1 + 4], [-12, Z1 + 3]]) { GMC.cyl(F, jx, jz, 2.2, 0, 6, M.terracotta); GMC.cyl(F, jx, jz, 1.2, 6, 8, M.terracotta); }
        // интерьер: ковёр, низкий стол, подушки, полка с горшками, лежанка, лампа
        F.box(-14, 1, -10, 14, 2, 10, (lx, ly, lz) => ((lx >> 2) + (lz >> 2)) & 1 ? M.canvas : M.fabric);
        GMC.table(F, -6, 2, -4, 6, 4, 4, M.plank, M.darkwood);
        for (const [cx, cz] of [[-11, -2], [8, -2], [-2, 6]]) F.box(cx, 2, cz, cx + 4, 4, cz + 4, M.canvas2);
        F.box(X0 + T, 1, Z0 + T, X0 + T + 18, 20, Z0 + T + 4, (lx, ly) => ly % 6 === 1 ? M.plank : (ly % 6 < 4 && ((lx & 3) === 1) ? M.terracotta : -1));
        F.box(X0 + T, 1, Z0 + T, X0 + T + 18, 20, Z0 + T + 1, M.plank);
        F.box(X1 - 20, 1, Z0 + T, X1 - T, 5, Z0 + T + 12, M.plank); F.box(X1 - 20, 5, Z0 + T, X1 - T, 6, Z0 + T + 12, M.canvas2);
        F.box(-1, H - 4, -1, 1, H - 3, 1, M.lamp);
    },

    /** Дувал: глинобитная стена квартала с зубцами, проломами и арочными воротами (+z). Полуразмеры — scale·10. */
    'desert-compound'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), A = GMD.adobe;
        const HX = Math.round((mk && mk.scale ? mk.scale[0] : 9) * 10), HZ = Math.round((mk && mk.scale ? mk.scale[2] : 9) * 10), HW = 24;
        const breach = (u, s) => GMC.noise(u, s * 50, 18, 31) > 0.78;
        const wall = (ax, u0, u1, d0, s) => GMC.wbox(F, ax, u0, 0, d0, u1, HW + 4, d0 + 3, (u, y, d) => {
            if (ax === 'x' && s > 0 && Math.abs(u) < 16) return -1;
            const br = breach(u, s), top = br ? 6 + Math.floor(GMC.hash(u, s, 1) * 6) : HW;
            if (br && y >= top) return -1;
            if (y >= HW) return ((u >> 2) & 1) ? M.adobe2 : -1;
            return A(u, y, d);
        });
        wall('x', -HX, HX, -HZ, -1); wall('x', -HX, HX, HZ - 3, 1); wall('z', -HZ + 3, HZ - 3, -HX, -2); wall('z', -HZ + 3, HZ - 3, HX - 3, 2);
        // арка ворот с двустворчатыми воротами
        F.box(-16, 0, HZ - 4, 16, 40, HZ + 1, (lx, ly, lz) => {
            if (Math.abs(lx + 0.5) < 10) {
                const arch = 26 + Math.round(9 * Math.sqrt(Math.max(0, 1 - ((lx + 0.5) / 10) ** 2)));
                if (ly < arch) return -1;
            }
            if (ly >= 36) return ((lx >> 2) & 1) ? M.adobe2 : -1;
            return A(lx, ly, lz);
        });
        F.box(-10, 0, HZ - 3, -1, 26, HZ - 2, (lx, ly) => ly % 6 === 0 || lx === -10 ? M.darkwood : M.plank);
        F.box(4, 0, HZ, 10, 26, HZ + 1, (lx, ly) => ly % 6 === 0 || lx === 9 ? M.darkwood : M.plank);
        F.box(-1, 32, HZ + 1, 1, 34, HZ + 2, M.lamp);
        // осыпи у проломов
        for (let u = -HX; u < HX; u += 3) for (const s of [-1, 1]) if (breach(u, s) && GMC.hash(u, s, 5) < 0.5) GMC.ell(F, u, 0, s < 0 ? -HZ + 5 : HZ - 8, 3, 3, 3, (lx, ly) => ly < 0 ? -1 : M.adobe);
    },

    /** Деревянная водонапорная башня: четыре ноги-бруса с раскосами, площадка с перилами, бак из клёпок
     *  с обручами, коническая крыша, лестница, труба со сливом. Подруби все ноги — башня рухнет. */
    'desert-watertower'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot), LH = 100, R = 22;
        const legs = [[-20, -20], [17, -20], [-20, 17], [17, 17]];
        for (const [lx, lz] of legs) { F.box(lx - 1, 0, lz - 1, lx + 5, 2, lz + 5, M.concrete); F.box(lx, 2, lz, lx + 3, LH, lz + 3, M.darkwood); }
        for (let ly = 28; ly < LH; ly += 26) {
            for (const [a, b] of [[legs[0], legs[1]], [legs[2], legs[3]], [legs[0], legs[2]], [legs[1], legs[3]]]) {
                const ax = a[0] + 1, az = a[1] + 1, bx = b[0] + 1, bz = b[1] + 1;
                GMC.lineF(F, ax, ly - 24, az, bx, ly, bz, M.wood); GMC.lineF(F, bx, ly - 24, bz, ax, ly, az, M.wood);
                F.box(Math.min(ax, bx), ly, Math.min(az, bz), Math.max(ax, bx) + 1, ly + 2, Math.max(az, bz) + 1, M.darkwood);
            }
        }
        GMC.cyl(F, 0, 0, R + 5, LH, LH + 2, M.plank);
        GMC.cyl(F, 0, 0, R + 5, LH + 2, LH + 10, (lx, ly, lz, d) => d < R + 4 ? -1 : (ly === LH + 9 || ((lx + lz) % 5 === 0) ? M.darkwood : -1));
        GMC.cyl(F, 0, 0, R, LH + 2, LH + 36, (lx, ly, lz) => (ly - LH) % 9 === 0 ? M.rust : ((Math.round(Math.atan2(lz, lx) * 14) & 1) ? M.plank : M.wood), 1.8);
        GMC.cyl(F, 0, 0, R - 1, LH + 2, LH + 3, M.darkwood);
        GMC.cyl(F, 0, 0, R - 1.5, LH + 30, LH + 31, M.water);
        for (let ly = LH + 36; ly < LH + 52; ly++) GMC.cyl(F, 0, 0, (R + 2) * (1 - (ly - LH - 36) / 16) + 0.5, ly, ly + 1, M.rust, 1.6);
        F.box(0, LH + 52, 0, 1, LH + 56, 1, M.metal);
        for (let ly = 4; ly < LH; ly += 3) F.box(-21, ly, -19, -20, ly + 1, -15, M.metal);
        F.box(-21, 2, -19, -20, LH, -18, M.metal); F.box(-21, 2, -16, -20, LH, -15, M.metal);
        F.box(-1, 14, -1, 2, LH, 2, M.rust);
        F.box(2, 14, -1, 8, 16, 2, M.rust); F.box(7, 10, -1, 8, 14, 2, M.rust);
        F.box(-11, LH + 13, R, 12, LH + 22, R + 1, M.darkwood);
        GMC.text(F, 'WATER', -9, LH + 15, R + 1, 1, 0, M.canvas2, 1);
    },

    /** Радиомачта на растяжках: решётчатый ствол в красно-белых поясах сужается к шарниру над керамическим
     *  изолятором (с землёй не связан!), тарелки на одной стороне, маяк, два яруса тросов к трём анкерам.
     *  Перережь все тросы — мачта завалится (тарелки тянут её на +z). Рядом аппаратная. */
    'desert-mast'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot), TOP = 160, BASE = 9;
        F.box(-10, 0, -10, 11, 3, 11, M.concrete);
        F.box(-3, 3, -3, 3, 5, 3, M.tile); F.box(-1, 5, -1, 1, 8, 1, M.tile);
        const band = ly => (Math.floor((ly - BASE) / 18) & 1) ? M.carwhite : M.carred;
        for (const [cx, cz] of [[-4, -4], [3, -4], [-4, 3], [3, 3]]) GMC.lineF(F, cx > 0 ? 0 : -1, BASE, cz > 0 ? 0 : -1, cx, BASE + 18, cz, M.carred);
        F.box(-1, BASE, -1, 1, BASE + 3, 1, M.carred);
        F.box(-4, BASE + 18, -4, 4, TOP, 4, (lx, ly, lz) => {
            const ex = lx === -4 || lx === 3, ez = lz === -4 || lz === 3;
            if (ex && ez) return band(ly);
            const yy = (ly - BASE) % 8;
            if ((ex || ez) && yy === 0) return band(ly);
            const u0 = ex ? lz + 4 : lx + 4, u = ((ly - BASE) % 16) < 8 ? u0 : 7 - u0;
            if ((ex || ez) && (u === yy || u === yy + 1)) return band(ly);
            return -1;
        });
        F.box(-1, TOP, -1, 1, TOP + 8, 1, M.metal); F.box(-1, TOP + 2, -1, 1, TOP + 4, 1, M.neonred);
        F.box(-5, 100, -5, 5, 101, 5, M.neonred);
        for (const [ly, dx] of [[108, -2], [128, 1]]) {
            F.box(dx - 1, ly - 1, 4, dx + 2, ly + 2, 13, M.metal);
            GMC.cylZ(F, 13, 16, dx, ly, 6, M.concrete2); GMC.cylZ(F, 16, 17, dx, ly, 6, M.carwhite); GMC.cylZ(F, 17, 18, dx, ly, 4.5, M.carwhite);
        }
        F.box(-3, 86, 4, 4, 87, 12, M.metal); F.box(-3, 87, 11, 4, 92, 12, M.metal);
        const RA = 85, anchors = [[0, -RA], [Math.round(RA * 0.87), Math.round(RA * 0.5)], [-Math.round(RA * 0.87), Math.round(RA * 0.5)]];
        for (const [ax, az] of anchors) {
            F.box(ax - 4, 0, az - 4, ax + 5, 6, az + 5, M.concrete);
            F.box(ax, 6, az, ax + 1, 9, az + 1, M.metal);
            const cx = ax > 0 ? 3 : -4, cz = az > 0 ? 3 : -4;
            for (const ly of [62, 122]) GMC.lineF(F, ax, 8, az, cx, ly, cz, M.cable);
        }
        for (let i = -14; i <= 14; i += 7) for (const [px, pz] of [[i, -14], [i, 14], [-14, i], [14, i]]) F.box(px, 0, pz, px + 1, 12, pz + 1, M.metal);
        for (const ly of [5, 11]) { F.box(-14, ly, -14, 15, ly + 1, -13, M.cable); F.box(-14, ly, 14, 15, ly + 1, 15, M.cable); F.box(-14, ly, -14, -13, ly + 1, 15, M.cable); F.box(14, ly, -14, 15, ly + 1, 15, M.cable); }
        F.box(-5, 3, 15, 5, 10, 16, M.hazard);
        F.box(24, 0, -40, 52, 24, -16, (lx, ly, lz) => {
            const e = lx === 24 || lx === 51 || lz === -40 || lz === -17 || ly === 0 || ly === 23;
            if (!e) return -1;
            if (lx === 24 && lz > -32 && lz < -24 && ly < 20) return ly === 0 ? M.concrete : M.metal;
            if (lz === -17 && lx > 30 && lx < 44 && ly > 9 && ly < 17) return M.glass;
            return M.concrete;
        });
        F.box(52, 4, -34, 56, 14, -22, M.metal); F.box(40, 24, -34, 46, 30, -28, M.metal);
        F.box(30, 1, -38, 34, 16, -34, M.concrete2); F.box(36, 1, -38, 40, 16, -34, M.concrete2);
    },

    /** Рынок: ряд прилавков на тонких столбах с полосатыми навесами, товар, ковры на верёвках, ящики. Фронт +z. */
    'desert-market'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const cols = [[M.canvas, M.canvas2], [M.blue, M.canvas2], [M.caryellow, M.canvas], [M.fabric, M.canvas2], [M.steelg, M.canvas2]];
        const goods = [[M.carred, M.leaves2], [M.caryellow, M.terracotta], [M.terracotta, M.canvas], [M.leaves2, M.caryellow], [M.fabric, M.canvas2]];
        for (let i = 0; i < 5; i++) {
            const S = F.sub(-56 + i * 28, 0, 0), [ca, cb] = cols[i];
            for (const [px, pz] of [[-11, -8], [10, -8], [-11, 7], [10, 7]]) S.box(px, 0, pz, px + 1, pz < 0 ? 26 : 22, pz + 1, M.wood);
            for (let lz = -10; lz < 12; lz++) { const yy = 26 - Math.floor((lz + 10) / 5); S.box(-13, yy - 1, lz, 13, yy + 1, lz + 1, (lx) => ((lx >> 2) & 1) ? ca : cb); }
            S.box(-13, 18, 11, 13, 21, 12, (lx) => ((lx >> 2) & 1) ? ca : cb);
            S.box(-9, 0, 3, 9, 8, 7, M.plank);
            S.box(-9, 8, 2, 9, 9, 8, M.plank);
            for (let gx = -8; gx < 8; gx += 3) GMC.ell(S, gx + 1, 10, 5, 1.6, 1.4, 1.6, goods[i][(gx >> 1) & 1]);
            S.box(-11, 16, -8, 11, 17, -7, M.cable);
            for (let rx = -9; rx < 9; rx += 6) S.box(rx, 6, -8, rx + 5, 16, -7, (lx, ly) => [M.fabric, M.canvas, M.canvas2][((lx >> 1) + (ly >> 2) + i) % 3]);
            for (let k = 0; k < 2 + (i & 1); k++) S.box(-12 + k * 7, 0, -15, -6 + k * 7, 6 + (k & 1) * 6, -10, M.crate);
        }
    },

    /** Топливный склад: сетчатый забор, два вертикальных бака (взрывоопасные) в обваловании, трубы,
     *  колонки под навесом «FUEL», бытовка, генератор. Бочки и бензовоз — отдельными маркерами. Ворота — −z. */
    'desert-fueldepot'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const X0 = -50, X1 = 50, Z0 = -60, Z1 = 62;
        F.box(X0, -1, Z0, X1, 0, Z1, (lx, ly, lz) => ((lx + 1000) % 10 === 0 || (lz + 1000) % 10 === 0) ? M.concrete2 : M.concrete);
        const fence = (ax, u0, u1, d) => GMC.wbox(F, ax, u0, 0, d, u1, 20, d + 1, (u, y) => {
            if (ax === 'x' && d === Z0 && Math.abs(u) < 16) return -1;
            if ((u + 1000) % 12 === 0 || y === 19 || y === 1) return M.metal;
            return ((u + 1000) % 3 === 0 || y % 3 === 0) ? M.cable : -1;
        });
        fence('x', X0, X1, Z0); fence('x', X0, X1, Z1 - 1); fence('z', Z0, Z1, X0); fence('z', Z0, Z1, X1 - 1);
        for (const gx of [-17, 16]) F.box(gx, 0, Z0, gx + 1, 24, Z0 + 1, M.hazard);
        // обвалование и два бака
        GMC.walls(F, -42, -14, 42, 50, 0, 5, 2, M.concrete);
        for (const tx of [-21, 21]) {
            GMC.cyl(F, tx, 18, 17, 0, 46, (lx, ly) => (ly % 12 === 11) ? M.metal : M.fueltank, 1.6);
            for (let ly = 46; ly < 52; ly++) GMC.cyl(F, tx, 18, 17 - (ly - 46) * 2.6, ly, ly + 1, M.fueltank, 1.8);
            GMC.cyl(F, tx, 18, 16, 0, 1, M.concrete);
            for (let a = 2; a < 46; a += 2) {
                const an = a * 0.16 + (tx > 0 ? Math.PI : 0), ax = tx + Math.round(Math.cos(an) * 18), az = 18 + Math.round(Math.sin(an) * 18);
                F.box(ax - 1, a, az - 1, ax + 1, a + 1, az + 1, M.metal);
            }
            F.box(tx - 9, 22, 0, tx + 9, 31, 1, M.hazard);
            GMC.text(F, 'FUEL', tx + 7, 24, -1, -1, 0, M.carred, 1);
            F.box(tx - 1, 3, -7, tx + 2, 6, 2, M.rust);
        }
        F.box(-22, 3, -10, 23, 6, -7, M.rust);
        for (const px of [-14, 0, 14]) F.box(px, 0, -10, px + 1, 3, -7, M.concrete2);
        F.box(-1, 3, -40, 2, 6, -10, M.rust);
        // колонки под навесом у ворот
        F.box(-24, 0, -54, 24, 1, -34, M.concrete2);
        for (const [cx, cz] of [[-22, -52], [21, -52], [-22, -37], [21, -37]]) F.box(cx, 1, cz, cx + 1, 30, cz + 1, M.carwhite);
        F.box(-26, 30, -56, 26, 33, -32, M.carwhite);
        F.box(-26, 33, -56, 26, 37, -55, M.carred);
        GMC.text(F, 'FUEL', 7, 33, -57, -1, 0, M.neonamber, 1);
        for (let lx = -20; lx < 20; lx += 10) F.box(lx, 29, -48, lx + 6, 30, -40, M.lamp);
        for (const px of [-10, 6]) {
            F.box(px, 1, -48, px + 5, 18, -42, (lx, ly, lz) => (ly > 12 && ly < 16 && lz === -48) ? M.neongreen : M.carred);
            F.box(px + 5, 8, -46, px + 6, 10, -44, M.rubber);
        }
        // бытовка, генератор, знак
        F.box(28, 0, -54, 46, 22, -34, (lx, ly, lz) => {
            const e = lx === 28 || lx === 45 || lz === -54 || lz === -35 || ly === 0 || ly === 21;
            if (!e) return -1;
            if (lx === 28 && lz > -50 && lz < -44 && ly > 0 && ly < 19) return M.darkwood;
            if (lz === -54 && lx > 32 && lx < 42 && ly > 9 && ly < 16) return M.glass;
            return ((lx + lz) & 1) ? M.steelg : M.blue;
        });
        F.box(-46, 0, 30, -32, 12, 44, M.metal); F.box(-44, 12, 34, -42, 18, 36, M.rust);
        F.box(-30, 0, Z0 - 2, -29, 16, Z0 - 1, M.metal); F.box(-36, 10, Z0 - 3, -22, 18, Z0 - 2, M.hazard);
        GMC.text(F, 'NO', -26, 12, Z0 - 4, -1, 0, M.carred, 1);
    },

    /** Бочка (динамическая, взрывоопасная): стоя, n % 4 === 3 — лёжа, n % 5 === 0 — белая. Каждая — своё тело. */
    'desert-barrel'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), n = GMC.num(mk);
        const mat = n % 5 === 0 ? M.fueltank : M.barrel, b = F.get(0, -1, 0) ? 0 : -1;
        F.box(-4, b, -4, 5, b + 9, 5, 0);
        if (n % 4 === 3) { GMC.cylX(F, -4, 5, b + 3, 0, 3, (lx) => lx === -4 || lx === 4 ? M.rust : mat); F.dyn(-4, b, -3, 5, b + 7, 4); return; }
        GMC.cyl(F, 0, 0, 3, b, b + 9, (lx, ly) => (ly === b + 3 || ly === b + 6) ? M.rust : mat);
        F.dyn(-3, b, -3, 4, b + 9, 4);
    },

    /** Бензовоз (динамический): кабина, рама, 6 колёс, цистерна из взрывоопасного материала. Курс +x. */
    'desert-tanker'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const b = F.get(0, -1, 0) ? 0 : -1, W0 = -11, W1 = 11;
        F.box(-47, b, W0, 48, b + 31, W1, 0);
        F.box(-46, b + 5, -8, 46, b + 8, 8, M.concrete2);
        for (const c of [-38, -28, 30]) {
            for (const [z0, z1] of [[W0, W0 + 3], [W1 - 3, W1]]) for (let ly = b; ly < b + 9; ly++) for (let lx = c - 4; lx <= c + 4; lx++) {
                const d2 = (lx - c) ** 2 + (ly - b - 4) ** 2;
                if (d2 > 18) continue;
                for (let lz = z0; lz < z1; lz++) F.put(lx, ly, lz, d2 <= 3 ? M.metal : M.rubber);
            }
            F.box(c - 1, b + 3, W0 + 3, c + 2, b + 5, W1 - 3, M.metal);
            F.box(c - 1, b + 5, -1, c + 2, b + 6, 1, M.metal);
        }
        GMC.cylX(F, -46, 18, b + 18, 0, 10, M.fueltank, 1.6);
        GMC.cylX(F, -47, -46, b + 18, 0, 9, M.fueltank); GMC.cylX(F, 18, 19, b + 18, 0, 9, M.fueltank);
        for (const lx of [-40, -20, 0, 14]) GMC.cylX(F, lx, lx + 1, b + 18, 0, 10.6, M.metal, 1.2);
        F.box(-10, b + 28, -3, 6, b + 30, 3, M.metal);
        F.box(20, b + 8, -10, 46, b + 14, 10, M.caryellow);
        F.box(26, b + 14, -10, 46, b + 30, 10, (lx, ly, lz) => {
            const e = lx === 26 || lx === 45 || lz === -10 || lz === 9 || ly === b + 29;
            if (!e) return -1;
            if (ly > b + 18 && ly < b + 27 && (lx === 45 ? (lz > -9 && lz < 8) : ((lz === -10 || lz === 9) && lx > 30 && lx < 43))) return M.glass;
            return M.caryellow;
        });
        F.box(46, b + 6, -9, 47, b + 10, 9, M.concrete2); F.box(46, b + 10, -8, 47, b + 12, -5, M.lamp); F.box(46, b + 10, 4, 47, b + 12, 7, M.lamp);
        F.box(27, b + 14, -9, 31, b + 18, 8, M.fabric);
        F.dyn(-47, b, W0, 48, b + 31, W1);
    },

    /** Руины: аркада из песчаника (последние арки обрушены — свисают консолью), барабаны колонн,
     *  завалы, обломок башни с проломом, лестница в никуда. */
    'desert-ruins'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const sw = (lx, ly, lz) => GMC.stonework(lx, ly, lz, M.sandstone, M.sandstone2, M.adobe);
        const N = 5, P = 7, O = 16, AW = 5, X0 = -Math.floor((N * (P + O) + P) / 2);
        for (let i = 0; i <= N; i++) {
            const px = X0 + i * (P + O);
            const ph = i === N ? 18 : 30;
            F.box(px, 0, -AW, px + P, ph, AW, sw);
            F.box(px - 1, 0, -AW - 1, px + P + 1, 3, AW + 1, M.sandstone2);
            if (i < N) {
                const ax0 = px + P, R = O / 2, cx = ax0 + R - 0.5, broken = i >= N - 2;
                F.box(ax0, 30, -AW, ax0 + O, 46, AW, (lx, ly, lz) => {
                    if (Math.hypot(lx - cx, ly - 30) < R) return -1;
                    if (broken && i === N - 1 && lx > cx - 2) return -1;
                    if (broken && i === N - 2 && ly > 41 && lx > cx) return -1;
                    return sw(lx, ly, lz);
                });
                F.box(px, 30, -AW, px + P, i === N - 1 ? 40 : 46, AW, (lx, ly, lz) => (i === N) ? -1 : sw(lx, ly, lz));
                if (i < N - 2) F.box(ax0 - P, 46, -AW, ax0 + O, 49, AW, (lx) => ((lx >> 1) & 1) ? M.sandstone2 : -1);
            }
        }
        for (const [cx, cz, len] of [[X0 + 30, 22, 14], [X0 + 70, -20, 10], [X0 + 100, 18, 12]]) GMC.cylX(F, cx, cx + len, 4, cz, 4, M.sandstone);
        for (const [rx, rz, r] of [[X0 + 122, 4, 9], [X0 + 110, -13, 6], [X0 + 130, 16, 6]]) GMC.ell(F, rx, 0, rz, r, r * 0.7, r, (lx, ly, lz) => ly < 0 ? -1 : (GMC.hash(lx >> 1, ly >> 1, lz >> 1) < 0.5 ? M.sandstone : M.sandstone2));
        const TX = X0 + 12, TZ = 38;
        F.box(TX - 15, 0, TZ - 15, TX + 15, 72, TZ + 15, (lx, ly, lz) => {
            const e = lx < TX - 12 || lx >= TX + 12 || lz < TZ - 12 || lz >= TZ + 12;
            if (!e) return -1;
            if (ly > 40 + Math.floor(GMC.noise(lx + lz, 0, 6, 21) * 30)) return -1;
            if (ly > 20 && ly < 32 && Math.abs(lx - TX) < 3) return -1;
            if (ly < 22 && Math.abs(lz - TZ) < 4 && lx < TX - 11) return -1;
            return sw(lx, ly, lz);
        });
        for (let i = 0; i < 18; i++) F.box(TX + 15, i, TZ - 10 + i, TX + 22, i + 1, TZ - 8 + i, sw);
    },

    /** Перевёрнутый школьный автобус: лежит на боку, ржавчина, выбитые стёкла, колёса вбок, наносы песка. */
    'desert-bus'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        const L0 = -55, L1 = 55, HB = 24;
        // локальная y — бывшая ширина (борт на земле), z — бывшая высота (крыша на +z)
        F.box(L0, 0, -14, L1, HB, 15, (lx, ly, lz) => {
            const side = ly === 0 || ly === HB - 1, roof = lz === 14, floor = lz === -14 || lz === -13, end = lx === L0 || lx === L1 - 1;
            if (!side && !roof && !floor && !end) return -1;
            if (side && !end && lz > -4 && lz < 10 && ((lx + 1000) % 12) > 1) return ly === 0 ? M.glass : (GMC.hash(lx >> 2, 3, lz >> 2) < 0.35 ? M.glass : 0);
            if (end && lx === L1 - 1 && lz > -6 && lz < 12 && ly > 1 && ly < HB - 2) return GMC.hash(ly >> 3, lz >> 3, 4) < 0.5 ? 0 : M.glass;
            if (floor) return lz === -14 ? M.rust : M.concrete2;
            if (GMC.noise(lx, ly + lz, 6, 7) > 0.66) return M.rust;
            return lz > 9 ? M.carwhite : M.caryellow;
        });
        for (const c of [-36, 33]) for (const [y0, y1] of [[0, 3], [HB - 3, HB]]) {
            for (let lz = -24; lz <= -14; lz++) for (let lx = c - 5; lx <= c + 5; lx++) {
                const d2 = (lx - c) ** 2 + (lz + 19) ** 2;
                if (d2 > 27) continue;
                for (let ly = y0; ly < y1; ly++) F.put(lx, ly, lz, d2 <= 5 ? M.rust : M.rubber);
            }
        }
        for (let lx = -50; lx < 40; lx += 9) F.box(lx, 1, -12, lx + 4, HB - 1, -9, M.blue);
        GMC.ell(F, 10, 0, -27, 40, 9, 12, (lx, ly) => ly < 0 ? -1 : M.sand);
        GMC.ell(F, -20, 0, 22, 26, 6, 8, (lx, ly) => ly < 0 ? -1 : M.sand);
    },

    /** Скала из слоистого песчаника; n = 1 — природная арка (перемычка держится на двух столбах). */
    'desert-rocks'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), n = GMC.num(mk);
        const strat = (lx, ly, lz) => (Math.floor((ly + GMC.noise(lx, lz, 20, n) * 4) / 4) % 3 === 0) ? M.sandstone2 : (GMC.hash(lx >> 2, ly >> 1, lz >> 2) < 0.15 ? M.rock : M.sandstone);
        const blob = (cx, cy, cz, rx, ry, rz) => {
            for (let ly = Math.max(0, Math.floor(cy - ry)); ly <= cy + ry; ly++) for (let lz = Math.floor(cz - rz); lz <= cz + rz; lz++) for (let lx = Math.floor(cx - rx); lx <= cx + rx; lx++) {
                const t = ((lx - cx) / rx) ** 2 + ((ly - cy) / ry) ** 2 + ((lz - cz) / rz) ** 2;
                if (t > 1 + (GMC.noise(lx + lz, ly, 5, n * 3) - 0.5) * 0.5) continue;
                F.put(lx, ly, lz, strat(lx, ly, lz));
            }
        };
        if (n === 1) {
            blob(-26, 20, 0, 10, 30, 11); blob(26, 18, 0, 11, 28, 10);
            blob(0, 48, 0, 38, 9, 10);
            blob(-34, 5, 6, 12, 7, 12); blob(36, 4, -6, 10, 6, 10);
        } else {
            blob(0, 8, 0, 22 + n * 2, 14 + n * 3, 18); blob(14, 20 + n * 2, 6, 11, 11, 9); blob(-16, 3, 10, 13, 6, 11);
        }
    },

    /** Финиковая пальма: изогнутый ствол с кольцами, веер листьев, грозди фиников. */
    'desert-palm'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), n = GMC.num(mk);
        const H = 58 + (n * 13) % 24, lean = 10 + (n % 3) * 4;
        let px = 0;
        for (let ly = 0; ly < H; ly++) {
            const t = ly / H, ox = Math.round(lean * t * t);
            F.box(Math.min(ox, px) - 1, ly, -1, Math.max(ox, px) + 2, ly + 1, 2, (ly % 4 === 0) ? M.darkwood : M.wood);
            px = ox;
        }
        const tx = px, ty = H;
        F.box(tx - 2, ty - 2, -2, tx + 3, ty + 2, 3, M.leaves2);
        for (let k = 0; k < 9; k++) {
            const a = k / 9 * Math.PI * 2 + n, L = 22 + (k % 3) * 4;
            let qx = tx, qy = ty + 1, qz = 0;
            for (let s = 1; s <= 6; s++) {
                const f = s / 6, nx = tx + Math.cos(a) * L * f, nz = Math.sin(a) * L * f, ny = ty + 1 + 6 * f - 16 * f * f;
                GMC.lineF(F, qx, qy, qz, nx, ny, nz, s > 4 ? M.leaves : M.leaves2);
                GMC.lineF(F, qx, qy + 1, qz, nx, ny + 1, nz, M.leaves2);
                qx = nx; qy = ny; qz = nz;
            }
        }
        for (const [dx, dz] of [[2, 2], [-2, 1], [1, -2]]) GMC.ell(F, tx + dx, ty - 4, dz, 1.5, 2.5, 1.5, M.terracotta);
    },

    /** Колодец: каменное кольцо, вода, деревянная рама с воротом и ведром на верёвке. */
    'desert-well'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        GMC.cyl(F, 0, 0, 7, 0, 9, (lx, ly, lz) => GMC.stonework(lx, ly, lz, M.sandstone, M.sandstone2, M.adobe), 2.5);
        GMC.cyl(F, 0, 0, 4.6, -4, -1, M.water);
        GMC.cyl(F, 0, 0, 4.4, -1, 0, 0);
        F.box(-9, 0, -1, -7, 26, 1, M.darkwood); F.box(7, 0, -1, 9, 26, 1, M.darkwood);
        F.box(-9, 22, -1, 9, 24, 1, M.wood);
        F.box(0, 13, 0, 1, 22, 1, M.cable);
        GMC.cyl(F, 0, 0, 2, 9, 13, M.plank, 1);
        F.box(-1, 12, 0, 2, 13, 1, M.metal);
    },

    /** Глинобитная дозорная башня: стены с наклоном, бойницы, деревянные ярусы с лестницами, смотровая
     *  площадка с парапетом и тентом на шестах. Высокая и узкая — подруби низ, и она завалится. */
    'desert-watchtower'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot), H = 112, A = GMD.adobe;
        F.box(-14, 0, -14, 14, H, 14, (lx, ly, lz) => {
            const r = 14 - Math.floor(ly / 28);
            const a = Math.max(Math.abs(lx + 0.5), Math.abs(lz + 0.5));
            if (a > r || a < r - 3) return -1;
            return A(lx, ly, lz);
        });
        for (let ly = 18; ly < H - 10; ly += 22) for (const ax of ['x', 'z']) {
            const r = 14 - Math.floor(ly / 28);
            GMC.wbox(F, ax, -2, ly, -r, 2, ly + 7, r, (u, y, d) => (Math.abs(d + 0.5) > r - 3 ? 0 : -1));
        }
        F.box(-5, 0, 10, 5, 22, 14, (lx, ly, lz) => (lz === 11 && Math.abs(lx + 0.5) < 4.5 && ly > 0) ? (ly % 5 === 0 ? M.darkwood : M.blue) : (Math.abs(lx + 0.5) < 4.5 && ly > 0 ? 0 : -1));
        for (const fy of [30, 58, 86]) {
            const r = 14 - Math.floor(fy / 28) - 3;
            F.box(-r, fy, -r, r, fy + 2, r, (lx, ly, lz) => (lx > -r + 1 && lx < -r + 6 && lz > -r + 1 && lz < -r + 6) ? 0 : M.plank);
            for (let ly = fy - 26; ly < fy + 2; ly += 3) if (ly > 1) F.box(-r + 2, ly, -r, -r + 5, ly + 1, -r + 1, M.wood);
        }
        // смотровая площадка: настил, парапет, тент
        F.box(-13, H, -13, 13, H + 2, 13, M.plank);
        for (const [cx, cz] of [[-14, -14], [12, -14], [-14, 12], [12, 12]]) F.box(cx, H - 4, cz, cx + 2, H, cz + 2, M.darkwood);
        F.box(-15, H - 2, -15, 15, H, 15, (lx, ly, lz) => (Math.abs(lx + 0.5) > 11 || Math.abs(lz + 0.5) > 11) ? M.darkwood : -1);
        F.box(-13, H + 2, -13, 13, H + 9, 13, (lx, ly, lz) => (Math.abs(lx + 0.5) > 11.5 || Math.abs(lz + 0.5) > 11.5) ? (ly === H + 8 || ((lx + lz) & 3) === 0 ? M.darkwood : -1) : -1);
        for (const [cx, cz] of [[-12, -12], [11, -12], [-12, 11], [11, 11]]) F.box(cx, H + 2, cz, cx + 1, H + 22, cz + 1, M.wood);
        F.box(-13, H + 22, -13, 13, H + 23, 13, (lx, ly, lz) => ((lx >> 2) & 1) ? M.canvas : M.canvas2);
        F.box(-1, H + 2, -1, 1, H + 10, 1, M.metal); F.box(-1, H + 10, -1, 1, H + 11, 4, M.metal); F.box(-1, H + 9, 3, 1, H + 12, 5, M.lamp);
    },

    /** Столбы электролинии вдоль дороги (локальная +x): деревянные опоры с траверсами, изоляторы, три
     *  провисающих провода. Длина — scale[0]·10 в каждую сторону. */
    'desert-poles'(w, x, z, rot, mk) {
        const F = GMC.frame(w, x, z, rot), HL = Math.round((mk && mk.scale ? mk.scale[0] : 20) * 10), PH = 72, STEP = 68;
        const xs = []; for (let lx = -HL; lx <= HL; lx += STEP) xs.push(lx);
        for (const px of xs) {
            F.box(px - 1, 0, -1, px + 2, PH, 2, (lx, ly) => ly % 9 === 0 ? M.darkwood : M.wood);
            F.box(px - 1, PH - 6, -12, px + 2, PH - 4, 13, M.darkwood);
            for (const pz of [-11, 0, 11]) F.box(px, PH - 4, pz, px + 1, PH - 2, pz + 1, M.tile);
            GMC.lineF(F, px, PH - 18, 0, px, PH - 6, -8, M.darkwood);
        }
        for (let i = 0; i + 1 < xs.length; i++) for (const pz of [-11, 0, 11]) GMC.sagF(F, xs[i], PH - 2, pz, xs[i + 1], PH - 2, pz, 7, M.cable);
        F.box(xs[1] - 4, PH - 22, 2, xs[1] + 5, PH - 12, 9, M.concrete2);
    },

    /** Блокпост на въезде: шлагбаум в красно-белую полоску на стойке, будка, стенки из мешков с песком, бочка. */
    'desert-checkpoint'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        F.box(-3, 0, -30, 3, 14, -24, M.concrete);
        F.box(-1, 14, -29, 1, 16, -25, M.metal);
        F.box(-1, 13, -24, 1, 15, 26, (lx, ly, lz) => ((lz + 1000) % 10 < 5) ? M.carred : M.carwhite);
        F.box(-2, 0, 24, 2, 12, 28, M.metal);
        F.box(-12, 0, -46, 6, 28, -32, (lx, ly, lz) => {
            const e = lx === -12 || lx === 5 || lz === -46 || lz === -33 || ly === 0 || ly === 27;
            if (!e) return -1;
            if (ly > 11 && ly < 21 && (lz === -33 || lx === 5) && ((lx + lz) % 7) > 0) return M.glass;
            if (lx === 5 && lz > -45 && lz < -40 && ly > 0 && ly < 22) return 0;
            return ly === 27 ? M.rust : M.plank;
        });
        F.box(-14, 27, -48, 8, 29, -30, M.rust);
        const bags = (x0, z0, len, along) => {
            for (let k = 0; k < 4; k++) for (let i = 0; i < len; i += 6) {
                const off = (k & 1) * 3, bx = along ? x0 + i + off : x0, bz = along ? z0 : z0 + i + off;
                if ((along && i + off + 6 > len) || (!along && i + off + 6 > len)) continue;
                F.box(bx, k * 3, bz, bx + (along ? 6 : 4), k * 3 + 3, bz + (along ? 4 : 6), (lx, ly, lz) => ((lx + lz + ly) % 7 === 0) ? M.sand : M.canvas2);
            }
        };
        bags(-30, -56, 36, true); bags(-30, -52, 30, false); bags(12, 30, 30, true);
        GMC.cyl(F, 10, -28, 3, 0, 9, (lx, ly) => ly % 3 === 0 ? M.rust : M.steelg);
        F.box(6, 0, 34, 7, 18, 35, M.metal); F.box(-3, 14, 33, 16, 20, 34, M.carred);
        GMC.text(F, 'STOP', 12, 15, 32, -1, 0, M.carwhite, 1);
    },

    /** Шатёр кочевников: шесты, натянутое полотно, растяжки к колышкам, ковры и котёл внутри. */
    'desert-tent'(w, x, z, rot) {
        const F = GMC.frame(w, x, z, rot);
        for (const px of [-18, 0, 18]) F.box(px, 0, -1, px + 1, 26, 1, M.wood);
        for (let lz = -16; lz <= 16; lz++) {
            const yy = 26 - Math.floor(Math.abs(lz) * 0.9);
            F.box(-22, yy - 1, lz, 23, yy + 1, lz + 1, (lx) => ((lx >> 2) & 1) ? M.canvas : M.fabric);
        }
        for (const s of [-1, 1]) F.box(-22, 6, s * 16 + (s > 0 ? 0 : 0), 23, 12, s * 16 + 1, (lx) => ((lx >> 2) & 1) ? M.canvas : M.fabric);
        for (const [px, pz] of [[-22, -16], [22, -16], [-22, 16], [22, 16]]) {
            const ox = Math.sign(px) * 8, oz = Math.sign(pz) * 6;
            GMC.lineF(F, px, 12, pz, px + ox, 0, pz + oz, M.cable);
            F.box(px + ox, 0, pz + oz, px + ox + 1, 2, pz + oz + 1, M.wood);
        }
        F.box(-16, 0, -12, 16, 1, 12, (lx, ly, lz) => [M.canvas, M.fabric, M.canvas2][((lx >> 3) + (lz >> 3) + 3) % 3]);
        GMC.cyl(F, 8, 4, 3, 1, 5, M.metal, 1.2); F.box(6, 1, 2, 11, 2, 7, M.neonamber);
        F.box(-14, 1, -10, -6, 4, -2, M.canvas2); F.box(-14, 1, 2, -6, 4, 10, M.canvas2);
    },

    /** Пикап (динамический) — общая машина набора. */
    'desert-car'(w, x, z, rot, mk) {
        const paints = [M.carwhite, M.caryellow, M.blue, M.carred];
        GMC.car(GMC.frame(w, x, z, rot), paints[GMC.num(mk) % paints.length], false);
    },
});
