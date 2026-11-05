// EnemyTypes.js — виды врагов: воксельные рисунки частей и числа. Стиль — абсурдные мем-существа (оригинальные
// персонажи: еда, бытовые вещи, птицы). Рисунки: FolkArt.grid(sx, sy, sz, g => …) в вокселях vox ≈ 0.05 м, +x — левый
// бок существа, +y — вверх, +z — вперёд (лицо рисовать на стороне z = sz − 1). Внутренность каждой части заливается
// наполнителем (toy_foam, или своё поле inside): его видно, когда вырезают пиксели. Никакой крови и анатомии —
// только игрушечный пластик.
//
// Поля типа: id, name {ru,en}, tier (1..7 — с какой сложности вылазки), hp, speed (м/с), behavior
// (melee|shooter|lobber|kamikaze|charger|sniper|flyer|boss), dmg, range, rate (с между атаками), reward ($),
// mass (делит толчки), stagger (выше — труднее уронить), aggro (м), scale, breaker (ломает стены), bolt {color,speed,dmg,size,lob,blast},
// burst/burstGap (очередь), keep (дистанция стрелка), noRaid (не в обычной охране), boss, noHeadDeath (голова не убивает),
// minions/minionCount (свита босса), slamR (радиус удара о землю), vox (размер вокселя, по умолчанию 0.05), radius (габарит луча), girth (радиус тела).
//
// Рисунок ↔ кости: длина части = sy · vox ≈ расстояние между частицами кости (см. FolkKit.biped: legU, legL, belly, chest,
// head+neck, armU, armF). Нижняя часть ноги тянется до пола: sy ≈ (legL + 0.08) / 0.05. Голова крепится концом bot — нижние
// 2 слоя сетки головы не оставлять пустыми (иначе голова «оторвана» от шеи).
//
// Двуногие: defineFolk (FolkKit.biped). Летуны и прочие: defineFolkCustom со своим FolkSkeleton и pose (гусь, дрон).

/** Собрать тип: нарисованные части -> скелет -> запись в VoxFolk.TYPES. */
function defineFolk(id, o) {
    const inside = o.inside != null ? o.inside : M.toy_foam;
    for (const k in o.art) if (o.art[k] && o.art[k].fillInside) o.art[k].fillInside(inside);
    for (const r of o.riders || []) if (r.art && r.art.fillInside) r.art.fillInside(inside);
    const sk = FolkKit.biped(o.dims || {}, o.art, o.riders || [], o.armor);
    const hip = /** @type {any} */ (sk).hipY, d = /** @type {any} */ (sk).dims;
    VoxFolk.TYPES[id] = Object.assign({
        id, skeleton: sk, pose: FolkKit.poseBiped, vox: 0.05, height: hip + d.belly + d.chest + d.neck + d.head + 0.04,
        girth: 0.3, radius: 1.5, hp: 100, speed: 3.5, behavior: 'melee', dmg: 10, range: 1.5, rate: 1, reward: 15, tier: 1,
    }, o);
}

/**
 * Тип на своём скелете (не двуногий): o.skeleton — FolkSkeleton (частица pelvis обязательна, neck/waist желательны,
 * haR — точка выстрела), o.pose(rig, dt) заполняет rig.T мировыми целями частиц, o.height, o.girth, o.radius — габариты.
 */
function defineFolkCustom(id, o) {
    const inside = o.inside != null ? o.inside : M.toy_foam;
    for (const p of o.skeleton.parts) if (p.art && p.art.fillInside) p.art.fillInside(inside);
    VoxFolk.TYPES[id] = Object.assign({
        id, vox: 0.05, height: 1.6, girth: 0.3, radius: 1.5, hp: 100, speed: 3.5, behavior: 'melee', dmg: 10, range: 1.5, rate: 1, reward: 15, tier: 1,
    }, o);
}

/** Простая конечность-брусок: цвет сверху, внизу кисть или ботинок. */
function folkLimb(sx, sy, sz, top, end, endLen = 4, endFwd = 0) {
    return FolkArt.grid(sx, sy, sz + endFwd, g => {
        g.box(0, endLen, 0, sx, sy, sz, top);
        g.box(0, 0, 0, sx, endLen, sz + endFwd, end);
    });
}

/** Глаз на передней грани (z = sz − 1): белок w×h с углом (x, y), зрачок p×p; dx, dy — смещение взгляда. */
function folkEye(g, x, y, w, h, p = 2, dx = 0, dy = 0, white = M.toy_eye, pupil = M.toy_black, z = g.sz) {
    g.box(x, y, z - 2, x + w, y + h, z, white);
    const px = x + ((w - p) >> 1) + dx, py = y + ((h - p) >> 1) + dy;
    g.box(px, py, z - 1, px + p, py + p, z, pupil);
    return g;
}
/** Два глаза симметрично по центру сетки: gap — просвет между белками; dx > 0 — зрачки к носу (злой взгляд). z — передняя грань. */
function folkEyes(g, y, w, h, gap, p = 2, dx = 0, dy = 0, z = g.sz) {
    const x0 = Math.floor((g.sx - (w * 2 + gap)) / 2);
    folkEye(g, x0, y, w, h, p, dx, dy, M.toy_eye, M.toy_black, z);
    folkEye(g, x0 + w + gap, y, w, h, p, -dx, dy, M.toy_eye, M.toy_black, z);
    return g;
}
/**
 * Изогнутая труба вдоль y (банан): слои [y0, y1), центр по z плывёт от zc0 к zc1, радиусы rx, rz (воксели),
 * mat — материал (число или (x,y,z) -> материал).
 */
function folkTube(g, cx, zc0, zc1, rx, rz, y0, y1, mat) {
    for (let y = y0; y < y1; y++) {
        const zc = zc0 + (zc1 - zc0) * (y - y0) / Math.max(1, y1 - y0 - 1);
        g.ell(cx, y + 0.5, zc, rx, 0.5, rz, mat);
    }
    return g;
}
/** Злые брови над глазами (внутренние концы ниже). */
function folkBrows(g, y, w, gap, c = M.toy_black, thick = 1) {
    const x0 = Math.floor((g.sx - (w * 2 + gap)) / 2), z = g.sz;
    for (let i = 0; i < w; i++) {
        const lo = y + Math.round((w - 1 - i) * 0.5), ro = y + Math.round(i * 0.5);
        g.box(x0 + i, lo, z - 2, x0 + i + 1, lo + thick, z, c);
        g.box(x0 + w + gap + i, ro, z - 2, x0 + w + gap + i + 1, ro + thick, z, c);
    }
    return g;
}
/** Рот-щель с белыми зубами сверху. */
function folkMouth(g, x, y, w, h, teeth = true, c = M.toy_black) {
    g.box(x, y, g.sz - 2, x + w, y + h, g.sz, c);
    if (teeth && h > 1) g.box(x + 1, y + h - 1, g.sz - 1, x + w - 1, y + h, g.sz, M.toy_white);
    return g;
}
/** Шум 0..1 по вокселю (для пятен и крапа). */
const folkNoise = (x, y, z) => VoxFolk.hash(x, y, z);

/**
 * Оружие в правой руке (наездник на armFR): ось z рисунка — ствол — идёт вдоль предплечья от локтя к кисти, ось y — вверх.
 * В позе aim ствол смотрит вперёд (чуть вверх), при опущенной руке — вниз. armF — длина предплечья (dims.armF),
 * fwd — на сколько центр рисунка вынесен за кисть (м); roll — поворот вокруг ствола.
 */
function folkHold(art, armF, fwd = 0.18, name = 'item', roll = 0) {
    return { name, art, parent: 'armFR', pos: [0, -armF * 0.5 - fwd, 0], rot: [1.5, 0, roll] };
}

