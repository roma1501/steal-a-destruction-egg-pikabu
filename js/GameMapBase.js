// GameMapBase.js — база игрока: строители маркеров карты 'base' (Maps.js) и алтарь яйца на вылазках.
// Плиты баз — неразрушимый яркий пластик (plate_*), как участки в Roblox: красный участок игрока, вокруг чужие
// участки других цветов и полигон. Несущее — plate_* и яйца-статуи; мелкий декор (цветы, штакетник, лампы, деревья, мишени, ящики) разрушается.
//
// Координаты: 1 воксель = 0.1 м; ly = 0 — первый слой над плитой, ly = -1 — верхний слой самой плиты (вставки заподлицо).
// Проходимость: игрок шагает на ступень до 4 вокселей, ширина игрока 6 вокселей; проходы — от 13 вокселей, проёмы — выше 22.

const BASE_GROUND = 20;

/** Детали базы: рисуются в локальной системе постройки F (GameMapBuild.frame). */
/** @satisfies {Record<string, any>} */
const BaseKit = {
    /** Цифры 3×5 для вывесок. */
    FONT: {
        0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'],
        3: ['###', '..#', '.##', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
        6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
        9: ['###', '#.#', '###', '..#', '###'],
    },
    /** Знак денег на плите. */
    CASH: ['.###.', '#.#.#', '#.#..', '.###.', '..#.#', '#.#.#', '.###.'],
    /** Силуэты для стен лотков; символы — см. pal(). */
    PIX: {
        star: ['....y....', '...yyy...', 'yyyyyyyyy', '.yyyyyyy.', '..yyyyy..', '.yyy.yyy.', '.y.....y.'],
        shirt: ['.mm...mm.', 'mmmmmmmmm', 'mmmmmmmmm', '..mmmmm..', '..mmmmm..', '..mmmmm..'],
        egg: ['...ww...', '..wwww..', '.wwyyww.', '.wwwwww.', 'wwyywwww', 'wwwwyyww', '.wwwwww.', '..wwww..'],
        paw: ['..n..n..', '.nn..nn.', 'n..nn..n', 'n.nnnn.n', '..nnnn..', '.nnnnnn.', '.nnnnnn.'],
        book: ['rrrrrrrrrrr', 'rwwwwrwwwwr', 'rwkkwrwkkwr', 'rwwwwrwwwwr', 'rwkkwrwkkwr', 'rwwwwrwwwwr', 'rrrrrrrrrrr'],
        rifle: ['....kk.........', 'nnnkkkkkkkkkkkk', 'nnkkkkkkkkgg...', 'n...kk.kk......', '....kk.kk......'],
        shotgun: ['nnn.kkkkkkkkkk', 'nnnnkkkkkkkkkk', 'nn..k.nnnn....', '....k.........'],
        rpg: ['....lllllllll..r', 'kkkklllllllllrrr', 'kkkklllllllllrrr', '....lllllllll..r', '.....k..k.......'],
        pistol: ['kkkkkkk', 'kkkkkkk', '..nnk..', '..nn...', '..nn...'],
        smg: ['..kkkkkkkk', 'kkkkkkkggg', 'k.kk.k....', '..kk.k....', '..kk......'],
        heart: ['.rr...rr.', 'rrrr.rrrr', 'rwrrrrrrr', 'rrrrrrrrr', '.rrrrrrr.', '..rrrrr..', '...rrr...', '....r....'],
        shield: ['bbbbbbbbb', 'bcccbcccb', 'bcccbcccb', 'bbbbbbbbb', 'bcccbcccb', 'bcccbcccb', '.bccbccb.', '..bcbcb..', '...bbb...', '....b....'],
        boot: ['..ooo....', '..ooo....', '..ooo....', '..oooo...', '..ooooo..', 'yooooooo.', 'yooooooo.', 'kkkkkkkkk'],
        arrow: ['....e....', '...eee...', '..eeeee..', '.eeeeeee.', 'eeeeeeeee', '...eee...', '...eee...', '...eee...'],
    },
    pal() {
        return {
            k: M.toy_black, g: M.toy_dgray, o: M.toy_orange, n: M.toy_brown, l: M.toy_dgreen, r: M.toy_red, w: M.toy_white,
            b: M.toy_blue, c: M.toy_cyan, y: M.toy_yellow, e: M.neon_cash, m: M.toy_magenta,
        };
    },

    /** Плоский круг или столбик: центр (cx, cz) — непрерывные локальные координаты (центр вокселя i — это i + 0.5). */
    disc(F, cx, cz, r, y0, y1, v) { GameMapBuild.cyl(F, cx, cz, r, y0, y1, v); },
    /** Кольцо r0 < d ≤ r1. */
    ring(F, cx, cz, r0, r1, y0, y1, v) {
        GameMapBuild.cyl(F, cx, cz, r1, y0, y1, (lx, ly, lz) => Math.hypot(lx + 0.5 - cx, lz + 0.5 - cz) > r0 ? (typeof v === 'function' ? v(lx, ly, lz) : v) : -1);
    },
    /** Яйцо-эллипсоид из egg_*: снизу шире. a, b — материалы, pattern — plain | stripes | rings | spots | checker | zigzag | split. */
    egg(F, cx, y0, cz, rx, h, a, b, pattern) {
        const cy = y0 + h * 0.44, top = h * 0.56, low = h * 0.44;
        F.box(Math.floor(cx - rx), y0, Math.floor(cz - rx), Math.ceil(cx + rx), y0 + h, Math.ceil(cz + rx), (lx, ly, lz) => {
            const u = (lx + 0.5 - cx) / rx, w = (lz + 0.5 - cz) / rx, yy = ly + 0.5, t = yy > cy ? (yy - cy) / top : (yy - cy) / low;
            const k = yy > cy ? 1 - 0.1 * t : 1;
            if ((u * u + w * w) / (k * k) + t * t > 1.03) return -1;
            const q = ly - y0;
            switch (pattern) {
                case 'stripes': return (q >> 1) & 1 ? b : a;
                case 'rings': return ((q / 3) | 0) % 3 === 1 ? b : a;
                case 'spots': return F.h(lx >> 1, ly >> 1, lz >> 1) > 0.66 ? b : a;
                case 'checker': return ((lx >> 1) + (ly >> 1) + (lz >> 1)) & 1 ? b : a;
                case 'zigzag': return Math.abs(((q + Math.abs(((Math.atan2(w, u) * 3.82 + 12) % 2) - 1) * 4) % 7) - 3.5) < 1.2 ? b : a;
                case 'split': return yy > cy + 1 ? b : a;
            }
            return a;
        });
    },
    /** Пиксель-арт на вертикальной плоскости: (ax, ay, az) — левый нижний угол, (ux, uz) — направление строки, s — масштаб. */
    pix(F, rows, pal, ax, ay, az, ux, uz, s) {
        s = s || 1;
        const H = rows.length;
        rows.forEach((row, r) => {
            for (let c = 0; c < row.length; c++) {
                if (row[c] === '.') continue;
                const m = typeof pal === 'number' ? pal : pal[row[c]];
                for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) F.put(ax + ux * (c * s + i), ay + (H - 1 - r) * s + j, az + uz * (c * s + i), m);
            }
        });
    },
    /** Пиксель-арт плашмя на слое y: строка — вдоль +x, строки идут по +z от (ax, az). */
    flat(F, rows, pal, ax, y, az) {
        rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] !== '.') F.put(ax + c, y, az + r, pal[row[c]]); });
    },
    /** Число по центру (cx, cz): вид с той стороны, где (ux, uz) идёт слева направо. */
    text(F, str, cx, ay, cz, ux, uz, s, v) {
        const W = (str.length * 4 - 1) * s, st = -(W >> 1);
        for (let i = 0; i < str.length; i++) {
            const g = this.FONT[str[i]];
            if (g) this.pix(F, g, v, cx + ux * (st + i * 4 * s), ay, cz + uz * (st + i * 4 * s), ux, uz, s);
        }
    },
    /** Система координат детали, смотрящей вдоль +x постройки: её локальная +z — это +x родителя. */
    sub(F, lx, lz) { return GameMapBuild.frame(F.w, F.wx(lx, lz), F.wz(lx, lz), (F.rot + 3) % 4); },

    /** Вывеска на двух стойках: щит вдоль x, номер с обеих сторон. Под щитом проход 2.4 м. */
    sign(F, lx, lz, str, col) {
        for (const a of [lx - 14, lx + 13]) {
            F.box(a, 0, lz - 1, a + 2, 46, lz + 2, M.plate_dark);
            F.box(a - 1, 0, lz - 2, a + 3, 2, lz + 3, M.plate_gray);
        }
        F.box(lx - 16, 24, lz - 1, lx + 17, 46, lz + 2, col);
        F.box(lx - 14, 26, lz - 1, lx + 15, 44, lz + 2, M.plate_white);
        this.text(F, str, lx, 27, lz + 2, 1, 0, 3, M.plate_dark);
        this.text(F, str, lx, 27, lz - 2, -1, 0, 3, M.plate_dark);
        for (const a of [lx - 15, lx - 5, lx + 5, lx + 15]) { F.box(a, 46, lz, a + 1, 48, lz + 1, M.neonamber); }
    },

    /** Столб с лампой: стойка, вынос в сторону (ax, az), фонарь над проходом выше 2.6 м. */
    lamp(F, lx, lz, ax, az, h) {
        h = h || 34;
        F.box(lx - 3, 0, lz - 3, lx + 4, 2, lz + 4, M.plate_dark);
        F.box(lx - 1, 2, lz - 1, lx + 2, h, lz + 2, (a, ly) => (ly >> 3) & 1 ? M.plate_red : M.plate_white);
        F.box(lx - 1, h, lz - 1, lx + 2, h + 2, lz + 2, M.plate_dark);
        const ex = lx + ax * 9, ez = lz + az * 9;
        F.box(Math.min(lx - 1, ex - 1), h, Math.min(lz - 1, ez - 1), Math.max(lx + 2, ex + 2), h + 2, Math.max(lz + 2, ez + 2), M.plate_dark);
        F.box(ex - 3, h - 1, ez - 3, ex + 4, h, ez + 4, M.plate_dark);
        F.box(ex - 2, h - 6, ez - 2, ex + 3, h - 1, ez + 3, M.lamp);
        F.box(ex - 1, h - 7, ez - 1, ex + 2, h - 6, ez + 2, M.plate_yellow);
    },

    /** Клумба на краю: белый поребрик, земля, цветы. Шагается (высота до 0.4 м), пройти через неё можно. */
    bed(F, x0, z0, x1, z1) {
        const C = [M.toy_pink, M.toy_yellow, M.toy_white, M.toy_cyan, M.toy_magenta, M.toy_orange];
        F.box(x0, 0, z0, x1, 2, z1, M.plate_white);
        F.box(x0 + 1, 1, z0 + 1, x1 - 1, 2, z1 - 1, M.soil);
        for (let lz = z0 + 1; lz < z1 - 1; lz++) for (let lx = x0 + 1; lx < x1 - 1; lx++) {
            const h = F.h(lx, 7, lz);
            if (h < 0.3) { F.put(lx, 2, lz, M.leaves2); F.put(lx, 3, lz, C[Math.floor(F.h(lx >> 1, 9, lz >> 1) * C.length)]); }
            else if (h < 0.75) F.put(lx, 2, lz, h < 0.5 ? M.leaves : M.leaves2);
        }
    },

    /** Кадка с деревом: дерево разрушается, кадка — нет. */
    tree(F, lx, lz, h) {
        h = h || 26;
        this.disc(F, lx + 0.5, lz + 0.5, 13.5, 0, 2, M.plate_white);
        this.disc(F, lx + 0.5, lz + 0.5, 12.2, 1, 2, M.soil);
        F.box(lx - 1, 2, lz - 1, lx + 2, h, lz + 2, M.wood);
        const B = GameMapBuild;
        B.blob(F, lx + 0.5, h + 5, lz + 0.5, 12, (a, b, c) => F.h(a >> 2, b >> 2, c >> 2) > 0.55 ? M.leaves2 : M.leaves, 0.18);
        B.blob(F, lx + 7.5, h + 1, lz - 3.5, 7, M.leaves2, 0.2);
        B.blob(F, lx - 6.5, h + 2, lz + 4.5, 7.5, M.leaves, 0.2);
        const X = F.wx(lx, lz), Z = F.wz(lx, lz), G0 = BASE_GROUND - 1;
        B.prune(F.w, X - 22, G0, Z - 22, X + 23, G0 + h + 24, Z + 23, [M.leaves, M.leaves2]);
        const C = [M.toy_pink, M.toy_yellow, M.toy_white, M.toy_magenta];
        for (let i = 0; i < 26; i++) {
            const a = i / 26 * Math.PI * 2, r = 5 + (i % 3) * 2.2;
            const px = Math.round(lx + Math.cos(a) * r), pz = Math.round(lz + Math.sin(a) * r);
            F.put(px, 2, pz, M.leaves2);
            if (i % 2) F.put(px, 3, pz, C[i % C.length]);
        }
    },

    /** Соломенное гнездо на верху тумбы: тёмная подстилка (верх 0.4 м — там стоит яйцо), кольцо соломы и соломинки наружу. */
    straw(F, cx, cz) {
        const S = (a, b, c) => { const h = F.h(a, b, c); return h > 0.78 ? M.plank : h > 0.42 ? M.hay : M.toy_tan; };
        this.disc(F, cx, cz, 6, 3, 4, M.toy_brown);
        this.ring(F, cx, cz, 5.2, 8.4, 3, 5, S);
        this.ring(F, cx, cz, 5.7, 8, 5, 6, (a, b, c) => F.h(a, b, c) > 0.42 ? S(a, b, c) : -1);
        for (let i = 0; i < 18; i++) {
            const q = i / 18 * Math.PI * 2, r = 8.7 + (i % 2) * 0.4;
            const px = Math.floor(cx + Math.cos(q) * r), pz = Math.floor(cz + Math.sin(q) * r), py = 3 + (i % 2);
            if (F.get(px - 1, py, pz) || F.get(px + 1, py, pz) || F.get(px, py, pz - 1) || F.get(px, py, pz + 1) || F.get(px, py - 1, pz)) F.put(px, py, pz, S(i, 3, i));
        }
    },

    /** Тумба гнезда: ступени шагаются, верх 0.3 м. */
    plinth(F, cx, cz, col) {
        this.disc(F, cx, cz, 10.5, 0, 1, M.plate_gray);
        this.disc(F, cx, cz, 9.5, 1, 2, M.plate_white);
        this.disc(F, cx, cz, 8.8, 2, 3, col);
    },

    /** Гнездо соседа: тумба, солома, декоративное яйцо из egg_*, плита перед ним. */
    decoNest(F, lx, lz, egg, mat) {
        F.box(lx - 11, -1, lz - 12, lx + 24, 0, lz + 13, M.plate_white);
        F.box(lx - 10, -1, lz - 11, lx + 23, 0, lz + 12, M.plate_dark);
        const cx = lx + 0.5, cz = lz + 0.5;
        this.plinth(F, cx, cz, mat);
        this.straw(F, cx, cz);
        this.egg(F, cx, 4, cz, 5.2, 15, M[egg[0]], M[egg[1]], egg[2]);
        F.box(lx + 12, -1, lz - 5, lx + 21, 0, lz + 6, mat);
    },

    /** Чужой участок. Локальная +x смотрит к участку игрока; scale маркера — полуразмеры. */
    plot(w, x, z, rot, mk, mat, num, eggs) {
        const F = GameMapBuild.frame(w, x, z, rot), [hx, hz] = GameMapBuild.span(mk);
        F.box(-hx, -1, -hz, hx, 0, hz, M.plate_gray);
        F.box(-hx + 5, -1, -hz + 5, hx - 5, 0, hz - 5, mat);
        // бортик с разрывом напротив входа; углы выше
        F.box(-hx, 0, -hz, hx, 2, -hz + 5, M.plate_gray);
        F.box(-hx, 0, hz - 5, hx, 2, hz, M.plate_gray);
        F.box(-hx, 0, -hz, -hx + 5, 2, hz, M.plate_gray);
        F.box(hx - 5, 0, -hz, hx, 2, -22, M.plate_gray);
        F.box(hx - 5, 0, 22, hx, 2, hz, M.plate_gray);
        // задняя стенка: у чужих участков она не даёт видеть край мира и задаёт ритм
        F.box(-hx + 1, 2, -hz + 1, -hx + 4, 12, hz - 1, (a, ly, lz) => ly >= 10 ? M.plate_white : ((lz + 1000) >> 3) & 1 ? mat : M.plate_white);
        for (const a of [-hz, 0, hz - 8]) { F.box(-hx, 2, a, -hx + 6, 18, a + 8, M.plate_white); F.box(-hx, 18, a - 1, -hx + 7, 20, a + 9, mat); }
        for (const [sx, sz] of [[hx - 10, -hz], [hx - 10, hz - 10]]) {
            F.box(sx, 2, sz, sx + 10, 8, sz + 10, M.plate_white);
            F.box(sx - 1, 8, sz - 1, sx + 11, 10, sz + 11, mat);
            F.box(sx + 3, 10, sz + 3, sx + 7, 14, sz + 7, M.lamp);
        }
        // гнёзда в ряд у задней стенки
        const n = Math.max(1, Math.floor((2 * hz - 20) / 31)), step = (2 * hz - 20) / n;
        for (let i = 0; i < n; i++) {
            const lz = Math.round(-hz + 10 + step * (i + 0.5));
            this.decoNest(F, -hx + 19, lz, eggs[i % eggs.length], mat);
        }
        // вход, вывеска, фонари, клумбы
        F.box(hx - 5, -1, -22, hx, 0, 22, M.plate_white);
        F.box(6, -1, -14, hx - 5, 0, 14, M.plate_white);
        F.box(8, -1, -12, hx - 5, 0, 12, M.plate_gray);
        this.lamp(F, hx - 9, -27, -1, 0, 32);
        this.lamp(F, hx - 9, 27, -1, 0, 32);
        this.sign(this.sub(F, hx - 9, -52), 0, 0, String(num), mat);
        this.tree(F, 19, hz - 26, 22 + (num % 3) * 3);
        this.tree(F, 19, -hz + 26, 24 + (num % 2) * 4);
        this.bed(F, hx - 13, 40, hx - 5, hz - 44);
        if (hz - 44 > 74) this.bed(F, hx - 13, -hz + 44, hx - 5, -70);
    },

    /** Угловая башня борта. */
    tower(F, cx, cz, col) {
        F.box(cx - 9, 0, cz - 9, cx + 9, 5, cz + 9, M.plate_gray);
        F.box(cx - 5, 5, cz - 5, cx + 5, 24, cz + 5, (a, ly) => (ly >= 10 && ly < 13) || (ly >= 18 && ly < 21) ? col : M.plate_white);
        F.box(cx - 7, 24, cz - 7, cx + 7, 27, cz + 7, M.plate_dark);
        F.box(cx - 3, 27, cz - 3, cx + 3, 33, cz + 3, M.lamp);
        F.box(cx - 4, 33, cz - 4, cx + 4, 35, cz + 4, col);
        F.box(cx - 1, 35, cz - 1, cx + 1, 52, cz + 1, M.plate_white);
        // флажок
        for (let a = 0; a < 12; a++) F.box(cx + 1, 51 - Math.floor(a / 2), cz, cx + 1 + (12 - a), 52 - Math.floor(a / 2), cz + 1, a & 1 ? M.toy_yellow : M.toy_red);
    },

    /** Столб ворот 10×10: полосы, колпак, лампа. */
    pylon(F, cx, cz, h, col) {
        F.box(cx - 5, 0, cz - 5, cx + 5, 3, cz + 5, M.plate_gray);
        F.box(cx - 4, 3, cz - 4, cx + 4, h, cz + 4, (a, ly) => ((ly - 3) >> 2) & 1 ? col : M.plate_white);
        F.box(cx - 5, h, cz - 5, cx + 5, h + 2, cz + 5, M.plate_dark);
        F.box(cx - 3, h + 2, cz - 3, cx + 3, h + 6, cz + 3, M.lamp);
        F.box(cx - 4, h + 6, cz - 4, cx + 4, h + 8, cz + 4, M.plate_yellow);
    },

    /** Участок забора: линия вдоль оси along ('x' | 'z'), толщина 2 от c, столбы с шагом 26. Рейки — пластик, штакетник разрушается. */
    fence(F, along, c, a0, a1) {
        const P = along === 'x' ? (p0, y0, t0, p1, y1, t1, v) => F.box(p0, y0, c + t0, p1, y1, c + t1, v) : (p0, y0, t0, p1, y1, t1, v) => F.box(c + t0, y0, p0, c + t1, y1, p1, v);
        P(a0, 6, 0, a1, 7, 2, M.plate_white);
        P(a0, 12, 0, a1, 13, 2, M.plate_white);
        for (let a = a0; a < a1; a += 3) P(a, 2, 0, Math.min(a + 2, a1), a % 2 ? 15 : 14, 1, M.toy_white);
        const n = Math.max(1, Math.round((a1 - a0) / 26));
        for (let i = 0; i <= n; i++) {
            const a = Math.min(a1 - 4, a0 + Math.round((a1 - a0 - 4) * i / n));
            P(a, 2, -1, a + 4, 16, 3, M.plate_white);
            P(a - 1, 16, -2, a + 5, 18, 4, M.plate_yellow);
        }
    },

    /** Мешок с песком (тело): 10×4×5 вдоль x или 5×4×10 вдоль z, скругление по рёбрам. */
    bag(F, x0, y0, z0, alongZ) {
        const sx = alongZ ? 5 : 10, sz = alongZ ? 10 : 5;
        F.body(x0, y0, z0, x0 + sx, y0 + 4, z0 + sz, (lx, ly, lz) => {
            const ex = lx === x0 || lx === x0 + sx - 1, ez = lz === z0 || lz === z0 + sz - 1, ey = ly === y0 || ly === y0 + 3;
            if ((ex && ez) || ((ex || ez) && ey)) return -1;
            return F.h(lx >> 1, ly, lz >> 1) > 0.62 ? M.toy_cream : M.toy_tan;
        });
    },

    /** Деревянная мишень на стойке: щит смотрит на +z. */
    target(F, lx, lz, r, y) {
        F.box(lx - 2, 0, lz - 3, lx + 3, 1, lz + 3, M.plate_dark);
        F.box(lx - 1, 1, lz - 1, lx, y + 2, lz, M.plate_dark);
        F.box(lx + 1, 1, lz - 1, lx + 2, y + 2, lz, M.plate_dark);
        const cy = y + r + 1;
        F.box(lx - r, y + 1, lz, lx + r + 1, y + 2 * r + 2, lz + 2, (a, ly) => {
            const d = Math.hypot(a - lx, ly - cy);
            if (d > r + 0.3) return -1;
            const k = Math.floor(d / (r + 0.31) * 5);
            return k === 0 ? M.toy_yellow : k === 1 ? M.toy_red : k === 2 ? M.toy_white : k === 3 ? M.toy_red : M.toy_white;
        });
    },

    /** Лоток: подиум, стены, полосатая крыша, прилавок, щит с силуэтом на крыше. Перед прилавком свободно. o: { wall, trim, a, b } */
    stall(F, o) {
        // коврик заподлицо и подиум
        F.box(-26, -1, -18, 27, 0, 26, M.plate_white);
        F.box(-25, -1, -17, 26, 0, 25, M.plate_gray);
        F.box(-16, -1, 14, 17, 0, 25, (lx, ly, lz) => ((lx + lz + 400) >> 2) & 1 ? o.trim : M.plate_white);
        F.box(-22, 0, -16, 23, 1, 14, M.plate_dark);
        // задняя стена и боковые щёки
        F.box(-20, 1, -15, 21, 35, -12, o.wall);
        F.box(-20, 1, -15, -17, 33, -5, o.wall);
        F.box(18, 1, -15, 21, 33, -5, o.wall);
        F.box(-20, 27, -12, 21, 29, -11, o.trim);
        // столбы «карамель»
        const candy = (a, ly) => (ly >> 2) & 1 ? o.a : o.b;
        for (const a of [-22, 19]) F.box(a, 1, 10, a + 3, 30, 13, candy);
        // крыша: скат к покупателю, полосы вдоль ската, зубчатая кромка
        const roofY = lz => 35 - Math.round((lz + 18) * 7 / 39);
        F.box(-26, 24, -18, 27, 38, 21, (lx, ly, lz) => {
            const ry = roofY(lz), st = ((lx + 26) / 6 | 0) & 1 ? o.a : o.b;
            if (ly >= ry && ly < ry + 2) return st;
            if (lz === 20 && ((lx + 26) % 6) < 3 && ly >= ry - 3 && ly < ry) return st;
            return -1;
        });
        // опора щита и щит с силуэтом
        for (const a of [-13, 12]) F.box(a, 30, -9, a + 2, 38, -7, M.plate_dark);
        F.box(-18, 37, -9, 19, 57, -7, o.board || M.plate_dark);
        F.box(-17, 38, -7, 18, 39, -6, M.neonamber);
        F.box(-17, 55, -7, 18, 56, -6, M.neonamber);
        F.box(-18, 39, -7, -17, 55, -6, M.neonamber);
        F.box(18, 39, -7, 19, 55, -6, M.neonamber);
        // прилавок
        F.box(-15, 1, 5, 16, 9, 10, M.plate_gray);
        F.box(-15, 3, 10, 16, 6, 11, o.trim);
        F.box(-16, 9, 4, 17, 10, 11, M.plate_white);
        // ящики под полками: разрушаются
        for (const [a, b] of [[-17, -11], [10, -11]]) {
            F.box(a, 1, b, a + 8, 8, b + 7, M.crate);
            F.box(a, 1, b, a + 8, 2, b + 7, M.darkwood);
            F.box(a, 7, b, a + 8, 8, b + 7, M.darkwood);
        }
        F.box(-6, 1, -11, 3, 5, -5, M.toy_dgray);
        F.box(-6, 5, -11, 3, 6, -5, o.trim);
        // полка на задней стене
        F.box(-17, 9, -12, 18, 10, -8, M.plate_dark);
        F.box(-17, 18, -12, 18, 19, -9, M.plate_dark);
    },

    /** Вертикальная стойка со стволом: подпорка и силуэт стоя (вдоль y), толщина 1. */
    uprightGun(F, lx, lz, y, len, a, b) {
        F.box(lx, y, lz, lx + 1, y + len, lz + 1, a);
        F.box(lx - 1, y, lz, lx + 2, y + 3, lz + 1, b);
        F.box(lx - 1, y + 5, lz, lx + 1, y + 7, lz + 1, a);
    },
};

