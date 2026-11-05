// NpcTypes.js — продавцы за прилавками базы: Дядя Патрон (арсенал) и Профессор Лампочка (улучшения).
// Те же воксельные существа, что и враги (VoxFolk), но неуязвимые: от попаданий вздрагивают и падают, части не теряют.

(function () {
    const C = M;
    const NPC = { behavior: 'melee', noRaid: true, npc: true, tier: 99, hp: 100, speed: 2.2, reward: 0, inside: C.toy_foam };

    // ---- Дядя Патрон: голова-гильза с пулей, тёмные очки, усы, камуфляж
    {
        const camo = (x, y, z) => { const r = VoxFolk.hash(x >> 1, y >> 1, z >> 1); return r > 0.68 ? C.toy_brown : (r > 0.34 ? C.toy_dgreen : C.toy_green); };
        const head = FolkArt.grid(14, 24, 14, g => {
            g.cyl(7, 7, 7, 7, 0, 3, C.toy_gold);                     // закраина
            g.cyl(7, 7, 6.2, 6.2, 3, 13, C.toy_gold);                // гильза
            g.cyl(7, 7, 6.2, 6.2, 13, 15, C.toy_dgray);
            for (let y = 15; y < 24; y++) { const r = 6.2 * Math.sqrt(Math.max(0, 1 - (y - 15) / 9)); g.cyl(7, 7, Math.max(0.8, r), Math.max(0.8, r), y, y + 1, C.toy_red); }
            // очки и усы
            g.box(2, 9, 12, 12, 12, 14, C.toy_black);
            g.box(3, 10, 13, 6, 11, 14, C.toy_chrome); g.box(8, 10, 13, 11, 11, 14, C.toy_chrome);
            g.box(3, 5, 12, 11, 7, 14, C.toy_brown);
            g.box(2, 4, 12, 4, 6, 14, C.toy_brown); g.box(10, 4, 12, 12, 6, 14, C.toy_brown);
        });
        const vest = sy => FolkArt.grid(14, sy, 9, g => {
            g.box(0, 0, 0, 14, sy, 9, camo);
            g.box(5, 0, 8, 9, sy, 9, C.toy_black);
            for (let y = 1; y < sy - 1; y += 3) { g.box(1, y, 8, 3, y + 2, 9, C.toy_gold); g.box(11, y, 8, 13, y + 2, 9, C.toy_gold); }
        });
        defineFolk('npc_gunner', Object.assign({}, NPC, {
            name: { ru: 'Дядя Патрон', en: 'Uncle Cartridge' },
            dims: { legU: 0.34, legL: 0.36, hipW: 0.13, belly: 0.27, chest: 0.34, shW: 0.34, armU: 0.3, armF: 0.33, head: 0.96, neck: 0.02 },
            art: {
                head, chest: vest(7), belly: vest(6),
                armU: folkLimb(5, 6, 5, C.toy_skin, C.toy_skin, 1), armF: folkLimb(5, 7, 5, C.toy_skin, C.toy_dgray, 3),
                legU: FolkArt.grid(6, 7, 6, g => g.box(0, 0, 0, 6, 7, 6, camo)), legL: folkLimb(6, 8, 6, C.toy_dgreen, C.toy_black, 3, 3),
            },
        }));
    }

    // ---- Профессор Лампочка: голова-лампа с цоколем, очки, белый халат, бирюзовый галстук
    {
        const head = FolkArt.grid(16, 22, 16, g => {
            g.cyl(8, 8, 3.6, 3.6, 0, 5, C.toy_chrome);
            for (let y = 1; y < 5; y += 2) g.cyl(8, 8, 4, 4, y, y + 1, C.toy_gray);
            g.ell(8, 13, 8, 8, 8.6, 8, C.toy_yellow);
            g.box(6, 15, 8, 10, 16, 9, C.toy_orange);   // нить накала, видно при выбитых пикселях
            // круглые очки, рот
            g.box(2, 13, 14, 7, 17, 16, C.toy_black); g.box(9, 13, 14, 14, 17, 16, C.toy_black);
            g.box(3, 14, 15, 6, 16, 16, C.toy_eye); g.box(10, 14, 15, 13, 16, 16, C.toy_eye);
            g.box(4, 14, 15, 5, 15, 16, C.toy_black); g.box(11, 14, 15, 12, 15, 16, C.toy_black);
            g.box(7, 14, 15, 9, 15, 16, C.toy_black);
            g.box(5, 9, 15, 11, 10, 16, C.toy_black);
        });
        const coat = sy => FolkArt.grid(14, sy, 9, g => {
            g.box(0, 0, 0, 14, sy, 9, C.toy_white);
            g.box(6, 0, 8, 8, sy, 9, C.toy_teal);
            g.box(2, 2, 8, 5, 4, 9, C.toy_gray);
        });
        defineFolk('npc_prof', Object.assign({}, NPC, {
            name: { ru: 'Профессор Лампочка', en: 'Professor Bulb' },
            dims: { legU: 0.32, legL: 0.34, hipW: 0.12, belly: 0.27, chest: 0.33, shW: 0.31, armU: 0.29, armF: 0.32, head: 0.88, neck: 0.02 },
            art: {
                head, chest: coat(7), belly: coat(6),
                armU: folkLimb(4, 6, 4, C.toy_white, C.toy_white, 1), armF: folkLimb(4, 7, 4, C.toy_white, C.toy_skin, 2),
                legU: folkLimb(5, 7, 5, C.toy_navy, C.toy_navy, 1), legL: folkLimb(5, 7, 5, C.toy_navy, C.toy_brown, 2, 3),
            },
        }));
    }

    // Общая одежда новых продавцов
    const body = (id, name, head, shirt, trim, skin, pants, boots, dims) => {
        const top = sy => FolkArt.grid(14, sy, 9, g => { g.box(0, 0, 0, 14, sy, 9, shirt); g.box(6, 0, 8, 8, sy, 9, trim); });
        defineFolk(id, Object.assign({}, NPC, {
            name,
            dims: Object.assign({ legU: 0.32, legL: 0.34, hipW: 0.12, belly: 0.27, chest: 0.33, shW: 0.31, armU: 0.29, armF: 0.32, head: 0.88, neck: 0.02 }, dims || {}),
            art: {
                head, chest: top(7), belly: top(6),
                armU: folkLimb(4, 6, 4, shirt, shirt, 1), armF: folkLimb(4, 7, 4, shirt, skin, 2),
                legU: folkLimb(5, 7, 5, pants, pants, 1), legL: folkLimb(5, 8, 5, pants, boots, 3, 2),
            },
        }));
    };

    // ---- Бабушка Наседка (питомник): голова-курица в платке
    body('npc_hen', { ru: 'Бабушка Наседка', en: 'Granny Hen' }, FolkArt.grid(16, 22, 16, g => {
        g.ell(8, 9, 8, 7.6, 8.6, 7.6, C.toy_white);
        g.box(3, 10, 14, 7, 14, 16, C.toy_eye); g.box(9, 10, 14, 13, 14, 16, C.toy_eye);
        g.box(5, 11, 15, 7, 13, 16, C.toy_black); g.box(9, 11, 15, 11, 13, 16, C.toy_black);
        g.box(6, 6, 14, 10, 9, 16, C.toy_orange);
        g.box(6, 16, 3, 10, 22, 12, C.toy_red);
        g.box(1, 3, 2, 15, 5, 14, C.toy_magenta);
    }), C.toy_magenta, C.toy_yellow, C.toy_orange, C.toy_navy, C.toy_brown);

    // ---- Хранитель Томик (кодекс): голова-книга и очки
    body('npc_book', { ru: 'Хранитель Томик', en: 'Keeper Tome' }, FolkArt.grid(18, 20, 10, g => {
        g.box(0, 0, 0, 18, 20, 10, C.toy_red);
        g.box(1, 1, 1, 17, 19, 9, C.toy_cream);
        g.box(0, 0, 8, 18, 20, 10, C.toy_red);
        g.box(8, 0, 9, 10, 20, 10, C.toy_gold);
        g.box(3, 10, 9, 8, 15, 10, C.toy_black); g.box(10, 10, 9, 15, 15, 10, C.toy_black);
        g.box(4, 11, 9, 7, 14, 10, C.toy_eye); g.box(11, 11, 9, 14, 14, 10, C.toy_eye);
        g.box(5, 12, 9, 6, 13, 10, C.toy_black); g.box(12, 12, 9, 13, 13, 10, C.toy_black);
        g.box(6, 5, 9, 12, 6, 10, C.toy_black);
    }), C.toy_navy, C.toy_gold, C.toy_skin, C.toy_navy, C.toy_black);

    // ---- Стилист Блёстка (магазин): голова — диско-шар
    body('npc_style', { ru: 'Стилист Блёстка', en: 'Stylist Sparkle' }, FolkArt.grid(16, 18, 16, g => {
        g.ell(8, 9, 8, 8, 8.6, 8, (x, y, z) => { const r = VoxFolk.hash(x >> 1, y >> 1, z >> 1); return r > 0.7 ? C.toy_cyan : (r > 0.4 ? C.toy_magenta : C.toy_chrome); });
        g.box(2, 9, 14, 7, 12, 16, C.toy_black); g.box(9, 9, 14, 14, 12, 16, C.toy_black);
        g.box(7, 10, 14, 9, 11, 16, C.toy_black);
        g.box(5, 5, 14, 11, 6, 16, C.toy_pink);
    }), C.toy_purple, C.toy_cyan, C.toy_skin, C.toy_white, C.toy_magenta);
})();