(function () {
    const C = M;

    // ---- Огурчино Пистолетто: огурец с бластером (стрелок)
    {
        const body = (top) => FolkArt.grid(12, top ? 7 : 6, 10, g => { g.box(0, 0, 0, 12, top ? 7 : 6, 10, C.toy_green); g.paint((x, y, z) => (x + y * 3 + z * 2) % 5 === 0 ? C.toy_dgreen : -1); });
        const head = FolkArt.grid(14, 14, 12, g => {
            g.ell(7, 7, 6, 7, 7, 6, C.toy_green);
            g.paint((x, y, z) => (x * 2 + y * 3 + z) % 7 === 0 ? C.toy_dgreen : -1);
            g.box(3, 7, 10, 6, 10, 12, C.toy_eye); g.box(8, 7, 10, 11, 10, 12, C.toy_eye);
            g.box(4, 7, 11, 5, 9, 12, C.toy_black); g.box(9, 7, 11, 10, 9, 12, C.toy_black);
            g.box(4, 3, 10, 10, 4, 12, C.toy_black); g.box(5, 2, 10, 9, 3, 12, C.toy_white);
            g.box(2, 11, 8, 12, 12, 11, C.toy_black);
        });
        const blaster = FolkArt.grid(3, 4, 14, g => { g.box(0, 0, 0, 3, 3, 14, C.toy_orange); g.box(0, 0, 11, 3, 3, 14, C.toy_glow_red); g.box(1, 3, 3, 2, 4, 6, C.toy_black); });
        defineFolk('pickle', {
            name: { ru: 'Огурчино Пистолетто', en: 'Pistoletto Pickle' }, tier: 1, hp: 60, speed: 2.8, behavior: 'shooter', dmg: 7, range: 17, rate: 1.5, keep: 9, reward: 16, aggro: 17,
            bolt: { color: 'green', speed: 16, dmg: 7 },
            dims: { legU: 0.26, legL: 0.28, hipW: 0.1, belly: 0.3, chest: 0.34, shW: 0.3, armU: 0.24, armF: 0.26, head: 0.68, neck: 0.02 },
            art: {
                head, chest: body(true), belly: body(false),
                armU: folkLimb(4, 5, 4, C.toy_green, C.toy_green, 1), armF: folkLimb(4, 5, 4, C.toy_green, C.toy_yellow, 2),
                legU: folkLimb(5, 5, 5, C.toy_blue, C.toy_blue, 1), legL: folkLimb(5, 6, 5, C.toy_blue, C.toy_white, 2, 3),
            },
            riders: [folkHold(blaster, 0.26, 0.2, 'gun')],
        });
    }

    // ---- Пельмень Гопникус: пельмень в спортивке (ближний бой)
    {
        const stripe = (sy) => FolkArt.grid(16, sy, 12, g => { g.box(0, 0, 0, 16, sy, 12, C.toy_navy); g.box(0, 0, 0, 2, sy, 12, C.toy_white); g.box(14, 0, 0, 16, sy, 12, C.toy_white); });
        const head = FolkArt.grid(18, 12, 14, g => {
            g.ell(9, 5, 7, 9, 6, 7, C.toy_cream);
            for (let x = 1; x < 17; x += 2) g.box(x, 8 + (x % 4 === 1 ? 1 : 0), 3, x + 1, 11, 11, C.toy_tan);
            g.box(4, 5, 12, 7, 8, 14, C.toy_white); g.box(11, 5, 12, 14, 8, 14, C.toy_white);
            g.box(5, 5, 13, 7, 7, 14, C.toy_black); g.box(12, 5, 13, 14, 7, 14, C.toy_black);
            g.box(4, 8, 12, 8, 9, 14, C.toy_black); g.box(10, 8, 12, 14, 9, 14, C.toy_black);
            g.box(6, 2, 12, 12, 3, 14, C.toy_black);
        });
        defineFolk('dumpling', {
            name: { ru: 'Пельмень Гопникус', en: 'Dumpling Gopnikus' }, tier: 1, hp: 90, speed: 3.9, behavior: 'melee', dmg: 11, range: 1.55, rate: 1.0, reward: 14, aggro: 15,
            dims: { legU: 0.32, legL: 0.33, hipW: 0.14, belly: 0.26, chest: 0.32, shW: 0.34, armU: 0.3, armF: 0.33, head: 0.52 },
            art: {
                head, chest: stripe(7), belly: stripe(6),
                armU: folkLimb(5, 6, 5, C.toy_navy, C.toy_navy, 1), armF: folkLimb(5, 7, 5, C.toy_navy, C.toy_cream, 3),
                legU: folkLimb(6, 7, 6, C.toy_navy, C.toy_navy, 1), legL: folkLimb(6, 7, 6, C.toy_navy, C.toy_white, 2, 3),
            },
        });
    }

    // ---- Тостер-Камикадзе: бежит и взрывается
    {
        const head = FolkArt.grid(18, 16, 12, g => {
            g.box(0, 0, 0, 18, 15, 12, C.toy_chrome);
            g.box(2, 15, 2, 8, 16, 10, C.toy_black); g.box(10, 15, 2, 16, 16, 10, C.toy_black);
            g.box(3, 15, 3, 7, 16, 9, C.toy_tan); g.box(11, 15, 3, 15, 16, 9, C.toy_tan);
            g.box(3, 7, 11, 7, 11, 12, C.toy_eye); g.box(11, 7, 11, 15, 11, 12, C.toy_eye);
            g.box(5, 7, 11, 7, 9, 12, C.toy_black); g.box(11, 7, 11, 13, 9, 12, C.toy_black);
            g.box(5, 3, 11, 13, 5, 12, C.toy_glow_red);
        });
        const small = (c) => FolkArt.grid(8, 4, 6, g => g.box(0, 0, 0, 8, 4, 6, c));
        defineFolk('toaster', {
            name: { ru: 'Тостер-Камикадзе', en: 'Kamikaze Toaster' }, tier: 1, hp: 35, speed: 6.4, behavior: 'kamikaze', dmg: 0, range: 2.4, fuse: 0.65, blast: 2.5, reward: 12, aggro: 19, stride: 0.34,
            dims: { legU: 0.14, legL: 0.16, hipW: 0.12, belly: 0.1, chest: 0.1, shW: 0.3, armU: 0.12, armF: 0.14, head: 0.62, neck: 0 },
            art: {
                head, chest: small(C.toy_dgray), belly: small(C.toy_dgray),
                armU: folkLimb(3, 3, 3, C.toy_black, C.toy_black, 1), armF: folkLimb(3, 3, 3, C.toy_black, C.toy_red, 1),
                legU: folkLimb(3, 3, 3, C.toy_black, C.toy_black, 1), legL: folkLimb(3, 3, 3, C.toy_black, C.toy_red, 1, 2),
            },
        });
    }
})();