Object.assign(GameMapBuild.builders, {
    // Земля базы: порода, тёмные улицы, полоса и ограда по краю мира.
    // Два крайних ряда — трава: её цвет берёт дальняя земля (VoxRender._borderColor читает ряд 1), за оградой ровно и зелено.
    'base-terrain'(w) {
        const G = BASE_GROUND, S = w.sx, E = 8;
        w.fill(0, 0, 0, S, G - 1, w.sz, M.bedrock);
        w.fill(0, G - 1, 0, S, G, w.sz, M.plate_dark);
        for (const [x0, z0, x1, z1] of [[0, 0, S, E], [0, S - E, S, S], [0, 0, E, S], [S - E, 0, S, S]]) w.fill(x0, G - 1, z0, x1, G, z1, M.plate_gray);
        for (const [x0, z0, x1, z1] of [[0, 0, S, 2], [0, S - 2, S, S], [0, 0, 2, S], [S - 2, 0, S, S]]) w.fill(x0, G - 1, z0, x1, G, z1, M.grass2);
        // разметка улиц: белый пунктир (шаг 24)
        for (let a = 0; a < S; a += 24) {
            for (const c of [91, 420]) {
                if (a > 8 && a < S - 8) { w.fill(c, G - 1, a, c + 2, G, a + 12, M.plate_white); w.fill(a, G - 1, c, a + 12, G, c + 2, M.plate_white); }
            }
        }
        // ограда по краю мира: невидимую стену не видно, стена по пояс и столбы
        const wall = (x0, z0, x1, z1) => w.fill(x0, G, z0, x1, G + 9, z1, M.plate_gray);
        wall(3, 3, S - 3, 6); wall(3, S - 6, S - 3, S - 3); wall(3, 3, 6, S - 3); wall(S - 6, 3, S - 3, S - 3);
        w.fill(2, G + 9, 2, S - 2, G + 11, 7, M.plate_white); w.fill(2, G + 9, S - 7, S - 2, G + 11, S - 2, M.plate_white);
        w.fill(2, G + 9, 2, 7, G + 11, S - 2, M.plate_white); w.fill(S - 7, G + 9, 2, S - 2, G + 11, S - 2, M.plate_white);
        for (let a = 2; a < S - 6; a += 32) {
            for (const [px, pz] of [[a, 2], [a, S - 7], [2, a], [S - 7, a]]) {
                w.fill(px, G, pz, px + 5, G + 15, pz + 5, M.plate_white);
                w.fill(px, G + 15, pz, px + 5, G + 17, pz + 5, a & 32 ? M.plate_red : M.plate_yellow);
            }
        }
    },

    // Участок игрока: плита, борт, забор с воротами, дорожка спавн — портал, башни, клумбы.
    'base-plot'(w, x, z, rot, mk) {
        const F = GameMapBuild.frame(w, x, z, 0), K = BaseKit, L = GameMapBuild.span(mk)[0], R = L - 6;
        F.box(-L, -1, -L, L, 0, L, M.plate_gray);
        F.box(-R, -1, -R, R, 0, R, M.plate_red);
        // площадка портала
        K.disc(F, 0, -122, 59, -1, 0, M.plate_white);
        K.disc(F, 0, -122, 56, -1, 0, M.plate_purple);
        // дорожка: от южных ворот к порталу; белые кромки, жёлтые шевроны по курсу
        F.box(-24, -1, -104, 24, 0, L, M.plate_white);
        F.box(-22, -1, -104, 22, 0, L, M.plate_gray);
        // переходы к боковым воротам между гнёздами
        for (const [a, b] of [[-R, -24], [24, R]]) {
            F.box(a, -1, -24, b, 0, -10, M.plate_white);
            F.box(a, -1, -23, b, 0, -11, M.plate_gray);
        }
        F.box(-22, -1, -24, 22, 0, -10, M.plate_gray);
        for (const c of [-90, -52, -6, 34, 62, 136]) {
            for (let lx = -14; lx < 14; lx++) {
                const q = Math.round(Math.abs(lx + 0.5) * 0.62);
                F.box(lx, -1, c + q, lx + 1, 0, c + q + 5, M.plate_yellow);
            }
        }
        // пятно спавна
        K.disc(F, 0, 100, 16, -1, 0, M.plate_white);
        K.disc(F, 0, 100, 13.5, -1, 0, M.plate_blue);
        K.ring(F, 0, 100, 5, 7, -1, 0, M.plate_white);
        // борт: два уровня; разрывы — ворота
        const S_ = [[-L, -24], [24, L]], W_ = [[-L, -32], [-2, L]];
        F.box(-L, 0, -L, L, 2, -R + 2, M.plate_gray);
        for (const [a, b] of S_) F.box(a, 0, L - 8, b, 2, L, M.plate_gray);
        for (const [a, b] of W_) { F.box(-L, 0, a, -R + 2, 2, b, M.plate_gray); F.box(R - 2, 0, a, L, 2, b, M.plate_gray); }
        // тёмный нижний кант снаружи
        F.box(-L, 0, -L, L, 1, -L + 1, M.plate_dark);
        for (const [a, b] of S_) F.box(a, 0, L - 1, b, 1, L, M.plate_dark);
        for (const [a, b] of W_) { F.box(-L, 0, a, -L + 1, 1, b, M.plate_dark); F.box(L - 1, 0, a, L, 1, b, M.plate_dark); }
        // забор
        const C = L - 5, T = 138;
        K.fence(F, 'x', -C - 1, -T, T);
        K.fence(F, 'x', C - 1, -T, -34);
        K.fence(F, 'x', C - 1, 34, T);
        K.fence(F, 'z', -C - 1, -T, -42);
        K.fence(F, 'z', -C - 1, 8, T);
        K.fence(F, 'z', C - 1, -T, -42);
        K.fence(F, 'z', C - 1, 8, T);
        // угловые башни
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.tower(F, sx * (L - 9), sz * (L - 9), sx * sz > 0 ? M.plate_yellow : M.plate_blue);
        // южные ворота: проём 4.8 × 3.8 м, балка, щит с номером
        K.pylon(F, -29, 151, 38, M.plate_red);
        K.pylon(F, 29, 151, 38, M.plate_red);
        F.box(-34, 38, 148, 34, 44, 154, (a) => ((a + 340) >> 3) & 1 ? M.plate_red : M.plate_white);
        F.box(-15, 44, 149, 16, 64, 153, M.plate_yellow);
        F.box(-13, 46, 149, 14, 62, 153, M.plate_white);
        K.text(F, '1', 0, 47, 153, 1, 0, 3, M.plate_red);
        K.text(F, '1', 0, 47, 148, -1, 0, 3, M.plate_red);
        // боковые ворота: проём 3 × 2.8 м
        for (const c of [-151, 151]) {
            K.pylon(F, c, -37, 28, M.plate_blue);
            K.pylon(F, c, 3, 28, M.plate_blue);
            F.box(c - 3, 28, -42, c + 3, 33, 8, (a, ly, lz) => ((lz + 420) >> 3) & 1 ? M.plate_blue : M.plate_white);
        }
        // клумбы вдоль забора: дальше них остаётся проход 1.5 м до гнёзд
        for (const [a, b] of [[-136, -44], [10, 136]]) { K.bed(F, -R, a, -R + 8, b); K.bed(F, R - 8, a, R, b); }
        for (const [a, b] of [[-100, -40], [40, 100]]) { K.bed(F, a, -R, b, -R + 8); K.bed(F, a, R - 8, b, R); }
    },

    // Полигон за воротами: плита, линия огня, отбойная стена, мишени, мешки, ящики и бочки — тела.
    // Вход — с востока у южного края; манекены смотрят на линию огня (на +z).
    'base-range'(w, x, z, rot, mk) {
        const F = GameMapBuild.frame(w, x, z, 0), K = BaseKit, B = GameMapBuild, [hx, hz] = B.span(mk);
        F.box(-hx, -1, -hz, hx, 0, hz, M.plate_gray);
        F.box(-hx + 4, -1, -hz + 4, hx - 4, 0, hz - 4, M.plate_dark);
        // бортик, вход с востока
        F.box(-hx, 0, -hz, hx, 2, -hz + 4, M.plate_gray);
        F.box(-hx, 0, hz - 4, hx, 2, hz, M.plate_gray);
        F.box(-hx, 0, -hz, -hx + 4, 2, hz, M.plate_gray);
        F.box(hx - 4, 0, -hz, hx, 2, 90, M.plate_gray);
        F.box(hx - 4, -1, 90, hx, 0, hz - 4, M.plate_white);
        // разметка: линия огня и дальности
        F.box(-hx + 4, -1, 84, hx - 4, 0, 90, (lx, ly, lz) => ((lx + lz + 400) >> 2) & 1 ? M.plate_yellow : M.plate_dark);
        for (const c of [40, 0, -40, -80]) F.box(-hx + 4, -1, c, hx - 4, 0, c + 2, M.plate_white);
        F.box(-1, -1, -hz + 4, 1, 0, 84, M.plate_gray);
        // отбойная стена с нарисованной мишенью
        F.box(-hx + 4, 0, -hz + 4, hx - 4, 38, -hz + 10, M.plate_gray);
        F.box(-hx + 4, 34, -hz + 4, hx - 4, 38, -hz + 10, (lx) => ((lx + 400) >> 3) & 1 ? M.plate_yellow : M.plate_dark);
        F.box(-hx + 4, 0, -hz + 4, hx - 4, 2, -hz + 10, M.plate_dark);
        F.box(-17, 3, -hz + 10, 18, 33, -hz + 11, (lx, ly) => {
            const d = Math.hypot(lx, ly - 18), k = Math.floor(d / 3.1);
            if (d > 15.5) return -1;
            return k & 1 ? M.plate_white : M.plate_red;
        });
        // боковая стенка с внешней стороны
        F.box(-hx + 1, 2, -hz + 4, -hx + 4, 14, 84, (lx, ly, lz) => ly >= 12 ? M.plate_white : ((lz + 1000) >> 3) & 1 ? M.plate_yellow : M.plate_dark);
        // мишени разрушаются
        K.target(F, -22, -62, 7, 8);
        K.target(F, 22, -62, 7, 8);
        K.target(F, 0, -84, 8, 12);
        K.target(F, -12, -30, 5, 6);
        K.target(F, 13, -30, 5, 6);
        // укрытие у линии огня: мешки двумя рядами (8 тел)
        for (const a of [-30, 8]) {
            K.bag(F, a, 0, 74);
            K.bag(F, a + 11, 0, 74);
            K.bag(F, a + 5, 4, 74);
            K.bag(F, a + 16, 4, 74);
        }
        // ящики (10 тел)
        B.crate(F, -32, 0, 44, 9);
        B.crate(F, -22, 0, 45, 8);
        B.crate(F, -29, 9, 45, 8);
        B.crate(F, 23, 0, 44, 9);
        B.crate(F, 15, 0, 46, 7);
        B.crate(F, 25, 9, 46, 6);
        B.crate(F, -32, 0, -14, 8);
        B.crate(F, -31, 8, -13, 6);
        B.crate(F, 25, 0, -16, 8);
        B.crate(F, 25, 0, -6, 7);
        // сено и бочки (5 тел)
        B.hayBale(F, -30, 0, -50);
        B.hayBale(F, 20, 0, -44);
        B.barrel(F, -4, 0, -58);
        B.barrel(F, 4, 0, -58);
        B.barrel(F, 0, 0, -50);
    },

    // Чужие участки: только декор. Цвета и номера — у каждого свой строитель, размер и поворот — маркер.
    'plot-green'(w, x, z, rot, mk) { BaseKit.plot(w, x, z, rot, mk, M.plate_green, 2, [['egg_green', 'toy_dgreen', 'spots'], ['egg_gold', 'egg_white', 'rings'], ['egg_blue', 'egg_white', 'stripes'], ['egg_stone', 'egg_dark', 'spots']]); },
    'plot-orange'(w, x, z, rot, mk) { BaseKit.plot(w, x, z, rot, mk, M.plate_orange, 4, [['egg_red', 'egg_gold', 'zigzag'], ['egg_white', 'egg_dark', 'rings'], ['egg_purple', 'egg_pink', 'zigzag'], ['egg_gold', 'egg_red', 'split']]); },
    'plot-blue'(w, x, z, rot, mk) { BaseKit.plot(w, x, z, rot, mk, M.plate_blue, 3, [['egg_cyan', 'egg_white', 'checker'], ['egg_stone', 'egg_dark', 'spots'], ['egg_purple', 'egg_cyan', 'checker'], ['egg_gold', 'egg_white', 'rings'], ['egg_dark', 'egg_cyan', 'stripes']]); },
    'plot-purple'(w, x, z, rot, mk) { BaseKit.plot(w, x, z, rot, mk, M.plate_purple, 5, [['egg_pink', 'egg_cyan', 'checker'], ['egg_dark', 'egg_pink', 'rings'], ['egg_green', 'egg_gold', 'zigzag'], ['egg_white', 'egg_dark', 'spots']]); },
    'plot-yellow'(w, x, z, rot, mk) { BaseKit.plot(w, x, z, rot, mk, M.plate_yellow, 6, [['egg_blue', 'egg_white', 'stripes'], ['egg_red', 'egg_dark', 'checker'], ['egg_cyan', 'egg_pink', 'stripes'], ['egg_green', 'toy_dgreen', 'spots'], ['egg_purple', 'egg_gold', 'split']]); },

    // Вывеска с номером участка
    'base-sign'(w, x, z, rot) { BaseKit.sign(GameMapBuild.frame(w, x, z, rot), 0, 0, '1', M.plate_red); },
    // Столб с лампой: вынос по локальной +x
    'base-lamp'(w, x, z, rot) { BaseKit.lamp(GameMapBuild.frame(w, x, z, rot), 0, 0, 1, 0); },
    // Гирлянда флажков поперёк дорожки: scale[0] — полудлина, крепится к выносам столбов
    'base-bunting'(w, x, z, rot, mk) {
        const F = GameMapBuild.frame(w, x, z, rot), L = GameMapBuild.span(mk)[0], C = [M.toy_red, M.toy_yellow, M.toy_blue, M.toy_lime, M.toy_magenta, M.toy_white], top = 34;
        for (let a = -L; a < L; a++) {
            const sag = Math.round(3 * (1 - (a / L) * (a / L)));
            F.put(a, top - sag, 0, M.plate_white);
            const k = a + L, q = k % 8;
            if (q < 7) {
                const dep = 4 - Math.abs(q - 3), col = C[Math.floor(k / 8) % C.length];
                for (let d = 1; d <= dep; d++) F.put(a, top - sag - d, 0, col);
            }
        }
    },
    // Дерево в кадке
    'base-tree'(w, x, z, rot) { BaseKit.tree(GameMapBuild.frame(w, x, z, rot), 0, 0); },
    // Яйцо-памятник на постаменте
    'base-statue'(w, x, z, rot, mk) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, cx = 0.5, cz = 0.5;
        const o = /-(\d+)$/.test(mk.name) ? ['egg_purple', 'egg_cyan', 'checker', M.plate_purple] : ['egg_gold', 'egg_white', 'rings', M.plate_yellow];
        K.disc(F, cx, cz, 13.5, 0, 2, M.plate_white);
        K.disc(F, cx, cz, 11.5, 2, 4, M.plate_gray);
        K.disc(F, cx, cz, 9.5, 4, 8, o[3]);
        K.disc(F, cx, cz, 10.5, 8, 9, M.plate_white);
        K.egg(F, cx, 9, cz, 8.4, 25, M[o[0]], M[o[1]], o[2]);
    },

    // Гнездо: тумба, соломенное кольцо, плита сбора денег перед ним (локальная +x — к центру участка).
    // Верх тумбы 0.3 м, солома 0.4 м: на ней стоит яйцо (GameBase: y = земля + 0.4).
    nest(w, x, z, rot, mk) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, cx = 0.5, cz = 0.5;
        // плитка заподлицо под гнездом и плитой
        F.box(-13, -1, -13, 28, 0, 14, M.plate_white);
        F.box(-12, -1, -12, 27, 0, 13, M.plate_dark);
        K.plinth(F, cx, cz, M.plate_red);
        K.straw(F, cx, cz);
        // плита денег 1.1 × 1.1 м: центр в 1.8 м по локальной +x, высота 1 воксель, знак на ней читается от центра участка
        F.box(12, -1, -6, 25, 0, 7, M.plate_white);
        F.box(13, 0, -5, 24, 1, 6, M.neon_cash);
        K.CASH.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') F.put(15 + r, 0, 2 - c, M.plate_dark); });
        // номер гнезда на табличке за тумбой
        const m = /-(\d+)$/.exec(mk.name), num = m ? m[1] : '1', hw = num.length > 1 ? 8 : 4;
        F.box(-15, 0, -1, -13, 9, 2, M.plate_dark);
        F.box(-15, 9, -hw, -13, 22, hw + 1, M.plate_white);
        F.box(-13, 9, -hw, -12, 10, hw + 1, M.plate_yellow);
        K.text(F, num, -13, 11, 0, 0, -1, 2, M.plate_dark);
    },

    // Портал вылазок: арка из пластика и неона. Логика рисует плоскость 3.6 × 4.2 м (центр на 2.2 м) в центре маркера:
    // проём — круг радиуса 24 над столбами до 2.8 м, углы плоскости внутри него. Подиум — 1 воксель, по нему входят.
    raidgate(w, x, z, rot) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit;
        const yc = 28, ri = 24, ro = 34, y0 = 1;
        F.box(-52, 0, -18, 52, 1, 18, M.plate_dark);
        F.box(-50, 0, -16, 50, 1, 16, M.plate_gray);
        F.box(-22, 0, -8, 22, 1, 8, M.plate_purple);
        F.box(-22, 0, -8, -20, 1, 8, M.plate_yellow);
        F.box(20, 0, -8, 22, 1, 8, M.plate_yellow);
        const dist = (lx, ly) => { const cx = lx + 0.5, cy = ly + 0.5; return cy <= yc ? Math.abs(cx) : Math.hypot(cx, cy - yc); };
        F.box(-ro, y0, -6, ro, yc + ro, 6, (lx, ly) => {
            const d = dist(lx, ly);
            if (d < ri || d >= ro) return -1;
            if (d < ri + 2) return M.toy_glow_cyan;
            if (d >= ro - 2) return M.plate_yellow;
            return M.plate_purple;
        });
        // неон на лицевых гранях и лампочки по дуге
        for (const zf of [6, -7]) {
            F.box(-ro, y0, zf, ro, yc + ro, zf + 1, (lx, ly) => {
                const d = dist(lx, ly);
                return d >= ro - 4 && d < ro - 3 ? M.neonred : -1;
            });
            const R = ri + 4.5;
            const bulb = (bx, by) => { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) F.put(Math.round(bx) + i - 1, Math.round(by) + j, zf, M.lamp); };
            for (let a = 0; a <= 12; a++) { const q = a / 12 * Math.PI; bulb(Math.cos(q) * R, yc + Math.sin(q) * R); }
            for (const by of [5, 13, 21]) { bulb(-R, by); bulb(R, by); }
        }
        // основания арки
        for (const s of [-1, 1]) {
            const a = s < 0 ? -ro - 1 : ri;
            F.box(a, 1, -8, a + ro - ri + 1, 8, 8, M.plate_dark);
            F.box(a, 8, -8, a + ro - ri + 1, 10, 8, M.plate_yellow);
        }
        // яйца-статуи на арке
        K.disc(F, 0, 0, 10, yc + ro - 3, yc + ro + 1, M.plate_white);
        K.disc(F, 0, 0, 8, yc + ro + 1, yc + ro + 3, M.plate_purple);
        K.egg(F, 0, yc + ro + 3, 0, 9, 26, M.egg_gold, M.egg_white, 'rings');
        for (const s of [-1, 1]) {
            const ex = s * 25, base = yc + 23;
            F.box(ex - 5, base - 6, -5, ex + 5, base, 5, M.plate_purple);
            K.disc(F, ex, 0, 7, base, base + 2, M.plate_white);
            K.egg(F, ex, base + 2, 0, 5.6, 16, s < 0 ? M.egg_cyan : M.egg_pink, M.egg_white, 'stripes');
        }
        // столбы с прожекторами по бокам
        for (const s of [-1, 1]) {
            const c = s * 44, a = c - 3;
            F.box(a - 2, 1, -5, a + 8, 4, 5, M.plate_gray);
            F.box(a, 4, -3, a + 6, 50, 3, (lx, ly) => (ly >> 3) & 1 ? M.plate_yellow : M.plate_dark);
            // поперечина и две фары, смотрят на площадку
            F.box(a - 6, 50, -3, a + 12, 53, 3, M.plate_dark);
            for (const h of [a - 7, a + 7]) {
                F.box(h, 53, -4, h + 7, 60, 4, M.plate_dark);
                F.box(h + 1, 54, 4, h + 6, 59, 5, M.lamp);
                F.box(h + 1, 54, -5, h + 6, 59, -4, M.lamp);
            }
        }
    },

    // Лоток оружейника: крыша в полоску, прилавок, стволы на стене и прилавке (передняя сторона — локальная +z)
    arsenal(w, x, z, rot) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, P = K.pal();
        K.stall(F, { wall: M.plate_orange, trim: M.plate_dark, a: M.plate_red, b: M.plate_white, board: M.plate_yellow });
        K.pix(F, K.PIX.rifle, P, -15, 41, -7, 1, 0, 2);
        // стена: силуэты стволов
        K.pix(F, K.PIX.rifle, P, -17, 20, -12, 1, 0);
        K.pix(F, K.PIX.rpg, P, 2, 20, -12, 1, 0);
        K.pix(F, K.PIX.shotgun, P, -17, 11, -12, 1, 0);
        K.pix(F, K.PIX.pistol, P, -1, 11, -12, 1, 0);
        K.pix(F, K.PIX.smg, P, 8, 11, -12, 1, 0);
        // на прилавке: ящик патронов, стволы стоя на концах, гранаты
        F.box(-12, 10, 6, -6, 13, 10, M.toy_orange);
        F.box(-12, 13, 6, -6, 14, 10, M.toy_dgray);
        K.flat(F, ['..kkkkkkkk', 'nnkkkkkgg.', '...k.k....'], P, -4, 10, 6);
        F.box(7, 10, 6, 13, 12, 10, M.toy_dgray);
        F.box(8, 11, 7, 12, 12, 9, M.toy_yellow);
        K.uprightGun(F, -15, 7, 10, 13, M.toy_black, M.toy_brown);
        K.uprightGun(F, 15, 7, 10, 11, M.toy_dgray, M.toy_brown);
    },

    // Лавка косметики: звёзды и майка
    'vendor-shop'(w, x, z, rot) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, P = K.pal();
        K.stall(F, { wall: M.plate_purple, trim: M.plate_yellow, a: M.plate_purple, b: M.plate_white });
        K.pix(F, K.PIX.star, P, -5, 39, -7, 1, 0, 2);
        K.pix(F, K.PIX.shirt, P, -17, 13, -12, 1, 0);
        K.pix(F, K.PIX.star, P, -4, 19, -12, 1, 0);
        K.pix(F, K.PIX.shirt, P, 8, 13, -12, 1, 0);
        for (const [a, c] of [[-14, M.toy_magenta], [-8, M.toy_cyan], [5, M.toy_yellow], [11, M.toy_lime]]) F.box(a, 10, 6, a + 4, 13, 10, c);
    },

    // Питомник: яйца и лапки
    'vendor-pets'(w, x, z, rot) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, P = K.pal();
        K.stall(F, { wall: M.plate_green, trim: M.plate_yellow, a: M.plate_green, b: M.plate_white });
        K.pix(F, K.PIX.paw, P, -7, 39, -7, 1, 0, 2);
        K.pix(F, K.PIX.egg, P, -16, 12, -12, 1, 0);
        K.pix(F, K.PIX.paw, P, -3, 20, -12, 1, 0);
        K.pix(F, K.PIX.egg, P, 8, 12, -12, 1, 0);
        for (const [a, c] of [[-14, M.egg_gold], [-7, M.egg_blue], [4, M.egg_pink], [10, M.egg_green]]) { F.box(a, 10, 6, a + 4, 14, 10, c); F.box(a + 1, 14, 7, a + 3, 16, 9, c); }
    },

    // Кодекс: книги на полках
    'vendor-codex'(w, x, z, rot) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, P = K.pal();
        K.stall(F, { wall: M.plate_red, trim: M.plate_dark, a: M.plate_red, b: M.plate_yellow });
        K.pix(F, K.PIX.book, P, -8, 39, -7, 1, 0, 2);
        for (let y = 10; y < 26; y += 8) {
            F.box(-18, y - 1, -12, 19, y, -9, M.plate_dark);
            for (let a = -17, i = 0; a < 18; a += 3, i++) F.box(a, y, -12, a + 2, y + 5 + (i % 2), -10, [M.toy_red, M.toy_blue, M.toy_yellow, M.toy_lime, M.toy_magenta][i % 5]);
        }
        for (const a of [-14, 7]) { F.box(a, 10, 6, a + 8, 12, 10, M.toy_white); F.box(a, 12, 6, a + 8, 13, 10, M.toy_red); }
    },

    // Лоток улучшений: те же детали, значки здоровья, брони, скорости
    upgrades(w, x, z, rot) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, P = K.pal();
        K.stall(F, { wall: M.plate_blue, trim: M.plate_yellow, a: M.plate_blue, b: M.plate_white });
        K.pix(F, K.PIX.arrow, P, -9, 39, -7, 1, 0, 2);
        K.pix(F, K.PIX.heart, P, -17, 11, -12, 1, 0);
        K.pix(F, K.PIX.shield, P, -5, 11, -12, 1, 0);
        K.pix(F, K.PIX.boot, P, 8, 11, -12, 1, 0);
        K.pix(F, K.PIX.arrow, P, -13, 19, -12, 1, 0);
        K.pix(F, K.PIX.arrow, P, 5, 19, -12, 1, 0);
        K.pix(F, K.PIX.pistol, P, -3, 20, -12, 1, 0);
        // на прилавке: колбы, шестерня, ящик
        for (const [a, c] of [[-13, M.toy_cyan], [-9, M.toy_magenta], [-5, M.toy_lime]]) {
            F.box(a, 10, 6, a + 3, 14, 9, c);
            F.box(a + 1, 14, 7, a + 2, 16, 8, M.toy_white);
        }
        F.box(4, 10, 5, 13, 13, 10, M.crate);
        F.box(4, 13, 5, 13, 14, 10, M.darkwood);
        F.box(6, 14, 6, 11, 16, 9, M.neon_cash);
    },

    // Подставка манекена: 1 воксель, манекен стоит на ней (GameBase: y = земля + 0.1)
    dummy(w, x, z, rot) {
        const F = GameMapBuild.frame(w, x, z, rot), K = BaseKit, cx = 0, cz = 0;
        K.disc(F, cx, cz, 11, -1, 0, M.plate_white);
        K.disc(F, cx, cz, 9.5, 0, 1, M.plate_yellow);
        K.ring(F, cx, cz, 5.5, 7, 0, 1, M.plate_dark);
        // мешки вокруг (3 тела) сзади и по бокам; перед манекеном свободно
        K.bag(F, -5, 0, -15);
        K.bag(F, -16, 0, -8, true);
        K.bag(F, 11, 0, -8, true);
    },
});

