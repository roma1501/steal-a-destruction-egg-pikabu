// GameMapsB.js — набор карт B Rubble Lab: «Стройка» (construction), «Завод» (factory), «Порт» (docks).
// Строители маркеров (имя = id карты + '-' + деталь) дописываются в GameMapBuild.builders.
// Первый маркер каждой карты — <id>-terrain в центре карты: покрытие земли, дороги, котлованы, валы по краям.
// Постройки — в локальных координатах от маркера (lx, ly от уровня земли GROUND, lz), поворот — четверти.
// Свободные предметы (поддоны, бочки, трубы, контейнеры…) ставятся вокселями и отмечаются dyn: после
// загрузки каждый связный кусок в ящике — своё спящее тело (стоит ровно на опоре, пока не тронут).
// Всё — внутри IIFE: файлы наборов карт делят одну глобальную область.

(() => {
    const GB = GameMapBuild;

    /** Хэш целых координат -> [0, 1). */
    function hash(a, b, c) {
        let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }
    /** Гладкий шум 0..1 по клеткам size, seed — свой рисунок. */
    function vnoise(x, z, size, seed) {
        const fx = x / size, fz = z / size, ix = Math.floor(fx), iz = Math.floor(fz);
        let tx = fx - ix, tz = fz - iz;
        tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
        const a = hash(ix, seed, iz), b = hash(ix + 1, seed, iz), c = hash(ix, seed, iz + 1), d = hash(ix + 1, seed, iz + 1);
        return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    }
    /** @param {any} v @param {number} a @returns {number} */
    const num = (v, a) => (typeof v === 'function' ? v(a) : v);

    /** Постройка: локальные координаты от маркера (x, z), поворот rot четвертей (+x смотрит по курсу маркера). */
    class Plot {
        /** @param {VoxWorld} w @param {number} x @param {number} z @param {number} rot */
        constructor(w, x, z, rot) {
            this.w = w; this.x = x; this.z = z; this.rot = rot || 0; this.G = GB.GROUND;
            this.ca = [1, 0, -1, 0][this.rot]; this.sa = [0, 1, 0, -1][this.rot];
        }
        wx(lx, lz) { return this.x + lx * this.ca - lz * this.sa; }
        wz(lx, lz) { return this.z + lx * this.sa + lz * this.ca; }
        /** Воксель: v > 0 — материал, 0 — воздух, < 0 — не трогать. Коренную породу (y = 0) не трогает. */
        put(lx, ly, lz, v) {
            const y = this.G + ly;
            if (v >= 0 && y >= 1) this.w.put(this.x + lx * this.ca - lz * this.sa, y, this.z + lx * this.sa + lz * this.ca, v);
        }
        get(lx, ly, lz) { return this.w.get(this.wx(lx, lz), this.G + ly, this.wz(lx, lz)); }
        /** Ящик [x0,x1)×[y0,y1)×[z0,z1): материал числом (быстрый fill) или функцией (lx, ly, lz) => v. */
        box(x0, y0, z0, x1, y1, z1, v) {
            y0 = Math.max(y0, 1 - this.G);
            if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
            if (typeof v === 'number') {
                if (v < 0) return;
                const ax = this.wx(x0, z0), bx = this.wx(x1 - 1, z1 - 1), az = this.wz(x0, z0), bz = this.wz(x1 - 1, z1 - 1);
                this.w.fill(Math.min(ax, bx), this.G + y0, Math.min(az, bz), Math.max(ax, bx) + 1, this.G + y1, Math.max(az, bz) + 1, v);
                return;
            }
            for (let ly = y0; ly < y1; ly++) for (let lz = z0; lz < z1; lz++) for (let lx = x0; lx < x1; lx++) {
                const m = v(lx, ly, lz);
                if (m >= 0) this.put(lx, ly, lz, m);
            }
        }
        /** Четыре стены толщиной t (без пола и крыши). */
        walls(x0, y0, z0, x1, y1, z1, t, v) {
            this.box(x0, y0, z0, x1, y1, z0 + t, v); this.box(x0, y0, z1 - t, x1, y1, z1, v);
            this.box(x0, y0, z0 + t, x0 + t, y1, z1 - t, v); this.box(x1 - t, y0, z0 + t, x1, y1, z1 - t, v);
        }
        /** Пустая коробка-оболочка толщиной t. */
        shell(x0, y0, z0, x1, y1, z1, t, v) {
            this.walls(x0, y0 + t, z0, x1, y1 - t, z1, t, v);
            this.box(x0, y0, z0, x1, y0 + t, z1, v); this.box(x0, y1 - t, z0, x1, y1, z1, v);
        }
        /** Цилиндр по оси y: центр (cx, cz), r и ri (внутренний, 0 — сплошной) — числа или функции ly. */
        cylY(cx, cz, y0, y1, r, ri, v) {
            let R = 0;
            for (let ly = y0; ly < y1; ly++) R = Math.max(R, num(r, ly));
            for (let ly = y0; ly < y1; ly++) {
                const ro = num(r, ly), rn = num(ri, ly), r2 = ro * ro, i2 = rn > 0 ? rn * rn : -1;
                for (let lz = Math.floor(cz - R - 1); lz <= Math.ceil(cz + R); lz++) for (let lx = Math.floor(cx - R - 1); lx <= Math.ceil(cx + R); lx++) {
                    const dx = lx + 0.5 - cx, dz = lz + 0.5 - cz, q = dx * dx + dz * dz;
                    if (q >= r2 || q < i2) continue;
                    const m = typeof v === 'function' ? v(lx, ly, lz, Math.sqrt(q), Math.atan2(dz, dx)) : v;
                    if (m >= 0) this.put(lx, ly, lz, m);
                }
            }
        }
        /** Цилиндр по оси x: центр (cy, cz) — числа или функции lx; r, ri — тоже. */
        cylX(cy, cz, x0, x1, r, ri, v) {
            for (let lx = x0; lx < x1; lx++) {
                const yc = num(cy, lx), zc = num(cz, lx), ro = num(r, lx), rn = num(ri, lx), r2 = ro * ro, i2 = rn > 0 ? rn * rn : -1;
                for (let ly = Math.floor(yc - ro - 1); ly <= Math.ceil(yc + ro); ly++) for (let lz = Math.floor(zc - ro - 1); lz <= Math.ceil(zc + ro); lz++) {
                    const dy = ly + 0.5 - yc, dz = lz + 0.5 - zc, q = dy * dy + dz * dz;
                    if (q >= r2 || q < i2) continue;
                    const m = typeof v === 'function' ? v(lx, ly, lz, Math.sqrt(q), Math.atan2(dy, dz)) : v;
                    if (m >= 0) this.put(lx, ly, lz, m);
                }
            }
        }
        /** Цилиндр по оси z: центр (cx, cy) — числа или функции lz. */
        cylZ(cx, cy, z0, z1, r, ri, v) {
            for (let lz = z0; lz < z1; lz++) {
                const xc = num(cx, lz), yc = num(cy, lz), ro = num(r, lz), rn = num(ri, lz), r2 = ro * ro, i2 = rn > 0 ? rn * rn : -1;
                for (let ly = Math.floor(yc - ro - 1); ly <= Math.ceil(yc + ro); ly++) for (let lx = Math.floor(xc - ro - 1); lx <= Math.ceil(xc + ro); lx++) {
                    const dx = lx + 0.5 - xc, dy = ly + 0.5 - yc, q = dx * dx + dy * dy;
                    if (q >= r2 || q < i2) continue;
                    const m = typeof v === 'function' ? v(lx, ly, lz, Math.sqrt(q), Math.atan2(dy, dx)) : v;
                    if (m >= 0) this.put(lx, ly, lz, m);
                }
            }
        }
        /** Отрезок с 6-связностью (шаг — по одной оси: кусок не рассыпается на воксели), сечение t³. */
        line(x0, y0, z0, x1, y1, z1, v, t = 1) {
            const n = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)) * 2;
            let px = Math.round(x0), py = Math.round(y0), pz = Math.round(z0);
            this.box(px, py, pz, px + t, py + t, pz + t, v);
            for (let i = 1; i <= n; i++) {
                const s = i / n;
                const qx = Math.round(x0 + (x1 - x0) * s), qy = Math.round(y0 + (y1 - y0) * s), qz = Math.round(z0 + (z1 - z0) * s);
                while (px !== qx || py !== qy || pz !== qz) {
                    if (py !== qy) py += Math.sign(qy - py); else if (px !== qx) px += Math.sign(qx - px); else pz += Math.sign(qz - pz);
                    this.box(px, py, pz, px + t, py + t, pz + t, v);
                }
            }
        }
        /** Отметить ящик динамическим (тела после загрузки). */
        dyn(x0, y0, z0, x1, y1, z1) { GB.rdyn(this.w, this.x, this.z, this.rot, x0, y0, z0, x1, y1, z1); }
        /** Ящик + динамика. */
        body(x0, y0, z0, x1, y1, z1, v) { this.box(x0, y0, z0, x1, y1, z1, v); this.dyn(x0, y0, z0, x1, y1, z1); }
        /** Хэш в мировых координатах (узор не зависит от поворота). */
        h(lx, ly, lz, s = 0) { return hash(this.wx(lx, lz), ly + s * 131, this.wz(lx, lz)); }
    }

    // ------------------------------------------------------------------ узоры материалов

    /** Кирпичная кладка: блоки 4×2 с перевязкой, два тона и редкий светлый кирпич. */
    const brickF = (lx, ly, lz) => {
        const c = ly >> 1, b = Math.floor((lx + lz + (c & 1) * 2) / 4), h = hash(b, c, 11);
        return h < 0.66 ? M.brick : (h < 0.97 ? M.brick2 : M.mortar);
    };
    /** Старая кладка: темнее, с закопчёнными пятнами. */
    const oldBrickF = (lx, ly, lz) => {
        const c = ly >> 1, b = Math.floor((lx + lz + (c & 1) * 2) / 4), h = hash(b, c, 23);
        return h < 0.3 ? M.brick2 : (h < 0.97 ? M.brick : M.mortar);
    };
    /** Бетон с неровными тёмными разводами. */
    const concF = (lx, ly, lz) => (vnoise(lx + ly * 0.7, lz - ly * 0.4, 7, 5) > 0.76 ? M.concrete2 : M.concrete);
    /** Доски: полосы по 2 вокселя вдоль оси a. */
    const boardsF = (a) => (((a >> 1) & 3) === 3 ? M.wood : M.plank);

    // ------------------------------------------------------------------ рельеф

    /** Валы по краям карты: ширина W, высота h0..h1 (шум), верх top, тело fill. */
    function edgeBerm(w, W, h0, h1, seed, top, fill) {
        const G = GB.GROUND;
        for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
            const d = Math.min(x, z, w.sx - 1 - x, w.sz - 1 - z);
            if (d >= W) continue;
            const t = 1 - d / W;
            const h = Math.round(t * t * (h0 + (h1 - h0) * vnoise(x, z, 41, seed)) + t * 4 * vnoise(x, z, 11, seed + 1));
            if (h <= 0) continue;
            if (h > 1) w.fill(x, G, z, x + 1, G + h - 1, z + 1, fill);
            w.put(x, G + h - 1, z, typeof top === 'function' ? top(x, z, h) : top);
        }
    }
    /** Покрасить верхний слой земли (y = GROUND − 1) функцией (x, z) => материал | −1. */
    function paintGround(w, x0, z0, x1, z1, f) {
        const y = GB.GROUND - 1;
        for (let z = Math.max(0, z0); z < Math.min(w.sz, z1); z++) for (let x = Math.max(0, x0); x < Math.min(w.sx, x1); x++) {
            const m = f(x, z);
            if (m > 0) w.put(x, y, z, m);
        }
    }

    // ------------------------------------------------------------------ общие предметы (тела)

    /** Поддон 12×2×10 (углом в x0, y0, z0): три бруска и настил. */
    function pallet(P, x0, y0, z0, W = 12, D = 10) {
        for (const dz of [0, (D >> 1) - 1, D - 1]) P.box(x0, y0, z0 + dz, x0 + W, y0 + 1, z0 + dz + 1, M.darkwood);
        P.box(x0, y0 + 1, z0, x0 + W, y0 + 2, z0 + D, (lx) => (((lx - x0) % 4) === 3 ? M.wood : M.plank));
    }
    /** Поддон кирпича (тело). h — высота кладки. */
    function brickPallet(P, x0, y0, z0, h = 8, mat) {
        pallet(P, x0, y0, z0);
        P.box(x0, y0 + 2, z0, x0 + 12, y0 + 2 + h, z0 + 10, mat || ((lx, ly, lz) => {
            const k = ly - y0 - 2;
            if (k === h - 1 && ((lx + lz) & 1)) return hash(lx, ly, lz) < 0.5 ? M.brick2 : M.brick;
            return ((lx - x0) % 3 === 2) || ((k & 1) === 1 && (lz - z0) % 5 === 4) ? M.brick2 : M.brick;
        }));
        P.dyn(x0, y0, z0, x0 + 12, y0 + 2 + h, z0 + 10);
    }
    /** Поддон мешков цемента (тело). */
    function bagPallet(P, x0, y0, z0, layers = 4) {
        pallet(P, x0, y0, z0);
        P.box(x0, y0 + 2, z0, x0 + 12, y0 + 2 + layers * 2, z0 + 10, (lx, ly, lz) => {
            const k = (ly - y0 - 2) >> 1, a = (k & 1) ? (lz - z0) : (lx - x0);
            return (((a / 4) | 0) + k) & 1 ? M.plaster : M.mortar;
        });
        P.dyn(x0, y0, z0, x0 + 12, y0 + 2 + layers * 2, z0 + 10);
    }
    /** Бочка 6×9×6 (тело): mat — корпус (взрывной barrel / ржавая), обручи, крышка, пробка. */
    function barrel(P, x0, y0, z0, mat) {
        const body = mat || M.barrel;
        P.cylY(x0 + 3, z0 + 3, y0, y0 + 9, 3.2, 0, (lx, ly, lz, d) => {
            const k = ly - y0;
            if (k === 0) return M.metal;
            if (k === 8) return d > 2.3 ? M.metal : body;
            if ((k === 2 || k === 6) && d > 2.3) return M.rust;
            return body;
        });
        P.put(x0 + 4, y0 + 9, z0 + 2, M.metal);
        P.dyn(x0, y0, z0, x0 + 6, y0 + 10, z0 + 6);
    }
    /** Газовый баллон Ø3 высотой h (тело): mat — корпус (barrel — пропан, oxygen — кислород). */
    function gasCylinder(P, x0, y0, z0, mat, h = 14) {
        P.box(x0, y0, z0, x0 + 3, y0 + h, z0 + 3, (lx, ly, lz) => {
            const k = ly - y0, corner = (lx === x0 || lx === x0 + 2) && (lz === z0 || lz === z0 + 2);
            if (k >= h - 2) return corner ? 0 : (k === h - 1 ? ((lx === x0 + 1 && lz === z0 + 1) ? M.metal : 0) : mat);
            if (k === 0 && corner) return 0;
            return k === h - 4 ? M.paint : mat;
        });
        P.dyn(x0, y0, z0, x0 + 3, y0 + h, z0 + 3);
    }
    /** Ящик s×sy×s (тело): доски и тёмные рёбра. */
    function crate(P, x0, y0, z0, s, sy, mat) {
        sy = sy || s;
        const face = mat || M.crate;
        P.body(x0, y0, z0, x0 + s, y0 + sy, z0 + s, (lx, ly, lz) => {
            const ex = lx === x0 || lx === x0 + s - 1, ey = ly === y0 || ly === y0 + sy - 1, ez = lz === z0 || lz === z0 + s - 1;
            const e = (ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0);
            if (e >= 2) return M.darkwood;
            if (e === 0) return -1;
            return ((ly - y0) % 4 === 3) ? M.wood : face;
        });
    }
    /** Катушка кабеля: щёки Ø(2r), ось по z, ширина L (тело). */
    function cableDrum(P, x0, y0, z0, r = 7, L = 8) {
        const cx = x0 + r, cy = y0 + r;
        P.cylZ(cx, cy, z0, z0 + 1, r, 0, M.darkwood);
        P.cylZ(cx, cy, z0 + L - 1, z0 + L, r, 0, M.darkwood);
        P.cylZ(cx, cy, z0 + 1, z0 + L - 1, r - 1.6, 0, (lx, ly, lz, d) => (d < 2 ? M.plank : M.rubber));
        P.dyn(x0, y0, z0, x0 + 2 * r, y0 + 2 * r, z0 + L);
    }
    /** Тачка (тело): корыто, колесо, ручки. Вдоль x, колесо спереди (+x). */
    function wheelbarrow(P, x0, y0, z0, tray) {
        P.cylZ(x0 + 14, y0 + 2.5, z0 + 3, z0 + 5, 2.6, 0, M.rubber);
        P.box(x0 + 1, y0, z0 + 1, x0 + 3, y0 + 3, z0 + 2, M.metal); P.box(x0 + 1, y0, z0 + 6, x0 + 3, y0 + 3, z0 + 7, M.metal);
        P.box(x0, y0 + 3, z0 + 1, x0 + 15, y0 + 4, z0 + 2, M.darkwood); P.box(x0, y0 + 3, z0 + 6, x0 + 15, y0 + 4, z0 + 7, M.darkwood);
        P.box(x0 + 4, y0 + 4, z0 + 1, x0 + 13, y0 + 9, z0 + 7, (lx, ly, lz) => {
            const k = ly - y0 - 4, i = lx - x0 - 4;
            const inside = i > 0 && i < 8 - (k > 2 ? 0 : 0) && lz > z0 + 1 && lz < z0 + 6 && k > 0;
            return inside ? (k <= 2 ? M.concrete2 : 0) : (tray || M.steelg);
        });
        P.dyn(x0, y0, z0, x0 + 17, y0 + 9, z0 + 8);
    }

    // ------------------------------------------------------------------ строители
    /** @type {Record<string, (w: VoxWorld, x: number, z: number, rot: number, mk: any) => void>} */
    const B = {};

    // ================================================================== СТРОЙКА (construction)
    // Каркас 5 этажей (24 × 14 м), леса по двум фасадам, башенный кран с грузом на тросе, котлован,
    // склад материалов, бытовки, бетоновоз, забор. Земля — утоптанная грязь, щебёночные дороги.

    B['construction-terrain'] = function (w) {
        paintGround(w, 0, 0, w.sx, w.sz, (x, z) => {
            const inside = x >= 42 && x < 470 && z >= 42 && z < 470;
            const n = vnoise(x, z, 19, 31), n2 = vnoise(x, z, 6, 32);
            if (!inside) return n2 < 0.22 ? M.dirt : -1;
            const road = (x >= 228 && x < 288 && z >= 248) || (z >= 262 && z < 300 && x >= 110 && x < 398);
            const n3 = vnoise(x, z, 14, 35);
            if (road) {
                const rut = (x >= 228 && x < 288) ? ((x - 228) % 30 >= 7 && (x - 228) % 30 < 11) : ((z - 262) % 19 >= 4 && (z - 262) % 19 < 7);
                if (rut && n2 < 0.72) return n > 0.6 ? M.murk : M.mud;
                return n3 < 0.22 ? M.dirt : M.gravel;
            }
            if (n > 0.83) return M.murk;
            if (n > 0.72) return M.mud;
            return n3 < 0.2 ? M.gravel : (n3 > 0.85 && n2 > 0.5 ? M.sand : M.dirt);
        });
        // под лужами — грязь
        for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) if (w.get(x, GB.GROUND - 1, z) === M.murk) w.put(x, GB.GROUND - 2, z, M.mud);
        // отвалы грунта по краям
        edgeBerm(w, 36, 8, 26, 33, (x, z, h) => (h > 14 && vnoise(x, z, 8, 34) < 0.5 ? M.dirt : M.grass), M.dirt);
    };

    /** Забор: с юга — глухой профнастил с воротами, с остальных сторон — сетчатые секции на бетонных блоках. */
    B['construction-fence'] = function (w) {
        const P = new Plot(w, 0, 0, 0);
        const A = 40, Z = 471, H = 20;
        // сетка: секции по 34, рама — труба, сетка через воксель-два
        const mesh = (along, fixed, a0, a1) => {
            for (let a = a0; a < a1; a++) {
                const s = (a - a0) % 34;
                for (let ly = 0; ly < H; ly++) {
                    const frame = s === 0 || s === 33 || ly === 2 || ly === H - 1;
                    const m = frame ? M.scaffold : ((s % 3 === 0 || ly % 3 === 2) && ly > 2 ? M.metal : 0);
                    if (ly < 2) { if (s === 0 || s === 33) { if (along === 'x') P.put(a, ly, fixed, M.scaffold); else P.put(fixed, ly, a, M.scaffold); } continue; }
                    if (m) { if (along === 'x') P.put(a, ly, fixed, m); else P.put(fixed, ly, a, m); }
                }
                if (s === 0 || s === 33) {
                    // бетонная «нога»
                    if (along === 'x') P.box(a - 1, 0, fixed - 3, a + 2, 2, fixed + 4, M.concrete2); else P.box(fixed - 3, 0, a - 1, fixed + 4, 2, a + 2, M.concrete2);
                }
            }
        };
        mesh('x', A, A, Z + 1);
        mesh('z', A, A + 1, Z);
        mesh('z', Z, A + 1, Z);
        // юг: профнастил на стойках, ворота x 222..294
        for (let x = A; x <= Z; x++) {
            if (x >= 222 && x < 294) continue;
            const post = (x - A) % 30 === 0;
            P.box(x, 0, Z, x + 1, H + 2, Z + 1, post ? M.darkwood : -1);
            if (!post) P.box(x, 1, Z, x + 1, H, Z + 1, (x % 4 < 2) ? M.corrugated2 : M.steelg);
            if (post) P.line(x, 0, Z - 7, x, 13, Z - 1, M.darkwood);
        }
        // стойки ворот и открытые внутрь створки (сетка)
        for (const gx of [220, 294]) P.box(gx, 0, Z - 1, gx + 2, 26, Z + 2, M.metal);
        for (const gx of [222, 293]) {
            for (let s = 0; s < 34; s++) for (let ly = 1; ly < 22; ly++) {
                const frame = s === 0 || s === 33 || ly === 1 || ly === 21;
                if (frame || s % 3 === 0 || ly % 3 === 0) P.put(gx, ly, Z - 1 - s, frame ? M.scaffold : M.metal);
            }
        }
        // щит стройки у ворот
        P.box(300, 0, Z - 3, 302, 30, Z - 2, M.darkwood); P.box(330, 0, Z - 3, 332, 30, Z - 2, M.darkwood);
        P.box(298, 16, Z - 4, 334, 32, Z - 3, (lx, ly) => (ly === 16 || ly === 31 || lx === 298 || lx === 333 ? M.paint : (ly > 26 ? M.ctr_orange : (ly % 3 === 0 && lx > 301 && lx < 330 ? M.paint : M.blue))));
    };

    /** Каркас: колонны 40×40 см, плиты 20 см с балками, лестница, частичное кирпичное заполнение, верх в арматуре. */
    B['construction-frame'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -120, X1 = 120, Z0 = -70, Z1 = 70, SH = 28;
        const colX = [-120, -60, 0, 60, 116], colZ = [-70, -2, 66];
        const ST = [-108, -72, 8, 36];                 // проём лестницы x0, x1, z0, z1
        // плита пола 1-го этажа
        P.box(X0, 0, Z0, X1, 2, Z1, concF);
        for (let k = 1; k <= 4; k++) {
            const y = k * SH;
            P.box(X0, y, Z0, X1, y + 2, Z1, concF);
            P.box(ST[0], y, ST[2], ST[1], y + 2, ST[3], 0);
            for (const cz of colZ) P.box(X0, y - 3, cz, X1, y, cz + 4, M.concrete);
            for (const cx of colX) P.box(cx, y - 3, Z0, cx + 4, y, Z1, M.concrete);
        }
        for (let k = 0; k < 4; k++) for (const cx of colX) for (const cz of colZ) P.box(cx, k * SH + 2, cz, cx + 4, (k + 1) * SH - 3, cz + 4, M.concrete2);
        // 5-й этаж: колонны частью, выпуски арматуры, опалубка и недолитая плита
        const T = 4 * SH + 2;                           // 114 — верх 4-го перекрытия
        const bars = (cx, cz, y0, h) => { for (const [ox, oz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) P.box(cx + ox, y0, cz + oz, cx + ox + 1, y0 + h, cz + oz + 1, M.rebar); };
        for (const cx of [-120, -60, 0, 60]) for (const cz of colZ) P.box(cx, T, cz, cx + 4, T + 26, cz + 4, M.concrete2);
        for (const cz of colZ) { bars(116, cz, T, 13); bars(-120, cz, T + 26, 9); bars(-60, cz, T + 26, 9); }
        bars(0, 66, T + 26, 9); bars(60, 66, T + 26, 9); bars(0, -2, T + 29, 6); bars(60, -2, T + 29, 6);
        // пролёт x 0..64, z -70..2: балки, щиты опалубки, бетон на половине, сетка арматуры на другой
        P.box(0, T + 23, -70, 64, T + 26, -66, M.concrete); P.box(0, T + 23, -2, 64, T + 26, 2, M.concrete);
        P.box(0, T + 23, -66, 4, T + 26, -2, M.concrete); P.box(60, T + 23, -66, 64, T + 26, -2, M.concrete);
        P.box(4, T + 25, -66, 60, T + 26, -2, (lx, ly, lz) => (((lz + 70) % 12) === 0 ? M.darkwood : M.plank));
        P.box(0, T + 26, -70, 30, T + 28, 2, concF);
        P.box(30, T + 26, -70, 64, T + 27, 2, (lx, ly, lz) => ((lx % 4 === 0 || (lz + 70) % 4 === 0) ? M.rebar : -1));
        for (let px = 8; px < 58; px += 10) for (let pz = -62; pz < -4; pz += 10) {
            P.box(px, T, pz, px + 1, T + 25, pz + 1, M.scaffold);
            P.box(px - 1, T, pz - 1, px + 2, T + 1, pz + 2, M.metal);
        }
        // лестница: два марша по 7 ступеней и площадка на каждом этаже
        for (let k = 0; k < 4; k++) {
            const f = k * SH + 2;
            for (let i = 0; i < 7; i++) { const top = f + 2 * (i + 1); P.box(-108 + 3 * i, Math.max(f, top - 4), 8, -105 + 3 * i, top, 20, M.concrete); }
            P.box(-87, f + 11, 8, -72, f + 14, 36, M.concrete);
            for (let i = 0; i < 7; i++) { const top = f + 16 + 2 * i, xa = -90 - 3 * i; P.box(xa, top - 4, 24, xa + 3, top, 36, M.concrete); }
            // перила марша (трубка)
            for (let i = 0; i < 7; i++) P.box(-108 + 3 * i, f + 2 * (i + 1), 21, -105 + 3 * i, f + 2 * (i + 1) + 9, 22, (lx, ly) => (ly === f + 2 * (i + 1) + 8 || lx % 6 === 0 ? M.scaffold : -1));
        }
        // ограждение проёма лестницы наверху
        P.box(ST[0], T, ST[2] - 1, ST[1], T + 10, ST[2], (lx, ly) => ((ly - T) % 5 === 4 || lx % 8 === 0 ? M.plank : -1));
        P.box(ST[1], T, ST[2], ST[1] + 1, T + 10, ST[3], (lx, ly, lz) => ((ly - T) % 5 === 4 || lz % 8 === 0 ? M.plank : -1));

        // кирпичное заполнение: стороны n, s (вдоль x), w, e (вдоль z); проёмы окон и дверей
        const bays = [[-116, -60], [-56, 0], [4, 60], [64, 116]], baysZ = [[-66, -2], [2, 66]];
        /** @param {string} side @param {number} a0 @param {number} a1 @param {number} k @param {any} o */
        const infill = (side, a0, a1, k, o) => {
            const y0 = k * SH + 2, y1 = (k + 1) * SH - 3;
            const L = a1 - a0;
            const holes = o.holes || [[8, 22, 9, 22], [L - 22, L - 8, 9, 22]];
            const f = (lx, ly, lz) => {
                const a = (side === 'n' || side === 's') ? lx : lz;
                const t = side === 'n' ? lz + 69 : side === 's' ? 68 - lz : side === 'w' ? lx + 119 : 118 - lx;   // 0 — наружный слой
                const u = a - a0, hy = ly - y0;
                if (o.ragged != null) {
                    const cap = o.ragged + Math.floor(u / 4) * 2 * (o.dir || 1) + (o.dir === -1 ? 30 : 0);
                    if (hy >= Math.max(0, cap)) return -1;
                }
                for (const hl of holes) {
                    if (u >= hl[0] && u < hl[1] && hy >= hl[2] && hy < hl[3]) {
                        if (t !== 1 || hl[4] === 'open') return 0;
                        const edge = u === hl[0] || u === hl[1] - 1 || hy === hl[2] || hy === hl[3] - 1 || u === ((hl[0] + hl[1]) >> 1);
                        if (hl[4] === 'door') return edge && hy < hl[3] ? (u === hl[0] || u === hl[1] - 1 || hy === hl[3] - 1 ? M.darkwood : 0) : 0;
                        return o.glass ? (edge ? M.paint : M.glass) : 0;
                    }
                    if (u >= hl[0] - 1 && u < hl[1] + 1 && hy === hl[2] - 1 && hl[4] !== 'door' && hl[4] !== 'open') return t === 0 ? M.concrete : M.mortar;
                    if (u >= hl[0] - 2 && u < hl[1] + 2 && hy === hl[3] && hl[4] !== 'open') return M.concrete2;
                }
                return brickF(lx, ly, lz);
            };
            if (side === 'n') P.box(a0, y0, -69, a1, y1, -66, f);
            else if (side === 's') P.box(a0, y0, 66, a1, y1, 69, f);
            else if (side === 'w') P.box(-119, y0, a0, -116, y1, a1, f);
            else P.box(116, y0, a0, 119, y1, a1, f);
        };
        // 1-й этаж — почти весь
        for (const [a0, a1] of bays) infill('n', a0, a1, 0, { glass: true });
        infill('s', bays[0][0], bays[0][1], 0, { glass: true });
        infill('s', bays[1][0], bays[1][1], 0, { holes: [[6, 16, 0, 21, 'door'], [28, 48, 9, 22]], glass: true });
        infill('s', bays[2][0], bays[2][1], 0, { holes: [[8, 48, 0, 22, 'open']] });
        infill('s', bays[3][0], bays[3][1], 0, {});
        for (const [a0, a1] of baysZ) { infill('w', a0, a1, 0, { glass: true }); infill('e', a0, a1, 0, {}); }
        // 2-й этаж — север, запад, восток частично
        infill('n', bays[0][0], bays[0][1], 1, { glass: true }); infill('n', bays[1][0], bays[1][1], 1, { glass: true });
        infill('n', bays[2][0], bays[2][1], 1, {}); infill('n', bays[3][0], bays[3][1], 1, {});
        infill('w', baysZ[0][0], baysZ[0][1], 1, {}); infill('w', baysZ[1][0], baysZ[1][1], 1, { ragged: 4 });
        infill('e', baysZ[1][0], baysZ[1][1], 1, {});
        // 3-й этаж — кладка в работе: уступами
        infill('n', bays[0][0], bays[0][1], 2, {}); infill('n', bays[1][0], bays[1][1], 2, { ragged: 10 });
        infill('n', bays[2][0], bays[2][1], 2, { ragged: 2 }); infill('w', baysZ[0][0], baysZ[0][1], 2, { ragged: 6 });
        // перегородки из гипсовых блоков
        P.box(28, 2, -66, 30, 25, 66, (lx, ly, lz) => ((lz > -50 && lz < -40) || (lz > 20 && lz < 30)) && ly < 23 ? 0 : M.plaster);
        P.box(-56, 30, 24, 116, 53, 26, (lx, ly) => ((lx > -30 && lx < -20) || (lx > 70 && lx < 80)) && ly < 51 ? 0 : (ly < 44 || lx < 40 ? M.plaster : -1));
        // ограждения по краю перекрытий 4 и 5 (север, запад)
        for (const k of [3, 4]) {
            const f = k * SH + 2;
            P.box(X0 + 1, f, Z0 + 1, X1 - 1, f + 11, Z0 + 2, (lx, ly) => (k === 3 && lx >= 17 && lx < 47) ? -1 : (((lx - X0) % 16 === 0) || ly === f + 5 || ly === f + 10 ? M.plank : -1));
            P.box(X0 + 1, f, Z0 + 2, X0 + 2, f + 11, Z1 - 1, (lx, ly, lz) => (((lz - Z0) % 16 === 0) || ly === f + 5 || ly === f + 10 ? M.plank : -1));
        }
        // консольная приёмная площадка на 4-м перекрытии (север): держится на двух кронштейнах
        const PY = 3 * SH;                              // 84..86 — плита
        P.box(18, PY, -94, 46, PY + 2, -72, (lx, ly, lz) => (ly === PY ? M.metal : ((lx + lz) % 3 === 0 ? M.metal : M.scaffold)));
        P.box(18, PY + 2, -94, 46, PY + 12, -93, (lx, ly) => (ly === PY + 6 || ly === PY + 11 || lx % 7 === 4 ? M.hazard : -1));
        P.box(18, PY + 2, -93, 19, PY + 12, -72, (lx, ly, lz) => (ly === PY + 6 || ly === PY + 11 || lz % 7 === 0 ? M.hazard : -1));
        P.box(45, PY + 2, -93, 46, PY + 12, -72, (lx, ly, lz) => (ly === PY + 6 || ly === PY + 11 || lz % 7 === 0 ? M.hazard : -1));
        for (const bx of [21, 41]) P.box(bx, PY, -72, bx + 2, PY + 2, -70, M.rebar);
        brickPallet(P, 26, PY + 2, -88, 8);

        // материалы на этажах (тела)
        brickPallet(P, -40, 2, 40, 8); brickPallet(P, -26, 2, 40, 6); bagPallet(P, 70, 2, 40, 4);
        cableDrum(P, 40, 2, -40, 7, 8); wheelbarrow(P, 80, 2, -20);
        brickPallet(P, -10, 30, 48, 8); bagPallet(P, 10, 30, 48, 5); brickPallet(P, 90, 30, 50, 6);
        brickPallet(P, -50, 58, 50, 8); brickPallet(P, -36, 58, 50, 8); bagPallet(P, 30, 58, 46, 3);
        brickPallet(P, 70, 86, 40, 8); P.body(-40, 86, 30, -10, 89, 34, M.rebar);
        brickPallet(P, -100, 114, -50, 6, (lx, ly, lz) => ((lx + ly) % 4 === 0 ? M.concrete : M.concrete2));
        // строительный мусор у колонн 1-го этажа
        for (const [bx, bz] of [[-56, -60], [4, -64], [62, 4], [-58, 56], [100, -50], [-20, 6]]) {
            for (let i = 0; i < 7; i++) {
                const ox = Math.floor(hash(bx, i, bz) * 6), oz = Math.floor(hash(bz, i, bx) * 6);
                P.box(bx + ox, 2, bz + oz, bx + ox + 2, 3 + (i & 1), bz + oz + 2, i % 3 ? M.brick2 : M.concrete2);
            }
        }
    };

    /** Леса вдоль южного и восточного фасадов каркаса (тот же маркер, что и каркас): стойки, настилы, связи. */
    B['construction-scaffold'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const decks = [30, 58, 86, 114], TOP = 126;
        /**
         * Пролёт лесов вдоль оси: S(a0, y0, b0, a1, y1, b1, v) ставит ящик в координатах (a — вдоль фасада, b — от стены).
         * @param {(a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, v: any) => void} S
         */
        const run = (S, posts, inner, outer, aFrom, aTo, ties, braceSign) => {
            for (const a of posts) {
                for (const b of [inner, outer]) {
                    S(a - 1, 0, b - 1, a + 2, 1, b + 2, M.darkwood);
                    S(a, 1, b, a + 1, TOP, b + 1, M.scaffold);
                }
            }
            for (const d of decks) {
                for (const a of posts) S(a, d - 2, inner - 1, a + 1, d - 1, outer + 2, M.scaffold);
                S(aFrom, d - 2, inner, aTo, d - 1, inner + 1, M.scaffold);
                S(aFrom, d - 2, outer, aTo, d - 1, outer + 1, M.scaffold);
                S(aFrom, d - 1, inner - 1, aTo, d, outer + 2, (la, ly, lb) => boardsF(Math.abs(lb)));
                S(aFrom, d, outer + 1, aTo, d + 2, outer + 2, M.wood);
                S(aFrom, d + 5, outer, aTo, d + 6, outer + 1, M.scaffold);
                S(aFrom, d + 10, outer, aTo, d + 11, outer + 1, M.scaffold);
                S(aFrom, d - 16, inner, aTo, d - 15, inner + 1, M.scaffold);
            }
            // диагональные связи по наружной стороне через пролёт
            const lv = [1, ...decks.map(d => d - 2)];
            for (let i = 0; i + 1 < posts.length; i += 2) {
                for (let j = 0; j + 1 < lv.length; j++) {
                    const up = ((i >> 1) + j) & 1;
                    const ya = up ? lv[j] : lv[j + 1], yb = up ? lv[j + 1] : lv[j];
                    const a0 = posts[i], a1 = posts[i + 1];
                    // отрезок в плоскости b = outer
                    const n = Math.abs(a1 - a0) + Math.abs(yb - ya);
                    let pa = a0, py = ya;
                    S(pa, py, outer, pa + 1, py + 1, outer + 1, M.scaffold);
                    for (let s = 1; s <= n; s++) {
                        const qa = Math.round(a0 + (a1 - a0) * s / n), qy = Math.round(ya + (yb - ya) * s / n);
                        while (pa !== qa || py !== qy) {
                            if (py !== qy) py += Math.sign(qy - py); else pa += Math.sign(qa - pa);
                            S(pa, py, outer, pa + 1, py + 1, outer + 1, M.scaffold);
                        }
                    }
                }
            }
            // анкеры к перекрытиям (тонкие: их можно перебить)
            for (const a of ties) for (const d of [58, 86]) S(a, d - 2, inner - 3, a + 1, d - 1, inner, M.scaffold);
        };
        const postsS = []; for (let a = -122; a <= 118; a += 20) postsS.push(a);
        run((a0, y0, b0, a1, y1, b1, v) => P.box(a0, y0, b0, a1, y1, b1, v), postsS, 72, 84, -123, 136, [-82, 18, 98], 1);
        const postsE = []; for (let a = -72; a <= 68; a += 20) postsE.push(a);
        postsE.push(84);
        run((a0, y0, b0, a1, y1, b1, v) => P.box(b0, y0, a0, b1, y1, a1, typeof v === 'function' ? (lx, ly, lz) => v(lz, ly, lx) : v), postsE, 122, 134, -73, 71, [-40, 40], 1);
        // кирпич на настиле для каменщика
        brickPallet(P, -60, 58, 73, 6); brickPallet(P, 40, 86, 73, 5); bagPallet(P, 122, 30, -28, 3);
    };

    /** Башенный кран: решётчатая мачта 16×16, стрела 25 м на запад, противовесы, кабина, груз на тросах. */
    B['construction-crane'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const Y = M.hazard, TOP = 148, JY = TOP + 4, JX = -262;
        // фундамент с анкерами
        P.box(-20, -6, -20, 20, 6, 20, concF);
        for (const [cx, cz] of [[-9, -9], [6, -9], [-9, 6], [6, 6]]) P.box(cx, 6, cz, cx + 3, 7, cz + 3, M.metal);
        // мачта
        for (const [cx, cz] of [[-8, -8], [6, -8], [-8, 6], [6, 6]]) P.box(cx, 6, cz, cx + 2, TOP, cz + 2, Y);
        for (let y = 6; y < TOP; y += 16) {
            P.box(-8, y, -8, 8, y + 1, -7, Y); P.box(-8, y, 7, 8, y + 1, 8, Y);
            P.box(-8, y, -8, -7, y + 1, 8, Y); P.box(7, y, -8, 8, y + 1, 8, Y);
            const y1 = Math.min(TOP - 1, y + 16), fl = ((y - 6) >> 4) & 1;
            P.line(fl ? -7 : 6, y, -8, fl ? 6 : -7, y1, -8, Y);
            P.line(fl ? 6 : -7, y, 7, fl ? -7 : 6, y1, 7, Y);
            P.line(-8, y, fl ? 6 : -7, -8, y1, fl ? -7 : 6, Y);
            P.line(7, y, fl ? -7 : 6, 7, y1, fl ? 6 : -7, Y);
            P.box(-4, y + 1, -6, 4, y + 2, -5, M.metal);       // площадка-ступень лестницы внутри
        }
        for (let y = 7; y < TOP; y += 3) P.box(-3, y, -7, 3, y + 1, -6, M.metal);   // перекладины лестницы
        P.box(-3, 6, -7, -2, TOP, -6, M.metal); P.box(2, 6, -7, 3, TOP, -6, M.metal);
        // поворотная платформа
        P.box(-10, TOP, -10, 10, TOP + 2, 10, M.metal);
        P.cylY(0, 0, TOP + 2, JY, 8.5, 0, Y);
        // стрела: два нижних пояса, верхний, раскосы
        P.box(JX, JY, -7, -6, JY + 2, -5, Y); P.box(JX, JY, 5, -6, JY + 2, 7, Y);
        P.box(JX + 4, JY + 12, -1, 12, JY + 14, 1, Y);
        for (let a = -6; a - 12 >= JX; a -= 12) {
            const b = a - 12;
            P.line(a, JY + 1, -6, a - 6, JY + 12, 0, Y); P.line(a - 6, JY + 12, 0, b, JY + 1, -6, Y);
            P.line(a, JY + 1, 6, a - 6, JY + 12, 0, Y); P.line(a - 6, JY + 12, 0, b, JY + 1, 6, Y);
            P.box(a - 1, JY, -6, a, JY + 1, 6, Y);
        }
        P.box(JX - 2, JY, -7, JX, JY + 6, 7, Y);
        P.line(JX, JY + 5, 0, JX + 4, JY + 12, 0, Y);
        // корень стрелы над платформой
        P.box(-8, JY, -7, 8, JY + 2, 7, Y);
        P.line(-6, JY + 1, -6, 0, JY + 12, 0, Y); P.line(-6, JY + 1, 6, 0, JY + 12, 0, Y);
        // противовесная консоль
        P.box(8, JY, -7, 66, JY + 2, -5, Y); P.box(8, JY, 5, 66, JY + 2, 7, Y);
        P.box(8, JY, -5, 66, JY + 1, 5, (lx, ly, lz) => ((lx + lz) & 1 ? M.metal : M.scaffold));
        for (const zz of [-7, 6]) P.box(8, JY + 2, zz, 66, JY + 10, zz + 1, (lx, ly) => (lx % 8 === 0 || ly === JY + 5 || ly === JY + 9 ? Y : -1));
        P.line(12, JY + 13, 0, 64, JY + 2, 0, Y);
        for (let i = 0; i < 3; i++) P.box(44 + i * 7, JY - 18, -8, 50 + i * 7, JY, 8, (lx, ly, lz) => (ly === JY - 18 || (lz + 8) % 15 === 0 ? M.concrete2 : M.concrete));
        P.box(44, JY - 2, -8, 65, JY, 8, M.concrete2);
        P.box(22, JY + 1, -5, 36, JY + 8, 5, M.metal);
        P.cylZ(29, JY + 4.5, -5, 5, 3.4, 0, (lx, ly, lz, d) => (d > 2.4 ? M.cable : M.rust));
        P.box(37, JY + 1, -4, 42, JY + 6, 4, M.blue);
        // кабина машиниста
        P.box(-18, TOP - 10, 8, -5, JY, 20, (lx, ly, lz) => {
            const ex = lx === -18 || lx === -6, ez = lz === 8 || lz === 19, ey = ly === TOP - 10 || ly === JY - 1;
            if (!ex && !ez && !ey) return ly === TOP - 9 && lx < -10 ? M.metal : (lx === -16 && ly < TOP - 5 && lz > 11 && lz < 16 ? M.darkwood : -1);
            const win = ly > TOP - 8 && ly < JY - 2 && !((ex && ez));
            return win && (lx === -18 || lz === 19 || (ez && lx < -7)) ? M.glass : Y;
        });
        P.box(-6, TOP - 10, 8, -4, TOP - 8, 10, Y);
        // тележка, тросы, крюк и пачка балок
        const TX = -160;
        P.box(TX, JY - 3, -6, TX + 14, JY, 6, M.metal);
        for (const tx of [TX + 1, TX + 11]) for (const tz of [-6, 5]) P.box(tx, JY - 1, tz, tx + 2, JY + 2, tz + 1, M.rust);
        P.box(TX + 2, JY - 4, -2, TX + 12, JY - 3, 2, Y);
        for (const cx of [TX + 3, TX + 10]) P.box(cx, 92, 0, cx + 1, JY - 4, 1, M.cable);
        P.box(TX + 1, 84, -3, TX + 13, 92, 4, (lx, ly) => (ly === 84 || ly === 91 ? M.metal : Y));
        P.box(TX + 6, 77, 0, TX + 8, 84, 1, M.metal); P.box(TX + 5, 76, 0, TX + 9, 77, 1, M.metal);
        P.line(TX + 6, 76, 0, TX - 18, 66, 0, M.cable); P.line(TX + 8, 76, 0, TX + 30, 66, 0, M.cable);
        P.box(TX - 22, 58, -4, TX + 34, 66, 5, (lx, ly, lz) => {
            const r = (ly - 58) & 3, c = ((lz + 4) % 3);
            if (r === 1 || r === 2) return c === 1 ? M.rust : 0;
            return M.rust;
        });
        // бочки и баллоны у основания мачты
        barrel(P, 9, 6, -9); barrel(P, 9, 6, -2); barrel(P, 15, 6, -9);
        gasCylinder(P, 10, 6, 6, M.barrel); gasCylinder(P, 14, 6, 6, M.oxygen);
        // ограждение основания
        P.box(-24, 0, -24, 24, 10, 24, (lx, ly, lz) => {
            const ex = lx === -24 || lx === 23, ez = lz === -24 || lz === 23;
            if (!ex && !ez) return -1;
            const a = ex ? lz : lx;
            if (ez && lz === 23 && lx > -6 && lx < 6) return -1;            // калитка
            if ((a + 24) % 12 === 0 || a === 23) return M.metal;
            return (ly === 9 || ly === 5) ? (((a + 24) >> 2) & 1 ? M.hazard : M.paint) : -1;
        });
    };

    /** Котлован под следующий корпус: шпунт, бетонная подготовка, фундаменты с выпусками, лужа, пандус. */
    B['construction-pit'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -30, X1 = 30, Z0 = -70, Z1 = 70, D = -15;
        P.box(X0, D, Z0, X1, 0, Z1, 0);
        P.box(X0, D - 1, Z0, X1, D, Z1, (lx, ly, lz) => (vnoise(lx + 200, lz, 9, 41) > 0.7 ? M.murk : M.concrete2));
        P.box(X0, D - 2, Z0, X1, D - 1, Z1, M.mud);
        // пандус с юга
        for (let lz = 26; lz < Z1; lz++) {
            const h = D + Math.round((lz - 26) * (-D) / (Z1 - 26));
            P.box(X0 + 8, D, lz, X1, h, lz + 1, M.dirt);
            P.box(X0 + 8, h - 1, lz, X1, h, lz + 1, (lx) => (vnoise(lx, lz, 6, 42) < 0.35 ? M.mud : M.gravel));
        }
        // шпунтовое ограждение по трём сторонам: «гофра» шагом 3 (лист то в стене, то на виду)
        const zig = (a) => (Math.floor(a / 3) & 1);
        for (let lx = X0 - 1; lx < X1 + 1; lx++) for (let ly = D; ly < 5; ly++) P.put(lx, ly, Z0 - 1 + zig(lx), M.rust);
        for (let lz = Z0 - 1; lz < Z1; lz++) for (let ly = D; ly < 5; ly++) { P.put(X0 - 1 + zig(lz), ly, lz, M.rust); P.put(X1 - zig(lz), ly, lz, M.rust); }
        P.box(X0 - 2, 5, Z0 - 2, X1 + 2, 7, Z0 + 1, M.steelg); P.box(X0 - 2, 5, Z0 + 1, X0 + 1, 7, Z1, M.steelg); P.box(X1 - 1, 5, Z0 + 1, X1 + 2, 7, Z1, M.steelg);
        // распорки
        for (const lz of [-40, 0]) P.box(X0, -4, lz, X1, -2, lz + 2, M.rust);
        // фундаменты: подушки с выпусками и опалубкой
        for (const fx of [-22, 4]) for (const fz of [-58, -28, 2]) {
            P.box(fx, D, fz, fx + 14, D + 6, fz + 14, concF);
            for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i === 0 || i === 3 || j === 0 || j === 3) P.box(fx + 3 + i * 2 + (i > 1 ? 1 : 0), D + 6, fz + 3 + j * 2 + (j > 1 ? 1 : 0), fx + 4 + i * 2 + (i > 1 ? 1 : 0), D + 18, fz + 4 + j * 2 + (j > 1 ? 1 : 0), M.rebar);
        }
        P.walls(4, D + 6, 2, 18, D + 14, 16, 1, M.plank);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i === 0 || i === 3 || j === 0 || j === 3) P.box(4 + 3 + i * 2 + (i > 1 ? 1 : 0), D + 6, 2 + 3 + j * 2 + (j > 1 ? 1 : 0), 4 + 4 + i * 2 + (i > 1 ? 1 : 0), D + 18, 2 + 4 + j * 2 + (j > 1 ? 1 : 0), M.rebar);
        // сетки арматуры (тела) и штабель щитов опалубки
        P.body(-24, D, 24, 0, D + 1, 40, (lx, ly, lz) => (lx % 3 === 0 || lz % 3 === 0 ? M.rebar : 0));
        P.body(-24, D + 1, 24, 0, D + 2, 40, (lx, ly, lz) => ((lx + 1) % 3 === 0 || (lz + 1) % 3 === 0 ? M.rebar : 0));
        for (let i = 0; i < 4; i++) P.body(-26, D + i * 2, -10 - i, -6, D + i * 2 + 2, 0 - i, (lx, ly, lz) => (ly === D + i * 2 ? M.darkwood : boardsF(lx)));
        barrel(P, 20, D, -66, M.rust); barrel(P, 20, D, -50, M.barrel);
    };

    /** Экскаватор у котлована: гусеницы, поворотная часть, кабина, стрела с ковшом (вдоль +x). */
    B['construction-excavator'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        for (const tz of [-12, 6]) {
            P.box(-17, 1, tz, 17, 6, tz + 6, (lx, ly) => ((lx & 1) && (ly === 1 || ly === 5) ? M.metal : M.rubber));
            P.box(-15, 0, tz, 15, 1, tz + 6, M.rubber);
            const oz = tz < 0 ? tz - 1 : tz + 6;
            for (let r = -12; r <= 12; r += 6) P.cylZ(r + 0.5, 3.5, oz, oz + 1, 2, 0, M.hazard);
        }
        P.box(-8, 2, -6, 8, 6, 6, M.metal);
        P.cylY(0, 0, 6, 8, 9, 0, M.metal);
        P.box(-15, 8, -11, 12, 16, 11, (lx, ly, lz) => {
            if (lx < -11) return M.metal;                                           // противовес
            if (lz === 10 && ly > 9 && ly < 15 && lx < 0 && (lx & 1)) return M.metal; // жалюзи
            return M.hazard;
        });
        P.box(-15, 16, -1, 0, 20, 11, (lx, ly, lz) => (ly === 19 && (lx + lz) % 4 === 0 ? M.rust : M.hazard));
        P.box(-4, 20, 6, -1, 26, 8, M.metal);
        P.box(0, 16, -11, 12, 32, -1, (lx, ly, lz) => {
            const ex = lx === 0 || lx === 11, ez = lz === -11 || lz === -2, ey = ly === 31 || ly === 16;
            if (!ex && !ez && !ey) return ly === 20 && lx < 5 ? M.darkwood : 0;
            if (ey) return M.hazard;
            if (ly > 19 && ly < 30 && !(ex && ez)) return M.glass;
            return M.hazard;
        });
        // стрела и рукоять
        P.line(10, 14, 2, 34, 38, 2, M.hazard, 3);
        P.line(34, 38, 2, 52, 4, 2, M.hazard, 3);
        P.line(12, 12, 5, 30, 32, 5, M.metal, 1); P.line(36, 36, 5, 47, 16, 5, M.metal, 1);
        P.box(48, -6, 0, 58, 7, 7, (lx, ly, lz) => {
            if (lx > 49 && lz > 0 && lz < 6 && ly > -5 && ly < 2) return 0;          // полость ковша (открыта к +x)
            if (ly === -6) return lx % 2 === 0 ? M.metal : -1;                      // зубья
            return M.rust;
        });
    };

    /** Площадка складирования: поддоны кирпича, мешки, бетонные кольца, трубы на прокладках, доски, арматура, кучи. */
    B['construction-yard'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        // поддоны кирпича в два яруса
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
            brickPallet(P, -76 + i * 14, 0, -66 + j * 12, 8);
            if ((i + j) % 2 === 0) brickPallet(P, -76 + i * 14, 10, -66 + j * 12, i === 2 ? 6 : 8);
        }
        bagPallet(P, -76, 0, -38, 4); bagPallet(P, -62, 0, -38, 5); bagPallet(P, -62, 10 + 2, -38, 3);
        // бетонные кольца лёжа и стоя
        for (let i = 0; i < 4; i++) {
            const cz = -66 + i * 16;
            P.cylX(7, cz + 7, -10, 8, 7, 5.4, (lx, ly, lz) => ((lx + 10) % 18 === 0 ? M.concrete2 : M.concrete));
            P.dyn(-10, 0, cz, 8, 14, cz + 14);
        }
        for (let i = 0; i < 2; i++) {
            P.cylY(20 + i * 16 + 7, -60, 0, 18, 7, 5.4, M.concrete);
            P.dyn(20 + i * 16, 0, -67, 20 + i * 16 + 14, 18, -53);
        }
        // стальные трубы на брусьях: нижний ряд, прокладки, верхний ряд
        for (const sx of [-74, -46, -22]) P.box(sx, 0, -12, sx + 3, 3, 30, M.darkwood);
        for (let i = 0; i < 5; i++) {
            const pz = -10 + i * 8;
            P.cylX(6, pz + 3, -80, -16, 3.1, 1.7, M.rust); P.dyn(-80, 3, pz, -16, 9, pz + 6);
        }
        for (const sx of [-74, -46, -22]) { P.box(sx, 9, -12, sx + 3, 11, 30, M.plank); P.dyn(sx, 9, -12, sx + 3, 11, 30); }
        for (let i = 0; i < 4; i++) {
            const pz = -6 + i * 8;
            P.cylX(14, pz + 3, -78, -18, 3.1, 1.7, (lx) => (lx % 20 === 0 ? M.metal : M.rust)); P.dyn(-78, 11, pz, -18, 17, pz + 6);
        }
        // пакеты досок на прокладках
        for (let j = 0; j < 3; j++) {
            const y0 = j * 6;
            P.box(-74, y0, 42, -40, y0 + 6, 56, (lx, ly, lz) => {
                const k = ly - y0;
                if (k < 2) return (lx === -72 || lx === -58 || lx === -44) ? M.darkwood : 0;
                return ((lz - 42) % 3 === 2) ? M.wood : M.plank;
            });
            P.dyn(-74, y0, 42, -40, y0 + 6, 56);
        }
        // арматура на козлах
        for (const kx of [-30, 2]) {
            P.box(kx, 0, 46, kx + 2, 7, 47, M.darkwood); P.box(kx, 0, 55, kx + 2, 7, 56, M.darkwood); P.box(kx, 7, 44, kx + 2, 9, 58, M.darkwood);
        }
        P.body(-36, 9, 46, 12, 12, 54, (lx, ly, lz) => ((lz + ly) & 1 ? M.rebar : M.rust));
        // кучи песка и щебня
        P.cylY(50, 30, 0, 16, (ly) => 24 * (1 - ly / 16.5), 0, (lx, ly, lz) => (hash(lx, ly, lz) < 0.12 ? M.dirt : M.sand));
        P.cylY(48, 64, 0, 13, (ly) => 20 * (1 - ly / 13.5), 0, M.gravel);
        // бадья для бетона и катушки
        cableDrum(P, 22, 0, -30, 7, 8); cableDrum(P, 38, 0, -32, 6, 7);
        wheelbarrow(P, -10, 0, 34, M.ctr_green); wheelbarrow(P, -8, 0, 0);
        // контейнер-бункер для мусора (тело): мусор внутри
        P.box(60, 0, -70, 80, 14, -48, (lx, ly, lz) => {
            const i = lx - 60, j = lz + 70, k = ly;
            const slope = (k * 0.35) | 0;
            if (i < 3 - slope || i > 16 + slope) return 0;
            const wall = i === 3 - slope || i === 16 + slope || j === 0 || j === 21 || k === 0;
            if (wall) return k === 13 ? M.metal : M.hazard;
            if (k < 10 + ((i * 7 + j * 3) % 4)) return hash(lx, ly, lz) < 0.4 ? M.brick2 : (hash(lx, ly, lz) < 0.7 ? M.plank : M.concrete2);
            return 0;
        });
        P.dyn(60, 0, -70, 80, 14, -48);
    };

    /** Бытовки: два блока в ряд, третий сверху, лестница, туалеты, генератор, бочки, баллоны, прожектор. */
    B['construction-cabins'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        /** Бытовка 60×26×24 (x, z, высота): каркас, стены, окна, дверь, обстановка. */
        const cabin = (x0, y0, z0, doorAt, wall) => {
            const L = 60, D = 24, H = 26, F = M.blue;
            P.box(x0, y0, z0, x0 + L, y0 + 2, z0 + D, F);
            P.box(x0 + 1, y0 + 2, z0 + 1, x0 + L - 1, y0 + 3, z0 + D - 1, M.plaster2);
            P.box(x0, y0 + 2, z0, x0 + L, y0 + H - 2, z0 + D, (lx, ly, lz) => {
                const i = lx - x0, j = lz - z0, k = ly - y0;
                const side = j === 0 || j === D - 1, end = i === 0 || i === L - 1;
                if (!side && !end) return -1;
                if ((i < 2 || i > L - 3) && (j < 2 || j > D - 3)) return F;
                if (side) {
                    const front = j === 0;
                    if (front && i >= doorAt && i < doorAt + 10 && k < 23) return (i === doorAt || i === doorAt + 9 || k === 22) ? F : (k > 14 && k < 20 && i > doorAt + 2 && i < doorAt + 7 ? M.glass : M.steelg);
                    for (const wx of [6, 24, 44]) if (i >= wx && i < wx + 10 && k > 10 && k < 20) return (i === wx || i === wx + 9 || k === 11 || k === 19) ? M.paint : M.glass;
                }
                if (end && k > 10 && k < 20 && j > 7 && j < 16) return (j === 8 || j === 15 || k === 11 || k === 19) ? M.paint : M.glass;
                return k === 3 || k === H - 3 ? F : (wall || M.plaster);
            });
            P.box(x0, y0 + H - 2, z0, x0 + L, y0 + H, z0 + D, (lx, ly) => (ly === y0 + H - 1 ? (lx % 3 === 0 ? M.corrugated : M.paint) : F));
            // обстановка: стол, стулья, шкаф, обогреватель
            P.box(x0 + 30, y0 + 3, z0 + D - 8, x0 + 46, y0 + 10, z0 + D - 2, (lx, ly, lz) => (ly === y0 + 9 ? M.plank : ((lx === x0 + 30 || lx === x0 + 45) && (lz === z0 + D - 8 || lz === z0 + D - 3) ? M.metal : -1)));
            P.box(x0 + 34, y0 + 10, z0 + D - 6, x0 + 38, y0 + 11, z0 + D - 3, M.plaster);
            P.box(x0 + 3, y0 + 3, z0 + D - 6, x0 + 11, y0 + 21, z0 + D - 2, (lx, ly) => ((ly - y0) % 6 === 2 ? M.darkwood : M.steelg));
            P.box(x0 + 50, y0 + 3, z0 + 3, x0 + 56, y0 + 8, z0 + 5, M.paint);
            P.box(x0 + 36, y0 + 3, z0 + D - 12, x0 + 40, y0 + 7, z0 + D - 9, M.darkwood);
        };
        cabin(-58, 0, -50, 40, M.plaster); cabin(-58, 0, -22, 40, M.paint); cabin(-58, 26, -50, 4, M.plaster);
        // наружная лестница на верхнюю бытовку: площадка у двери, марш вдоль +x к земле
        P.box(-58, 25, -58, -42, 26, -51, M.metal);
        for (const [px, pz] of [[-58, -58], [-43, -58], [-58, -52], [-43, -52]]) P.box(px, 0, pz, px + 1, 25, pz + 1, M.hazard);
        P.box(-58, 26, -58, -42, 36, -57, (lx, ly) => (ly === 35 || ly === 31 || (lx + 58) % 5 === 0 ? M.hazard : -1));
        P.box(-58, 26, -57, -57, 36, -51, (lx, ly, lz) => (ly === 35 || ly === 31 || (lz + 57) % 5 === 0 ? M.hazard : -1));
        for (let i = 0; i < 13; i++) { const x0 = -42 + 3 * (12 - i); P.box(x0, 2 * i + 1, -57, x0 + 3, 2 * i + 2, -52, M.metal); }
        P.line(-4, 0, -58, -42, 25, -58, M.hazard); P.line(-4, 0, -52, -42, 25, -52, M.hazard);
        P.line(-4, 9, -58, -42, 35, -58, M.hazard);
        for (let i = 0; i < 4; i++) { const px = -6 - i * 10, top = Math.round((-4 - px) * 26 / 38); P.box(px, top, -58, px + 1, top + 10, -57, M.hazard); }
        // туалеты (тела)
        for (let i = 0; i < 3; i++) {
            const tx = 10 + i * 14, tz = 12;
            P.box(tx, 0, tz, tx + 12, 24, tz + 12, (lx, ly, lz) => {
                const e = lx === tx || lx === tx + 11 || lz === tz || lz === tz + 11 || ly === 0 || ly === 23;
                if (!e) return (ly < 5 && lx > tx + 3 && lx < tx + 9 && lz > tz + 5) ? M.paint : -1;
                if (ly === 23) return M.paint;
                if (lz === tz && lx > tx + 2 && lx < tx + 9 && ly > 0 && ly < 21) return ly === 17 && lx === tx + 7 ? M.metal : M.ctr_blue;
                return (ly === 20 && (lx === tx || lx === tx + 11)) ? M.paint : M.blue;
            });
            P.dyn(tx, 0, tz, tx + 12, 24, tz + 12);
        }
        // генератор на салазках, бочки, баллоны
        P.box(10, 0, 34, 34, 2, 46, M.metal);
        P.box(11, 2, 35, 33, 13, 45, (lx, ly, lz) => ((lz === 35 || lz === 44) && ly > 4 && ly < 11 && (lx & 1) ? M.metal : (ly === 12 ? M.rust : M.hazard)));
        P.box(14, 13, 37, 16, 18, 39, M.metal);
        P.dyn(10, 0, 34, 34, 18, 46);
        barrel(P, 38, 0, 34); barrel(P, 45, 0, 34); barrel(P, 38, 0, 41); barrel(P, 45, 0, 41, M.rust); barrel(P, 41, 9, 37);
        for (let i = 0; i < 4; i++) gasCylinder(P, 4 + i * 4, 0, -54, i % 2 ? M.oxygen : M.barrel, 14);
        // прожекторная мачта на прицепе
        P.box(-40, 0, 20, -20, 6, 30, (lx, ly) => (ly < 2 ? M.metal : M.hazard));
        P.cylZ(-30, 3, 18, 20, 3, 0, M.rubber); P.cylZ(-30, 3, 30, 32, 3, 0, M.rubber);
        P.box(-31, 6, 24, -29, 90, 26, M.metal);
        P.box(-38, 90, 24, -22, 92, 26, M.metal);
        for (const lx of [-37, -33, -28, -24]) P.box(lx, 92, 23, lx + 3, 96, 27, (a, b, c) => (c === 23 ? M.lamp : M.metal));
        // контейнер-склад инструмента и мешки у двери
        container(P, -58, 0, 50, M.ctr_green, false);
        bagPallet(P, 4, 0, 60, 3);
        // стол со скамьями (тело)
        P.body(-30, 0, 40, -12, 8, 48, (lx, ly, lz) => {
            if (ly === 7) return lz > 41 && lz < 46 ? M.plank : 0;
            if (ly === 4) return lz === 40 || lz === 47 ? M.plank : 0;
            return (lx === -29 || lx === -13) ? M.darkwood : 0;
        });
    };

    /** Бетоновоз (вдоль +x кабиной вперёд): колёса, рама, кабина, наклонный барабан со спиралью, лоток. */
    B['construction-mixer'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        // колёса: 3 оси
        for (const ax of [18, 31, 74]) for (const wz of [0, 21]) {
            P.cylZ(ax, 5, wz, wz + 4, 5.2, 0, (lx, ly, lz, d) => (d < 2.2 ? M.metal : M.rubber));
        }
        P.box(4, 7, 5, 88, 10, 20, (lx, ly, lz) => ((lz > 7 && lz < 17) && ly < 9 ? -1 : M.metal));
        P.box(84, 4, 0, 90, 8, 25, M.metal);
        for (const ax of [18, 31, 74]) {
            P.box(ax - 1, 4, 0, ax + 1, 7, 25, M.metal);
            P.box(ax - 7, 10, 0, ax + 8, 11, 5, M.metal); P.box(ax - 7, 10, 20, ax + 8, 11, 25, M.metal);
        }
        // кабина
        P.box(66, 10, 1, 88, 34, 24, (lx, ly, lz) => {
            const e = lx === 66 || lx === 87 || lz === 1 || lz === 23 || ly === 33;
            if (!e) return ly === 16 ? M.darkwood : (ly === 20 && lx > 82 && lz > 4 && lz < 10 ? M.metal : -1);
            if (lx === 87 && ly > 20 && ly < 31 && lz > 2 && lz < 22) return lz === 12 ? M.metal : M.glass;
            if ((lz === 1 || lz === 23) && ly > 20 && ly < 31 && lx > 72 && lx < 86) return lx === 79 ? M.metal : M.glass;
            if (lx === 87 && ly > 11 && ly < 19 && lz > 5 && lz < 19) return (ly & 1) ? M.rubber : M.metal;   // решётка
            if ((lz === 1 || lz === 23) && (lx === 72 || lx === 85) && ly > 12) return M.metal;          // швы дверей
            if (ly === 19 || ly === 20) return M.ctr_orange;
            return ly < 12 ? M.rubber : M.paint;
        });
        P.box(87, 31, 2, 90, 33, 23, M.ctr_orange);
        for (const mz of [-1, 24]) { P.box(83, 22, mz, 86, 28, mz + 1, M.metal); P.box(83, 27, mz < 0 ? 0 : 23, 85, 28, mz < 0 ? 1 : 24, M.metal); }
        P.box(88, 9, 4, 90, 12, 21, M.metal);
        P.box(88, 12, 3, 89, 14, 6, M.lamp); P.box(88, 12, 19, 89, 14, 22, M.lamp);
        P.box(64, 10, 18, 66, 36, 20, M.metal);
        // барабан: ось наклонена (передний конец ниже), спиральная полоса
        const cy = (lx) => 21 + (60 - lx) * 0.12, r = (lx) => (lx > 50 ? 6 + (60 - lx) * 0.4 : (lx < 22 ? 4.5 + (lx - 8) * 0.39 : 10));
        P.cylX(cy, 12.5, 8, 61, r, (lx) => r(lx) - 1.8, (lx, ly, lz, d, ang) => {
            const s = ((ang / (Math.PI * 2)) * 18 + lx * 0.7) % 12;
            return (s + 12) % 12 < 3 ? M.paint : M.ctr_orange;
        });
        P.cylX(cy, 12.5, 60, 62, 6, 0, M.metal);
        P.box(56, 10, 9, 62, 22, 16, M.metal);
        P.box(8, 10, 8, 14, 24, 17, M.metal);
        P.box(2, 14, 10, 8, 18, 15, (lx, ly, lz) => (ly === 14 || lz === 10 || lz === 14 ? M.hazard : 0));
        P.line(2, 14, 12, -8, 6, 12, M.hazard, 2);
        P.cylX(13.5, 3.5, 40, 58, 3.4, 0, (lx) => (lx === 40 || lx === 57 ? M.metal : M.paint));
        P.box(4, 10, 2, 6, 28, 3, M.metal); P.box(4, 10, 2, 6, 11, 23, M.metal);
        for (let ly = 12; ly < 28; ly += 3) P.box(4, ly, 1, 6, ly + 1, 4, M.metal);
    };

    // ================================================================== ЗАВОД (factory)
    // Кирпичный цех 32 × 17,6 м со стальными фермами, фонарями и мостовым краном; котельная и труба 17 м;
    // три силоса на опорах, взрывоопасная газовая ёмкость, эстакада труб, галерея конвейера в склад,
    // склад со стеллажами, контора, клетка с баллонами. Двор — асфальт с разметкой.

    /** Погрузчик (тело) длиной 26 вдоль +x (вилы спереди). */
    function forklift(P, x0, y0, z0) {
        P.box(x0, y0, z0, x0 + 26, y0 + 22, z0 + 12, (lx, ly, lz) => {
            const i = lx - x0, k = ly - y0, j = lz - z0;
            if (i >= 20) {                                                        // мачта и вилы
                if (k < 1) return (j < 3 || j > 8) ? M.metal : 0;
                if (i === 20 && (j === 2 || j === 9) && k < 22) return M.metal;
                if (i === 20 && k === 21 && j > 1 && j < 10) return M.metal;
                if (i === 20 && k < 6 && j > 1 && j < 10) return M.metal;
                return 0;
            }
            if (k < 5) return ((i > 1 && i < 6) || (i > 13 && i < 18)) && (j < 2 || j > 9) ? M.rubber : (j > 1 && j < 10 && k > 1 ? M.metal : 0);
            if (k < 11) return i < 5 ? M.metal : M.hazard;                       // корпус, противовес
            if (k < 13) return i < 8 ? M.hazard : (j > 3 && j < 8 && i < 13 ? M.darkwood : (i === 13 && j > 4 && j < 7 ? M.metal : 0));
            if (k < 20) return (i === 3 || i === 16) && (j === 1 || j === 10) ? M.metal : (k === 13 && i > 12 && i < 16 && j > 4 && j < 7 ? M.metal : 0);
            if (k < 21) return i >= 3 && i <= 16 && j >= 1 && j <= 10 ? M.metal : 0;
            return 0;
        });
        P.dyn(x0, y0, z0, x0 + 26, y0 + 22, z0 + 12);
    }
    /** Стальной рулон (тело): ось по z, радиус r, длина L. */
    function coil(P, x0, y0, z0, r, L, mat) {
        P.cylZ(x0 + r, y0 + r, z0, z0 + L, r, 2.6, (lx, ly, lz, d) => (d > r - 1 ? (mat || M.metal) : ((Math.round(d * 2) & 1) ? M.metal : M.rust)));
        P.dyn(x0, y0, z0, x0 + 2 * r, y0 + 2 * r, z0 + L);
    }

    B['factory-terrain'] = function (w) {
        paintGround(w, 0, 0, w.sx, w.sz, (x, z) => {
            const inside = x >= 42 && x < 470 && z >= 42 && z < 470;
            const n = vnoise(x, z, 17, 61), n2 = vnoise(x, z, 5, 62);
            if (!inside) return n2 < 0.2 ? M.dirt : -1;
            // полы зданий — бетон
            if ((x >= 60 && x < 380 && z >= 60 && z < 236) || (x >= 395 && x < 465 && z >= 70 && z < 160) || (x >= 250 && x < 460 && z >= 345 && z < 455) || (x >= 55 && x < 175 && z >= 350 && z < 440)) {
                if (x >= 60 && x < 380 && z >= 60 && z < 236 && (Math.abs(z - 148 + 40) < 1 || Math.abs(z - 148 - 40) < 1) && x > 100 && x < 370) return M.hazard;
                return n > 0.8 ? M.concrete2 : M.concrete;
            }
            // разметка: осевая дороги от ворот, линия у цеха, стоянка у конторы
            if (x >= 214 && x < 216 && z > 250 && z < 470 && (z % 16) < 9) return M.paint;
            if (z >= 248 && z < 250 && x > 60 && x < 460 && (x % 16) < 9) return M.paint;
            if (z > 444 && z < 466 && x > 50 && x < 150 && (x - 50) % 24 < 1) return M.paint;
            if (x > 40 && x < 470 && (Math.abs(x - 300) < 1 || Math.abs(x - 140) < 1) && z > 455 && z < 470) return -1;
            // люки и пятна масла
            const mx = ((x - 120) % 70 + 70) % 70, mz = ((z - 255) % 70 + 70) % 70;
            if ((mx - 3) ** 2 + (mz - 3) ** 2 < 9) return M.metal;
            if (n > 0.86) return M.rubber;
            return M.asphalt;
        });
        edgeBerm(w, 36, 6, 18, 63, (x, z, h) => (vnoise(x, z, 7, 64) < 0.3 ? M.dirt : M.grass), M.dirt);
    };

    /** Забор из бетонных плит с узором и воротами на юге (x 186..250). */
    B['factory-fence'] = function (w) {
        const P = new Plot(w, 0, 0, 0);
        const A = 40, Z = 471, H = 24;
        const panel = (a, ly) => {
            const s = (a - A) % 30;
            if (s === 0) return ly < H + 2 ? M.concrete2 : -1;
            if (ly >= H) return -1;
            if (ly === 0 || ly === H - 1) return M.concrete2;
            return ((s + ly) % 10 === 0 || (s - ly + 100) % 10 === 0) && ly > 4 && ly < H - 4 ? M.concrete2 : M.concrete;
        };
        for (let a = A; a <= Z; a++) for (let ly = 0; ly < H + 2; ly++) {
            P.put(a, ly, A, panel(a, ly));
            if (a >= 186 && a < 250) { if ((a === 186 || a === 249) && ly < H + 4) P.put(a, ly, Z, M.concrete2); }
            else P.put(a, ly, Z, panel(a, ly));
            P.put(A, ly, a, panel(a, ly)); P.put(Z, ly, a, panel(a, ly));
        }
        // ворота: откатная решётка, сдвинутая вбок, будка охраны
        for (let a = 250; a < 300; a++) for (let ly = 1; ly < 22; ly++) if (a % 3 === 0 || ly === 1 || ly === 21 || ly === 11) P.put(a, ly, Z - 2, M.steelg);
        P.box(250, 0, Z - 3, 300, 1, Z - 1, M.metal);
        P.box(160, 0, 444, 182, 26, 466, (lx, ly, lz) => {
            const e = lx === 160 || lx === 181 || lz === 444 || lz === 465 || ly === 25;
            if (!e) return ly === 0 ? M.plaster2 : (ly < 9 && ly > 0 && lx > 172 && lz > 456 ? M.darkwood : -1);
            if (ly === 25) return M.concrete2;
            if (ly > 10 && ly < 21 && !((lx === 160 || lx === 181) && (lz === 444 || lz === 465))) return M.glass;
            if (lx === 181 && lz > 448 && lz < 458 && ly < 21) return 0;
            return ly < 4 ? M.brick2 : M.plaster;
        });
        P.box(158, 25, 442, 184, 27, 468, M.concrete2);
        // шлагбаум
        P.box(184, 0, 462, 187, 10, 465, M.metal);
        P.box(187, 8, 463, 246, 9, 464, (lx) => (((lx - 187) >> 2) & 1 ? M.paint : M.ctr_red));
    };

    /** Цех: кирпичные стены с пилястрами и арочными окнами, стальные фермы, кровля с полосами стекла, мостовой кран, станки. */
    B['factory-hall'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -160, X1 = 160, Z0 = -88, Z1 = 88, EH = 90;
        const ridgeA = (lz) => (lz < 0 ? -lz - 1 : lz);                 // 0 у конька .. 87 у стены
        const ry = (lz) => EH + Math.floor((87 - ridgeA(lz)) / 3);       // высота кровли
        const pil = [];
        for (let px = X0; px <= X1; px += 40) pil.push(px);
        // окна в пролётах продольных стен: [a0, a1) и арка
        const winTop = (u) => 64 + Math.round(6 * Math.sqrt(Math.max(0, 1 - (u / 12.5) ** 2)));
        /** Узор продольной стены (n/s): t — слой от наружного (0..2), a — lx. */
        const longWall = (a, ly, t, south) => {
            const bay = Math.floor((a - X0) / 40), u0 = (a - X0) % 40;
            const k = (ly);
            if (k < 6) return t === 0 ? M.concrete2 : M.brick2;          // цоколь
            if (k === 40 || k === 41) return M.mortar;                       // поясок
            if (k >= EH - 3) return M.brick2;
            // ворота в южной стене
            if (south && a >= 42 && a < 76 && k < 60) return 0;
            if (!south && a >= -60 && a < -50 && k < 22) return t === 1 ? (a === -60 || a === -51 || k === 21 ? M.darkwood : 0) : 0;
            if (u0 >= 8 && u0 < 32 && bay >= 0 && bay < 8) {
                const u = u0 - 19.5;
                const top = winTop(u);
                if (k >= 14 && k < top) {
                    if (t !== 1) return 0;
                    const bar = ((u0 - 8) % 6 === 5) || ((k - 14) % 8 === 7) || u0 === 8 || u0 === 31;
                    return bar ? M.metal : M.glass;
                }
                if (k >= top && k < top + 2) return M.brick2;                 // арка
                if (k === 13) return t === 0 ? M.concrete : M.mortar;         // подоконник
                const ou = Math.hypot(u0 - 19.5, k - 79.5);                   // круглое окно
                if (ou < 4) return t === 1 ? (ou < 1.2 || Math.abs(u0 - 19.5) < 0.6 ? M.metal : M.glass) : 0;
                if (ou < 5.2) return M.brick2;
            }
            return oldBrickF(a, ly, t);
        };
        // продольные стены
        P.box(X0, 0, Z0, X1, EH, Z0 + 3, (lx, ly, lz) => longWall(lx, ly, lz - Z0, false));
        P.box(X0, 0, Z1 - 3, X1, EH, Z1, (lx, ly, lz) => longWall(lx, ly, Z1 - 1 - lz, true));
        // торцы с фронтоном и ступенчатым парапетом
        const gable = (lx, ly, lz, east) => {
            const t = east ? X1 - 1 - lx : lx - X0, top = ry(lz) + 2;
            if (ly > top) return -1;
            if (ly < 6) return t === 0 ? M.concrete2 : M.brick2;
            if (ly >= top - 1) return M.concrete2;
            if (east && lz >= -25 && lz < 25 && ly < 60) return 0;               // ворота
            if (ly === 40 || ly === 41) return M.mortar;
            // три высоких окна и круглое окно во фронтоне
            for (const c of [-50, 0, 50]) {
                const u = lz + 0.5 - c;
                if (east && c === 0) continue;
                if (Math.abs(u) < 8 && ly >= 14 && ly < 60 + Math.round(4 * Math.sqrt(Math.max(0, 1 - (u / 8) ** 2)))) {
                    if (t !== 1) return 0;
                    return (Math.abs(u) > 7 || (ly - 14) % 8 === 7 || Math.abs(u) < 0.6) ? M.metal : M.glass;
                }
            }
            const o = Math.hypot(lz + 0.5, ly - 104);
            if (o < 6) return t === 1 ? (o < 1.5 ? M.metal : M.glass) : 0;
            if (o < 7.5) return M.brick2;
            return oldBrickF(lz, ly, t + 50);
        };
        P.box(X0, 0, Z0, X0 + 3, 125, Z1, (lx, ly, lz) => gable(lx, ly, lz, false));
        P.box(X1 - 3, 0, Z0, X1, 125, Z1, (lx, ly, lz) => gable(lx, ly, lz, true));
        // пилястры (наружу на 2) с карнизом
        for (const px of pil) {
            const a0 = Math.max(X0, px - 3), a1 = Math.min(X1, px + 3);
            P.box(a0, 0, Z0 - 2, a1, EH + 1, Z0, (lx, ly, lz) => (ly < 6 ? M.concrete2 : oldBrickF(lx, ly, lz)));
            P.box(a0, 0, Z1, a1, EH + 1, Z1 + 2, (lx, ly, lz) => (ly < 6 ? M.concrete2 : oldBrickF(lx, ly, lz)));
        }
        P.box(X0 - 1, EH - 3, Z0 - 1, X1 + 1, EH - 1, Z0, M.brick2); P.box(X0 - 1, EH - 3, Z1, X1 + 1, EH - 1, Z1 + 1, M.brick2);
        P.box(X0 - 2, EH - 1, Z0 - 2, X1 + 2, EH + 1, Z0, M.concrete2); P.box(X0 - 2, EH - 1, Z1, X1 + 2, EH + 1, Z1 + 2, M.concrete2);
        // кровля: профлист 2 слоя по уклону 1:3, полосы стекла в чётных пролётах
        P.box(X0 + 3, EH, Z0, X1 - 3, 120, Z1, (lx, ly, lz) => {
            const r = ry(lz);
            if (ly !== r && ly !== r - 1) return -1;
            const a = ridgeA(lz), bay = Math.floor((lx - X0) / 40);
            if ((bay & 1) === 0 && a >= 24 && a < 60 && ((lx - X0) % 40) > 4 && ((lx - X0) % 40) < 36) return M.glass;
            if (vnoise(lx, a, 9, 77) > 0.8) return M.rust;
            return (lx & 1) ? M.corrugated : M.metal;
        });
        P.box(X0, 119, -1, X1, 121, 1, M.metal);                                   // конёк
        // фермы
        for (const px of pil.slice(1, -1)) {
            const a0 = px - 1;
            P.box(a0, EH - 6, Z0 + 3, a0 + 2, EH - 4, Z1 - 3, M.metal);                 // нижний пояс
            for (let lz = Z0 + 3; lz < Z1 - 3; lz++) P.box(a0, ry(lz) - 3, lz, a0 + 2, ry(lz) - 1, lz + 1, M.metal);  // верхний
            for (let s = -80; s <= 80; s += 10) {
                const top = ry(s) - 3;
                P.box(a0, EH - 4, s, a0 + 1, top, s + 1, M.metal);
                if (s < 80) { const s2 = s + 10, t2 = ry(s2) - 3; if (s < 0) P.line(a0 + 1, EH - 4, s, a0 + 1, t2, s2, M.metal); else P.line(a0 + 1, top, s, a0 + 1, EH - 4, s2, M.metal); }
            }
        }
        // прогоны
        for (const a of [6, 26, 46, 66, 84]) for (const lz of [a, -a - 1]) P.box(X0 + 3, ry(lz) - 2, lz, X1 - 3, ry(lz) - 1, lz + 1, M.rust);
        // подкрановые балки на консолях и мостовой кран
        for (const px of pil) {
            if (px === X0 || px === X1) continue;
            P.box(px - 2, 60, Z0 + 3, px + 2, 66, Z0 + 10, M.concrete2);
            P.box(px - 2, 60, Z1 - 10, px + 2, 66, Z1 - 3, M.concrete2);
        }
        P.box(X0 + 3, 66, Z0 + 5, X1 - 3, 70, Z0 + 9, M.metal); P.box(X0 + 3, 66, Z1 - 9, X1 - 3, 70, Z1 - 5, M.metal);
        P.box(X0 + 3, 70, Z0 + 6, X1 - 3, 71, Z0 + 8, M.rust); P.box(X0 + 3, 70, Z1 - 8, X1 - 3, 71, Z1 - 6, M.rust);
        const CX = -40;
        P.shell(CX - 5, 72, Z0 + 4, CX + 5, 80, Z1 - 4, 1, M.hazard);
        for (const ez of [Z0 + 4, Z1 - 12]) P.box(CX - 12, 71, ez, CX + 12, 76, ez + 8, (lx, ly) => (ly === 71 ? M.metal : M.hazard));
        P.box(CX - 4, 80, -9, CX + 4, 86, 9, M.metal);
        P.box(CX - 3, 81, -12, CX + 3, 86, -9, M.blue);
        for (const cz of [-3, 3]) P.box(CX, 40, cz, CX + 1, 80, cz + 1, M.cable);
        P.box(CX - 3, 34, -4, CX + 4, 40, 5, M.hazard);
        P.box(CX - 1, 32, -1, CX + 2, 34, 2, M.metal);
        // висящий рулон на С-крюке: стержень через сердцевину касается витков
        P.box(CX - 1, 19, -12, CX + 2, 33, -10, M.rust); P.box(CX - 1, 31, -12, CX + 2, 33, 2, M.rust);
        P.cylZ(CX + 0.5, 21, -12, 10, 3.2, 0, M.rust);
        P.cylZ(CX + 0.5, 21, -9, 9, 9, 3.1, (lx, ly, lz, d) => (d > 8 ? M.metal : ((Math.round(d * 2) & 1) ? M.metal : M.rust)));
        // кабина крановщика под мостом
        P.box(CX + 5, 62, 50, CX + 15, 72, 62, (lx, ly, lz) => {
            const e = lx === CX + 5 || lx === CX + 14 || lz === 50 || lz === 61 || ly === 62 || ly === 71;
            if (!e) return -1;
            return ly > 63 && ly < 70 && ly !== 71 ? M.glass : M.hazard;
        });
        // станки: токарные вдоль севера
        for (let i = 0; i < 4; i++) {
            const sx = -78 + i * 56, sz = -72;
            P.box(sx, 0, sz, sx + 40, 2, sz + 12, M.concrete2);
            for (const lx of [sx + 2, sx + 36]) P.box(lx, 2, sz + 2, lx + 3, 9, sz + 10, M.steelg);
            P.box(sx + 1, 9, sz + 1, sx + 39, 12, sz + 11, M.steelg);
            P.box(sx + 2, 12, sz + 3, sx + 38, 13, sz + 9, M.metal);
            P.box(sx + 1, 12, sz + 1, sx + 11, 24, sz + 11, (lx, ly, lz) => (ly === 23 ? M.metal : M.steelg));
            P.cylX(17.5, sz + 6, sx + 11, sx + 14, 4, 0, M.metal);
            P.box(sx + 30, 12, sz + 3, sx + 36, 19, sz + 9, M.steelg);
            P.box(sx + 20, 13, sz + 2, sx + 26, 17, sz + 10, M.metal);
            P.box(sx + 4, 24, sz + 10, sx + 8, 30, sz + 11, M.paint);
        }
        // прессы
        for (const [sx, sz] of [[-100, 30], [-40, 30]]) {
            P.box(sx, 0, sz, sx + 24, 8, sz + 18, M.steelg);
            P.box(sx, 8, sz, sx + 5, 46, sz + 18, M.steelg); P.box(sx + 19, 8, sz, sx + 24, 46, sz + 18, M.steelg);
            P.box(sx, 46, sz, sx + 24, 56, sz + 18, (lx, ly) => (ly === 55 ? M.metal : M.steelg));
            P.box(sx + 7, 26, sz + 3, sx + 17, 46, sz + 15, M.metal);
            P.box(sx + 6, 8, sz + 2, sx + 18, 10, sz + 16, M.rust);
            P.box(sx + 24, 4, sz + 6, sx + 28, 20, sz + 12, (lx, ly) => (ly > 14 && ly < 18 ? M.lamp : M.blue));
            P.cylY(sx + 12, sz + 9, 56, 64, 4, 0, M.metal);
        }
        // конвейер вдоль цеха с ящиками
        P.box(-120, 0, 60, 120, 10, 68, (lx, ly, lz) => {
            if (ly === 9) return M.rubber;
            if (ly === 8) return (lx & 1) ? M.metal : 0;
            if (ly === 7) return lz === 60 || lz === 67 ? M.metal : 0;
            return ((lx + 120) % 20 === 0 || (lx + 120) % 20 === 1) && (lz === 60 || lz === 67) ? M.metal : 0;
        });
        for (let i = 0; i < 7; i++) crate(P, -110 + i * 32, 10, 61, 6, 6);
        // поддоны с ящиками и рулоны вдоль юга, бочки у восточных ворот
        for (let i = 0; i < 4; i++) { pallet(P, -130 + i * 16, 0, 72); crate(P, -129 + i * 16, 2, 72, 9, 9); if (i % 2 === 0) crate(P, -128 + i * 16, 11, 73, 7, 6); }
        for (let i = 0; i < 3; i++) coil(P, 96 + i * 16, 0, 72, 6, 10, i === 1 ? M.rust : M.metal);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) barrel(P, 128 + i * 7, 0, 30 + j * 7, (i + j) % 3 === 2 ? M.rust : M.barrel);
        // сварочный пост: верстак, баллоны
        P.box(100, 0, -40, 124, 9, -30, (lx, ly, lz) => (ly === 8 ? M.metal : ((lx === 100 || lx === 123) && (lz === -40 || lz === -31) ? M.metal : -1)));
        gasCylinder(P, 126, 0, -40, M.oxygen); gasCylinder(P, 126, 0, -36, M.barrel); gasCylinder(P, 130, 0, -40, M.oxygen);
        // диспетчерская на стойках у западного торца
        const OX0 = -155, OX1 = -112, OZ0 = -80, OZ1 = -46, OY = 32;
        for (const [cx, cz] of [[OX0 + 1, OZ0 + 1], [OX1 - 4, OZ0 + 1], [OX0 + 1, OZ1 - 4], [OX1 - 4, OZ1 - 4]]) P.box(cx, 0, cz, cx + 3, OY, cz + 3, M.rust);
        P.line(OX1 - 3, 2, OZ1 - 3, OX1 - 3, OY - 2, OZ0 + 3, M.rust);
        P.box(OX0, OY, OZ0, OX1, OY + 2, OZ1, M.metal);
        P.box(OX0, OY + 2, OZ0, OX1, OY + 26, OZ1, (lx, ly, lz) => {
            const ex = lx === OX0 || lx === OX1 - 1, ez = lz === OZ0 || lz === OZ1 - 1, top = ly === OY + 25;
            if (!ex && !ez && !top) {
                if (ly === OY + 2) return M.plaster2;
                if (ly < OY + 9 && lz > OZ1 - 8 && lz < OZ1 - 2 && lx > OX0 + 4 && lx < OX0 + 30) return ly === OY + 8 ? M.plank : -1;
                return -1;
            }
            if (top) return M.concrete2;
            if (ly > OY + 9 && ly < OY + 21 && (lx === OX1 - 1 || lz === OZ1 - 1) && !(ex && ez)) return (lx + lz) % 9 === 0 ? M.metal : M.glass;
            if (lx === OX1 - 1 && lz > OZ0 + 3 && lz < OZ0 + 12 && ly < OY + 22) return 0;
            return M.plaster;
        });
        for (let i = 0; i < 16; i++) P.box(OX1 + 2 * i, OY - 2 * i - 1, OZ0 + 3, OX1 + 2 * i + 2, OY - 2 * i, OZ0 + 11, M.metal);
        P.box(OX1, OY, OZ0 + 3, OX1 + 2, OY + 1, OZ0 + 11, M.metal);
        P.line(OX1, OY + 9, OZ0 + 2, OX1 + 32, 9, OZ0 + 2, M.hazard);
        P.line(OX1, OY + 9, OZ0 + 11, OX1 + 32, 9, OZ0 + 11, M.hazard);
        // откатная створка южных ворот (приоткрыта)
        P.box(10, 0, Z1 + 2, 50, 58, Z1 + 3, (lx, ly) => (ly % 12 === 0 || lx === 10 || lx === 49 ? M.steelg : (lx & 1 ? M.corrugated2 : M.corrugated)));
        P.box(0, 58, Z1, 100, 60, Z1 + 3, M.metal);
        // восточные ворота: створка внутри, открыта
        P.box(X1 - 5, 0, 25, X1 - 4, 58, 70, (lx, ly, lz) => (ly % 12 === 0 || lz === 25 ? M.steelg : (lz & 1 ? M.corrugated2 : M.corrugated)));
    };

    /** Котельная: кирпичная коробка, два котла, трубы, уголь, газоход к трубе (на юг). */
    B['factory-boiler'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -35, X1 = 35, Z0 = -45, Z1 = 45, H = 72;
        P.box(X0, 0, Z0, X1, H, Z1, (lx, ly, lz) => {
            const tx = Math.min(lx - X0, X1 - 1 - lx), tz = Math.min(lz - Z0, Z1 - 1 - lz), t = Math.min(tx, tz);
            if (t > 2) return -1;
            if (ly < 5) return t === 0 ? M.concrete2 : M.brick2;
            if (ly >= H - 4) return t === 0 ? M.brick2 : oldBrickF(lx, ly, lz);
            const along = tx === t ? lz : lx, a = along - (tx === t ? Z0 : X0), len = tx === t ? Z1 - Z0 : X1 - X0;
            // высокие окна с аркой
            for (let c = 14; c < len - 8; c += 22) {
                const u = a + 0.5 - (c + 4);
                const top = 50 + Math.round(4 * Math.sqrt(Math.max(0, 1 - (u / 5) ** 2)));
                if (Math.abs(u) < 5 && ly >= 14 && ly < top) {
                    if (tx === t && lx > 0 && lz > 20 && ly < 40) return 0;
                    if (t !== 1) return 0;
                    return (Math.abs(u) > 4 || (ly - 14) % 6 === 5) ? M.metal : M.glass;
                }
                if (Math.abs(u) < 5 && ly >= top && ly < top + 2) return M.brick2;
            }
            if (tz === t && lz < 0 && lx > -8 && lx < 8 && ly < 26) return t === 1 && (lx === -7 || lx === 7 || ly === 25) ? M.darkwood : 0;
            return oldBrickF(lx, ly, lz);
        });
        P.box(X0, H - 1, Z0, X1, H, Z1, M.concrete2);
        P.box(X0 + 3, H - 2, Z0 + 3, X1 - 3, H - 1, Z1 - 3, M.concrete);
        P.walls(X0, H, Z0, X1, H + 4, Z1, 2, M.brick2);
        P.box(X0 - 1, H + 4, Z0 - 1, X1 + 1, H + 5, Z1 + 1, M.concrete2);
        // котлы
        for (const bx of [-18, 14]) {
            P.box(bx - 10, 0, -34, bx + 10, 8, 30, oldBrickF);
            P.cylZ(bx, 20, -36, 32, 12, 9.6, (lx, ly, lz) => ((lz + 36) % 12 === 0 ? M.metal : M.tanksteel));
            P.cylZ(bx, 20, -37, -36, 12, 0, M.rust);
            P.box(bx - 3, 10, -38, bx + 3, 16, -37, M.metal);
            P.cylY(bx, 20, 31, H - 1, 3, 1.6, M.rust);
            P.cylY(bx, -20, 31, 52, 2.5, 1, M.metal);
            P.box(bx - 2, 30, -20, bx + 2, 34, 20, M.metal);
        }
        // газоход на юг к трубе (низкий кирпичный короб)
        P.box(-8, 0, Z1, 8, 20, Z1 + 26, (lx, ly, lz) => (lx > -6 && lx < 6 && ly > 1 && ly < 18 ? 0 : oldBrickF(lx, ly, lz)));
        P.box(-6, 2, Z1 - 3, 6, 18, Z1, 0);
        // уголь
        P.cylY(-20, 36, 0, 7, (ly) => 6 * (1 - ly / 7.5), 0, (lx, ly, lz) => (hash(lx, ly, lz) < 0.3 ? M.rubber : M.asphalt));
        P.box(18, 0, 34, 30, 8, 42, M.darkwood);
    };

    /** Кирпичная труба 17 м: квадратный цоколь, круглый ствол с сужением, стальные бандажи, скобы, закопчённый верх. */
    B['factory-chimney'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const BY = 30, TOP = 170;
        P.box(-22, 0, -22, 22, BY, 22, (lx, ly, lz) => {
            const t = Math.min(lx + 22, 21 - lx, lz + 22, 21 - lz);
            if (t > 3) return ly < 2 ? M.concrete2 : 0;
            if (ly < 4) return M.concrete2;
            if (ly >= BY - 3) return t === 0 && ly === BY - 2 ? M.mortar : M.brick2;
            if (lz === 21 - t && lx > -5 && lx < 5 && ly < 12) return 0;              // прочистной люк
            if (lz === -22 + t && lx > -7 && lx < 7 && ly < 20) return 0;             // вход газохода
            return oldBrickF(lx, ly, lz);
        });
        P.box(-23, BY - 2, -23, 23, BY, 23, M.concrete2);
        P.box(-3, 0, 21, 4, 12, 22, M.metal);
        const rOut = (ly) => 15 - (ly - BY) * (5.5 / (TOP - BY));
        P.cylY(0, 0, BY, TOP, rOut, (ly) => rOut(ly) - (ly < 90 ? 3 : 2.2), (lx, ly, lz, d, ang) => {
            if (ly >= TOP - 10) return (hash(lx, ly, lz) < 0.7 ? M.brick2 : M.brick) | 128;
            if ((ly - BY) % 22 === 11 && d > rOut(ly) - 1) return M.metal;
            return oldBrickF(Math.round(ang * 30), ly, Math.round(d));
        });
        P.cylY(0, 0, TOP - 8, TOP - 4, (ly) => rOut(ly) + 1.4, (ly) => rOut(ly) - 1, (lx, ly, lz) => (M.brick2 | 128));
        // бандажи чуть наружу
        for (let ly = BY + 11; ly < TOP - 10; ly += 22) P.cylY(0, 0, ly, ly + 1, rOut(ly) + 0.8, rOut(ly) - 0.5, M.metal);
        // ходовые скобы и громоотвод
        for (let ly = BY + 2; ly < TOP - 2; ly += 3) {
            const r = Math.floor(rOut(ly));
            P.box(-2, ly, r, 2, ly + 1, r + 1, M.metal);
        }
        P.box(0, TOP - 4, -9, 1, TOP + 1, -8, M.metal);
    };

    /** Три силоса на стальных опорах, конусы, переходной мостик наверху, лестница-башня. */
    B['factory-silos'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const R = 14, Y0 = 42, Y1 = 118;
        for (const cx of [-38, 0, 38]) {
            // опоры и связи
            for (const [ox, oz] of [[-10, -10], [8, -10], [-10, 8], [8, 8]]) P.box(cx + ox, 0, oz, cx + ox + 3, Y0 + 2, oz + 3, M.metal);
            P.line(cx - 10, 2, -10, cx + 9, 26, -10, M.metal); P.line(cx + 9, 2, 9, cx - 10, 26, 9, M.metal);
            P.line(cx - 10, 2, 9, cx - 10, 26, -10, M.metal); P.line(cx + 9, 2, -10, cx + 9, 26, 9, M.metal);
            P.box(cx - 11, 26, -11, cx + 11, 28, -8, M.metal); P.box(cx - 11, 26, 8, cx + 11, 28, 11, M.metal);
            P.box(cx - 11, Y0, -11, cx + 11, Y0 + 2, 11, (lx, ly, lz) => (Math.abs(lx - cx + 0.5) > 8.5 || Math.abs(lz + 0.5) > 8.5 ? M.metal : -1));
            // конус, тело, крыша
            P.cylY(cx + 0.5, 0.5, 26, Y0, (ly) => 3 + (ly - 26) * (R - 3) / (Y0 - 26), (ly) => 1.5 + (ly - 26) * (R - 4.6) / (Y0 - 26), M.tanksteel);
            P.cylY(cx + 0.5, 0.5, Y0, Y1, R, R - 1.6, (lx, ly) => ((ly - Y0) % 16 === 15 ? M.metal : M.tanksteel));
            P.cylY(cx + 0.5, 0.5, Y1, Y1 + 6, (ly) => R - (ly - Y1) * 2, (ly) => R - (ly - Y1) * 2 - 1.8, M.tanksteel);
            P.cylY(cx + 0.5, 0.5, Y1 + 6, Y1 + 8, 3, 0, M.metal);
            P.box(cx - 1, 20, -1, cx + 2, 26, 2, M.metal);
            P.box(cx - 3, 16, -3, cx + 4, 20, 4, M.hazard);
            // надпись-полоса
            P.cylY(cx + 0.5, 0.5, 96, 100, R + 0.01, R - 1.6, M.ctr_blue);
        }
        // мостик наверху (тонкие связи: их можно перебить)
        P.box(-60, Y1 + 8, -3, 60, Y1 + 9, 3, (lx, ly, lz) => ((lx + lz) & 1 ? M.scaffold : M.metal));
        P.box(-60, Y1 + 9, -3, 60, Y1 + 16, -2, (lx, ly) => (ly === Y1 + 15 || ly === Y1 + 12 || lx % 6 === 0 ? M.scaffold : -1));
        P.box(-60, Y1 + 9, 2, 60, Y1 + 16, 3, (lx, ly) => (ly === Y1 + 15 || ly === Y1 + 12 || lx % 6 === 0 ? M.scaffold : -1));
        // лестница с ограждением-клеткой по западному силосу на мостик
        const LX = -38 - R - 2;
        P.box(LX, 2, -2, LX + 1, Y1 + 9, -1, M.metal); P.box(LX, 2, 2, LX + 1, Y1 + 9, 3, M.metal);
        for (let ly = 4; ly < Y1 + 8; ly += 3) P.box(LX, ly, -1, LX + 1, ly + 1, 2, M.metal);
        for (let ly = 30; ly < Y1 + 8; ly += 12) P.box(LX - 4, ly, -4, LX + 1, ly + 1, 5, (lx, a, lz) => (lx === LX - 4 || lz === -4 || lz === 4 ? M.metal : -1));
        P.box(LX - 4, 30, -4, LX - 3, Y1 + 8, -3, M.metal); P.box(LX - 4, 30, 4, LX - 3, Y1 + 8, 5, M.metal);
        P.box(LX - 4, Y1 + 8, -4, -52, Y1 + 9, 5, M.metal);
        // разгрузочная площадка под средним силосом: тележка
        P.body(-6, 0, -20, 6, 8, -12, (lx, ly) => (ly < 2 ? M.rubber : (ly === 7 ? M.rust : M.steelg)));
    };

    /** Газовая ёмкость: горизонтальный цилиндр из взрывоопасного материала на бетонных опорах, лестница, вентили. */
    B['factory-lpg'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const GAS = M.fueltank || M.barrel;
        for (const sx of [-30, 0, 30]) P.box(sx - 3, 0, -10, sx + 3, 8, 10, (lx, ly, lz) => (ly < 7 || Math.abs(lz + 0.5) > 8 ? M.concrete : -1));
        P.cylX(19, 0.5, -38, 38, 13, 11.4, (lx) => (lx === -38 || lx === 37 ? M.metal : GAS));
        P.cylX(19, 0.5, -40, -38, (lx) => 10 - (-38 - lx) * 3, 0, GAS);
        P.cylX(19, 0.5, 38, 40, (lx) => 10 - (lx - 37) * 3, 0, GAS);
        P.box(-4, 32, -3, 4, 36, 4, M.metal);
        P.cylY(0, 0.5, 36, 40, 2.5, 0, M.ctr_red);
        P.box(-36, 32, -2, -30, 33, 3, M.metal);
        for (let ly = 0; ly < 32; ly += 3) P.box(-42, ly, -2, -41, ly + 1, 3, M.metal);
        P.box(-42, 0, -3, -41, 34, -2, M.metal); P.box(-42, 0, 3, -41, 34, 4, M.metal);
        P.box(-42, 32, -3, -36, 33, 4, M.metal);
        // ограждение и знаки
        P.box(-46, 0, -18, 46, 12, 18, (lx, ly, lz) => {
            const e = lx === -46 || lx === 45 || lz === -18 || lz === 17;
            if (!e) return -1;
            if (lz === 17 && lx > -6 && lx < 6) return -1;
            const a = (lx === -46 || lx === 45) ? lz : lx;
            if (ly === 11 || ly === 6) return M.metal;
            return (a % 8 === 0) ? M.metal : -1;
        });
        P.box(-6, 8, 17, 6, 12, 18, (lx, ly) => (ly === 8 || ly === 11 ? M.ctr_red : M.paint));
    };

    /** Эстакада труб вдоль x: портальные рамы, два яруса, трубы разных цветов, узел задвижек на востоке. */
    B['factory-piperack'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const L0 = -104, L1 = 104;
        for (let px = L0 + 2; px < L1; px += 40) {
            for (const pz of [-10, 7]) P.box(px, 0, pz, px + 3, 44, pz + 3, M.steelg);
            for (const ly of [30, 41]) P.box(px, ly, -10, px + 3, ly + 3, 10, M.steelg);
            P.line(px + 1, 2, -9, px + 1, 30, 8, M.steelg);
        }
        for (const ly of [33, 44]) for (const pz of [-10, 8]) P.box(L0, ly - 3, pz, L1, ly - 1, pz + 2, M.steelg);
        const pipes = [[33, -6, 2.6, M.ctr_green], [33, 0, 3.4, M.rust], [33, 6, 2.2, M.hazard], [44, -5, 3.0, M.tanksteel], [44, 3, 2.4, M.ctr_blue]];
        for (const [py, pz, r, m] of pipes) {
            P.cylX(py + r, pz, L0 - 4, L1, r, r > 2.5 ? r - 1.6 : 0, (lx) => ((lx - L0) % 30 === 0 ? M.metal : m));
        }
        // узел задвижек и спуск труб в землю
        for (const [py, pz, r, m] of pipes) {
            P.cylY(L1 + 2 + (pz + 6) * 0.6, pz, -3, py + Math.ceil(r * 2), r, 0, m);
        }
        P.box(L1 - 2, 0, -14, L1 + 14, 1, 14, M.concrete2);
        for (const pz of [-6, 0, 6]) P.cylZ(L1 + 6, 14, pz - 1, pz + 1, 3, 0, M.ctr_red);
        // западный конец: колено вниз к ёмкости
        P.cylY(L0 - 2, 0, 8, 37, 3.4, 1.8, M.rust);
        P.cylX(10, 0, L0 - 30, L0, 3.4, 1.8, M.rust);
        P.box(L0 - 30, 0, -3, L0 - 26, 7, 3, M.concrete);
    };

    /** Галерея конвейера: наклонный короб из профлиста с окнами от цеха (−z, выше) к складу (+z), опора посередине. */
    B['factory-gallery'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const Z0 = -54, Z1 = 56, W = 12, H = 22;
        const by = (lz) => Math.round(62 - (lz - Z0) * (24 / (Z1 - Z0)));
        for (let lz = Z0 - 4; lz < Z1 + 4; lz++) {
            const y = by(lz);
            P.box(-W, y, lz, W, y + H, lz + 1, (lx, ly) => {
                const k = ly - y, e = lx === -W || lx === W - 1;
                if (k < 2) return (lz & 1) || e ? M.metal : M.scaffold;
                if (k === H - 1 || k === H - 2) return (lx & 1) ? M.corrugated : M.corrugated2;
                if (!e) {
                    if (k === 2 && lx > -6 && lx < 6) return M.metal;              // рама ленты
                    if (k === 5 && lx > -6 && lx < 6) return M.rubber;
                    if ((k === 3 || k === 4) && (lx === -6 || lx === 5) && (lz % 8 === 0)) return M.metal;
                    return 0;
                }
                if (k > 8 && k < 15) return (lz % 10 === 0) ? M.metal : M.glass;
                return (lz & 1) ? M.corrugated2 : M.steelg;
            });
            // промежуток с соседним слоем: закрыть ступеньку
            const y2 = by(lz + 1);
            if (y2 !== y) P.box(-W, Math.min(y, y2), lz, W, Math.max(y, y2) + 1, lz + 1, (lx, ly) => (ly === Math.min(y, y2) ? M.metal : -1));
        }
        // ящики на ленте
        for (let lz = Z0 + 8; lz < Z1 - 6; lz += 18) P.box(-3, by(lz) + 6, lz, 3, by(lz) + 11, lz + 5, M.crate);
        // опора посередине
        const MZ = 6, my = by(MZ + 4);
        for (const [ox, oz] of [[-W, MZ], [W - 2, MZ], [-W, MZ + 6], [W - 2, MZ + 6]]) P.box(ox, 0, oz, ox + 2, my, oz + 2, M.metal);
        for (let ly = 4; ly < my - 6; ly += 14) { P.line(-W, ly, MZ, W - 2, ly + 12, MZ, M.metal); P.line(W - 2, ly, MZ + 7, -W, ly + 12, MZ + 7, M.metal); P.box(-W, ly, MZ, W, ly + 1, MZ + 8, (lx, a, lz) => (lz === MZ || lz === MZ + 7 ? M.metal : -1)); }
        // кронштейны в стены (крепление на концах)
        P.box(-W, by(Z0) - 6, Z0 - 4, W, by(Z0), Z0 - 2, M.metal);
        P.box(-W, by(Z1) - 6, Z1 + 2, W, by(Z1), Z1 + 4, M.metal);
    };

    /** Склад: стальной каркас, стены из профлиста, кровля, стеллажи с ящиками, погрузчик, рампа. */
    B['factory-warehouse'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -105, X1 = 105, Z0 = -55, Z1 = 55, H = 66;
        const rr = (lz) => H + Math.floor((55 - Math.abs(lz + 0.5)) / 5);        // кровля 1:5
        // каркас
        for (let px = X0; px <= X1 - 3; px += 30) for (const pz of [Z0, Z1 - 3]) P.box(px, 0, pz, px + 3, rr(pz) + 1, pz + 3, M.ctr_blue);
        // стены: цоколь из кирпича, профлист с полосой окон
        P.box(X0, 0, Z0, X1, H + 12, Z1, (lx, ly, lz) => {
            const ex = lx === X0 || lx === X1 - 1, ez = lz === Z0 || lz === Z1 - 1;
            if (!ex && !ez) return -1;
            const top = ex ? rr(lz) : H;
            if (ly > top) return -1;
            if (ly < 8) return brickF(lx, ly, lz);
            const a = ez ? lx : lz;
            // ворота: юг x −40..−6 и 30..64, запад один проём
            if (ez && lz === Z1 - 1 && ((lx >= -40 && lx < -6) || (lx >= 30 && lx < 64)) && ly < 48) return (lx >= 30 && ly > 30) ? ((ly & 1) ? M.corrugated : M.metal) : 0;
            if (ex && lx === X0 && lz >= -14 && lz < 14 && ly < 44) return 0;
            if (ly > 44 && ly < 54) return (a % 10 === 0) ? M.metal : M.glass;
            if (ly === 44 || ly === 54) return M.metal;
            return ((a >> 1) & 1) ? M.corrugated2 : M.steelg;
        });
        // кровля 2 слоя со светопрозрачными полосами
        P.box(X0 - 2, H, Z0 - 2, X1 + 2, H + 13, Z1 + 2, (lx, ly, lz) => {
            const r = rr(Math.max(Z0, Math.min(Z1 - 1, lz)));
            if (ly !== r && ly !== r + 1) return -1;
            if (((lx - X0) % 30) > 10 && ((lx - X0) % 30) < 20 && Math.abs(lz) > 8 && Math.abs(lz) < 40 && lx > X0 + 2 && lx < X1 - 2) return M.glass;
            return (lx & 1) ? M.corrugated : M.metal;
        });
        // фермы-ригели под кровлей
        for (let px = X0; px <= X1 - 3; px += 30) for (let lz = Z0; lz < Z1; lz++) P.box(px, rr(lz) - 3, lz, px + 3, rr(lz), lz + 1, M.ctr_blue);
        // рампа у южных ворот
        P.box(-46, 0, Z1, 0, 6, Z1 + 14, M.concrete);
        for (let i = 0; i < 6; i++) P.box(-52 + i, 0, Z1, -51 + i, i + 1, Z1 + 14, M.concrete);
        P.box(-46, 5, Z1 + 13, 0, 6, Z1 + 14, M.hazard);
        // стеллажи: 3 ряда вдоль x, по 3 яруса; на балках ящики (тела)
        for (const rz of [-40, -10, 20]) {
            for (let px = -90; px <= 80; px += 34) for (const oz of [0, 9]) {
                P.box(px, 0, rz + oz, px + 2, 58, rz + oz + 2, M.ctr_blue);
                if (oz === 0) for (let ly = 6; ly < 54; ly += 12) P.line(px, ly, rz + 1, px, ly + 10, rz + 9, M.ctr_blue);
            }
            for (const ly of [18, 36, 54]) for (const oz of [0, 9]) P.box(-90, ly, rz + oz, 82, ly + 2, rz + oz + 2, M.ctr_orange);
            for (let px = -90; px < 80; px += 34) {
                for (const ly of [0, 20, 38, 56]) for (let k = 0; k < 2; k++) {
                    if (hash(px, ly + k * 7, rz) > (ly === 56 ? 0.25 : 0.5)) continue;
                    const cx = px + 3 + k * 16, s = 11 + ((px + ly + k) & 1);
                    if (ly === 0) { pallet(P, cx, 0, rz, 14, 11); crate(P, cx + 1, 2, rz, s, s - 2); }
                    else crate(P, cx + 1, ly, rz, s, s - 2);
                }
            }
        }
        // погрузчик и поддоны у ворот
        forklift(P, -36, 0, 38); forklift(P, 20, 0, 38);
        for (let i = 0; i < 3; i++) { pallet(P, 60 + i * 14, 0, 38); crate(P, 61 + i * 14, 2, 38, 10, 8); }
        bagPallet(P, -80, 0, 40, 4); bagPallet(P, -66, 0, 40, 3);
    };

    /** Контора: 2 этажа, штукатурка на кирпичном цоколе, ленточные окна, лестница, кабинеты, кондиционеры на крыше. */
    B['factory-office'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -60, X1 = 60, Z0 = -45, Z1 = 45, FH = 30;
        // перекрытия
        P.box(X0, 0, Z0, X1, 2, Z1, M.concrete);
        P.box(X0, FH, Z0, X1, FH + 2, Z1, M.concrete);
        P.box(X0 - 2, 2 * FH, Z0 - 2, X1 + 2, 2 * FH + 2, Z1 + 2, M.concrete2);
        P.box(-56, FH, -40, -40, FH + 2, -20, 0);
        // наружные стены с ленточными окнами
        P.box(X0, 2, Z0, X1, 2 * FH, Z1, (lx, ly, lz) => {
            const tx = Math.min(lx - X0, X1 - 1 - lx), tz = Math.min(lz - Z0, Z1 - 1 - lz), t = Math.min(tx, tz);
            if (t > 1) return -1;
            const k = ly % FH, a = tx === t ? lz : lx;
            if (ly >= FH && ly < FH + 2) return M.concrete;
            if (ly < 8) return brickF(lx, ly, lz);
            if (k > 10 && k < 24) {
                if (tz === t && lz > 0 && lx > -8 && lx < 8 && ly < FH) return t === 1 ? ((lx === -7 || lx === 7 || k === 23) ? M.darkwood : (lx === 0 ? M.metal : M.glass)) : 0;
                if (t === 1) return (a % 12 === 0) ? M.paint : M.glass;
                return 0;
            }
            if (tz === t && lz > 0 && lx > -8 && lx < 8 && ly < 24) return t === 1 && (lx === -7 || lx === 7) ? M.darkwood : 0;
            return k === 10 ? M.paint : M.plaster;
        });
        // парапет и козырёк входа
        P.walls(X0 - 2, 2 * FH + 2, Z0 - 2, X1 + 2, 2 * FH + 6, Z1 + 2, 2, M.plaster);
        P.box(-14, 24, Z1, 14, 26, Z1 + 14, M.concrete2);
        for (const cx of [-13, 12]) P.box(cx, 2, Z1 + 12, cx + 1, 24, Z1 + 13, M.metal);
        P.box(-12, 0, Z1, 12, 2, Z1 + 12, M.concrete);
        // внутренние стены: коридор вдоль x, кабинеты
        for (const f of [0, 1]) {
            const y0 = 2 + f * FH, y1 = (f + 1) * FH;
            P.box(X0 + 2, y0, -8, X1 - 2, y1, -6, (lx, ly) => ((lx + 60) % 30 > 20 && (lx + 60) % 30 < 28 && ly < y0 + 21 ? 0 : M.plaster2));
            for (const cx of [-30, 0, 30]) P.box(cx, y0, Z0 + 2, cx + 2, y1, -8, M.plaster2);
            // мебель: столы и стулья (столы — статика, стулья — тела)
            for (const cx of [-15, 15, 45]) {
                P.box(cx - 6, y0, -34, cx + 6, y0 + 8, -26, (lx, ly, lz) => (ly === y0 + 7 ? M.plank : ((lx === cx - 6 || lx === cx + 5) && (lz === -34 || lz === -27) ? M.darkwood : -1)));
                P.box(cx - 3, y0 + 8, -32, cx + 1, y0 + 11, -30, M.plaster2);
                P.body(cx - 2, y0, -24, cx + 3, y0 + 10, -19, (lx, ly, lz) => (ly < y0 + 4 ? ((lx === cx - 2 || lx === cx + 2) && (lz === -24 || lz === -20) ? M.metal : 0) : ly === y0 + 4 ? M.blue : (lz === -20 ? M.blue : 0)));
                P.box(cx + 7, y0, Z0 + 3, cx + 13, y0 + 18, Z0 + 7, (lx, ly) => ((ly - y0) % 6 === 5 ? M.metal : M.steelg));
            }
            // у южной стены: шкафы с папками, кулер
            P.box(30, y0, 34, 50, y0 + 20, 41, (lx, ly) => ((ly - y0) % 5 === 4 ? M.darkwood : (hash(lx, ly, f) < 0.5 ? M.goods_y || M.crate : M.crate)));
        }
        // лестница: марш вдоль +z в проёме перекрытия (10 ступеней по 30 см)
        for (let i = 0; i < 10; i++) P.box(-56, Math.max(2, 3 * i - 1), -40 + 2 * i, -40, 5 + 3 * i, -38 + 2 * i, M.concrete2);
        P.box(-57, FH + 2, -40, -56, FH + 12, -20, (lx, ly, lz) => (ly === FH + 11 || lz % 5 === 0 ? M.metal : -1));
        P.box(-56, FH + 2, -41, -40, FH + 12, -40, (lx, ly) => (ly === FH + 11 || lx % 5 === 0 ? M.metal : -1));
        // крыша: кондиционеры, бак, антенна
        for (const cx of [-40, -20]) { P.box(cx, 2 * FH + 2, -20, cx + 14, 2 * FH + 10, -8, (lx, ly, lz) => (lz === -8 && (lx & 1) ? M.metal : M.paint)); P.cylZ(cx + 7, 2 * FH + 6, -8, -7, 3, 0, M.metal); }
        P.cylY(30, 20, 2 * FH + 2, 2 * FH + 4, 7, 0, M.metal);
        for (const [ox, oz] of [[25, 15], [34, 15], [25, 24], [34, 24]]) P.box(ox, 2 * FH + 4, oz, ox + 2, 2 * FH + 10, oz + 2, M.metal);
        P.cylY(30, 20, 2 * FH + 10, 2 * FH + 20, 6, 4.4, M.tanksteel);
        P.box(48, 2 * FH + 2, 30, 49, 2 * FH + 32, 31, M.metal);
        P.box(44, 2 * FH + 26, 30, 53, 2 * FH + 27, 31, M.metal);
    };

    /** Двор завода: тягач с площадкой и рулонами (тела), поддоны у рампы склада, бункер с ломом, бочки у котельной. */
    B['factory-yard'] = function (w, x, z) {                      // раскладка от маркера в (256, 256)
        const P = new Plot(w, x - 256, z - 256, 0);
        // полуприцеп-площадка вдоль x (x 112..176, z 244..264) и тягач спереди (x 176..202)
        for (const ax of [118, 128, 164]) for (const az of [244, 260]) P.cylZ(ax, 4, az, az + 4, 4.2, 0, (a, b, c, d) => (d < 1.8 ? M.metal : M.rubber));
        P.box(114, 4, 247, 176, 7, 257, M.metal);
        P.box(112, 7, 244, 178, 9, 264, (lx, ly, lz) => (ly === 8 && (lz === 244 || lz === 263) ? M.ctr_red : (((lx - 112) % 8) === 0 ? M.darkwood : M.plank)));
        for (let i = 0; i < 3; i++) coil(P, 116 + i * 20, 9, 248, 6, 12, i === 1 ? M.rust : M.metal);
        P.box(178, 0, 246, 204, 26, 262, (lx, ly, lz) => {
            const i = lx - 178, j = lz - 246;
            if (ly < 9) {
                const wheel = ((i > 2 && i < 11) || (i > 17 && i < 25)) && (j < 3 || j > 12);
                if (wheel) return ly < 8 ? M.rubber : M.metal;
                return j > 2 && j < 13 && ly > 3 ? M.metal : -1;
            }
            if (i < 10) return ly < 11 ? M.metal : (i === 3 && j === 3 && ly < 24 ? M.metal : -1);
            if (ly > 15 && ly < 22 && (i === 25 || j === 0 || j === 15) && i > 12) return M.glass;
            if (i === 25 && ly < 14 && (j & 1)) return M.metal;
            return ly === 25 ? M.paint : M.ctr_blue;
        });
        // поддоны с ящиками у рампы склада (тела)
        for (let i = 0; i < 4; i++) { pallet(P, 362 + i * 14, 0, 458, 12, 10); crate(P, 363 + i * 14, 2, 458, 10, 9); if (i & 1) crate(P, 364 + i * 14, 11, 459, 8, 7); }
        // бункер с металлоломом у котельной (тело)
        P.box(396, 0, 166, 420, 14, 182, (lx, ly, lz) => {
            const i = lx - 396, j = lz - 166, sl = (ly * 0.35) | 0;
            if (i < 3 - sl || i > 20 + sl) return 0;
            if (i === 3 - sl || i === 20 + sl || j === 0 || j === 15 || ly === 0) return ly === 13 ? M.metal : M.ctr_orange;
            if (ly < 10 + ((i * 5 + j * 3) % 4)) return hash(lx, ly, lz) < 0.5 ? M.rust : (hash(lx, ly, lz) < 0.8 ? M.metal : M.plank);
            return 0;
        });
        P.dyn(396, 0, 166, 420, 14, 182);
        // бочки с мазутом у котельной
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) barrel(P, 382 + j * 6, 0, 100 + i * 7, (i + j) % 3 === 0 ? M.rust : M.barrel);
    };

    /** Клетка с газовыми баллонами у стены цеха: решётка, навес, баллоны в три ряда (тела). */
    B['factory-cage'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -22, X1 = 22, Z0 = -8, Z1 = 10, H = 26;
        P.box(X0, 0, Z0, X1, 1, Z1, M.concrete2);
        P.box(X0, 1, Z0, X1, H, Z1, (lx, ly, lz) => {
            const ex = lx === X0 || lx === X1 - 1, ez = lz === Z1 - 1;
            if (!ex && !ez) return -1;
            if (ez && lx > -6 && lx < 6 && ly < 22) return (lx === -5 || lx === 5) ? M.metal : (lx % 3 === 0 || ly % 4 === 0 ? M.metal : 0);
            const a = ex ? lz : lx;
            return (a % 3 === 0 || ly % 6 === 0 || ly === H - 1) ? M.metal : 0;
        });
        P.box(X0 - 2, H, Z0, X1 + 2, H + 1, Z1 + 3, (lx) => ((lx & 1) ? M.corrugated : M.metal));
        P.box(-12, 14, Z1, 12, 20, Z1 + 1, (lx, ly) => (ly === 14 || ly === 19 ? M.ctr_red : M.paint));
        let k = 0;
        for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) {
            const cx = X0 + 3 + i * 4 + (r & 1), cz = Z0 + 1 + r * 4;
            gasCylinder(P, cx, 1, cz, (k++ % 3 === 1) ? M.oxygen : M.barrel, 15);
        }
        // цепь вдоль ряда
        P.box(X0 + 1, 11, Z0 + 1, X1 - 1, 12, Z0 + 2, -1);
    };

    // ================================================================== ПОРТ (docks)
    // Сухой док (бетонные стенки, грязное дно с лужами) с судном на кильблоках и подпорах, портальный
    // контейнерный кран над доком с контейнером на тросах, штабели контейнеров (низ — статика, верх — тела),
    // деревянный пирс на сваях с бочками, кирпичный и стальной склады, контора порта с маячной башней.

    const DOCK = { X0: 52, X1: 460, Z0: 58, Z1: 168, FLOOR: -17 };     // внутренность дока (мир), дно — ly
    const CTR = [M.ctr_red, M.ctr_blue, M.ctr_green, M.ctr_orange, M.ctr_red, M.steelg, M.ctr_blue, M.ctr_orange, M.rust];

    /** Контейнер 60×26×24 (вдоль x): стенки с рёбрами, угловые фитинги, двери с запорами на торце +x. */
    function container(P, x0, y0, z0, mat, dyn) {
        const L = 60, H = 26, D = 24;
        P.box(x0, y0, z0, x0 + L, y0 + H, z0 + D, (lx, ly, lz) => {
            const i = lx - x0, k = ly - y0, j = lz - z0;
            const endI = i === 0 || i === L - 1, endK = k === 0 || k === H - 1;
            const sideOut = j === 0 || j === D - 1, sideIn = j === 1 || j === D - 2;
            if (endK) return (endI && (j < 2 || j > D - 3)) ? M.metal : ((j < 2 || j > D - 3) ? mat : (endK && k === 0 ? M.rust : mat));
            if (endI) {
                if (j < 2 || j > D - 3) return M.metal;                              // угловые стойки
                if (i === L - 1 && (j === 5 || j === 9 || j === 14 || j === 18)) return M.metal;   // запоры
                if (i === L - 1 && j === 11) return M.rust;                           // стык створок
                return mat;
            }
            if (sideIn) return mat;
            if (sideOut) return (i % 4 < 2) ? mat : -1;                                // рёбра
            return -1;
        });
        if (dyn) P.dyn(x0, y0, z0, x0 + L, y0 + H, z0 + D);
    }
    /** Кнехт: плита, тумба, шляпка. */
    function bollard(P, x0, z0) {
        P.box(x0, 0, z0, x0 + 6, 1, z0 + 6, M.metal);
        P.cylY(x0 + 3, z0 + 3, 1, 6, 2, 0, M.metal);
        P.cylY(x0 + 3, z0 + 3, 6, 7, 2.8, 0, M.metal);
    }
    /** Фонарный столб высотой h с плафоном вдоль +x. */
    function lampPost(P, x0, z0, h) {
        P.box(x0 - 1, 0, z0 - 1, x0 + 3, 2, z0 + 3, M.concrete2);
        P.box(x0, 2, z0, x0 + 2, h, z0 + 2, M.metal);
        P.box(x0, h - 2, z0, x0 + 9, h, z0 + 2, M.metal);
        P.box(x0 + 5, h - 3, z0 - 1, x0 + 10, h - 2, z0 + 3, M.lamp);
    }

    B['docks-terrain'] = function (w) {
        const G = GB.GROUND, Y = G - 1;
        paintGround(w, 0, 0, w.sx, w.sz, (x, z) => {
            const inside = x >= 40 && x < 472 && z >= 36 && z < 472;
            const n = vnoise(x, z, 15, 81), n2 = vnoise(x, z, 5, 82);
            if (!inside) return n2 < 0.2 ? M.dirt : -1;
            // причалы — бетон с температурными швами
            const quay = z < 58 || (z >= 168 && z < 200) || x >= 460;
            if (quay) {
                if ((z >= 182 && z < 184) || (z >= 286 && z < 288)) return M.metal;          // подкрановые рельсы
                if (z >= 196 && z < 198) return (x % 8) < 5 ? M.hazard : M.concrete;          // жёлтая линия
                return ((x % 40) === 0 || (z % 40) === 0) ? M.concrete2 : (n > 0.82 ? M.concrete2 : M.concrete);
            }
            if ((z >= 286 && z < 288) && x > 40) return M.metal;
            // дорога от ворот
            if (x >= 206 && x < 290 && z >= 330) {
                if (x >= 247 && x < 249 && (z % 18) < 10) return M.paint;
                return n > 0.85 ? M.rubber : M.asphalt;
            }
            // контейнерная площадка: асфальт, разметка мест
            if (z >= 200 && z < 330) {
                if ((z === 200 || z === 228 || z === 258 || z === 298 || z === 326) && x > 50 && x < 440) return M.paint;
                return n > 0.86 ? M.rubber : M.asphalt;
            }
            return n > 0.8 ? M.concrete2 : M.concrete;
        });
        // док: выкопать, дно — бетон с грязью и лужами
        const { X0, X1, Z0, Z1 } = DOCK;
        w.fill(X0, 3, Z0, X1, G, Z1, 0);
        for (let z = Z0; z < Z1; z++) for (let x = X0; x < X1; x++) {
            const a = vnoise(x, z, 13, 83), b = vnoise(x, z, 4, 84);
            w.put(x, 1, z, M.mud);
            w.put(x, 2, z, a > 0.7 ? M.murk : (a > 0.52 || b > 0.85 ? M.mud : M.concrete2));
        }
        // стенки дока и бортик
        w.fill(48, 2, Z1, 464, G, Z1 + 4, M.concrete2);
        w.fill(48, 2, Z0 - 4, 464, G, Z0, M.concrete2);
        w.fill(X1, 2, Z0, X1 + 4, G, Z1, M.concrete2);
        w.fill(48, Y, Z1, 464, G, Z1 + 4, M.concrete); w.fill(48, Y, Z0 - 4, 464, G, Z0, M.concrete); w.fill(X1, Y, Z0, X1 + 4, G, Z1, M.concrete);
        for (let x = 48; x < 464; x++) {
            const gap = (x >= 56 && x < 92) || (x >= 398 && x < 442);
            if (!gap) { w.put(x, G, Z1, M.concrete); w.put(x, G, Z1 + 1, M.concrete); w.put(x, G + 1, Z1, (x >> 2) & 1 ? M.hazard : M.paint); }
            w.put(x, G, Z0 - 1, M.concrete); w.put(x, G + 1, Z0 - 1, (x >> 2) & 1 ? M.hazard : M.paint);
        }
        for (let z = Z0; z < Z1; z++) { w.put(X1, G, z, M.concrete); w.put(X1, G + 1, z, (z >> 2) & 1 ? M.hazard : M.paint); }
        // скобы-трапы в стенках
        for (let x = 120; x < 460; x += 70) for (let y = 4; y < G; y += 3) { w.put(x, y, Z1 - 1, M.metal); w.put(x + 3, y, Z1 - 1, M.metal); w.put(x + 1, y, Z1 - 1, M.metal); w.put(x + 2, y, Z1 - 1, M.metal); }
        // лестница в док у западного конца (вдоль южной стенки)
        for (let i = 0; i < 6; i++) w.fill(60 + 6 * i, 3, Z1 - 10, 66 + 6 * i, G - 1 - 3 * i, Z1, M.concrete);
        edgeBerm(w, 34, 6, 20, 85, (x, z, h) => (vnoise(x, z, 7, 86) < 0.3 ? M.dirt : M.grass), M.dirt);
    };

    /** Батопорт (стальной затвор) западного торца дока с переходом. */
    B['docks-gate'] = function (w, x, z) {                        // маркер в (49, 113)
        const P = new Plot(w, x - 49, z - 113, 0);
        const { Z0, Z1 } = DOCK;
        P.box(46, -18, Z0 - 2, 52, 2, Z1 + 2, (lx, ly, lz) => {
            if (ly >= 0) return ly === 1 && (lx === 46 || lx === 51) ? M.rust : (ly === 0 ? M.metal : -1);
            if ((lz - Z0) % 12 === 0 || ly % 6 === 0) return M.rust;
            return (lx === 51 && hash(lx, ly, lz) < 0.08) ? M.rust : M.ctr_blue;
        });
        for (const lx of [46, 51]) P.box(lx, 1, Z0 - 2, lx + 1, 10, Z1 + 2, (a, ly, lz) => (ly === 9 || ly === 5 || lz % 8 === 0 ? M.metal : -1));
        P.box(42, 0, Z1 - 4, 46, 8, Z1 + 2, M.metal);
        P.cylX(5, Z1 - 1, 40, 44, 3, 0, M.rust);
    };

    /** Судно в доке на кильблоках и подпорах: корпус, трюмы, надстройка с рубкой, труба, мачта, кран, шлюпка. */
    B['docks-ship'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const KY = -11, DY = 24, B2 = 28;
        const keel = (lx) => KY + (lx < -90 ? (-90 - lx) * 0.4 : 0);
        const bow = (ly) => 96 + (ly - KY) * 0.4;
        const hw = (lx, ly) => {
            const kl = keel(lx);
            if (ly < Math.floor(kl) || lx > bow(ly) || lx < -110) return 0;
            const t = Math.min(1, (ly - kl + 0.5) / 8);
            const hb = 0.62 + 0.38 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
            let tp = 1;
            if (lx > 50) { const f = (lx - 50) / (bow(ly) - 50); tp = Math.sqrt(Math.max(0, 1 - f * f)); }
            if (lx < -80) { const a = (-80 - lx) / 30; tp = 1 - 0.35 * a * a; }
            return B2 * hb * tp;
        };
        const hullCol = (ly) => (ly < 1 ? M.redwash : (ly < 3 ? M.paint : M.ctr_blue));
        P.box(-112, KY, -B2 - 1, 112, DY + 6, B2 + 1, (lx, ly, lz) => {
            const h = hw(lx, Math.min(ly, DY - 1)), d = Math.abs(lz + 0.5);
            if (h <= 0.5 || d >= h) return -1;
            const kl = Math.floor(keel(lx));
            if (ly >= DY) {                                                        // фальшборт
                if (ly < DY + 4 && d > h - 1.6) return ly === DY + 3 ? M.paint : M.ctr_blue;
                return -1;
            }
            const shell = d > h - 2 || ly < kl + 2 || lx <= -109 || lx >= bow(ly) - 2;
            if (ly >= DY - 2) {                                                    // палуба с люками
                const hatch = (lx >= -40 && lx < 0) || (lx >= 10 && lx < 50);
                if (hatch && d < 16 && !shell) return 0;
                return shell ? hullCol(ly) : ((lx + 200) % 10 === 0 ? M.rust : M.metal);
            }
            if (shell) {
                const outer = d > h - 1;
                if (outer && (ly === 13 || ly === 14) && ((lx > -106 && lx < -64) || (lx > 82 && lx < 100)) && ((lx + 200) % 6) < 2) return M.glass;   // иллюминаторы
                if (outer && ly > 3 && ly > DY - 3 - Math.floor(hash(lx, 1, lz > 0 ? 3 : 4) * 16) && hash(lx, 2, lz > 0 ? 5 : 6) < 0.07) return M.rust;   // потёки ржавчины
                return hullCol(ly);
            }
            if (lx === -50 || lx === 60) return M.metal;                             // переборки
            if (ly === kl + 2 && lx > -50 && lx < 60) return M.plank;                // настил трюма
            return 0;
        });
        // комингсы люков, крышки на первом
        for (const [a0, a1] of [[-40, 0], [10, 50]]) {
            P.box(a0 - 1, DY, -17, a1 + 1, DY + 4, 17, (lx, ly, lz) => (lx === a0 - 1 || lx === a1 || lz === -17 || lz === 16 ? M.metal : -1));
        }
        P.box(-40, DY + 3, -16, 0, DY + 5, 16, (lx, ly) => (ly === DY + 4 ? ((lx & 7) === 0 ? M.metal : M.steelg) : ((lx & 7) === 0 ? M.metal : -1)));
        // бак (приподнятая палуба носа)
        P.box(80, DY - 1, -B2, 112, DY + 5, B2, (lx, ly, lz) => {
            const h = hw(lx, DY - 1), d = Math.abs(lz + 0.5);
            if (h <= 0.5 || d >= h) return -1;
            if (ly === DY + 4) return M.metal;
            return d > h - 2 ? M.ctr_blue : -1;
        });
        P.box(92, DY + 5, -6, 100, DY + 10, 6, M.metal);                            // брашпиль
        const az = Math.floor(hw(100, 15));
        for (const s of [-1, 1]) P.box(98, 12, s > 0 ? az - 1 : -az - 2, 103, 18, s > 0 ? az + 2 : -az + 1, M.rust);   // якоря
        // надстройка на корме: 3 яруса, рубка с панорамными окнами, крылья мостика
        const SX0 = -104, SX1 = -62;
        for (let lv = 0; lv < 3; lv++) {
            const y0 = DY + lv * 12, inset = lv * 2, z0 = -20 + (lv === 2 ? -6 : 0), z1 = 20 + (lv === 2 ? 6 : 0);
            P.box(SX0 + inset, y0, z0, SX1 - inset, y0 + 12, z1, (lx, ly, lz) => {
                const ex = lx === SX0 + inset || lx === SX1 - inset - 1, ez = lz === z0 || lz === z1 - 1, k = ly - y0;
                if (k === 11) return lv === 2 ? M.metal : M.paint;
                if (!ex && !ez) return k === 0 ? M.plaster2 : (lv === 2 && k === 4 && lx > SX1 - 12 && Math.abs(lz + 0.5) < 8 ? M.darkwood : -1);
                if (ex && ez) return M.paint;
                const a = ex ? lz : lx;
                if (lv === 2) return (k > 3 && k < 10) ? (((a + 64) % 6) === 0 ? M.paint : M.glass) : M.paint;
                if (lv === 0 && lx === SX1 - 1 && Math.abs(lz + 0.5) < 3 && k > 0 && k < 10) return 0;   // дверь на палубу
                if (k > 4 && k < 9 && ((a + 64) % 8) > 1 && ((a + 64) % 8) < 6) return M.glass;
                return M.paint;
            });
        }
        P.box(SX1 - 12, DY + 23, -30, SX1 - 4, DY + 25, 30, M.metal);               // крылья мостика
        P.box(SX0 + 6, DY + 36, -14, SX1 - 6, DY + 38, 14, M.metal);
        P.box(SX0 + 20, DY + 38, -1, SX0 + 22, DY + 56, 1, M.metal);                // радарная мачта
        P.box(SX0 + 14, DY + 52, -1, SX0 + 28, DY + 53, 1, M.metal);
        P.box(SX0 + 18, DY + 56, -6, SX0 + 24, DY + 57, 6, M.paint);
        // труба: овал, красная полоса, чёрный верх
        P.cylY(SX0 + 12, 0, DY + 36, DY + 60, (ly) => 6.5 + (ly - DY - 36) * 0.03, (ly) => 4.8, (lx, ly) => (ly > DY + 54 ? M.rubber : (ly > DY + 44 && ly < DY + 50 ? M.redwash : M.paint)));
        // шлюпка на шлюпбалках (левый борт)
        for (const dx of [SX0 + 10, SX0 + 28]) P.box(dx, DY + 19, -27, dx + 2, DY + 21, -20, M.metal);
        P.box(SX0 + 8, DY + 14, -27, SX0 + 32, DY + 19, -21, (lx, ly, lz) => {
            const k = ly - DY - 14, e = lx === SX0 + 8 || lx === SX0 + 31 || lz === -27 || lz === -22 || k === 0;
            if (k === 0 && (lx < SX0 + 10 || lx > SX0 + 29)) return -1;
            return e ? M.ctr_orange : (k === 4 ? M.paint : -1);
        });
        // палубный кран между люками
        P.cylY(5, 0, DY, DY + 14, 3.5, 0, M.hazard);
        P.box(1, DY + 14, -4, 10, DY + 22, 4, M.hazard);
        P.line(2, DY + 16, 0, -32, DY + 40, 0, M.hazard, 2);
        P.box(-32, DY + 10, 0, -31, DY + 40, 1, M.cable);
        P.box(-34, DY + 6, -2, -29, DY + 10, 3, M.metal);
        // фок-мачта с салингом и огнём
        P.box(92, DY + 10, -1, 94, DY + 52, 1, M.metal);
        P.box(92, DY + 40, -8, 94, DY + 41, 8, M.metal);
        P.box(92, DY + 52, -1, 94, DY + 54, 1, M.lamp);
        // перо руля и винт
        P.box(-112, -11, -1, -110, -2, 1, M.rust);
        P.cylX(-5, 0.5, -108, -106, 5.5, 1, (lx, ly, lz, d, ang) => (Math.floor((ang + Math.PI) / (Math.PI / 2)) % 2 === 0 || d < 2 ? M.bronze || M.hazard : -1));
        // кильблоки (дерево на бетоне) и боковые клетки — до днища
        for (let lx = -84; lx <= 88; lx += 18) {
            P.box(lx, DOCK.FLOOR, -7, lx + 8, DOCK.FLOOR + 2, 7, M.concrete2);
            P.box(lx, DOCK.FLOOR + 2, -7, lx + 8, KY, 7, (a, ly) => ((ly & 1) ? M.darkwood : M.wood));
        }
        for (let lx = -70; lx <= 60; lx += 26) for (const s of [-1, 1]) {
            const lz0 = s > 0 ? 16 : -22;
            let top = DOCK.FLOOR;
            while (top < KY + 10 && !P.get(lx + 3, top, lz0 + 3)) top++;
            P.box(lx, DOCK.FLOOR, lz0, lx + 6, top, lz0 + 6, (a, ly, lz) => (((ly + (a + lz)) & 1) ? M.darkwood : M.wood));
        }
        // подпоры от стенок дока к бортам (дерево)
        for (let lx = -80; lx <= 70; lx += 30) for (const s of [-1, 1]) {
            const hz = Math.floor(hw(lx, 6));
            P.line(lx, -2, s > 0 ? 53 : -55, lx, 6, s > 0 ? hz : -hz - 1, M.darkwood, 2);
        }
        // груз в открытом трюме (тела)
        crate(P, 14, KY + 3, -12, 12, 10); crate(P, 28, KY + 3, -12, 12, 10); crate(P, 14, KY + 3, 2, 12, 10); crate(P, 30, KY + 3, 4, 9, 9);
        crate(P, 16, KY + 13, -10, 9, 8);
    };

    /** Портальный контейнерный кран: 4 ноги на тележках, вылет над доком, задняя консоль, А-рама с вантами, кабина, контейнер на спредере. */
    B['docks-crane'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const Y = M.hazard, LT = 112, BT = 124, TIP = -178, BACK = 100;
        const legs = [[-32, -57], [22, -57], [-32, 47], [22, 47]];
        for (const [lx, lz] of legs) {
            P.box(lx - 2, 0, lz - 1, lx + 12, 6, lz + 11, (a, ly, b) => (ly < 3 && (a + b) % 5 === 0 ? M.metal : (ly === 5 ? M.metal : Y)));
            P.cylX(2.5, lz + 1.5, lx - 2, lx + 12, 2.5, 0, M.rust); P.cylX(2.5, lz + 8.5, lx - 2, lx + 12, 2.5, 0, M.rust);
            P.box(lx, 6, lz, lx + 10, LT, lz + 10, (a, ly, b) => ((a === lx || a === lx + 9 || b === lz || b === lz + 9) ? ((ly - 6) % 26 === 25 ? M.ctr_red : Y) : -1));
        }
        // порталы: поперечины вдоль x поверху и посередине, раскосы
        for (const lz of [-57, 47]) {
            P.box(-32, LT - 12, lz, 32, LT, lz + 10, (a, ly, b) => (a > -22 && a < 22 && ly > LT - 11 && ly < LT - 1 && b > lz && b < lz + 9 ? -1 : Y));
            P.box(-22, 54, lz + 3, 22, 58, lz + 7, Y);
            P.line(-22, 58, lz + 5, 0, LT - 12, lz + 5, Y, 2); P.line(22, 58, lz + 5, 0, LT - 12, lz + 5, Y, 2);
        }
        // продольные балки портала (между ногами) и стрела: две коробчатые балки
        for (const gx of [-32, 24]) {
            P.box(gx, LT, TIP, gx + 8, BT, BACK, (a, ly, b) => {
                const e = a === gx || a === gx + 7 || ly === LT || ly === BT - 1;
                if (!e) return -1;
                if ((a === gx || a === gx + 7) && ly > LT + 2 && ly < BT - 3 && (b % 12) > 2 && (b % 12) < 10 && (b < -60 || b > 60)) return -1;   // облегчение
                return (b - TIP) % 36 === 0 ? M.ctr_red : Y;
            });
            P.box(gx + 2, BT, TIP, gx + 6, BT + 1, BACK, M.metal);                        // рельс тележки
            P.box(gx, BT - 2, TIP - 3, gx + 8, BT + 2, TIP, M.ctr_red);
        }
        for (let b = TIP + 20; b < BACK; b += 40) P.box(-24, BT - 3, b, 24, BT - 1, b + 3, Y);   // связи между балками
        // А-рама над сухопутными ногами и ванты (тросы) к концам
        for (const ax of [-29, 27]) {
            P.line(ax, BT, 47, ax, 168, 24, Y, 3);
            P.line(ax, BT, 4, ax, 168, 24, Y, 3);
            P.line(ax + 1, 168, 25, ax + 1, BT + 1, TIP + 4, M.cable);
            P.line(ax + 1, 168, 25, ax + 1, BT + 1, -80, M.cable);
            P.line(ax + 1, 168, 25, ax + 1, BT + 1, BACK - 4, M.cable);
        }
        P.box(-29, 166, 23, 30, 170, 28, Y);
        // машинное отделение на задней консоли
        P.box(-24, BT, 58, 24, BT + 18, 96, (a, ly, b) => {
            const e = a === -24 || a === 23 || b === 58 || b === 95 || ly === BT + 17;
            if (!e) return ly === BT ? M.metal : -1;
            if (ly === BT + 17) return M.corrugated;
            if (ly > BT + 6 && ly < BT + 11 && (a % 6 === 0 || b % 6 === 0)) return M.glass;
            return (a + b) & 1 ? M.paint : M.corrugated;
        });
        // тележка, кабина, тросы, спредер и контейнер над трюмом
        const TZ0 = -124, TZ1 = -100;
        P.box(-26, BT + 1, TZ0, 26, BT + 7, TZ1, (a, ly, b) => (ly === BT + 6 ? M.metal : ((a === -26 || a === 25 || b === TZ0 || b === TZ1 - 1) ? M.ctr_red : -1)));
        P.box(-20, BT - 14, TZ1 - 12, -6, BT, TZ1 - 2, (a, ly, b) => {
            const e = a === -20 || a === -7 || b === TZ1 - 12 || b === TZ1 - 3 || ly === BT - 14;
            if (!e) return -1;
            return ly > BT - 12 && ly < BT - 3 && a !== -20 ? M.glass : M.paint;
        });
        P.box(-14, BT - 2, TZ1 - 3, -10, BT + 1, TZ1, M.metal);
        for (const cx of [-12, 11]) for (const cz of [TZ0 + 4, TZ1 - 5]) P.box(cx, 64, cz, cx + 1, BT + 1, cz + 1, M.cable);
        P.box(-32, 60, TZ0, 32, 64, TZ1, (a, ly, b) => (b === TZ0 || b === TZ1 - 1 || a === -32 || a === 31 || ly === 63 ? Y : -1));
        for (const cx of [-31, 30]) for (const cz of [TZ0, TZ1 - 1]) P.box(cx, 59, cz, cx + 1, 60, cz + 1, M.metal);
        container(P, -30, 33, TZ0, M.ctr_orange, false);
        P.box(-31, 59, TZ0, 31, 60, TZ1, (a, ly, b) => ((a === -31 || a === 30) && (b === TZ0 || b === TZ1 - 1) ? M.metal : -1));
        P.box(-30, 59, TZ0 + 1, 30, 60, TZ1 - 1, (a, ly, b) => (a % 15 === 0 ? M.metal : -1));
        // лестница по ноге и площадки
        for (let ly = 8; ly < LT; ly += 3) P.box(22, ly, -58, 32, ly + 1, -57, (a) => (a === 26 || a === 27 ? M.metal : -1));
        // бочки у морских ног — цепная реакция
        barrel(P, -42, 0, -50); barrel(P, -42, 0, -43); barrel(P, 34, 0, -50); barrel(P, 34, 0, -43); barrel(P, -42, 0, 50);
    };

    /** Штабели контейнеров: ряды вдоль x; нижний ярус — статика, верхние — тела. h — высоты штабелей. */
    function containerRow(P, z0, xs, hs, seed) {
        for (let i = 0; i < xs.length; i++) for (let k = 0; k < hs[i]; k++) {
            const m = CTR[Math.floor(hash(i, k, seed) * CTR.length)];
            container(P, xs[i], k * 26, z0, m, k > 0);
        }
    }
    B['docks-containers'] = function (w, x, z) {                  // раскладка от маркера в (220, 265)
        const P = new Plot(w, x - 220, z - 265, 0);
        const xs = [54, 118, 182, 246, 310];
        containerRow(P, 202, xs, [2, 3, 1, 2, 4], 1);
        containerRow(P, 232, xs, [3, 1, 2, 3, 2], 2);
        containerRow(P, 300, [54, 118, 182, 310, 374], [1, 2, 4, 2, 3], 3);
        // одиночный контейнер на шасси-полуприцепе в проезде
        P.box(120, 0, 262, 186, 3, 266, M.metal); P.box(120, 0, 274, 186, 3, 278, M.metal);
        for (const ax of [128, 136, 176]) for (const az of [260, 276]) P.cylZ(ax, 3, az, az + 4, 3.2, 0, (a, b, c, d) => (d < 1.4 ? M.metal : M.rubber));
        P.box(120, 3, 260, 186, 5, 282, M.metal);
        container(P, 123, 5, 259, M.ctr_green, true);
        // тягач
        P.box(188, 0, 262, 216, 22, 280, (lx, ly, lz) => {
            const i = lx - 188, j = lz - 262;
            if (ly < 7) return ((i > 2 && i < 9) || (i > 18 && i < 25)) && (j < 3 || j > 14) ? M.rubber : (j > 2 && j < 15 && ly > 2 ? M.metal : -1);
            if (i < 12) return ly < 9 ? M.metal : -1;
            if (ly > 12 && ly < 19 && (i === 27 || j === 0 || j === 17) && i > 14) return M.glass;
            return ly === 21 ? M.paint : M.ctr_red;
        });
    };

    /** Деревянный пирс на сваях от южного причала, будка, фонарь, бочки, лодка на дне рядом. */
    B['docks-pier'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -20, X1 = 20, Z0 = -58, Z1 = 50, F = DOCK.FLOOR;
        // сваи и связи
        for (const px of [-19, -1, 17]) for (let pz = Z0; pz < Z1; pz += 18) {
            P.box(px, F, pz, px + 2, -3, pz + 2, M.darkwood);
            if (pz + 18 < Z1) P.line(px, F + 2, pz + 1, px, -5, pz + 17, M.wood, 1);
        }
        for (let pz = Z0; pz < Z1; pz += 18) P.line(-18, -12, pz, 18, -5, pz, M.wood, 1);
        // прогоны и настил (доски поперёк)
        for (const px of [-19, -1, 17]) P.box(px, -3, Z0, px + 2, -1, Z1 + 2, M.darkwood);
        P.box(X0, -1, Z0, X1, 0, Z1 + 2, (lx, ly, lz) => (((lz - Z0) % 3) === 2 ? M.wood : M.plank));
        // перила
        for (const px of [X0, X1 - 1]) P.box(px, 0, Z0, px + 1, 11, Z1, (lx, ly, lz) => ((lz - Z0) % 9 === 0 || ly === 10 || ly === 5 ? M.darkwood : -1));
        P.box(X0, 0, Z0, X1, 11, Z0 + 1, (lx, ly) => ((lx - X0) % 9 === 0 || ly === 10 || ly === 5 ? M.darkwood : -1));
        // будка на конце
        P.box(-18, 0, Z0 + 2, 4, 26, Z0 + 20, (lx, ly, lz) => {
            const e = lx === -18 || lx === 3 || lz === Z0 + 2 || lz === Z0 + 19;
            if (ly >= 24) return M.roof;
            if (!e) return ly === 0 ? M.plank : (ly < 8 && lz < Z0 + 7 && lx < -8 ? M.darkwood : -1);
            if (lx === 3 && lz > Z0 + 8 && lz < Z0 + 16 && ly < 20) return 0;
            if (lz === Z0 + 2 && lx > -14 && lx < -4 && ly > 9 && ly < 17) return M.glass;
            return ((lx + lz) & 3) === 0 ? M.darkwood : M.plank;
        });
        P.box(-19, 24, Z0 + 1, 5, 26, Z0 + 21, M.roof);
        lampPost(P, 14, Z0 + 3, 42);
        // бочки с топливом, баллоны, ящики на пирсе
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) barrel(P, 6 + j * 6, 0, Z0 + 24 + i * 7, i === 1 && j === 1 ? M.rust : M.barrel);
        gasCylinder(P, -16, 0, Z0 + 23, M.barrel); gasCylinder(P, -12, 0, Z0 + 23, M.oxygen);
        crate(P, -16, 0, Z0 + 30, 9, 8); crate(P, -15, 8, Z0 + 31, 7, 6); cableDrum(P, -6, 0, Z0 + 44, 6, 7);
        bollard(P, 12, Z0 + 46); bollard(P, -18, Z0 + 46); bollard(P, 12, 10);
        // моторная лодка на дне дока у пирса (тело): плоское днище, борта, рубка
        const BX0 = -48, BX1 = -26, BZ0 = -42, BZ1 = 12;
        P.box(BX0, F, BZ0, BX1, F + 20, BZ1, (lx, ly, lz) => {
            const k = ly - F, u = (lz - BZ0) / (BZ1 - BZ0);                    // 0 — нос, 1 — корма
            const half = 4 + k * 0.65 - (u < 0.3 ? (0.3 - u) * (12 + k * 1.2) : 0);
            const c = lx + 0.5 - (BX0 + BX1) / 2, d = Math.abs(c);
            if (k < 10) {
                if (half <= 0.5 || d >= half) return -1;
                const shell = d > half - 1.6 || k === 0 || lz === BZ1 - 1 || lz === BZ0;
                if (k === 9) return shell ? M.darkwood : M.plank;
                if (shell) return k < 4 ? M.redwash : M.paint;
                if (k === 1) return M.plank;
                return 0;
            }
            if (lz >= BZ0 + 26 && lz < BZ0 + 44 && d < 7) {                         // рубка
                const e = d > 6 || lz === BZ0 + 26 || lz === BZ0 + 43 || k === 19;
                if (!e) return 0;
                if (k > 12 && k < 17 && !(k === 19)) return M.glass;
                return k === 19 ? M.ctr_blue : M.paint;
            }
            return -1;
        });
        P.dyn(BX0, F, BZ0, BX1, F + 20, BZ1);
    };

    /** Контора порта с маячной башней: 2 этажа, полосатая башня, балкон, фонарь с лампой, купол. */
    B['docks-office'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -32, X1 = 32, Z0 = -26, Z1 = 28, FH = 30;
        P.box(X0, 0, Z0, X1, 2, Z1, M.concrete);
        P.box(X0, FH, Z0, X1, FH + 2, Z1, M.concrete);
        P.box(X0 - 2, 2 * FH, Z0 - 2, X1 + 2, 2 * FH + 2, Z1 + 2, M.concrete2);
        P.box(X0, 2, Z0, X1, 2 * FH, Z1, (lx, ly, lz) => {
            const tx = Math.min(lx - X0, X1 - 1 - lx), tz = Math.min(lz - Z0, Z1 - 1 - lz), t = Math.min(tx, tz);
            if (t > 1) return -1;
            const k = ly % FH, a = tx === t ? lz : lx;
            if (ly < 8) return t === 0 ? M.concrete2 : M.brick2;
            if (ly >= FH && ly < FH + 2) return M.ctr_blue;
            if (tz === t && lz > 0 && lx > -6 && lx < 6 && ly < 24) return t === 1 && (lx === -5 || lx === 5 || ly === 23) ? M.blue : 0;
            if (k > 10 && k < 23 && ((a + 64) % 14) > 3 && ((a + 64) % 14) < 12) return t === 1 ? (((a + 64) % 14) === 7 ? M.paint : M.glass) : 0;
            return M.paint;
        });
        P.walls(X0 - 2, 2 * FH + 2, Z0 - 2, X1 + 2, 2 * FH + 6, Z1 + 2, 1, M.metal);
        // внутри: стойка, стол с рацией, шкаф, стулья
        P.box(-26, 2, -20, -6, 10, -14, (lx, ly) => (ly === 9 ? M.plank : M.darkwood));
        P.box(-22, 10, -19, -16, 14, -15, M.rubber); P.box(-14, 10, -19, -12, 18, -17, M.metal);
        P.body(-20, 2, -10, -15, 12, -5, (lx, ly, lz) => (ly < 6 ? ((lx === -20 || lx === -16) && (lz === -10 || lz === -6) ? M.metal : 0) : ly === 6 ? M.blue : (lz === -6 ? M.blue : 0)));
        P.box(12, 2, -22, 26, 22, -16, (lx, ly) => ((ly - 2) % 5 === 4 ? M.darkwood : M.steelg));
        P.box(-26, 32, -20, 0, 40, -12, (lx, ly) => (ly === 39 ? M.plank : ((lx === -26 || lx === -1) ? M.darkwood : -1)));
        for (let i = 0; i < 10; i++) P.box(X1 - 12, Math.max(2, 3 * i - 1), -14 + 2 * i, X1 - 3, 5 + 3 * i, -12 + 2 * i, M.concrete2);
        P.box(X1 - 12, FH, -14, X1 - 3, FH + 2, 8, 0);
        // флагшток и антенна на крыше
        P.box(-28, 2 * FH + 2, 22, -26, 2 * FH + 40, 24, M.metal);
        P.box(-26, 2 * FH + 30, 23, -14, 2 * FH + 38, 24, (lx, ly) => (ly < 2 * FH + 34 ? M.ctr_blue : M.paint));
        P.box(10, 2 * FH + 2, 10, 11, 2 * FH + 30, 11, M.metal);
        for (let ly = 2 * FH + 10; ly < 2 * FH + 30; ly += 6) P.box(6, ly, 10, 16, ly + 1, 11, M.metal);
        // маячная башня у северо-восточного угла
        const TX = 20, TZ = -40, R = 11, TOPY = 140;          // отдельно от конторы: падает целиком
        P.cylY(TX, TZ, 0, TOPY, (ly) => R - ly * 0.012, (ly) => R - ly * 0.012 - 2.4, (lx, ly, lz, d, ang) => {
            if (ly < 6) return M.concrete2;
            const win = (ly % 30 > 14 && ly % 30 < 21) && Math.abs(((ang + Math.PI * 2) % (Math.PI / 2)) - Math.PI / 4) < 0.12;
            if (win) return d > R - 1.6 ? 0 : M.glass;
            if (ly < 16 && ang > 1.2 && ang < 1.95) return 0;                        // дверь к конторе (+z)
            return (Math.floor(ly / 20) & 1) ? M.redwash : M.paint;
        });
        P.cylY(TX, TZ, 0, 2, R - 1, 0, M.concrete);
        P.cylY(TX, TZ, TOPY, TOPY + 2, R + 4, 0, M.metal);
        P.cylY(TX, TZ, TOPY + 2, TOPY + 9, R + 4, R + 2.7, (lx, ly, lz, d, ang) => (ly === TOPY + 8 || Math.round(ang * 10) % 4 === 0 ? M.metal : -1));
        P.cylY(TX, TZ, TOPY + 2, TOPY + 18, 7.5, 6, (lx, ly, lz, d, ang) => (ly < TOPY + 4 || ly > TOPY + 16 || Math.round(ang * 6 / Math.PI * 2) % 3 === 0 ? M.metal : M.glass));
        P.cylY(TX, TZ, TOPY + 2, TOPY + 5, 3, 0, M.metal);
        P.cylY(TX, TZ, TOPY + 5, TOPY + 13, 2.6, 0, M.lamp);
        P.cylY(TX, TZ, TOPY + 18, TOPY + 26, (ly) => 8.5 - (ly - TOPY - 18), 0, M.redwash);
        P.box(TX, TOPY + 26, TZ, TX + 1, TOPY + 30, TZ + 1, M.metal);
        barrel(P, 0, 0, -46); barrel(P, 0, 0, -39); barrel(P, -7, 0, -43, M.rust);
    };

    /** Старый кирпичный склад: 2 этажа на деревянных перекрытиях, двускатная черепичная крыша, грузовые двери с талями. */
    B['docks-brickstore'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -80, X1 = 80, Z0 = -50, Z1 = 50, EH = 64, F2 = 32;
        const ry = (lz) => EH + Math.floor((49 - (lz < 0 ? -lz - 1 : lz)) / 2);
        const ROPE = M.fabric || M.plank;
        P.box(X0, 0, Z0, X1, 92, Z1, (lx, ly, lz) => {
            const tx = Math.min(lx - X0, X1 - 1 - lx), tz = Math.min(lz - Z0, Z1 - 1 - lz), t = Math.min(tx, tz);
            if (t > 2) return -1;
            const gable = tx === t;
            const top = gable ? ry(lz) + 1 : EH;
            if (ly > top) return -1;
            if (ly < 5) return t === 0 ? M.concrete2 : M.brick2;
            if (ly === F2 || ly === F2 + 1 || ly === EH - 1) return M.brick2;
            const a = gable ? lz : lx, north = !gable && lz < 0;
            // грузовые двери по северному фасаду (3 пролёта на 2 этажа)
            for (const c of [-50, 0, 50]) {
                if (north && Math.abs(lx + 0.5 - c) < 8) {
                    if (ly >= 5 && ly < 28) return t === 1 && (Math.abs(lx + 0.5 - c) > 7 || ly === 27) ? M.darkwood : 0;
                    if (ly >= F2 + 2 && ly < F2 + 24) return t === 1 && (Math.abs(lx + 0.5 - c) > 7 || ly === F2 + 23) ? M.darkwood : 0;
                    if (ly === 28 || ly === F2 + 24) return M.concrete;
                }
            }
            // окна с лучковой перемычкой
            const u = ((a + 400) % 25) - 12;
            if (Math.abs(u) <= 4 && !(north && Math.abs(((lx + 400) % 50) - 0) < 0)) {
                const k = ly < F2 ? ly - 10 : ly - (F2 + 10);
                const nearDoor = north && [-50, 0, 50].some(c => Math.abs(lx + 0.5 - c) < 13);
                if (!nearDoor && k >= 0 && k < 14 && !(gable && ly > EH)) {
                    if (t !== 1) return 0;
                    return (Math.abs(u) === 4 || k === 6) ? M.darkwood : M.glass;
                }
                if (!nearDoor && (k === 14 || k === 15) && !(gable && ly > EH)) return M.brick2;
                if (!nearDoor && k === -1) return M.concrete;
            }
            if (gable && ly > EH + 4 && Math.abs(lz + 0.5) < 4 && ly < EH + 14) return t === 1 ? M.darkwood : 0;   // слуховое окно
            return brickF(lx, ly, lz);
        });
        // перекрытие 2-го этажа: балки и доски, деревянные столбы
        for (let lz = Z0 + 3; lz < Z1 - 3; lz += 8) P.box(X0 + 3, F2 - 2, lz, X1 - 3, F2, lz + 2, M.darkwood);
        P.box(X0 + 3, F2, Z0 + 3, X1 - 3, F2 + 2, Z1 - 3, (lx) => boardsF(lx + 100));
        P.box(X0 + 6, F2 - 2, Z1 - 25, X0 + 18, F2 + 2, Z1 - 3, 0);
        for (let i = 0; i < 11; i++) P.box(X0 + 6, Math.max(0, 3 * i - 3), Z1 - 5 - 2 * i, X0 + 18, 3 * (i + 1), Z1 - 3 - 2 * i, M.darkwood);
        for (let px = X0 + 40; px < X1 - 10; px += 40) for (const pz of [-17, 15]) { P.box(px, 0, pz, px + 3, F2 - 2, pz + 3, M.darkwood); P.box(px, F2 + 2, pz, px + 3, EH - 1, pz + 3, M.darkwood); }
        // стропила и черепица
        for (let px = X0 + 3; px < X1 - 3; px += 12) for (let lz = Z0; lz < Z1; lz++) P.box(px, ry(lz) - 2, lz, px + 2, ry(lz), lz + 1, M.darkwood);
        P.box(X0 + 3, EH - 2, Z0 + 3, X1 - 3, EH, Z1 - 3, (lx, ly, lz) => ((lz - Z0) % 20 === 3 ? M.darkwood : -1));
        P.box(X0 - 2, EH, Z0 - 3, X1 + 2, 92, Z1 + 3, (lx, ly, lz) => {
            const r = ry(Math.max(Z0, Math.min(Z1 - 1, lz)));
            if (ly !== r && ly !== r + 1) return -1;
            return ((lx + (ly & 1) * 2) % 4 === 0) ? M.roof2 || M.roof : M.roof;
        });
        P.box(X0 - 2, ry(0) + 1, -1, X1 + 2, ry(0) + 3, 1, M.roof2 || M.roof);
        // тали над верхними дверями: балка, блок, верёвка, ящик на верёвке
        for (const c of [-50, 0, 50]) {
            P.box(c - 1, EH + 2, Z0 - 10, c + 1, EH + 4, Z0 + 3, M.darkwood);
            P.box(c - 1, EH, Z0 - 9, c + 1, EH + 2, Z0 - 7, M.metal);
        }
        P.box(0, 40, Z0 - 8, 1, EH, Z0 - 7, ROPE);
        P.box(-5, 30, Z0 - 13, 6, 40, Z0 - 3, (lx, ly, lz) => ((lx === -5 || lx === 5 || ly === 30 || ly === 39 || lz === Z0 - 13 || lz === Z0 - 4) ? (ly === 39 && (lx + lz) % 3 ? M.crate : M.darkwood) : M.crate));
        P.box(50, 48, Z0 - 8, 51, EH, Z0 - 7, ROPE);
        P.box(48, 44, Z0 - 10, 53, 48, Z0 - 5, M.metal);
        // товар: мешки на поддонах, бочки, ящики (тела)
        for (let i = 0; i < 4; i++) { bagPallet(P, X0 + 30 + i * 14, 0, Z1 - 16, 3 + (i & 1)); bagPallet(P, X0 + 30 + i * 14, 2 * 0 + 0, Z1 - 30, 4); }
        for (let i = 0; i < 4; i++) barrel(P, 30 + i * 7, 0, Z1 - 12, i === 2 ? M.rust : M.barrel);
        for (let i = 0; i < 3; i++) crate(P, 10 + i * 12, 0, -20, 10, 10);
        crate(P, 14, 10, -18, 8, 7);
        for (let i = 0; i < 3; i++) crate(P, -30 + i * 14, F2 + 2, -10, 11, 10);
        for (const cz of [Z1 - 30, Z1 - 19]) {
            P.cylX(F2 + 2 + 5, cz + 5, X1 - 40, X1 - 12, 5, 1.5, (lx, ly, lz, d) => (d < 2.5 ? M.darkwood : (cz > 20 ? M.fabric || M.plaster : M.plaster2)));
            P.dyn(X1 - 40, F2 + 2, cz, X1 - 12, F2 + 12, cz + 10);
        }
    };

    /** Стальной склад с арочной кровлей: профлист, рамы, ворота, стеллажи с ящиками, погрузчик. */
    B['docks-steelstore'] = function (w, x, z, rot) {
        const P = new Plot(w, x, z, rot);
        const X0 = -88, X1 = 88, Z0 = -54, Z1 = 54, H = 56, R = 80;
        const ry = (lz) => H + Math.round(Math.sqrt(R * R - (lz + 0.5) * (lz + 0.5)) - Math.sqrt(R * R - 54 * 54));
        for (let px = X0; px <= X1 - 3; px += 25) for (let lz = Z0; lz < Z1; lz++) {
            const edge = lz < Z0 + 3 || lz >= Z1 - 3;
            P.box(px, edge ? 0 : ry(lz) - 3, lz, px + 3, ry(lz), lz + 1, M.steelg);
        }
        P.box(X0, 0, Z0, X1, 80, Z1, (lx, ly, lz) => {
            const ex = lx === X0 || lx === X1 - 1, ez = lz === Z0 || lz === Z1 - 1;
            if (!ex && !ez) return -1;
            const top = ex ? ry(lz) : H;
            if (ly > top) return -1;
            if (ly < 10) return M.concrete2;
            if (ez && lz === Z0 && ((lx >= -70 && lx < -40) || (lx >= 20 && lx < 50)) && ly < 46) return (lx >= 20 && ly > 34) ? (ly & 1 ? M.corrugated : M.metal) : 0;
            if (ez && lz === Z1 - 1 && lx >= -8 && lx < 2 && ly < 31) return 0;
            if (ex && ly > H - 20 && ly < H - 8 && Math.abs(lz) < 30) return (lz % 6 === 0) ? M.metal : M.glass;
            if (ez && ly > 38 && ly < 46 && ((lx + 200) % 25) > 6 && ((lx + 200) % 25) < 19) return M.glass;
            return ((lx + lz) >> 1) & 1 ? M.corrugated2 : M.steelg;
        });
        P.box(X0 - 2, H - 2, Z0 - 2, X1 + 2, 90, Z1 + 2, (lx, ly, lz) => {
            const r = ry(Math.max(Z0, Math.min(Z1 - 1, lz)));
            const r2 = ry(Math.max(Z0, Math.min(Z1 - 1, lz + (lz < 0 ? 1 : -1))));
            if (ly < Math.min(r, r2) || ly > Math.max(r, r2) + 1) return -1;
            if (((lx - X0) % 25) > 8 && ((lx - X0) % 25) < 17 && Math.abs(lz) < 24 && lx > X0 + 2 && lx < X1 - 2) return M.glass;
            return (lx & 1) ? M.corrugated : M.metal;
        });
        // стеллажи вдоль x и ящики
        for (const rz of [-30, 4]) {
            for (let px = -76; px <= 64; px += 35) for (const oz of [0, 9]) P.box(px, 0, rz + oz, px + 2, 48, rz + oz + 2, M.ctr_orange);
            for (const ly of [16, 32]) for (const oz of [0, 9]) P.box(-76, ly, rz + oz, 66, ly + 2, rz + oz + 2, M.ctr_blue);
            for (let px = -76; px < 64; px += 35) for (const ly of [0, 18, 34]) for (let k = 0; k < 2; k++) {
                if (hash(px, ly + k * 5, rz + 3) > 0.5) continue;
                const cx = px + 3 + k * 16, s = 11 + ((px + ly + k) & 1);
                if (ly === 0) { pallet(P, cx, 0, rz, 14, 11); crate(P, cx + 1, 2, rz, s, s - 2); } else crate(P, cx + 1, ly, rz, s, s - 2);
            }
        }
        forklift(P, -60, 0, -50 + 4);
        for (let i = 0; i < 4; i++) barrel(P, 40 + i * 7, 0, 34, i % 2 ? M.rust : M.barrel);
        for (let i = 0; i < 3; i++) barrel(P, 43 + i * 7, 0, 41);
        bagPallet(P, -80, 0, 30, 4); bagPallet(P, -66, 0, 30, 4); bagPallet(P, -80, 10, 30, 2);
    };

    /** Причальная мелочь: кнехты, кранцы-покрышки на стенке, фонари, тумбы, забор с воротами. */
    B['docks-quay'] = function (w) {
        const P = new Plot(w, 0, 0, 0);
        const { Z0, Z1 } = DOCK;
        for (let bx = 100; bx < 455; bx += 46) if (bx < 396 || bx > 444) bollard(P, bx, Z1 + 4);
        for (let bx = 70; bx < 455; bx += 60) bollard(P, bx, Z0 - 12);
        // кранцы-покрышки на южной стенке
        for (let fx = 96; fx < 455; fx += 30) {
            if (fx > 392 && fx < 446) continue;
            P.cylZ(fx + 3, -10, Z1 - 3, Z1, 4.2, 2, M.rubber);
            P.box(fx + 2, -6, Z1 - 1, fx + 4, 0, Z1, M.cable);
        }
        for (const lx of [80, 160, 380]) lampPost(P, lx, 190, 56);
        // ограда: решётка по бокам и с юга, ворота x 206..290
        const fence = (a, ly) => ((a % 3 === 0 || ly === 2 || ly === 19) ? M.steelg : 0);
        for (let a = 180; a <= 471; a++) for (let ly = 0; ly < 21; ly++) { const v = fence(a, ly); if (v) { P.put(40, ly, a, v); P.put(471, ly, a, v); } }
        for (let a = 40; a <= 471; a++) {
            if (a >= 206 && a < 290) continue;
            for (let ly = 0; ly < 21; ly++) { const v = fence(a, ly); if (v) P.put(a, ly, 471, v); }
        }
        for (const gx of [203, 290]) P.box(gx, 0, 469, gx + 3, 26, 474, M.concrete2);
        // проходная
        P.box(296, 0, 457, 316, 24, 470, (lx, ly, lz) => {
            const e = lx === 296 || lx === 315 || lz === 457 || lz === 469 || ly === 23;
            if (!e) return -1;
            if (ly === 23) return M.concrete2;
            if (ly > 9 && ly < 19 && (lx === 296 || lz === 457)) return M.glass;
            if (lx === 296 && lz > 460 && lz < 467 && ly < 20) return 0;
            return ly < 4 ? M.brick2 : M.ctr_blue;
        });
        P.box(200, 0, 454, 203, 10, 457, M.metal);
        P.box(201, 10, 455, 202, 64, 456, (lx, ly) => (((ly - 10) >> 2) & 1 ? M.paint : M.ctr_red));
        // поддоны и катушки на северном причале
        cableDrum(P, 150, 0, Z0 - 16, 6, 7); cableDrum(P, 276, 0, Z0 - 16, 7, 8);
        for (let i = 0; i < 3; i++) barrel(P, 230 + i * 7, 0, Z0 - 13, i === 1 ? M.rust : M.barrel);
    };

    // ------------------------------------------------------------------ экспорт
    Object.assign(GB.builders, B);
})();