// ======================================================================= tier 1–2
(function () {
    const C = M;
    const K = C.toy_black, W = C.toy_white;

    // ---- Цыплёнок-Страж: крошечный, быстрый, ходит стаей (и свита Королевы-Несушки)
    {
        const Y = C.toy_yellow, O = C.toy_orange;
        const head = FolkArt.grid(16, 11, 14, g => {
            g.ell(8, 5.5, 7, 8, 5.5, 7, Y);
            g.paint((x, y, z) => y >= 8 - (x & 1) ? W : (z >= 8 && y >= 2 && y <= 4 && (x <= 2 || x >= 13) ? C.toy_pink : -1));
            folkEyes(g, 3, 4, 5, 2, 3, 1, 0);
            g.box(6, 3, 11, 10, 5, 14, O); g.box(7, 2, 11, 9, 3, 13, C.toy_gold);
        });
        const chest = FolkArt.grid(12, 4, 10, g => { g.ell(6, 2, 5, 6, 2.6, 5, Y); g.paint((x, y, z) => z >= 6 ? C.toy_cream : -1); });
        const belly = FolkArt.grid(14, 5, 12, g => { g.ell(7, 2.5, 6, 7, 2.9, 6, Y); g.paint((x, y, z) => z >= 7 ? C.toy_cream : -1); });
        defineFolk('chick', {
            name: { ru: 'Цыплёнок-Страж', en: 'Guard Chick' }, tier: 1, hp: 20, speed: 6.2, behavior: 'melee', dmg: 5, range: 1.6, rate: 0.7, reward: 5, aggro: 15,
            scale: 0.6, mass: 1, stagger: 0.6, stride: 0.3, radius: 1.3, inside: C.toy_cream,
            dims: { legU: 0.14, legL: 0.12, hipW: 0.1, belly: 0.2, chest: 0.16, shW: 0.3, armU: 0.1, armF: 0.1, neck: 0, head: 0.5 },
            art: {
                head, chest, belly,
                armU: folkLimb(3, 3, 5, Y, Y, 1), armF: folkLimb(3, 3, 5, Y, C.toy_gold, 1),
                legU: folkLimb(3, 3, 3, O, O, 1), legL: folkLimb(3, 4, 3, O, O, 1, 3),
            },
        });
    }

    // ---- Тапок-Спринтер: пушистый тапок на ножках
    {
        const P = C.toy_pink;
        const head = FolkArt.grid(20, 12, 16, g => {
            g.ell(10, 5, 8, 10, 7.2, 8, P);
            g.paint((x, y, z) => y >= 10 ? C.toy_cream : (y === 9 ? W : (folkNoise(x, y, z) < 0.12 ? C.toy_magenta : -1)));
            folkEyes(g, 4, 5, 5, 2, 3, 0, 0);
            folkMouth(g, 6, 1, 8, 3);
        });
        const chest = FolkArt.grid(14, 4, 12, g => { g.ell(7, 2, 6, 7, 2.6, 6, P); g.paint((x, y, z) => y === 0 ? W : -1); });
        const belly = FolkArt.grid(16, 3, 14, g => { g.box(0, 0, 0, 16, 3, 14, C.toy_brown); g.paint((x, y, z) => y === 0 && (x + z) % 3 === 0 ? C.toy_dgray : -1); });
        defineFolk('slipper', {
            name: { ru: 'Тапок-Спринтер', en: 'Slipper Sprinter' }, tier: 1, hp: 55, speed: 5.6, behavior: 'melee', dmg: 9, range: 1.55, rate: 0.85, reward: 11, aggro: 16, stride: 0.3, radius: 1.3, inside: C.toy_cream,
            dims: { legU: 0.14, legL: 0.12, hipW: 0.13, belly: 0.16, chest: 0.2, shW: 0.3, armU: 0.14, armF: 0.12, neck: 0, head: 0.56 },
            art: {
                head, chest, belly,
                armU: folkLimb(4, 4, 4, P, P, 1), armF: folkLimb(4, 3, 4, P, W, 1),
                legU: folkLimb(4, 3, 4, W, W, 1), legL: folkLimb(4, 4, 4, W, W, 1, 3),
            },
        });
    }

    // ---- Петух-Качок: большой гребень, боксёрские перчатки, таран
    {
        const O = C.toy_orange, R = C.toy_red;
        const head = FolkArt.grid(14, 15, 14, g => {
            g.ell(7, 4.5, 7, 6.8, 4.6, 6.8, O);
            const crest = [1, 3, 5, 5, 4, 3, 4, 2, 1, 1];
            for (let z = 2; z < 12; z++) g.box(6, 8, z, 8, 9 + crest[z - 2], z + 1, R);
            folkEyes(g, 3, 4, 4, 2, 2, 1, 0);
            folkBrows(g, 7, 4, 2);
            g.box(5, 2, 11, 9, 4, 14, C.toy_yellow); g.box(6, 1, 11, 8, 2, 13, C.toy_gold);
            g.box(6, 0, 10, 8, 1, 12, R);
        });
        const chest = FolkArt.grid(18, 8, 12, g => { g.ell(9, 4, 6, 9, 4.4, 6, O); g.paint((x, y, z) => z >= 7 && x >= 6 && x <= 11 ? C.toy_cream : -1); });
        const belly = FolkArt.grid(14, 5, 10, g => { g.box(0, 0, 0, 14, 5, 10, K); g.paint((x, y, z) => x <= 1 || x >= 12 ? W : -1); });
        const tail = FolkArt.grid(14, 16, 3, g => {
            const cols = [C.toy_green, C.toy_teal, C.toy_blue, C.toy_purple, C.toy_blue, C.toy_teal, C.toy_green];
            for (let x = 0; x < 14; x++) { const h = Math.round(16 - Math.abs(x - 6.5) * 1.3); g.box(x, 0, 0, x + 1, h, 3, cols[x >> 1]); }
        });
        defineFolk('rooster', {
            name: { ru: 'Петух-Качок', en: 'Buff Rooster' }, tier: 2, hp: 150, speed: 4.3, behavior: 'charger', dmg: 16, range: 1.8, rate: 2.6, chargeSpeed: 11, reward: 32, aggro: 17,
            mass: 1.3, stagger: 1.3, stride: 0.4, hunch: 0.05, radius: 1.7, girth: 0.36,
            dims: { legU: 0.24, legL: 0.26, hipW: 0.12, belly: 0.22, chest: 0.42, shW: 0.4, armU: 0.3, armF: 0.3, neck: 0.04, head: 0.67 },
            art: {
                head, chest, belly,
                armU: folkLimb(8, 7, 8, O, O, 1), armF: folkLimb(7, 7, 7, O, R, 3),
                legU: folkLimb(4, 5, 4, O, O, 1), legL: folkLimb(4, 7, 4, C.toy_yellow, O, 2, 4),
            },
            riders: [{ name: 'tail', art: tail, parent: 'belly', pos: [0, 0.1, -0.3], rot: [-0.5, 0, 0] }],
        });
    }

    // ---- Кактус-Бодибилдер: толстый, колючий, ломает лёгкое
    {
        const G = C.toy_green, D = C.toy_dgreen;
        const spiky = (g, ridgeW = 4) => g.paint((x, y, z) => {
            const ridge = (x + (z >> 1)) % ridgeW === 0;
            return ridge ? (y % 3 === 0 ? C.toy_cream : D) : -1;
        });
        const cLimb = (sx, sy, sz, endLen, fwd, endMat) => { const l = folkLimb(sx, sy, sz, G, endMat || G, endLen, fwd); spiky(l); return l; };
        const head = FolkArt.grid(14, 11, 14, g => {
            g.ell(7, 4.5, 6.5, 7, 4.8, 6.8, G);
            spiky(g, 5);
            g.ell(4, 9.5, 5, 3.2, 1.8, 3.2, C.toy_pink); g.box(3, 10, 4, 5, 11, 6, C.toy_yellow);
            folkEyes(g, 3, 4, 4, 2, 2, 1, 0); folkBrows(g, 7, 4, 2);
            folkMouth(g, 3, 1, 8, 2);
        });
        const chest = FolkArt.grid(18, 8, 14, g => { g.ell(9, 4, 7, 9, 4.4, 7, G); spiky(g); });
        const belly = FolkArt.grid(16, 6, 14, g => { g.ell(8, 3, 7, 8, 3.4, 7, G); spiky(g); });
        defineFolk('cactus', {
            name: { ru: 'Кактус-Бодибилдер', en: 'Bodybuilder Cactus' }, tier: 2, hp: 190, speed: 3.3, behavior: 'melee', dmg: 20, range: 1.9, rate: 1.2, reward: 28, aggro: 15,
            mass: 1.5, stagger: 1.5, breaker: true, girth: 0.42, radius: 1.7, inside: C.toy_lime,
            dims: { legU: 0.2, legL: 0.2, hipW: 0.17, belly: 0.3, chest: 0.4, shW: 0.44, armU: 0.3, armF: 0.3, neck: 0, head: 0.51 },
            art: {
                head, chest, belly,
                armU: cLimb(9, 7, 9, 1, 0), armF: cLimb(8, 7, 8, 3, 0, C.toy_lime),
                legU: folkLimb(8, 4, 8, C.toy_orange, C.toy_orange, 1), legL: folkLimb(8, 6, 8, C.toy_orange, C.toy_brown, 2, 3),
            },
        });
    }

    // ---- Кофе-Мафиозо: чашка в фетровой шляпе с «томми-ганом»
    {
        const head = FolkArt.grid(16, 12, 14, g => {
            g.cyl(8, 7, 8, 7, 0, 12, W);
            folkEyes(g, 5, 4, 5, 2, 2, 1, 0);
            g.box(3, 3, 11, 13, 5, 14, K); g.box(2, 4, 11, 3, 6, 14, K); g.box(13, 4, 11, 14, 6, 14, K);
            g.box(6, 1, 12, 10, 3, 14, K);
        });
        const handle = FolkArt.grid(5, 9, 4, g => { g.box(0, 0, 0, 5, 2, 4, W); g.box(0, 7, 0, 5, 9, 4, W); g.box(3, 0, 0, 5, 9, 4, W); });
        const hat = FolkArt.grid(22, 9, 20, g => {
            g.ell(11, 1.5, 10, 11, 1.7, 10, K);
            g.cyl(11, 10, 7, 6.5, 2, 9, C.toy_dgray);
            g.cyl(11, 10, 7.3, 6.8, 2, 4, C.toy_red);
            g.box(8, 8, 3, 14, 9, 17, K);
        });
        const saucer = FolkArt.grid(18, 3, 16, g => { g.cyl(9, 8, 9, 8, 0, 3, W); g.cyl(9, 8, 5.5, 5, 2, 3, C.toy_cream); });
        const suit = (sx, sy, sz) => FolkArt.grid(sx, sy, sz, g => { g.box(0, 0, 0, sx, sy, sz, K); g.paint((x, y, z) => x % 3 === 0 ? C.toy_dgray : -1); });
        const chest = FolkArt.grid(14, 6, 10, g => {
            g.box(0, 0, 0, 14, 6, 10, K); g.paint((x, y, z) => x % 3 === 0 ? C.toy_dgray : -1);
            g.paint((x, y, z) => z >= 8 && Math.abs(x - 6.5) < y * 0.55 + 0.8 ? W : -1);
            g.paint((x, y, z) => z >= 8 && (x === 6 || x === 7) && y < 5 ? C.toy_red : -1);
        });
        const limb = (sx, sy, sz, end, endLen, fwd = 0) => { const l = folkLimb(sx, sy, sz, K, end, endLen, fwd); l.paint((x, y, z) => y >= endLen && x % 3 === 0 ? C.toy_dgray : -1); return l; };
        const tommy = FolkArt.grid(4, 8, 20, g => {
            g.box(0, 4, 0, 4, 8, 14, C.toy_dgray); g.box(1, 5, 14, 3, 7, 20, K);
            g.box(0, 0, 5, 4, 4, 11, C.toy_gray); g.box(1, 1, 6, 3, 3, 10, K);
            g.box(1, 7, 0, 3, 8, 3, C.toy_brown);
        });
        defineFolk('coffee', {
            name: { ru: 'Кофе-Мафиозо', en: 'Mobster Coffee' }, tier: 2, hp: 90, speed: 3.1, behavior: 'shooter', dmg: 6, range: 18, rate: 2.0, burst: 3, burstGap: 0.12, keep: 10, reward: 26, aggro: 18,
            bolt: { color: 'yellow', speed: 19, dmg: 6, spread: 0.045 }, inside: C.toy_tan, radius: 1.7,
            dims: { legU: 0.26, legL: 0.28, hipW: 0.11, belly: 0.22, chest: 0.3, shW: 0.27, armU: 0.26, armF: 0.28, neck: 0, head: 0.56 },
            art: {
                head, chest, belly: suit(12, 4, 10),
                armU: limb(5, 5, 5, K, 1), armF: limb(5, 6, 5, W, 2),
                legU: limb(5, 5, 5, K, 1), legL: limb(5, 7, 5, W, 3, 3),
            },
            riders: [
                { name: 'handle', art: handle, parent: 'head', pos: [0.47, -0.02, 0], rot: [0, 0, 0] },
                { name: 'hat', art: hat, parent: 'head', pos: [0, 0.42, -0.02], rot: [0.05, 0, 0.1] },
                { name: 'saucer', art: saucer, parent: 'chest', pos: [0, 0.16, 0.02], rot: [0, 0, 0] },
                folkHold(tommy, 0.28, 0.12, 'gun'),
            ],
        });
    }
})();

