// GameShopData.js — каталог косметики (данные для Shop.js): 6 вкладок, всё только внешний вид, без игрового преимущества.
// Около 35% предметов за деньги, 65% за рекламу (1–5 просмотров по редкости). Эксклюзивы — только в Daily Gift (день 7).

/** @satisfies {Record<string, any>} */
const GameShopData = {
    TABS: [
        { id: 'skin', name: { ru: 'Скины', en: 'Skins' } },
        { id: 'tracer', name: { ru: 'Трассеры', en: 'Tracers' } },
        { id: 'xhair', name: { ru: 'Прицелы', en: 'Crosshairs' } },
        { id: 'portal', name: { ru: 'Порталы', en: 'Portals' } },
        { id: 'boom', name: { ru: 'Разрушение', en: 'Destruction' } },
        { id: 'win', name: { ru: 'Салюты', en: 'Fireworks' } },
    ],
    /** Цена в $ по редкости: от и до. */
    COIN: { common: [400, 900], uncommon: [1500, 3500], rare: [6000, 15000], epic: [25000, 60000], legendary: [100000, 250000] },
    ADS: { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 },
    /** Цвет редкости (рамка карточки). */
    RAR: { common: '#b9c4e6', uncommon: '#5dff6c', rare: '#47a8ff', epic: '#c86bff', legendary: '#ffc81c' },

    /** Режимы рисунка скина (плагин WeaponSkinPlugin). */
    SOLID: 1, SPLIT: 2, STRIPES: 3, PIXELS: 4, CAMO: 5, DOTS: 6, GRAD: 7, NEON: 8, HOLO: 9, LAVA: 10, GALAXY: 11, GOLD: 12, CARBON: 13, ZEBRA: 14,

    /** Контуры прицелов, SVG path в рамке −28..28. */
    XH: {
        plus: 'M0-14V14M-14 0H14',
        gap: 'M0-17V-7M0 17V7M-17 0H-7M17 0H7',
        x: 'M-12-12L-4-4M12-12L4-4M-12 12L-4 4M12 12L4 4',
        dot: 'M2.5 0A2.5 2.5 0 1 1-2.5 0A2.5 2.5 0 1 1 2.5 0',
        ring: 'M14 0A14 14 0 1 1-14 0A14 14 0 1 1 14 0',
        ringdot: 'M14 0A14 14 0 1 1-14 0A14 14 0 1 1 14 0M1.5 0A1.5 1.5 0 1 1-1.5 0A1.5 1.5 0 1 1 1.5 0',
        square: 'M-13-13H13V13H-13Z',
        diamond: 'M0-16L16 0L0 16L-16 0Z',
        tri: 'M0-15L14 11H-14Z',
        chev: 'M-12 2L0-10L12 2M-12 14L0 2L12 14',
        bracket: 'M-18-9V-18H-9M9-18H18V-9M18 9V18H9M-9 18H-18V9',
        arrows: 'M0-8L-5-16H5ZM0 8L-5 16H5ZM-8 0L-16-5V5ZM8 0L16-5V5Z',
        target: 'M18 0A18 18 0 1 1-18 0A18 18 0 1 1 18 0M8 0A8 8 0 1 1-8 0A8 8 0 1 1 8 0',
        star: 'M0-17L4.5-5.5L16-5.5L7 2L10.5 14L0 7L-10.5 14L-7 2L-16-5.5L-4.5-5.5Z',
        heart: 'M0 14C-14 4-16-4-11-9C-7-13-2-11 0-6C2-11 7-13 11-9C16-4 14 4 0 14Z',
        egg: 'M0-17C8-17 13-5 13 3C13 11 7 15 0 15C-7 15-13 11-13 3C-13-5-8-17 0-17Z',
        crown: 'M-15 10V-8L-7 1L0-12L7 1L15-8V10Z',
        bolt: 'M4-17L-9 3H0L-4 17L9-3H0Z',
        hex: 'M0-16L14-8V8L0 16L-14 8V-8Z',
        sniper: 'M0-26V-5M0 26V5M-26 0H-5M26 0H5M14 0A14 14 0 1 1-14 0A14 14 0 1 1 14 0',
        smile: 'M15 0A15 15 0 1 1-15 0A15 15 0 1 1 15 0M-5-5V-3M5-5V-3M-7 5Q0 11 7 5',
        flower: 'M0-5A6 6 0 1 1 5 0A6 6 0 1 1 0 5A6 6 0 1 1-5 0A6 6 0 1 1 0-5Z',
    },

    build() {
        const S = this;
        // [id, ru, en, редкость, режим, цвет A, цвет B]
        const skins = [
            ['sk_black', 'Чёрный мат', 'Matte Black', 'common', S.SOLID, '#23252c', '#000000'],
            ['sk_snow', 'Снежный', 'Snow White', 'common', S.SOLID, '#eef3fa', '#000000'],
            ['sk_sand', 'Песчаный', 'Desert Sand', 'common', S.SOLID, '#cfae73', '#000000'],
            ['sk_army', 'Армейский', 'Army Green', 'common', S.SOLID, '#5f7040', '#000000'],
            ['sk_sea', 'Морской', 'Deep Sea', 'common', S.SOLID, '#2a7fb0', '#000000'],
            ['sk_cherry', 'Вишнёвый', 'Cherry', 'common', S.SOLID, '#b2223a', '#000000'],
            ['sk_tiger', 'Тигр', 'Tiger', 'uncommon', S.ZEBRA, '#ff8a1f', '#17120c'],
            ['sk_zebra', 'Зебра', 'Zebra', 'uncommon', S.ZEBRA, '#f2f2f2', '#141414'],
            ['sk_forest', 'Лесной камуфляж', 'Forest Camo', 'uncommon', S.CAMO, '#3b4a2a', '#7c8c50'],
            ['sk_desert', 'Камуфляж пустыни', 'Desert Camo', 'uncommon', S.CAMO, '#b89a68', '#6f5a3a'],
            ['sk_winter', 'Зимний камуфляж', 'Winter Camo', 'uncommon', S.CAMO, '#e6edf5', '#7f8ea3'],
            ['sk_urban', 'Городские пиксели', 'Urban Pixels', 'uncommon', S.PIXELS, '#4a4e57', '#9aa0ac'],
            ['sk_candy', 'Леденец', 'Candy Cane', 'uncommon', S.STRIPES, '#ff2a3c', '#ffffff'],
            ['sk_race', 'Гоночные шашки', 'Race Checker', 'uncommon', S.PIXELS, '#111111', '#f5f5f5'],
            ['sk_carbon', 'Карбон', 'Carbon', 'rare', S.CARBON, '#1b1d22', '#3b3f48'],
            ['sk_polka', 'Розовый горох', 'Pink Polka', 'rare', S.DOTS, '#ff6db8', '#ffffff'],
            ['sk_sunset', 'Закат', 'Sunset', 'rare', S.GRAD, '#ffb01f', '#d81f8c'],
            ['sk_ocean', 'Океан', 'Ocean', 'rare', S.GRAD, '#26e0d0', '#102a8c'],
            ['sk_toxic', 'Токсин', 'Toxic', 'rare', S.GRAD, '#b6ff1f', '#10240a'],
            ['sk_mint', 'Мятный лёд', 'Mint Ice', 'rare', S.SPLIT, '#8cffd8', '#f0fff8'],
            ['sk_bubble', 'Жвачка', 'Bubblegum', 'rare', S.STRIPES, '#ff8ad0', '#6ad8ff'],
            ['sk_retro', 'Ретро', 'Retro Arcade', 'rare', S.PIXELS, '#6a2bd8', '#ffd21f'],
            ['sk_neonb', 'Синий неон', 'Blue Neon', 'epic', S.NEON, '#2ad4ff', '#10162c'],
            ['sk_neonp', 'Розовый неон', 'Pink Neon', 'epic', S.NEON, '#ff3fb8', '#1a0f24'],
            ['sk_acid', 'Кислота', 'Acid', 'epic', S.NEON, '#a6ff1f', '#0f1a0a'],
            ['sk_lava', 'Лава', 'Lava', 'epic', S.LAVA, '#ff6a12', '#1c0a06'],
            ['sk_plasma', 'Плазма', 'Plasma', 'epic', S.LAVA, '#3fa8ff', '#070f2a'],
            ['sk_gold', 'Чистое золото', 'Pure Gold', 'legendary', S.GOLD, '#f2b81c', '#fff0a0'],
            ['sk_plat', 'Платина', 'Platinum', 'legendary', S.GOLD, '#c6d0dc', '#ffffff'],
            ['sk_holo', 'Голограмма', 'Hologram', 'legendary', S.HOLO, '#ffffff', '#ffffff'],
            ['sk_galaxy', 'Галактика', 'Galaxy', 'legendary', S.GALAXY, '#6a4bff', '#0a0820'],
            ['sk_void', 'Бездна', 'Abyss', 'legendary', S.GALAXY, '#ff2fa0', '#08040c'],
        ];
        const skinEx = [
            ['sk_royal', 'Королевский', 'Royal', 'legendary', S.GOLD, '#7a2fd0', '#ffe08a'],
            ['sk_chaos', 'Радужный хаос', 'Rainbow Chaos', 'legendary', S.HOLO, '#ff0000', '#00ff00'],
            ['sk_inferno', 'Адское пламя', 'Inferno', 'legendary', S.LAVA, '#ffe01f', '#3a0505'],
            ['sk_ghost', 'Призрак', 'Ghost', 'legendary', S.NEON, '#ffffff', '#2a3040'],
        ];
        // [id, ru, en, редкость, цвет, ширина, эффект]
        const tracers = [
            ['tr_red', 'Алый', 'Crimson', 'common', '#ff2a2a', 1, 'line'], ['tr_green', 'Зелёный', 'Green', 'common', '#2aff4a', 1, 'line'],
            ['tr_blue', 'Синий', 'Blue', 'common', '#2a8aff', 1, 'line'], ['tr_white', 'Белый', 'White', 'common', '#ffffff', 1, 'line'],
            ['tr_orange', 'Оранжевый', 'Orange', 'common', '#ff8a1a', 1, 'line'], ['tr_pink', 'Розовый', 'Pink', 'common', '#ff4fc0', 1, 'line'],
            ['tr_cyanfat', 'Толстый циан', 'Fat Cyan', 'uncommon', '#2afff0', 2.2, 'line'], ['tr_limefat', 'Толстый лайм', 'Fat Lime', 'uncommon', '#b6ff1f', 2.2, 'line'],
            ['tr_vdash', 'Лазер-морзе', 'Morse Laser', 'uncommon', '#a24cff', 1.4, 'dash'], ['tr_ydash', 'Жёлтый пунктир', 'Yellow Dash', 'uncommon', '#ffe01f', 1.4, 'dash'],
            ['tr_rdouble', 'Двойной алый', 'Double Red', 'uncommon', '#ff3a3a', 1, 'double'], ['tr_bdouble', 'Двойной синий', 'Double Blue', 'uncommon', '#3a9aff', 1, 'double'],
            ['tr_gspark', 'Золотые искры', 'Gold Sparks', 'rare', '#ffc81c', 1.2, 'spark'], ['tr_ispark', 'Ледяные искры', 'Ice Sparks', 'rare', '#9fe8ff', 1.2, 'spark'],
            ['tr_tspark', 'Токсичные искры', 'Toxic Sparks', 'rare', '#7dff2a', 1.2, 'spark'], ['tr_cfire', 'Огненная комета', 'Fire Comet', 'rare', '#ff6a1a', 1.6, 'comet'],
            ['tr_cblue', 'Голубая комета', 'Blue Comet', 'rare', '#2ac0ff', 1.6, 'comet'],
            ['tr_spink', 'Розовая спираль', 'Pink Spiral', 'epic', '#ff4fc0', 1, 'spiral'], ['tr_scyan', 'Циановая спираль', 'Cyan Spiral', 'epic', '#2afff0', 1, 'spiral'],
            ['tr_sgold', 'Золотая спираль', 'Gold Spiral', 'epic', '#ffd21f', 1, 'spiral'], ['tr_dneon', 'Неоновый дуэт', 'Neon Duo', 'epic', '#ff2ad0', 1.5, 'double'],
            ['tr_rainbow', 'Радуга', 'Rainbow', 'legendary', '#ffffff', 1.6, 'rainbow'], ['tr_rspiral', 'Радужная спираль', 'Rainbow Spiral', 'legendary', '#ffffff', 1.2, 'rspiral'],
            ['tr_void', 'Луч пустоты', 'Void Beam', 'legendary', '#a040ff', 2, 'comet'],
        ];
        // [id, ru, en, редкость, контур, цвет, анимация]
        const xhairs = [
            ['xh_gap', 'Классика', 'Classic', 'common', 'gap', '#5dff6c', ''], ['xh_plus', 'Плюс', 'Plus', 'common', 'plus', '#ffffff', ''],
            ['xh_x', 'Крест', 'Cross', 'common', 'x', '#ff4a4a', ''], ['xh_dot', 'Точка', 'Dot', 'common', 'dot', '#2afff0', ''],
            ['xh_ring', 'Кольцо', 'Ring', 'common', 'ring', '#ffffff', ''], ['xh_square', 'Квадрат', 'Square', 'common', 'square', '#ffd21f', ''],
            ['xh_ringdot', 'Кольцо с точкой', 'Ring Dot', 'uncommon', 'ringdot', '#2a8aff', ''], ['xh_diamond', 'Ромб', 'Diamond', 'uncommon', 'diamond', '#ff8a1a', ''],
            ['xh_tri', 'Треугольник', 'Triangle', 'uncommon', 'tri', '#a24cff', ''], ['xh_chev', 'Шевроны', 'Chevrons', 'uncommon', 'chev', '#5dff6c', ''],
            ['xh_bracket', 'Рамка', 'Brackets', 'uncommon', 'bracket', '#ffffff', ''], ['xh_arrows', 'Стрелки', 'Arrows', 'uncommon', 'arrows', '#ff4fc0', ''],
            ['xh_target', 'Мишень', 'Target', 'rare', 'target', '#ff2a2a', ''], ['xh_star', 'Звезда', 'Star', 'rare', 'star', '#ffd21f', ''],
            ['xh_heart', 'Сердечко', 'Heart', 'rare', 'heart', '#ff4fc0', 'pulse'], ['xh_egg', 'Яйцо', 'Egg', 'rare', 'egg', '#fff58a', ''],
            ['xh_hex', 'Соты', 'Hexagon', 'rare', 'hex', '#2afff0', ''], ['xh_smile', 'Улыбка', 'Smile', 'rare', 'smile', '#ffe01f', ''],
            ['xh_crown', 'Корона', 'Crown', 'epic', 'crown', '#ffc81c', 'pulse'], ['xh_bolt', 'Молния', 'Bolt', 'epic', 'bolt', '#9fe8ff', 'pulse'],
            ['xh_flower', 'Цветок', 'Flower', 'epic', 'flower', '#ff8ad0', 'spin'], ['xh_sniper', 'Снайпер', 'Sniper', 'epic', 'sniper', '#ff3a3a', ''],
            ['xh_spinstar', 'Вихрь-звезда', 'Spin Star', 'legendary', 'star', '#ffffff', 'rainbow'], ['xh_rtarget', 'Радужная мишень', 'Rainbow Target', 'legendary', 'target', '#ff5a5a', 'rainbow'],
        ];
        // [id, ru, en, редкость, цвет A, цвет B, рукава, закрутка, звёзды, радуга, скорость]
        const portals = [
            ['pt_red', 'Алый вихрь', 'Crimson Swirl', 'common', '#c81020', '#ff9a4a', 3, 2.6, 1, 0, 1], ['pt_green', 'Зелёный вихрь', 'Green Swirl', 'common', '#0ca030', '#b6ff5a', 3, 2.6, 1, 0, 1],
            ['pt_blue', 'Синий вихрь', 'Blue Swirl', 'common', '#1040d8', '#5ad8ff', 3, 2.6, 1, 0, 1], ['pt_orange', 'Оранжевый вихрь', 'Orange Swirl', 'common', '#e85a0c', '#ffd24a', 3, 2.6, 1, 0, 1],
            ['pt_pink', 'Розовый вихрь', 'Pink Swirl', 'common', '#d81f8c', '#ffb0e0', 3, 2.6, 1, 0, 1],
            ['pt_fiveb', 'Пять рукавов', 'Five Arms', 'uncommon', '#1840c8', '#ff5ad0', 5, 3, 1, 0, 1.1], ['pt_fiveg', 'Ядовитая звезда', 'Poison Star', 'uncommon', '#0a7a20', '#e0ff2a', 5, 3, 1.2, 0, 1.1],
            ['pt_slow', 'Сонный вихрь', 'Sleepy Swirl', 'uncommon', '#3a2fa8', '#a0c0ff', 2, 1.8, 1, 0, 0.55], ['pt_fast', 'Бешеный вихрь', 'Crazy Swirl', 'uncommon', '#c81060', '#ffe02a', 4, 3.6, 1, 0, 1.9],
            ['pt_stars', 'Звёздная ночь', 'Starry Night', 'rare', '#0a1050', '#5a7aff', 3, 2.6, 3.4, 0, 0.8], ['pt_ember', 'Угли', 'Embers', 'rare', '#3a0806', '#ff6a1a', 3, 3, 3, 0, 1],
            ['pt_mint', 'Мятный туман', 'Mint Mist', 'rare', '#0a7a6a', '#c0fff0', 6, 2, 1.4, 0, 0.8], ['pt_gold', 'Золотой вихрь', 'Gold Swirl', 'rare', '#a86a08', '#fff0a0', 4, 2.8, 2, 0, 1],
            ['pt_void', 'Бездна', 'Abyss', 'epic', '#07030f', '#a02fff', 3, 4.4, 2.4, 0, 1.3], ['pt_blood', 'Лунное затмение', 'Eclipse', 'epic', '#14040a', '#ff2a4a', 5, 4, 2, 0, 1.2],
            ['pt_ice', 'Ледяной шторм', 'Ice Storm', 'epic', '#0a3a80', '#ffffff', 6, 3.4, 3, 0, 1.5], ['pt_lime', 'Кислотный шторм', 'Acid Storm', 'epic', '#0c3a06', '#b6ff1f', 6, 3.4, 3, 0, 1.6],
            ['pt_rainbow', 'Радужный вихрь', 'Rainbow Swirl', 'legendary', '#ff2a2a', '#2a8aff', 4, 3, 2, 1, 1.1], ['pt_cosmos', 'Космос', 'Cosmos', 'legendary', '#14083a', '#ff6ad8', 5, 3.6, 4, 0.5, 1], ['pt_prism', 'Призма', 'Prism', 'legendary', '#ffffff', '#ffffff', 7, 3.2, 3, 1, 1.5],
        ];
        // [id, ru, en, редкость, тип, цвета]
        const booms = [
            ['bm_sred', 'Красные искры', 'Red Sparks', 'common', 'sparks', ['#ff3a3a', '#ff9a4a']], ['bm_sblue', 'Синие искры', 'Blue Sparks', 'common', 'sparks', ['#3a8aff', '#9fe8ff']],
            ['bm_sgreen', 'Зелёные искры', 'Green Sparks', 'common', 'sparks', ['#3aff5a', '#d0ff5a']], ['bm_sgold', 'Золотые искры', 'Gold Sparks', 'common', 'sparks', ['#ffd21f', '#fff0a0']],
            ['bm_smoke', 'Цветной дым', 'Color Smoke', 'common', 'smoke', ['#ff6ad8', '#6ad8ff']], ['bm_smokeg', 'Ядовитый дым', 'Toxic Smoke', 'common', 'smoke', ['#7dff2a', '#2a8a1a']],
            ['bm_conf', 'Конфетти', 'Confetti', 'uncommon', 'confetti', ['#ff3a3a', '#ffd21f', '#3aff5a', '#3a8aff', '#ff6ad8']], ['bm_confp', 'Розовое конфетти', 'Pink Confetti', 'uncommon', 'confetti', ['#ff6ad8', '#ffb0e0', '#ffffff']],
            ['bm_ring', 'Волна', 'Shock Ring', 'uncommon', 'ring', ['#ffffff', '#9fe8ff']], ['bm_ringo', 'Огненная волна', 'Fire Ring', 'uncommon', 'ring', ['#ff8a1a', '#ffd21f']],
            ['bm_bubble', 'Пузыри', 'Bubbles', 'uncommon', 'bubbles', ['#6ad8ff', '#ffffff']], ['bm_bubblep', 'Газировка', 'Soda', 'uncommon', 'bubbles', ['#ff8ad0', '#ffe0a0']],
            ['bm_foun', 'Фонтан', 'Fountain', 'rare', 'fountain', ['#3a8aff', '#ffffff']], ['bm_founl', 'Лавовый фонтан', 'Lava Fountain', 'rare', 'fountain', ['#ff5a12', '#ffd21f']],
            ['bm_coins', 'Золотой дождь', 'Gold Rain', 'rare', 'coins', ['#ffc81c', '#fff0a0']], ['bm_stars', 'Звёздная пыль', 'Star Dust', 'rare', 'stars', ['#ffffff', '#fff58a']],
            ['bm_starsv', 'Фиолетовая пыль', 'Violet Dust', 'rare', 'stars', ['#c86bff', '#ffffff']],
            ['bm_rays', 'Лучи', 'Rays', 'epic', 'rays', ['#fff58a', '#ffffff']], ['bm_raysb', 'Голубые лучи', 'Blue Rays', 'epic', 'rays', ['#2afff0', '#ffffff']],
            ['bm_spiral', 'Спираль', 'Spiral', 'epic', 'spiral', ['#ff2ad0', '#2afff0']], ['bm_spiralg', 'Золотая спираль', 'Gold Spiral', 'epic', 'spiral', ['#ffc81c', '#ff5a12']],
            ['bm_nova', 'Сверхновая', 'Supernova', 'legendary', 'nova', ['#ffffff', '#fff58a', '#ff8a1a']], ['bm_rnova', 'Радужная вспышка', 'Rainbow Blast', 'legendary', 'nova', ['#ff2a2a', '#ffd21f', '#3aff5a', '#2a8aff', '#c86bff']],
            ['bm_blackh', 'Чёрная дыра', 'Black Hole', 'legendary', 'implode', ['#a02fff', '#ff2ad0']],
        ];
        // [id, ru, en, редкость, рисунок, цвета]
        const wins = [
            ['wn_red', 'Красный', 'Red', 'common', 'ball', ['#ff3a3a', '#ffffff']], ['wn_blue', 'Синий', 'Blue', 'common', 'ball', ['#3a8aff', '#ffffff']],
            ['wn_green', 'Зелёный', 'Green', 'common', 'ball', ['#3aff5a', '#ffffff']], ['wn_gold', 'Золотой', 'Gold', 'common', 'ball', ['#ffd21f', '#fff0a0']],
            ['wn_ringr', 'Кольца', 'Rings', 'common', 'ring', ['#ff6ad8', '#ffffff']], ['wn_ringb', 'Голубые кольца', 'Blue Rings', 'common', 'ring', ['#2afff0', '#ffffff']],
            ['wn_double', 'Двойные кольца', 'Double Rings', 'uncommon', 'double', ['#ffd21f', '#ff3a3a']], ['wn_doubleb', 'Морозные кольца', 'Frost Rings', 'uncommon', 'double', ['#9fe8ff', '#3a8aff']],
            ['wn_pix', 'Пиксели', 'Pixels', 'uncommon', 'pix', ['#ff3a3a', '#ffd21f', '#3aff5a', '#3a8aff']], ['wn_pixm', 'Монохром', 'Monochrome', 'uncommon', 'pix', ['#ffffff', '#8a90a8']],
            ['wn_heart', 'Сердца', 'Hearts', 'rare', 'heart', ['#ff3a7a', '#ffb0d0']], ['wn_star', 'Звёзды', 'Stars', 'rare', 'star', ['#ffd21f', '#ffffff']],
            ['wn_flower', 'Цветы', 'Flowers', 'rare', 'flower', ['#ff8ad0', '#fff58a']], ['wn_willow', 'Ива', 'Willow', 'rare', 'willow', ['#ffc81c', '#ff8a1a']],
            ['wn_spiral', 'Спирали', 'Spirals', 'epic', 'spiral', ['#2afff0', '#ff2ad0']], ['wn_willowg', 'Зелёная ива', 'Green Willow', 'epic', 'willow', ['#7dff2a', '#2afff0']],
            ['wn_rain', 'Денежный дождь', 'Money Rain', 'epic', 'rain', ['#5dff6c', '#ffd21f']], ['wn_stard', 'Звездопад', 'Star Fall', 'epic', 'rain', ['#ffffff', '#fff58a']],
            ['wn_rainb', 'Радужные сердца', 'Rainbow Hearts', 'legendary', 'heart', ['#ff2a2a', '#ffd21f', '#3aff5a', '#2a8aff', '#c86bff']], ['wn_gala', 'Большой финал', 'Grand Finale', 'legendary', 'star', ['#ffffff', '#ffd21f', '#ff6ad8', '#2afff0']],
        ];

        const items = [];
        const add = (tab, rows, make) => {
            rows.forEach((r, k) => {
                const it = make(r);
                it.id = r[0]; it.tab = tab; it.name = { ru: r[1], en: r[2] }; it.rarity = r[3];
                it.price = this._price(r[3], k);
                items.push(it);
            });
        };
        const def = (id, tab, ru, en, extra) => items.push(Object.assign({ id, tab, name: { ru, en }, rarity: 'common', default: true }, extra));
        def('sk_std', 'skin', 'Заводской', 'Factory', { mode: 0 });
        add('skin', skins, r => ({ mode: r[4], a: r[5], b: r[6] }));
        for (const r of skinEx) items.push({ id: r[0], tab: 'skin', name: { ru: r[1], en: r[2] }, rarity: r[3], exclusive: 'daily', mode: r[4], a: r[5], b: r[6] });
        def('tr_std', 'tracer', 'Обычный', 'Standard', { fx: 'std' });
        add('tracer', tracers, r => ({ color: r[4], w: r[5], fx: r[6] }));
        def('xh_std', 'xhair', 'По оружию', 'By Weapon', { shape: '' });
        add('xhair', xhairs, r => ({ shape: r[4], color: r[5], anim: r[6] }));
        def('pt_std', 'portal', 'Фиолетовый вихрь', 'Violet Swirl', { a: '#8c1aff', b: '#33d9ff', arms: 3, twist: 2.6, stars: 1, rainbow: 0, speed: 1 });
        add('portal', portals, r => ({ a: r[4], b: r[5], arms: r[6], twist: r[7], stars: r[8], rainbow: r[9], speed: r[10] }));
        def('bm_std', 'boom', 'Без эффекта', 'No Effect', { type: 'none', cols: ['#ffffff'] });
        add('boom', booms, r => ({ type: r[4], cols: r[5] }));
        def('wn_std', 'win', 'Обычный', 'Standard', { pat: 'ball', cols: null });
        add('win', wins, r => ({ pat: r[4], cols: r[5] }));
        return { tabs: this.TABS, items };
    },

    _price(rarity, k) {
        if ((k * 7) % 20 >= 7) return { ads: this.ADS[rarity] };
        const [lo, hi] = this.COIN[rarity], v = lo + (hi - lo) * (((k * 37) % 100) / 100);
        const step = v < 5000 ? 50 : (v < 50000 ? 500 : 5000);
        return { coins: Math.round(v / step) * step };
    },
};
