// PetTypes.js — питомцы: по одному на каждое яйцо из EGGS. Модель — один воксельный меш (сетка FolkGrid), без рига:
// питомец прыгает или парит целиком, поэтому их может быть много. Перед модели — +Z. fly: true — парит, а не прыгает.

(function () {
    const C = M;
    /** Два глаза: cx — центр сетки, y — низ глаза, z — передняя грань (исключая), gap — просвет, s — сторона. */
    const eyes = (g, cx, y, z, gap = 2, s = 3, pupil = C.toy_black) => {
        for (const sgn of [-1, 1]) {
            const x = sgn < 0 ? cx - (gap >> 1) - s : cx + ((gap + 1) >> 1);
            g.box(x, y, z - 2, x + s, y + s, z, C.toy_eye);
            g.box(x + (sgn < 0 ? s - 2 : 0), y, z - 1, x + (sgn < 0 ? s : 2), y + 2, z, pupil);
        }
    };
    const legs = (g, xs, zs, h, w, v) => { for (const x of xs) for (const z of zs) g.box(x, 0, z, x + w, h, z + w, v); };
    const grid = (sx, sy, sz, fn) => FolkArt.grid(sx, sy, sz, fn);

    /** egg — id яйца; bonus считается по редкости яйца (GamePets.BONUS). */
    const list = [
        { id: 'p_brick', egg: 'brick', ru: 'Кирпичик', en: 'Bricky', art: () => grid(20, 18, 16, g => {
            const bricks = (x, y) => (y % 3 === 0 ? C.mortar : (((x + ((y / 3 | 0) & 1 ? 2 : 0)) % 5 === 0) ? C.mortar : C.brick));
            legs(g, [2, 14], [2, 10], 4, 4, C.mortar);
            g.box(0, 4, 0, 20, 18, 16, bricks);
            eyes(g, 10, 10, 16, 4, 4);
            g.box(7, 6, 15, 13, 8, 16, C.toy_black);
        }) },
        { id: 'p_gravel', egg: 'gravel', ru: 'Булыжник', en: 'Pebble', art: () => grid(20, 16, 18, g => {
            const rock = (x, y, z) => (VoxFolk.hash(x >> 2, y >> 2, z >> 2) > 0.62 ? C.egg_dark : C.egg_stone);
            g.ell(10, 8, 9, 10, 8, 9, rock);
            legs(g, [3, 13], [12], 2, 4, C.egg_dark);
            eyes(g, 10, 8, 18, 3, 3);
            g.box(8, 4, 16, 12, 5, 18, C.toy_black);
        }) },
        { id: 'p_crack', egg: 'crack', ru: 'Цыплёнок в скорлупе', en: 'Shell Chick', art: () => grid(18, 24, 18, g => {
            g.ell(9, 10, 9, 8.5, 9, 8.5, C.toy_yellow);
            g.box(5, 0, 10, 8, 3, 15, C.toy_orange); g.box(10, 0, 10, 13, 3, 15, C.toy_orange);
            eyes(g, 9, 11, 18, 3, 3);
            g.box(7, 8, 16, 11, 10, 18, C.toy_orange);
            g.ell(9, 18, 9, 8.8, 5.5, 8.8, (x, y) => ((x + y * 2) % 7 < 1 ? C.egg_dark : C.egg_white));
            g.box(0, 19, 0, 18, 24, 18, 0);
            for (let i = 0; i < 18; i += 3) g.box(i, 18, 0, i + 2, 21, 18, (x, y, z) => (Math.hypot(x - 9, z - 9) > 6.5 && Math.hypot(x - 9, z - 9) < 9 ? C.egg_white : 0));
        }) },
        { id: 'p_slime', egg: 'slime', ru: 'Слизик', en: 'Slimy', art: () => grid(22, 16, 20, g => {
            g.ell(11, 2, 10, 11, 14, 10, (x, y, z) => (VoxFolk.hash(x >> 1, y >> 1, z >> 1) > 0.88 ? C.toy_lime : C.egg_green));
            g.box(0, 0, 0, 22, 1, 20, 0);
            eyes(g, 11, 6, 20, 4, 4);
            g.box(8, 3, 18, 14, 4, 20, C.toy_dgreen);
            g.box(4, 12, 6, 7, 16, 9, C.toy_lime); g.box(15, 11, 8, 17, 15, 10, C.toy_lime);
        }) },
        { id: 'p_ice', egg: 'ice', ru: 'Пингвин Ледышка', en: 'Icy Penguin', art: () => grid(18, 26, 18, g => {
            g.ell(9, 11, 9, 8.5, 11, 8.5, C.toy_navy);
            g.ell(9, 10, 13, 6, 9, 5, C.toy_white);
            g.ell(9, 21, 9, 7, 5, 7, C.toy_navy);
            eyes(g, 9, 20, 16, 3, 3);
            g.box(7, 18, 14, 11, 20, 18, C.toy_orange);
            g.box(4, 0, 11, 8, 2, 16, C.toy_orange); g.box(10, 0, 11, 14, 2, 16, C.toy_orange);
            g.box(0, 8, 7, 2, 16, 11, C.toy_ice); g.box(16, 8, 7, 18, 16, 11, C.toy_ice);
            g.box(5, 25, 7, 13, 26, 11, C.toy_ice);
        }) },
        { id: 'p_leafy', egg: 'leafy', ru: 'Листокот', en: 'Leaf Cat', art: () => grid(18, 22, 24, g => {
            legs(g, [3, 12], [6, 14], 5, 3, C.egg_gold);
            g.box(2, 5, 4, 16, 13, 18, C.egg_green);
            g.box(3, 10, 14, 15, 21, 24, C.egg_green);
            eyes(g, 9, 14, 24, 3, 3);
            g.box(8, 12, 23, 10, 13, 24, C.toy_pink);
            g.box(3, 21, 17, 7, 22, 22, C.toy_lime); g.box(11, 21, 17, 15, 22, 22, C.toy_lime);
            g.box(4, 19, 14, 6, 21, 17, C.toy_dgreen); g.box(12, 19, 14, 14, 21, 17, C.toy_dgreen);
            g.box(8, 11, 0, 10, 13, 5, C.egg_gold); g.box(6, 13, 0, 12, 17, 3, C.toy_lime);
        }) },
        { id: 'p_soul', egg: 'soul', fly: true, ru: 'Духик', en: 'Ghostie', art: () => grid(18, 24, 16, g => {
            g.ell(9, 15, 8, 9, 9, 8, C.egg_purple);
            g.box(0, 6, 0, 18, 15, 16, (x, y, z) => (Math.hypot((x - 8.5) * 0.9, z - 7.5) < 7.6 ? C.egg_purple : 0));
            for (let x = 1; x < 17; x += 4) g.box(x, 2, 2, x + 2, 7, 14, C.egg_pink);
            eyes(g, 9, 14, 16, 3, 4);
            g.box(7, 10, 14, 11, 12, 16, C.toy_black);
        }) },
        { id: 'p_skull', egg: 'skull', ru: 'Костик', en: 'Bony', art: () => grid(20, 24, 18, g => {
            legs(g, [4, 13], [7], 6, 3, C.egg_white);
            g.box(5, 5, 6, 15, 10, 12, C.toy_gray);
            for (let y = 6; y < 10; y += 2) g.box(4, y, 7, 16, y + 1, 11, C.egg_white);
            g.ell(10, 16, 9, 10, 8, 9, C.egg_white);
            g.box(5, 15, 16, 9, 19, 18, C.toy_black); g.box(11, 15, 16, 15, 19, 18, C.toy_black);
            g.box(6, 16, 17, 8, 18, 18, C.toy_glow_red); g.box(12, 16, 17, 14, 18, 18, C.toy_glow_red);
            g.box(9, 13, 16, 11, 15, 18, C.toy_black);
            for (let x = 5; x < 15; x += 3) g.box(x, 9, 15, x + 2, 11, 17, C.egg_white);
        }) },
        { id: 'p_crystal', egg: 'crystal', ru: 'Кристальный краб', en: 'Crystal Crab', art: () => grid(26, 20, 18, g => {
            g.ell(13, 6, 9, 9, 5, 7, C.egg_purple);
            for (const [x, h] of [[8, 11], [12, 15], [16, 12]]) g.box(x, 8, 6, x + 3, 8 + h - 3, 10, C.egg_cyan);
            g.box(12, 18, 7, 14, 20, 9, C.toy_white);
            for (const x of [2, 21]) { g.box(x, 0, 4, x + 3, 5, 7, C.egg_purple); g.box(x, 0, 10, x + 3, 5, 13, C.egg_purple); }
            g.box(0, 6, 11, 6, 11, 17, C.egg_cyan); g.box(20, 6, 11, 26, 11, 17, C.egg_cyan);
            eyes(g, 13, 8, 16, 3, 3);
        }) },
        { id: 'p_golden', egg: 'golden', ru: 'Златогусь', en: 'Golden Goose', art: () => grid(18, 28, 22, g => {
            g.ell(9, 11, 9, 8.5, 8, 9, C.egg_gold);
            g.box(7, 14, 13, 11, 24, 17, C.egg_gold);
            g.ell(9, 24, 15, 4, 4, 4.5, C.egg_gold);
            eyes(g, 9, 24, 20, 3, 2);
            g.box(7, 22, 19, 11, 24, 22, C.toy_orange);
            g.box(5, 0, 8, 7, 4, 10, C.toy_orange); g.box(11, 0, 8, 13, 4, 10, C.toy_orange);
            g.box(4, 0, 10, 8, 1, 13, C.toy_orange); g.box(10, 0, 10, 14, 1, 13, C.toy_orange);
            g.box(0, 9, 4, 2, 16, 14, C.egg_white); g.box(16, 9, 4, 18, 16, 14, C.egg_white);
            g.box(7, 13, 0, 11, 18, 3, C.egg_white);
        }) },
        { id: 'p_flame', egg: 'flame', ru: 'Огнелис', en: 'Fire Fox', art: () => grid(18, 24, 28, g => {
            legs(g, [3, 12], [6, 15], 5, 3, C.toy_black);
            g.box(3, 5, 5, 15, 13, 20, C.toy_red);
            g.box(4, 5, 16, 14, 9, 20, C.toy_cream);
            g.box(3, 10, 16, 15, 20, 24, C.toy_red);
            g.box(6, 10, 24, 12, 14, 28, C.toy_cream);
            g.box(8, 13, 27, 10, 14, 28, C.toy_black);
            eyes(g, 9, 15, 24, 4, 3);
            g.box(3, 20, 17, 6, 24, 20, C.toy_red); g.box(12, 20, 17, 15, 24, 20, C.toy_red);
            g.box(7, 9, 0, 11, 15, 6, C.toy_orange); g.box(6, 14, 0, 12, 20, 3, C.egg_gold); g.box(8, 20, 0, 10, 23, 2, C.toy_glow_red);
        }) },
        { id: 'p_diamond', egg: 'diamond', ru: 'Алмазный пёс', en: 'Diamond Dog', art: () => grid(18, 22, 26, g => {
            const gem = (x, y, z) => (((x + y + z) >> 2) & 1 ? C.egg_cyan : C.toy_ice);
            legs(g, [3, 12], [5, 14], 5, 3, C.egg_white);
            g.box(3, 5, 4, 15, 13, 18, gem);
            g.box(4, 10, 15, 14, 20, 23, gem);
            g.box(6, 10, 23, 12, 14, 26, C.egg_white);
            g.box(8, 13, 25, 10, 14, 26, C.toy_black);
            eyes(g, 9, 15, 23, 4, 3);
            g.box(2, 14, 16, 4, 20, 20, C.egg_cyan); g.box(14, 14, 16, 16, 20, 20, C.egg_cyan);
            g.box(8, 12, 0, 10, 14, 5, C.toy_ice); g.box(8, 14, 0, 10, 18, 2, C.egg_white);
        }) },
        { id: 'p_volcano', egg: 'volcano', ru: 'Магмазавр', en: 'Magma Turtle', art: () => grid(24, 24, 26, g => {
            legs(g, [2, 18], [4, 16], 4, 4, C.egg_dark);
            g.ell(12, 8, 12, 12, 8, 12, (x, y, z) => (VoxFolk.hash(x >> 2, y >> 2, z >> 2) > 0.72 ? C.toy_orange : C.egg_dark));
            g.cyl(12, 12, 6, 6, 12, 18, C.egg_dark);
            g.cyl(12, 12, 4, 4, 15, 19, C.toy_glow_red);
            g.box(11, 19, 11, 13, 24, 13, C.toy_orange);
            g.box(7, 3, 20, 17, 11, 26, C.toy_green);
            eyes(g, 12, 7, 26, 3, 3);
        }) },
        { id: 'p_aurora', egg: 'aurora', fly: true, ru: 'Сияшка', en: 'Aurora Jelly', art: () => grid(20, 26, 20, g => {
            g.ell(10, 17, 10, 10, 9, 10, (x, y) => (y > 19 ? C.egg_pink : C.egg_cyan));
            g.box(0, 8, 0, 20, 16, 20, 0);
            for (const [x, z, l] of [[4, 5, 12], [9, 3, 15], [15, 5, 11], [3, 13, 14], [9, 16, 12], [15, 14, 15]]) g.box(x, 15 - l, z, x + 2, 16, z + 2, (X, y) => ((y >> 1) & 1 ? C.egg_pink : C.egg_cyan));
            eyes(g, 10, 16, 20, 4, 3);
        }) },
        { id: 'p_asteroid', egg: 'asteroid', fly: true, ru: 'Метеорыш', en: 'Meteorling', art: () => grid(24, 22, 24, g => {
            g.ell(12, 12, 12, 10, 10, 10, (x, y, z) => (VoxFolk.hash(x >> 2, y >> 2, z >> 2) > 0.7 ? C.egg_gold : C.egg_dark));
            for (const [x, y, z] of [[6, 15, 21], [17, 8, 21], [20, 16, 12]]) g.ell(x, y, z, 2.5, 2.5, 2.5, 0);
            for (let z = 0; z < 8; z++) g.box(9 + (z >> 2), 2 + (z >> 2), z, 15 - (z >> 2), 8 - (z >> 2) + 12, z + 1, z % 3 ? C.toy_orange : C.egg_gold);
            eyes(g, 12, 12, 23, 4, 4);
            g.box(9, 7, 21, 15, 9, 23, C.toy_black);
        }) },
        { id: 'p_solar', egg: 'solar', fly: true, ru: 'Солнечный феникс', en: 'Solar Phoenix', art: () => grid(32, 26, 20, g => {
            g.ell(16, 13, 10, 7, 9, 7, C.egg_gold);
            g.ell(16, 21, 12, 5, 5, 5, C.egg_gold);
            eyes(g, 16, 21, 17, 3, 2);
            g.box(14, 19, 16, 18, 21, 20, C.egg_red);
            g.box(15, 24, 10, 17, 26, 14, C.toy_glow_red);
            for (let i = 0; i < 9; i++) { const h = 11 - i, y = 10 + (i >> 1); g.box(8 - i, y, 6, 9 - i, y + h, 12, i % 2 ? C.egg_red : C.toy_orange); g.box(23 + i, y, 6, 24 + i, y + h, 12, i % 2 ? C.egg_red : C.toy_orange); }
            g.box(13, 0, 0, 19, 8, 4, C.egg_red); g.box(15, 0, 4, 17, 6, 7, C.toy_orange);
        }) },
        { id: 'p_galaxy', egg: 'galaxy', ru: 'Космокот', en: 'Astro Cat', art: () => grid(20, 28, 20, g => {
            const space = (x, y, z) => (VoxFolk.hash(x, y, z) > 0.93 ? C.toy_white : C.toy_navy);
            legs(g, [4, 12], [8], 5, 4, C.toy_white);
            g.box(4, 5, 5, 16, 14, 14, space);
            g.ell(10, 20, 10, 10, 8.5, 10, C.toy_ice);
            g.ell(10, 20, 11, 8, 7, 8, space);
            eyes(g, 10, 20, 19, 3, 3, C.toy_magenta);
            g.box(9, 18, 18, 11, 19, 19, C.toy_pink);
            g.box(3, 25, 7, 6, 28, 11, space); g.box(14, 25, 7, 17, 28, 11, space);
            g.box(8, 7, 0, 12, 10, 5, C.toy_white);
        }) },
        { id: 'p_titan', egg: 'titan', ru: 'Мини-титан', en: 'Mini Titan', art: () => grid(26, 30, 18, g => {
            g.box(6, 0, 4, 11, 9, 14, C.egg_gold); g.box(15, 0, 4, 20, 9, 14, C.egg_gold);
            g.box(5, 9, 2, 21, 23, 16, C.egg_purple);
            g.box(8, 13, 15, 18, 20, 16, C.egg_gold);
            g.box(11, 15, 16, 15, 18, 17, C.toy_glow_cyan);
            g.box(0, 9, 5, 5, 22, 13, C.egg_gold); g.box(21, 9, 5, 26, 22, 13, C.egg_gold);
            g.box(0, 6, 5, 5, 10, 13, C.toy_dgray); g.box(21, 6, 5, 26, 10, 13, C.toy_dgray);
            g.box(8, 23, 4, 18, 30, 14, C.egg_gold);
            g.box(9, 25, 13, 17, 28, 15, C.toy_black); g.box(10, 26, 14, 16, 27, 15, C.toy_glow_cyan);
        }) },
        { id: 'p_blackhole', egg: 'blackhole', fly: true, ru: 'Пустотик', en: 'Voidling', art: () => grid(30, 22, 30, g => {
            g.ell(15, 11, 15, 8.5, 8.5, 8.5, C.toy_black);
            for (let a = 0; a < 6.28; a += 0.05) for (const r of [11, 12.5, 14]) {
                const x = 15 + Math.cos(a) * r, z = 15 + Math.sin(a) * r;
                g.set(Math.floor(x), 11, Math.floor(z), r > 12 ? C.egg_pink : C.toy_purple);
            }
            eyes(g, 15, 11, 24, 3, 3, C.toy_magenta);
        }) },
        { id: 'p_dragon', egg: 'dragon', ru: 'Дракоша', en: 'Baby Dragon', art: () => grid(32, 28, 28, g => {
            legs(g, [11, 18], [6, 14], 5, 3, C.egg_dark);
            g.box(10, 5, 4, 22, 15, 18, C.toy_red);
            g.box(12, 5, 15, 20, 13, 19, C.toy_tan);
            g.box(11, 13, 15, 21, 25, 25, C.toy_red);
            g.box(13, 13, 25, 19, 18, 28, C.toy_red);
            eyes(g, 16, 19, 25, 4, 3);
            g.box(11, 25, 16, 13, 28, 19, C.toy_tan); g.box(19, 25, 16, 21, 28, 19, C.toy_tan);
            for (let i = 0; i < 10; i++) { const h = 11 - i; g.box(9 - i, 12 + (i >> 1), 7, 10 - i, 12 + (i >> 1) + h, 13, C.egg_dark); g.box(22 + i, 12 + (i >> 1), 7, 23 + i, 12 + (i >> 1) + h, 13, C.egg_dark); }
            g.box(14, 8, 0, 18, 11, 5, C.toy_red); g.box(15, 8, 0, 17, 13, 2, C.egg_dark);
            for (let z = 6; z < 18; z += 4) g.box(15, 15, z, 17, 18, z + 2, C.egg_dark);
        }) },
        { id: 'p_glitch', egg: 'glitch', fly: true, ru: 'Глитч', en: 'Glitch', art: () => grid(22, 24, 22, g => {
            const noise = (x, y, z) => { const r = VoxFolk.hash(x >> 1, y >> 1, z >> 1); return r > 0.66 ? C.egg_pink : (r > 0.33 ? C.egg_cyan : C.toy_black); };
            g.box(3, 3, 3, 19, 19, 19, noise);
            for (let i = 0; i < 26; i++) { const x = (VoxFolk.hash(i, 1, 7) * 20) | 0, y = (VoxFolk.hash(i, 2, 7) * 22) | 0, z = (VoxFolk.hash(i, 3, 7) * 20) | 0; g.box(x, y, z, x + 2, y + 2, z + 2, noise); }
            g.box(5, 10, 17, 10, 15, 19, C.toy_eye); g.box(12, 10, 17, 17, 15, 19, C.toy_eye);
            g.box(7, 10, 18, 10, 12, 19, C.toy_black); g.box(12, 12, 18, 15, 14, 19, C.toy_black);
            g.box(6, 6, 18, 16, 8, 19, C.toy_white);
        }) },
    ];

    /** @type {any} */ (window).PETS = list;
})();