// ======================================================================= tier 3–4
(function () {
    const C = M;
    const K = C.toy_black, W = C.toy_white;

    // ---- Арбуз-Метатель: бросает арбузные гранаты
    {
        const G = C.toy_green, D = C.toy_dgreen;
        const stripes = (cx, cz, n) => (x, y, z) => ((Math.floor((Math.atan2(x + 0.5 - cx, z + 0.5 - cz) + Math.PI) / (Math.PI * 2) * n)) & 1) ? D : -1;
        const head = FolkArt.grid(20, 13, 18, g => {
            g.ell(10, 6.5, 9, 10, 6.5, 9, G);
            g.paint(stripes(10, 9, 14));
            folkEyes(g, 5, 5, 5, 2, 3, 1, 0); folkBrows(g, 10, 5, 2);
            g.box(4, 0, 15, 16, 4, 18, W); g.box(5, 0, 15, 15, 3, 18, C.toy_pink);
            for (const [x, y] of [[7, 1], [10, 1], [13, 1], [9, 2], [12, 2]]) g.box(x, y, 16, x + 1, y + 1, 18, K);
        });
        const chest = FolkArt.grid(18, 7, 14, g => {
            g.ell(9, 3.5, 7, 9, 3.8, 7, G); g.paint(stripes(9, 7, 12));
        });
        const belly = FolkArt.grid(16, 6, 14, g => { g.ell(8, 3, 7, 8, 3.4, 7, G); g.paint(stripes(8, 7, 10)); g.paint((x, y, z) => y === 0 ? C.toy_lime : -1); });
        const mlimb = (sx, sy, sz, end, endLen, fwd = 0) => { const l = folkLimb(sx, sy, sz, G, end, endLen, fwd); l.paint((x, y, z) => y >= endLen && (x & 2) ? D : -1); return l; };
        const ball = FolkArt.grid(8, 8, 8, g => { g.ell(4, 4, 4, 4, 4, 4, G); g.paint(stripes(4, 4, 7)); });
        defineFolk('melon', {
            name: { ru: 'Арбуз-Метатель', en: 'Melon Thrower' }, tier: 3, hp: 150, speed: 3.2, behavior: 'lobber', dmg: 16, range: 18, rate: 3.0, reward: 52, aggro: 18,
            bolt: { color: 'green', blast: 1.8, speed: 12, dmg: 16, size: 0.32 }, mass: 1.3, stagger: 1.3, girth: 0.4, radius: 1.8, inside: C.toy_pink,
            dims: { legU: 0.22, legL: 0.22, hipW: 0.16, belly: 0.3, chest: 0.34, shW: 0.38, armU: 0.28, armF: 0.3, neck: 0, head: 0.61 },
            art: {
                head, chest, belly,
                armU: mlimb(7, 6, 7, G, 1), armF: mlimb(7, 7, 7, D, 2),
                legU: folkLimb(7, 4, 7, D, D, 1), legL: folkLimb(7, 6, 7, D, W, 2, 3),
            },
            riders: [{ name: 'ball', art: ball, parent: 'armFR', pos: [0, -0.18, 0.04], rot: [0, 0, 0] }],
        });
    }

    // ---- Чайник-Шипун: стреляет паром
    {
        const T = C.toy_teal, CH = C.toy_chrome;
        const head = FolkArt.grid(16, 10, 14, g => {
            g.ell(8, 3, 7, 8, 7.5, 7, T);
            g.paint((x, y, z) => y >= 8 ? CH : -1);
            g.box(7, 9, 6, 9, 10, 8, K);
            folkEyes(g, 3, 4, 4, 2, 2, 1, 0);
            g.box(6, 1, 12, 10, 3, 14, K);
        });
        const spout = FolkArt.grid(5, 13, 5, g => { g.box(0, 0, 0, 5, 10, 5, T); g.box(0, 10, 0, 5, 13, 5, CH); g.box(1, 12, 1, 4, 13, 4, K); });
        const handle = FolkArt.grid(4, 12, 10, g => { g.box(0, 10, 0, 4, 12, 10, K); g.box(0, 0, 0, 4, 12, 3, K); g.box(0, 0, 7, 4, 12, 10, K); });
        const dots = (g) => g.paint((x, y, z) => x % 4 === 1 && y % 3 === 1 ? W : -1);
        const chest = FolkArt.grid(16, 6, 14, g => { g.ell(8, 3, 7, 8, 3.4, 7, T); dots(g); });
        const belly = FolkArt.grid(18, 7, 16, g => { g.ell(9, 3.5, 8, 9, 3.8, 8, T); dots(g); g.paint((x, y, z) => y === 0 ? CH : -1); });
        const nozzle = FolkArt.grid(4, 4, 9, g => { g.box(0, 0, 0, 4, 4, 7, CH); g.box(0, 0, 7, 4, 4, 9, C.toy_cyan); g.box(1, 1, 8, 3, 3, 9, K); });
        defineFolk('kettle', {
            name: { ru: 'Чайник-Шипун', en: 'Hissing Kettle' }, tier: 3, hp: 100, speed: 3.3, behavior: 'shooter', dmg: 6, range: 17, rate: 1.5, burst: 2, burstGap: 0.1, keep: 8, reward: 45, aggro: 18,
            bolt: { color: 'cyan', speed: 28, dmg: 6, size: 0.1, spread: 0.03 }, inside: C.toy_cyan, radius: 1.7, girth: 0.36,
            dims: { legU: 0.16, legL: 0.18, hipW: 0.16, belly: 0.34, chest: 0.3, shW: 0.32, armU: 0.24, armF: 0.26, neck: 0, head: 0.46 },
            art: {
                head, chest, belly,
                armU: folkLimb(5, 5, 5, T, T, 1), armF: folkLimb(5, 6, 5, T, CH, 2),
                legU: folkLimb(6, 3, 6, CH, CH, 1), legL: folkLimb(6, 5, 6, CH, K, 2, 3),
            },
            riders: [
                { name: 'spout', art: spout, parent: 'head', pos: [0.4, -0.02, 0], rot: [0, 0, -1.0] },
                { name: 'handle', art: handle, parent: 'head', pos: [-0.45, 0.02, 0], rot: [0, 0, 0] },
                folkHold(nozzle, 0.26, 0.1, 'nozzle'),
            ],
        });
    }

    // ---- Банан-Снайпер: очень высокий, лазерный прицел
    {
        const Y = C.toy_yellow, B = C.toy_brown;
        const peel = (x, y, z) => folkNoise(x, y, z) < 0.045 ? B : -1;
        const head = FolkArt.grid(10, 12, 16, g => {
            folkTube(g, 5, 8.8, 10.3, 4.5, 4, 0, 9, Y);
            folkTube(g, 5, 10.5, 10.6, 2, 2, 9, 12, B);
            g.paint(peel);
            // слева обычный глаз, справа прицел: чёрная трубка с красной линзой
            folkEye(g, 1, 4, 4, 5, 3, 1, 0, M.toy_eye, K, 14);
            g.box(6, 3, 12, 10, 8, 14, K); g.box(7, 4, 13, 9, 7, 14, C.toy_glow_red);
            g.box(2, 1, 12, 8, 2, 14, K);
        });
        const body = (sy, o0, o1, belt) => FolkArt.grid(10, sy, 14, g => {
            folkTube(g, 5, 7 + o0, 7 + o1, 4.5, 3.8, 0, sy, Y);
            g.paint(peel);
            if (belt) g.paint((x, y, z) => y >= sy - 2 && z >= 6 ? K : -1);
            else g.paint((x, y, z) => y >= 2 && y <= 7 && z >= 9 && (x <= 2 || x >= 7) ? C.toy_dgray : -1);
        });
        const rifle = FolkArt.grid(3, 6, 24, g => {
            g.box(0, 1, 0, 3, 4, 20, C.toy_dgray); g.box(1, 2, 20, 2, 3, 24, K);
            g.box(0, 0, 0, 3, 3, 4, B); g.box(1, 4, 6, 2, 6, 15, K); g.box(1, 4, 15, 2, 6, 16, C.toy_glow_red);
        });
        defineFolk('banana', {
            name: { ru: 'Банан-Снайпер', en: 'Sniper Banana' }, tier: 4, hp: 85, speed: 2.8, behavior: 'sniper', dmg: 28, range: 40, aim: 1.5, rate: 3.2, reward: 60, aggro: 34,
            mass: 1, stagger: 0.8, stride: 0.55, girth: 0.22, radius: 1.9,
            dims: { legU: 0.55, legL: 0.55, hipW: 0.09, belly: 0.36, chest: 0.52, shW: 0.19, armU: 0.34, armF: 0.38, neck: 0.04, head: 0.52 },
            art: {
                head, chest: body(10, -1.2, 0.8, false), belly: body(7, -2.5, -1.2, true),
                armU: folkLimb(4, 8, 4, Y, Y, 1), armF: folkLimb(4, 9, 4, Y, C.toy_dgray, 2),
                legU: folkLimb(4, 11, 4, C.toy_dgreen, C.toy_dgreen, 1), legL: folkLimb(4, 13, 4, C.toy_dgreen, K, 3, 4),
            },
            riders: [folkHold(rifle, 0.38, 0.2, 'gun')],
        });
    }

    // ---- Холодильник-Таран: дверца-щит спереди
    {
        const body = (sy) => FolkArt.grid(20, sy, 16, g => { g.box(0, 0, 0, 20, sy, 16, W); g.paint((x, y, z) => x <= 1 || x >= 18 ? C.toy_cream : -1); });
        const head = FolkArt.grid(16, 8, 14, g => {
            g.box(0, 0, 0, 16, 8, 14, W); g.paint((x, y, z) => y >= 7 ? C.toy_cyan : -1);
            folkEyes(g, 3, 5, 4, 2, 2, 1, 0); folkBrows(g, 7, 5, 2);
            folkMouth(g, 4, 1, 8, 2, false);
        });
        const door = FolkArt.grid(18, 20, 4, g => {
            g.box(0, 0, 0, 18, 20, 3, W); g.box(0, 0, 0, 1, 20, 3, C.toy_cream); g.box(17, 0, 0, 18, 20, 3, C.toy_cream);
            g.box(14, 5, 3, 16, 15, 4, C.toy_chrome);
            g.box(3, 14, 3, 6, 17, 4, C.toy_red); g.box(8, 11, 3, 11, 14, 4, C.toy_blue); g.box(4, 5, 3, 7, 8, 4, C.toy_yellow);
            g.box(2, 9, 3, 6, 11, 4, C.toy_glow_cyan);
        });
        const flimb = (sx, sy, sz, end, endLen, fwd = 0) => folkLimb(sx, sy, sz, C.toy_gray, end, endLen, fwd);
        defineFolk('fridge', {
            name: { ru: 'Холодильник-Таран', en: 'Battering Fridge' }, tier: 4, hp: 320, speed: 3.2, behavior: 'charger', dmg: 24, range: 2.0, rate: 3.0, chargeSpeed: 12, reward: 55, aggro: 18,
            mass: 2, stagger: 2, breaker: true, scale: 1.15, girth: 0.5, radius: 2.2, inside: C.toy_cyan,
            armor: { head: 2, chest: 3, belly: 3, arm: 1.5, leg: 1.5 },
            dims: { legU: 0.2, legL: 0.2, hipW: 0.22, belly: 0.5, chest: 0.5, shW: 0.5, armU: 0.3, armF: 0.32, neck: 0, head: 0.36 },
            art: {
                head, chest: body(10), belly: body(10),
                armU: flimb(7, 7, 7, C.toy_gray, 1), armF: flimb(7, 7, 7, C.toy_dgray, 3),
                legU: folkLimb(9, 4, 9, C.toy_dgray, C.toy_dgray, 1), legL: folkLimb(9, 6, 9, C.toy_dgray, K, 2, 3),
            },
            riders: [{ name: 'door', art: door, parent: 'chest', pos: [0, -0.25, 0.5], rot: [0, 0, 0], armor: 2.5 }],
        });
    }

    // ---- Гриб-Камикадзе: огромная шляпка, бежит и взрывается
    {
        const R = C.toy_red;
        const surf = (x, y) => 11 + 11 * Math.sqrt(Math.max(0, 1 - ((x + 0.5 - 12) / 12) ** 2 - ((y + 0.5 - 2) / 10) ** 2));
        const spots = [[2, 7, 2.6], [21, 7, 2.6], [6, 11, 2.2], [17, 11, 2.2], [12, 11.5, 2.4], [1, 3, 2]].map(([x, y, r]) => [x, y, surf(x, y), r])
            .concat([[11, 11, 4, 2.6], [5, 9, 5, 2.4], [18, 10, 6, 2.4], [3, 6, 10, 2.6], [21, 6, 10, 2.6]]);
        const head = FolkArt.grid(24, 12, 22, g => {
            g.ell(12, 2, 11, 12, 10, 11, R);
            g.paint((x, y, z) => {
                if (y === 0) return C.toy_cream;
                for (const [cx, cy, cz, r] of spots) if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < r * r) return W;
                return -1;
            });
            folkEyes(g, 4, 5, 4, 3, 2, 1, 0); folkBrows(g, 8, 5, 3, K, 2);
            folkMouth(g, 7, 1, 10, 3);
        });
        const chest = FolkArt.grid(10, 5, 9, g => { g.ell(5, 2.5, 4.5, 5, 2.8, 4.5, C.toy_cream); g.paint((x, y, z) => y >= 4 ? W : -1); });
        const belly = FolkArt.grid(11, 4, 10, g => g.ell(5.5, 2, 5, 5.5, 2.3, 5, C.toy_cream));
        defineFolk('mushroom', {
            name: { ru: 'Гриб-Камикадзе', en: 'Kamikaze Mushroom' }, tier: 4, hp: 85, speed: 4.4, behavior: 'kamikaze', dmg: 0, range: 3.0, fuse: 0.85, blast: 3.2, reward: 45, aggro: 18,
            stride: 0.3, radius: 1.8, girth: 0.34, inside: C.toy_cream,
            dims: { legU: 0.14, legL: 0.16, hipW: 0.12, belly: 0.22, chest: 0.24, shW: 0.2, armU: 0.2, armF: 0.2, neck: 0, head: 0.56 },
            art: {
                head, chest, belly,
                armU: folkLimb(4, 4, 4, C.toy_cream, C.toy_cream, 1), armF: folkLimb(4, 5, 4, C.toy_cream, W, 2),
                legU: folkLimb(4, 3, 4, C.toy_cream, C.toy_cream, 1), legL: folkLimb(4, 5, 4, C.toy_cream, C.toy_tan, 2, 3),
            },
        });
    }
})();