/**
 * Алтарь яйца на вылазках (подключает GameRaid вместо круглой тумбы): три яруса, верх 0.3 м, диаметр 2.1 м, четыре столбика
 * по диагоналям с просветом 1.25 м — подойти и взять яйцо можно с любой стороны. Воксели через w.set (мир уже собран).
 * @param {VoxWorld} w @param {number} cx центр, воксель @param {number} cy первый свободный слой над землёй @param {number} cz
 */
/** @type {any} */ (GameMapBuild).altar = function (w, cx, cy, cz) {
    const put = (dx, dy, dz, v) => w.set(cx + dx, cy + dy, cz + dz, v);
    for (let dx = -13; dx <= 13; dx++) for (let dz = -13; dz <= 13; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > 10.5) continue;
        // подложка на неровной земле: не висит
        for (let dy = -1; dy >= -2; dy--) if (!w.get(cx + dx, cy + dy, cz + dz)) put(dx, dy, dz, M.plate_dark);
        put(dx, 0, dz, d > 8.7 ? M.plate_gray : M.plate_dark);
        if (d <= 8.5) put(dx, 1, dz, d > 7 ? M.plate_purple : M.plate_dark);
        if (d <= 6.5) put(dx, 2, dz, d > 4.6 ? M.plate_yellow : M.plate_white);
    }
    // зубцы на нижнем ярусе (шагаются)
    for (let a = 0; a < 8; a++) {
        const q = a / 8 * Math.PI * 2;
        put(Math.round(Math.cos(q) * 9.6), 1, Math.round(Math.sin(q) * 9.6), M.plate_yellow);
    }
    // столбики по диагоналям
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = sx * 8, pz = sz * 8;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            for (let y = 0; y < 8; y++) put(px + i, y, pz + j, y >= 3 && y <= 4 ? M.plate_yellow : M.plate_purple);
        }
        put(px, 8, pz, M.neon_cash);
    }
};