// ======================================================================= tier 5–7
(function () {
    const C = M;
    const K = C.toy_black, W = C.toy_white;

    // ---- Бабуля с Тапком: метает тапки
    {
        const SK = C.toy_skin, BL = C.toy_blue, DR = C.toy_magenta;
        const head = FolkArt.grid(16, 10, 14, g => {
            g.ell(8, 4.5, 7, 8, 5, 7, SK);
            // круглые очки: чёрная оправа, белые линзы, зрачки
            g.box(1, 2, 12, 8, 9, 14, K); g.box(8, 2, 12, 15, 9, 14, K);
            g.box(2, 3, 12, 7, 8, 14, W); g.box(9, 3, 12, 14, 8, 14, W);
            g.box(4, 5, 13, 6, 7, 14, K); g.box(10, 5, 13, 12, 7, 14, K);
            g.box(7, 1, 12, 9, 3, 14, C.toy_pink);
            g.box(5, 0, 12, 11, 1, 14, K);
        });
        const scarf = FolkArt.grid(18, 7, 16, g => {
            g.ell(9, 0, 8, 9, 7, 8, BL);
            g.paint((x, y, z) => (x % 4 === 1 && (y + (x >> 2)) % 3 === 0) || (z % 4 === 2 && y % 3 === 1 && x % 2 === 0) ? W : -1);
        });
        const chest = FolkArt.grid(12, 6, 10, g => { g.ell(6, 3, 5, 6, 3.3, 5, DR); g.paint((x, y, z) => (x + y * 2) % 5 === 0 ? C.toy_yellow : -1); });
        const skirt = FolkArt.grid(20, 8, 14, g => {
            for (let y = 0; y < 8; y++) { const hw = Math.round(5.5 + (7 - y) * 0.6), d = Math.round(4.5 + (7 - y) * 0.35); g.box(10 - hw, y, 7 - d, 10 + hw, y + 1, 7 + d, DR); }
            g.paint((x, y, z) => (x + y * 2) % 5 === 0 ? C.toy_yellow : -1);
            g.paint((x, y, z) => z >= 9 && Math.abs(x - 9.5) < 4.5 && y >= 1 ? C.toy_cream : -1);
            g.box(8, 2, 12, 12, 5, 14, C.toy_cream); g.box(9, 3, 13, 11, 4, 14, C.toy_tan);
        });
        const slip = FolkArt.grid(7, 4, 12, g => {
            g.box(0, 0, 0, 7, 1, 12, C.toy_cream); g.box(0, 1, 0, 7, 4, 12, C.toy_orange); g.box(1, 3, 0, 6, 4, 4, C.toy_cream);
        });
        defineFolk('grandma', {
            name: { ru: 'Бабуля с Тапком', en: 'Granny with a Slipper' }, tier: 5, hp: 160, speed: 2.8, behavior: 'shooter', dmg: 12, range: 16, rate: 1.6, keep: 8, reward: 75, aggro: 17,
            bolt: { color: 'orange', size: 0.3, speed: 13, dmg: 12, spread: 0.04 }, radius: 1.7, inside: C.toy_cream,
            dims: { legU: 0.2, legL: 0.2, hipW: 0.12, belly: 0.38, chest: 0.3, shW: 0.26, armU: 0.26, armF: 0.26, neck: 0.03, head: 0.43 },
            art: {
                head, chest, belly: skirt,
                armU: folkLimb(4, 5, 4, DR, DR, 1), armF: folkLimb(4, 5, 4, DR, SK, 2),
                legU: folkLimb(4, 4, 4, C.toy_tan, C.toy_tan, 1), legL: folkLimb(4, 6, 4, C.toy_tan, C.toy_pink, 2, 3),
            },
            riders: [
                { name: 'scarf', art: scarf, parent: 'head', pos: [0, 0.33, -0.02], rot: [0, 0, 0] },
                folkHold(slip, 0.26, 0.1, 'slipper'),
            ],
        });
    }

    // ---- Страус-Спринтер: ноги до небес, быстрый
    {
        const SK = C.toy_skin;
        const head = FolkArt.grid(10, 17, 11, g => {
            for (let y = 0; y < 12; y++) { const o = Math.round(y / 11 * 2); g.box(3, y, 2 + o, 7, y + 1, 6 + o, SK); }
            g.ell(5, 13.5, 5.5, 4.8, 3.6, 4.8, SK);
            folkEyes(g, 12, 3, 4, 2, 2, 0, 0);
            g.box(3, 10, 8, 7, 13, 11, C.toy_orange); g.box(4, 10, 10, 6, 11, 11, C.toy_gold);
            g.box(4, 16, 4, 6, 17, 7, K);
        });
        const feathers = (sx, sy, sz) => FolkArt.grid(sx, sy, sz, g => { g.ell(sx / 2, sy / 2, sz / 2, sx / 2, sy / 2 + 0.3, sz / 2, K); g.paint((x, y, z) => folkNoise(x, y, z) < 0.12 ? C.toy_dgray : -1); });
        const chest = feathers(14, 6, 12);
        chest.paint((x, y, z) => x <= 1 || x >= 12 ? W : -1);
        const tail = FolkArt.grid(12, 10, 8, g => { g.ell(6, 5, 4, 6, 5, 4, W); g.paint((x, y, z) => folkNoise(x, y, z) < 0.14 ? C.toy_cream : -1); });
        const thigh = FolkArt.grid(5, 11, 5, g => { g.box(0, 0, 0, 5, 11, 5, SK); g.paint((x, y, z) => y >= 7 ? K : -1); });
        defineFolk('ostrich', {
            name: { ru: 'Страус-Спринтер', en: 'Sprinter Ostrich' }, tier: 5, hp: 130, speed: 6.8, behavior: 'melee', dmg: 14, range: 1.8, rate: 0.8, reward: 80, aggro: 20,
            mass: 1, stagger: 0.9, stride: 0.6, girth: 0.25, radius: 1.8,
            dims: { legU: 0.55, legL: 0.55, hipW: 0.13, belly: 0.26, chest: 0.3, shW: 0.24, armU: 0.16, armF: 0.16, neck: 0.02, head: 0.79 },
            art: {
                head, chest, belly: feathers(16, 5, 14),
                armU: folkLimb(3, 4, 4, K, K, 1), armF: folkLimb(3, 4, 5, W, W, 1),
                legU: thigh, legL: folkLimb(4, 13, 4, SK, C.toy_orange, 2, 4),
            },
            riders: [{ name: 'tail', art: tail, parent: 'belly', pos: [0, 0.08, -0.3], rot: [-0.4, 0, 0] }],
        });
    }

    // ---- Бетономешалка-Голем: бочка на стальном теле
    {
        const O = C.toy_orange, Y = C.toy_yellow;
        const spiral = (cx, cz) => (x, y, z) => ((((Math.atan2(x + 0.5 - cx, z + 0.5 - cz) / (Math.PI * 2) + 0.5) * 3 + y * 0.22) % 1) < 0.34) ? Y : -1;
        const head = FolkArt.grid(22, 12, 20, g => {
            g.ell(11, 6, 10, 11, 7, 10, O);
            g.paint(spiral(11, 10));
            g.paint((x, y, z) => y >= 11 ? C.toy_gray : (y === 10 && ((x - 11) ** 2 + (z - 10) ** 2) > 30 ? C.toy_chrome : -1));
            folkEyes(g, 5, 5, 4, 3, 2, 1, 0); folkBrows(g, 9, 5, 3, K, 2);
            folkMouth(g, 5, 1, 12, 3);
        });
        const chest = FolkArt.grid(18, 8, 14, g => {
            g.box(0, 0, 0, 18, 8, 14, C.toy_gray);
            g.paint((x, y, z) => z >= 11 && y <= 2 ? (((x + y) & 3) < 2 ? Y : K) : (folkNoise(x, y, z) < 0.06 ? C.toy_dgray : -1));
        });
        const belly = FolkArt.grid(16, 5, 12, g => { g.box(0, 0, 0, 16, 5, 12, C.toy_dgray); g.paint((x, y, z) => y === 4 && x % 4 === 0 ? Y : -1); });
        const mlimb = (sx, sy, sz, end, endLen, fwd = 0) => { const l = folkLimb(sx, sy, sz, C.toy_gray, end, endLen, fwd); l.paint((x, y, z) => y === sy - 2 ? O : -1); return l; };
        defineFolk('mixer', {
            name: { ru: 'Бетономешалка-Голем', en: 'Concrete Mixer Golem' }, tier: 5, hp: 420, speed: 2.8, behavior: 'charger', dmg: 24, range: 2.2, rate: 4, chargeSpeed: 9, reward: 90, aggro: 16,
            mass: 2.2, stagger: 2.2, breaker: true, scale: 1.3, girth: 0.5, radius: 2.3, inside: C.toy_gray,
            armor: { head: 2, chest: 2.5, belly: 2, arm: 1.5, leg: 1.5 },
            dims: { legU: 0.16, legL: 0.16, hipW: 0.2, belly: 0.26, chest: 0.4, shW: 0.46, armU: 0.32, armF: 0.34, neck: 0, head: 0.56 },
            art: {
                head, chest, belly,
                armU: mlimb(8, 7, 8, C.toy_gray, 1), armF: mlimb(8, 8, 8, K, 3),
                legU: folkLimb(9, 3, 9, C.toy_dgray, C.toy_dgray, 1), legL: folkLimb(9, 5, 9, C.toy_dgray, Y, 2, 3),
            },
        });
    }

    // ---- Фараон Кукурузамон: маг-стрелок с пурпурной плазмой
    {
        const Y = C.toy_yellow, GD = C.toy_gold, BL = C.toy_blue, GR = C.toy_green;
        const kern = (g) => g.paint((x, y, z) => (x + y) & 1 ? GD : -1);
        const head = FolkArt.grid(18, 14, 14, g => {
            g.ell(9, 7, 7, 8.8, 7, 6.6, GD);
            g.box(0, 0, 3, 4, 9, 10, GD); g.box(14, 0, 3, 18, 9, 10, GD);
            g.paint((x, y, z) => y % 3 === 0 ? BL : -1);
            g.box(5, 0, 8, 13, 9, 14, Y);
            g.box(4, 9, 9, 14, 10, 14, GD); g.box(8, 9, 12, 10, 12, 14, GR);
            g.box(5, 3, 12, 13, 8, 14, K);
            folkEye(g, 5, 4, 3, 3, 2, 0, 0); folkEye(g, 10, 4, 3, 3, 2, 0, 0);
            g.box(7, 2, 12, 11, 3, 14, K); g.box(8, 0, 11, 10, 2, 14, BL);
        });
        const chest = FolkArt.grid(14, 7, 10, g => { g.ell(7, 3.5, 5, 7, 3.8, 5, Y); kern(g); g.paint((x, y, z) => y >= 4 && z >= 4 ? (((x + y) & 1) ? BL : GD) : -1); });
        const belly = FolkArt.grid(16, 6, 12, g => {
            for (let y = 0; y < 6; y++) g.box(8 - (4 + (5 - y) * 0.5 | 0), y, 1, 8 + (4 + (5 - y) * 0.5 | 0), y + 1, 11, GR);
            g.paint((x, y, z) => x % 3 === 0 ? C.toy_dgreen : -1);
        });
        const staff = FolkArt.grid(4, 4, 24, g => {
            g.box(1, 1, 0, 3, 3, 19, GD); g.box(0, 0, 18, 4, 4, 19, GD);
            g.ell(2, 2, 21, 2, 2, 2.6, C.toy_purple); g.box(1, 1, 20, 3, 3, 22, C.toy_magenta);
        });
        const limb = (sx, sy, sz, end, endLen, fwd = 0) => { const l = folkLimb(sx, sy, sz, Y, end, endLen, fwd); kern(l); return l; };
        defineFolk('pharaoh', {
            name: { ru: 'Фараон Кукурузамон', en: 'Pharaoh Cornamon' }, tier: 6, hp: 260, speed: 2.6, behavior: 'shooter', dmg: 20, range: 20, rate: 2.4, keep: 10, reward: 100, aggro: 20,
            bolt: { color: 'purple', speed: 9, dmg: 20, size: 0.3, spread: 0, blast: 1.4, lead: 0.5 }, radius: 1.8, inside: GD,
            dims: { legU: 0.2, legL: 0.22, hipW: 0.12, belly: 0.3, chest: 0.34, shW: 0.26, armU: 0.26, armF: 0.28, neck: 0.02, head: 0.64 },
            art: {
                head, chest, belly,
                armU: limb(4, 5, 4, Y, 1), armF: limb(4, 6, 4, GD, 2),
                legU: folkLimb(5, 4, 5, GR, GR, 1), legL: folkLimb(5, 6, 5, GR, GD, 2, 3),
            },
            riders: [folkHold(staff, 0.28, 0.14, 'staff')],
        });
    }

    // ---- Жвачка-Здоровяк: розовый ком, много HP
    {
        const MG = C.toy_magenta, PK = C.toy_pink;
        const lump = (g, mottle = 0.18) => g.paint((x, y, z) => folkNoise(x >> 1, y >> 1, z >> 1) < mottle ? PK : -1);
        const head = FolkArt.grid(20, 10, 18, g => {
            g.ell(10, 5, 9, 10, 5.2, 9, MG); g.ell(4, 7, 6, 4, 3.5, 4.5, MG); g.ell(16, 6, 8, 3.6, 3.5, 4, MG);
            lump(g);
            folkEyes(g, 4, 5, 5, 3, 2, 1, 0); folkBrows(g, 9, 5, 3, K, 2);
        });
        const body = (sx, sy, sz) => FolkArt.grid(sx, sy, sz, g => { g.ell(sx / 2, sy / 2, sz / 2, sx / 2, sy / 2 + 0.2, sz / 2, MG); g.ell(sx * 0.2, sy * 0.65, sz * 0.5, sx * 0.18, sy * 0.4, sz * 0.4, MG); lump(g); });
        const bubble = FolkArt.grid(8, 8, 8, g => { g.ell(4, 4, 4, 4, 4, 4, PK); g.box(1, 5, 6, 3, 7, 7, W); g.box(1, 5, 5, 2, 7, 7, W); });
        const glimb = (sx, sy, sz, endLen, fwd = 0) => { const l = folkLimb(sx, sy, sz, MG, PK, endLen, fwd); lump(l, 0.15); return l; };
        defineFolk('gum', {
            name: { ru: 'Жвачка-Здоровяк', en: 'Bubblegum Brute' }, tier: 7, hp: 480, speed: 2.6, behavior: 'melee', dmg: 28, range: 2.1, rate: 1.3, reward: 120, aggro: 14,
            mass: 2.5, stagger: 2.5, scale: 1.35, girth: 0.5, radius: 2.4, inside: C.toy_cream,
            dims: { legU: 0.2, legL: 0.18, hipW: 0.2, belly: 0.4, chest: 0.5, shW: 0.48, armU: 0.3, armF: 0.34, neck: 0, head: 0.46 },
            art: {
                head, chest: body(22, 10, 16), belly: body(20, 8, 16),
                armU: glimb(9, 7, 9, 1), armF: glimb(9, 8, 9, 3),
                legU: glimb(8, 4, 8, 1), legL: glimb(8, 5, 8, 2, 3),
            },
            riders: [{ name: 'bubble', art: bubble, parent: 'head', pos: [0, -0.2, 0.42], rot: [0, 0, 0] }],
        });
    }

    // ---- Индейка-Базука: пилигримская шляпа, веер-хвост, ракетница
    {
        const BR = C.toy_brown, TN = C.toy_tan, R = C.toy_red;
        const head = FolkArt.grid(12, 11, 12, g => {
            g.ell(6, 5, 6, 5.8, 5, 5.8, BR);
            folkEyes(g, 3, 4, 5, 2, 2, 1, 0);
            g.box(4, 2, 10, 8, 5, 12, C.toy_yellow); g.box(5, 2, 11, 7, 4, 12, C.toy_orange);
            g.box(5, 0, 9, 7, 3, 11, R);
        });
        const hat = FolkArt.grid(16, 11, 14, g => {
            g.cyl(8, 7, 8, 7, 0, 2, K); g.cyl(8, 7, 5.5, 5, 2, 11, K); g.cyl(8, 7, 5.8, 5.3, 2, 4, W);
            g.box(6, 2, 12, 10, 4, 14, C.toy_yellow); g.box(7, 3, 12, 9, 3, 14, K);
        });
        const fan = FolkArt.grid(24, 18, 3, g => {
            const cols = [BR, C.toy_orange, R, C.toy_yellow];
            for (let y = 0; y < 18; y++) for (let x = 0; x < 24; x++) {
                const dx = x + 0.5 - 12, dy = y + 0.5, d = Math.hypot(dx, dy);
                if (d > 17 || d < 3) continue;
                const a = Math.atan2(dx, dy);
                g.box(x, y, 0, x + 1, y + 1, 3, (Math.floor(a * 7) & 1) ? C.toy_dgray : cols[Math.min(3, Math.floor((d - 3) / 3.6))]);
            }
        });
        const chest = FolkArt.grid(16, 8, 12, g => { g.ell(8, 4, 6, 8, 4.4, 6, BR); g.paint((x, y, z) => z >= 8 ? TN : -1); });
        const belly = FolkArt.grid(14, 6, 10, g => { g.ell(7, 3, 5, 7, 3.4, 5, BR); g.paint((x, y, z) => z >= 6 ? TN : -1); });
        const launcher = FolkArt.grid(6, 6, 22, g => {
            g.box(0, 0, 0, 6, 6, 22, C.toy_dgreen); g.box(0, 0, 18, 6, 6, 22, C.toy_dgray); g.box(1, 1, 21, 5, 5, 22, K);
            g.box(0, 0, 8, 6, 6, 10, C.toy_yellow); g.box(2, 6 - 1, 2, 4, 6, 6, K);
        });
        defineFolk('turkey', {
            name: { ru: 'Индейка-Базука', en: 'Bazooka Turkey' }, tier: 7, hp: 380, speed: 2.6, behavior: 'lobber', dmg: 30, range: 22, rate: 3.6, reward: 120, aggro: 22,
            bolt: { color: 'orange', blast: 2.6, speed: 14, dmg: 30, size: 0.4 }, mass: 1.5, stagger: 1.5, girth: 0.36, radius: 2.2,
            dims: { legU: 0.28, legL: 0.3, hipW: 0.16, belly: 0.32, chest: 0.4, shW: 0.34, armU: 0.28, armF: 0.3, neck: 0.06, head: 0.45 },
            art: {
                head, chest, belly,
                armU: folkLimb(5, 6, 5, BR, BR, 1), armF: folkLimb(5, 7, 5, BR, TN, 2),
                legU: folkLimb(5, 6, 5, BR, BR, 1), legL: folkLimb(4, 8, 4, C.toy_orange, C.toy_yellow, 2, 4),
            },
            riders: [
                { name: 'hat', art: hat, parent: 'head', pos: [0, 0.43, 0], rot: [0, 0, 0.05] },
                { name: 'fan', art: fan, parent: 'chest', pos: [0, -0.1, -0.35], rot: [-0.3, 0, 0] },
                folkHold(launcher, 0.3, 0.1, 'launcher'),
            ],
        });
    }
})();

// ======================================================================= летуны на своём скелете
(function () {
    const C = M;
    const K = C.toy_black, W = C.toy_white;

    /** Жёсткая цель частицы: локальная точка (x влево, y вверх, z вперёд) -> мир, с общим наклоном корпуса. */
    function flyPose(rig, ctx, name, lx, ly, lz) {
        const i = rig.type.skeleton.ids[name] * 3, s = rig.scale, R = rig.root, T = rig.T;
        // наклон вокруг оси x (вперёд-вниз) и крен вокруг z, вокруг точки pivot
        const dy = ly - ctx.py, dz = lz - ctx.pz;
        let y1 = ctx.py + dy * ctx.cp - dz * ctx.sp, z1 = ctx.pz + dz * ctx.cp + dy * ctx.sp, x1 = lx;
        const dx = x1, dy2 = y1 - ctx.py;
        x1 = dx * ctx.cr - dy2 * ctx.sr; y1 = ctx.py + dx * ctx.sr + dy2 * ctx.cr;
        y1 += ctx.bob;
        T[i] = R.x + x1 * s * rig.rx + z1 * s * rig.fx;
        T[i + 1] = R.y + y1 * s;
        T[i + 2] = R.z + x1 * s * rig.rz + z1 * s * rig.fz;
    }
    /** Общая часть поз летунов: курс, наклон по скорости, крен вбок, покачивание. */
    function flyCtx(rig, py, pz, leanK = 0.07, maxLean = 0.32) {
        const R = rig.root;
        rig.fx = Math.sin(R.yaw); rig.fz = Math.cos(R.yaw); rig.rx = rig.fz; rig.rz = -rig.fx;
        const fwd = R.vx * rig.fx + R.vz * rig.fz, side = R.vx * rig.rx + R.vz * rig.rz;
        const fl = rig.flinch, back = (rig.flx * rig.fx + rig.flz * rig.fz) * fl;
        const lean = Math.max(-0.3, Math.min(maxLean, fwd * leanK)) - back * 0.28;
        const bank = Math.max(-0.3, Math.min(0.3, -side * 0.05));
        return { py, pz, cp: Math.cos(lean), sp: Math.sin(lean), cr: Math.cos(bank), sr: Math.sin(bank), bob: Math.sin(rig.time * 2.2) * 0.04 };
    }

    // ---- Гусь-Вертолёт: гусь с пропеллером на шапке, сверху бросает бомбы
    {
        const O = C.toy_orange;
        const head = FolkArt.grid(10, 14, 14, g => {
            for (let y = 0; y < 8; y++) { const o = Math.round(y / 8 * 2); g.box(3, y, 2 + o, 7, y + 1, 6 + o, W); }
            g.ell(5, 10.5, 6.5, 4.8, 3.5, 5, W);
            folkEyes(g, 10, 3, 4, 1, 2, 1, 0, 12);
            g.box(3, 7, 10, 7, 10, 14, O); g.box(4, 7, 11, 6, 8, 14, C.toy_gold);
        });
        const body = FolkArt.grid(14, 10, 12, g => { g.ell(7, 5, 6, 7, 5.2, 6, W); g.paint((x, y, z) => z >= 8 && y <= 6 ? C.toy_cream : -1); });
        const wing = FolkArt.grid(3, 14, 9, g => {
            g.box(0, 0, 0, 3, 14, 9, W); g.box(0, 0, 0, 3, 4, 9, C.toy_gray); g.box(0, 4, 0, 3, 5, 9, C.toy_cream);
            g.paint((x, y, z) => z === 4 || z === 7 ? C.toy_cream : -1);
        });
        const leg = folkLimb(4, 8, 3, O, O, 2, 5);
        const tail = FolkArt.grid(6, 5, 8, g => { g.ell(3, 2.5, 4, 3, 2.5, 4, W); g.box(2, 3, 5, 4, 5, 8, C.toy_gray); });
        const cap = FolkArt.grid(10, 7, 9, g => { g.ell(5, 0, 4.5, 5, 6, 4.5, C.toy_blue); g.paint((x, y, z) => y === 3 ? C.toy_yellow : -1); g.box(4, 6, 3, 6, 7, 6, K); });
        const prop = FolkArt.grid(20, 2, 20, g => {
            g.box(0, 0, 8, 20, 2, 12, C.toy_red); g.box(8, 0, 0, 12, 2, 20, C.toy_red);
            g.box(0, 0, 8, 3, 2, 12, C.toy_yellow); g.box(17, 0, 8, 20, 2, 12, C.toy_yellow);
            g.box(8, 0, 0, 12, 2, 3, C.toy_yellow); g.box(8, 0, 17, 12, 2, 20, C.toy_yellow);
            g.box(8, 0, 8, 12, 2, 12, C.toy_dgray);
        });
        const sk = new FolkSkeleton();
        sk.p('pelvis', 0, 0.5, -0.03, 0.14, 8).p('waist', 0, 0.7, 0, 0.13, 8).p('neck', 0, 0.92, 0.05, 0.12, 7).p('head', 0, 1.6, 0.05, 0.13, 3);
        sk.p('shL', 0.26, 0.86, 0, 0.09, 4).p('shR', -0.26, 0.86, 0, 0.09, 4);
        sk.p('wiL', 0.88, 0.9, -0.04, 0.08, 1.5).p('wiR', -0.88, 0.9, -0.04, 0.08, 1.5);
        sk.p('hiL', 0.11, 0.42, 0, 0.09, 4).p('hiR', -0.11, 0.42, 0, 0.09, 4);
        sk.p('anL', 0.11, 0.1, 0.08, 0.08, 2).p('anR', -0.11, 0.1, 0.08, 0.08, 2);
        sk.rigid(['pelvis', 'waist', 'neck', 'shL', 'shR', 'hiL', 'hiR']);
        sk.link('neck', 'head', 1).link('shL', 'head', 0.3).link('shR', 'head', 0.3).link('waist', 'head', 0.15);
        sk.link('shL', 'wiL').link('shR', 'wiR').link('wiL', 'pelvis', 0.5, true, 0.7).link('wiR', 'pelvis', 0.5, true, 0.7);
        sk.link('hiL', 'anL').link('hiR', 'anR');
        sk.part('body', { art: body, top: 'neck', bot: 'pelvis', xa: 'shL', xb: 'shR', prox: null, role: 'core' });
        sk.part('head', { art: head, top: 'head', bot: 'neck', prox: 'bot', parent: 'body', role: 'head' });
        sk.part('wingL', { art: wing, top: 'shL', bot: 'wiL', prox: 'top', parent: 'body', role: 'arm' });
        sk.part('wingR', { art: wing, top: 'shR', bot: 'wiR', prox: 'top', parent: 'body', role: 'arm' });
        sk.part('legL', { art: leg, top: 'hiL', bot: 'anL', prox: 'top', parent: 'body', role: 'other' });
        sk.part('legR', { art: leg, top: 'hiR', bot: 'anR', prox: 'top', parent: 'body', role: 'other' });
        sk.rider('tail', { art: tail, parent: 'body', pos: [0, -0.1, -0.34], rot: [-0.4, 0, 0] });
        sk.rider('cap', { art: cap, parent: 'head', pos: [0, 0.38, 0], rot: [0, 0, 0] });
        sk.rider('prop', { art: prop, parent: 'head', pos: [0, 0.6, 0], rot: [0, 0, 0] });
        const pose = (rig, dt) => {
            const R = rig.root, t = rig.time, ids = rig.type.skeleton.ids, pts = rig.type.skeleton.pts;
            const ctx = flyCtx(rig, 0.5, 0);
            for (const n of ['pelvis', 'waist', 'neck', 'head', 'shL', 'shR', 'hiL', 'hiR']) { const q = pts[ids[n]]; flyPose(rig, ctx, n, q.x, q.y, q.z); }
            const a = Math.sin(t * 13) * 0.55 + 0.1;
            for (const sd of [1, -1]) {
                const nm = sd > 0 ? 'L' : 'R', sh = pts[ids['sh' + nm]], hi = pts[ids['hi' + nm]], sw = Math.sin(t * 3 + sd) * 0.14;
                flyPose(rig, ctx, 'wi' + nm, sh.x + sd * Math.cos(a) * 0.62, sh.y + Math.sin(a) * 0.62, sh.z - 0.04);
                flyPose(rig, ctx, 'an' + nm, hi.x, hi.y - 0.32 * Math.cos(sw) - 0.08 * Math.sin(sw), hi.z - 0.32 * Math.sin(sw) + 0.08 * Math.cos(sw));
            }
            const p = rig.byName.prop;
            if (p && p.pos) p.rel = FolkRig._relFromEuler(p.pos, [0, t * 26, 0]);
        };
        defineFolkCustom('goose', {
            name: { ru: 'Гусь-Вертолёт', en: 'Helicopter Goose' }, tier: 3, hp: 70, speed: 4.5, behavior: 'flyer', dmg: 14, range: 15, rate: 2.4, reward: 48, aggro: 20,
            bolt: { lob: true, color: 'orange', blast: 1.9, speed: 9, dmg: 14, size: 0.34 }, mass: 1, stagger: 0.8,
            skeleton: sk, pose, height: 1.9, girth: 0.35, radius: 1.5, inside: W,
        });
    }

    // ---- Дрон-Пончик: летающий пончик с четырьмя винтами и пушкой
    {
        const body = FolkArt.grid(22, 10, 22, g => {
            const hash = folkNoise;
            for (let y = 0; y < 10; y++) for (let z = 0; z < 22; z++) for (let x = 0; x < 22; x++) {
                const dx = x + 0.5 - 11, dz = z + 0.5 - 11, r = Math.hypot(dx, dz), dy = y + 0.5 - 5;
                if (((r - 7.4) / 3.6) ** 2 + (dy / 4.7) ** 2 > 1) continue;
                const frosting = dy > -0.6 + hash(x, 0, z) * 1.4;
                const sprinkle = frosting && hash(x, y, z) < 0.09;
                g.set(x, y, z, sprinkle ? [C.toy_white, C.toy_yellow, C.toy_cyan, C.toy_lime][(x + z) & 3] : (frosting ? C.toy_pink : C.toy_tan));
            }
            const front = (x, y, z) => z >= 15;
            g.paint((x, y, z) => front(x, y, z) && y >= 3 && y <= 8 && ((x >= 5 && x < 10) || (x >= 12 && x < 17)) ? W : -1);
            g.paint((x, y, z) => front(x, y, z) && y >= 4 && y <= 7 && ((x >= 7 && x < 9) || (x >= 13 && x < 15)) ? K : -1);
            g.paint((x, y, z) => front(x, y, z) && y >= 1 && y <= 2 && x >= 7 && x < 15 ? K : -1);
        });
        const frame = FolkArt.grid(22, 3, 22, g => {
            for (let i = 0; i < 22; i++) { g.box(i, 0, i, i + 1, 3, Math.min(22, i + 3), C.toy_dgray); g.box(i, 0, 21 - i, i + 1, 3, Math.max(0, 21 - i - 2), C.toy_dgray); }
            for (const [x, z] of [[0, 0], [17, 0], [0, 17], [17, 17]]) g.box(x, 0, z, x + 5, 3, z + 5, C.toy_gray);
        });
        const blade = FolkArt.grid(11, 2, 11, g => { g.box(0, 0, 4, 11, 2, 7, C.toy_gray); g.box(4, 0, 0, 7, 2, 11, C.toy_gray); g.box(4, 0, 4, 7, 2, 7, K); g.box(0, 0, 4, 2, 2, 7, C.toy_yellow); g.box(9, 0, 4, 11, 2, 7, C.toy_yellow); });
        const gun = FolkArt.grid(4, 4, 10, g => { g.box(0, 0, 0, 4, 4, 8, C.toy_dgray); g.box(1, 1, 8, 3, 3, 10, K); });
        const sk = new FolkSkeleton();
        sk.p('pelvis', 0, 0.45, 0, 0.16, 8).p('waist', 0, 0.66, 0, 0.14, 8).p('neck', 0, 0.86, 0, 0.14, 6).p('head', 0, 0.86, 0.35, 0.1, 2);
        sk.p('shL', 0.4, 0.66, 0, 0.1, 3).p('shR', -0.4, 0.66, 0, 0.1, 3).p('haR', 0, 0.46, 0.62, 0.08, 1);
        sk.rigid(['pelvis', 'waist', 'neck', 'shL', 'shR', 'haR', 'head']);
        sk.part('body', { art: body, top: 'neck', bot: 'pelvis', xa: 'shL', xb: 'shR', prox: null, role: 'core', armor: 1.5 });
        sk.rider('frame', { art: frame, parent: 'body', pos: [0, -0.08, 0], rot: [0, 0, 0] });
        const corners = [[0.425, 0.425], [-0.425, 0.425], [0.425, -0.425], [-0.425, -0.425]];
        corners.forEach(([x, z], i) => sk.rider('rot' + i, { art: blade, parent: 'body', pos: [x, 0.06, z], rot: [0, 0, 0] }));
        sk.rider('gun', { art: gun, parent: 'body', pos: [0, -0.2, 0.42], rot: [0, 0, 0] });
        const pose = (rig, dt) => {
            const t = rig.time, ids = rig.type.skeleton.ids, pts = rig.type.skeleton.pts;
            const ctx = flyCtx(rig, 0.655, 0, 0.06, 0.28);
            for (const n of ['pelvis', 'waist', 'neck', 'head', 'shL', 'shR', 'haR']) { const q = pts[ids[n]]; flyPose(rig, ctx, n, q.x, q.y, q.z); }
            for (let i = 0; i < 4; i++) { const r = rig.byName['rot' + i]; if (r && r.pos) r.rel = FolkRig._relFromEuler(r.pos, [0, t * 34 * (i & 1 ? -1 : 1), 0]); }
        };
        defineFolkCustom('drone', {
            name: { ru: 'Дрон-Пончик', en: 'Donut Drone' }, tier: 6, hp: 160, speed: 5.5, behavior: 'flyer', dmg: 8, range: 22, rate: 1.2, burst: 3, burstGap: 0.12, reward: 105, aggro: 24,
            bolt: { color: 'cyan', speed: 20, dmg: 8, size: 0.12, spread: 0.04 }, mass: 1, stagger: 1,
            skeleton: sk, pose, height: 1.3, girth: 0.5, radius: 1.3, inside: C.toy_cream,
        });
    }
})();

// ======================================================================= босс
(function () {
    const C = M;
    const K = C.toy_black, W = C.toy_white, O = C.toy_orange, R = C.toy_red, GD = C.toy_gold;

    // ---- Королева-Несушка: гигантская курица в короне и плаще; свита — цыплята и тапки
    {
        const feather = (g, mod = 3) => g.paint((x, y, z) => ((x + (y & 1) * 2) % mod === 0) ? C.toy_cream : -1);
        const head = FolkArt.grid(12, 11, 12, g => {
            g.ell(6, 4.5, 6, 5.8, 4.6, 5.8, W);
            for (let z = 3; z < 10; z++) g.box(5, 8, z, 7, 9 + (z % 3 === 1 ? 2 : 1), z + 1, R);
            folkEyes(g, 3, 3, 4, 2, 2, 1, 0, 11); folkBrows(g, 7, 3, 2, K, 1);
            g.box(4, 1, 9, 8, 3, 12, C.toy_yellow); g.box(4, 0, 9, 8, 1, 11, GD); g.box(5, 0, 8, 7, 1, 10, R);
        });
        const chest = FolkArt.grid(16, 7, 13, g => { g.ell(8, 3.5, 6.5, 8, 3.9, 6.5, W); feather(g); });
        const belly = FolkArt.grid(16, 5, 13, g => { g.ell(8, 2.5, 6.5, 8, 2.9, 6.5, W); feather(g, 4); });
        const crown = FolkArt.grid(10, 6, 9, g => {
            g.cyl(5, 4.5, 5, 4.5, 0, 3, GD);
            for (const x of [0, 2, 4, 6, 8]) g.box(x, 3, 1, x + 1, 5 + (x === 4 ? 1 : 0), 8, GD);
            g.box(4, 1, 8, 6, 2, 9, R); g.box(1, 1, 7, 2, 2, 8, C.toy_blue); g.box(8, 1, 7, 9, 2, 8, C.toy_blue);
        });
        const cape = FolkArt.grid(16, 18, 3, g => {
            g.box(0, 0, 0, 16, 18, 3, C.toy_purple); g.box(0, 0, 0, 16, 2, 3, C.toy_cream); g.box(0, 0, 0, 1, 18, 3, GD); g.box(15, 0, 0, 16, 18, 3, GD);
            g.paint((x, y, z) => y > 3 && (x + y) % 5 === 0 && z === 2 ? GD : -1);
        });
        const ruff = FolkArt.grid(18, 3, 15, g => { g.cyl(9, 7.5, 9, 7.5, 0, 3, W); g.paint((x, y, z) => (x + z) % 3 === 0 && y === 2 ? C.toy_cream : -1); });
        const wing = (sy, endLen) => { const l = folkLimb(6, sy, 6, W, W, endLen); feather(l, 3); return l; };
        defineFolk('qhen', {
            name: { ru: 'Королева-Несушка', en: 'Queen Hen' }, tier: 6, hp: 2500, speed: 3.0, behavior: 'boss', boss: true, noRaid: true, noHeadDeath: true,
            dmg: 30, range: 1.4, rate: 1.4, attackTime: 0.7, reward: 1000, aggro: 30, scale: 2.2, vox: 0.06, mass: 4, stagger: 4,
            minions: ['chick', 'slipper'], minionCount: 4, slamR: 8, callEvery: 14, slamEvery: 6.5, stride: 0.45,
            girth: 0.35, radius: 1.6, inside: C.toy_cream,
            armor: { chest: 2, belly: 2, head: 1.5, arm: 1.2, leg: 1.2 },
            dims: { legU: 0.24, legL: 0.22, hipW: 0.2, belly: 0.3, chest: 0.42, shW: 0.46, armU: 0.3, armF: 0.3, neck: 0.04, head: 0.58 },
            art: {
                head, chest, belly,
                armU: wing(6, 1), armF: wing(6, 2),
                legU: folkLimb(6, 4, 6, W, O, 1), legL: folkLimb(5, 5, 5, O, O, 2, 4),
            },
            riders: [
                { name: 'crown', art: crown, parent: 'head', pos: [0, 0.35, 0], rot: [0, 0, 0.06] },
                { name: 'cape', art: cape, parent: 'chest', pos: [0, -0.12, -0.34], rot: [-0.14, 0, 0] },
                { name: 'ruff', art: ruff, parent: 'chest', pos: [0, 0.2, 0.0], rot: [0, 0, 0] },
            ],
        });
        // голову Королевы можно разбить в пыль, но целиком она не отрывается: смерть только по HP (GameEnemies убивает безголовых)
        for (const p of VoxFolk.TYPES.qhen.skeleton.parts) if (p.name === 'head') p.prox = null;
    }
})();

