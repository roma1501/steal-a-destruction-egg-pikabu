// GameAudio.js — звуковой слой Rubble Lab: удары обломков, разрушение вокселей, взрывы, оружие,
// шаги, огонь и интерфейс. ТОЛЬКО звук: физика, картинка и ввод живут в других модулях и зовут сюда.
//
// Все позиции — в МЕТРАХ мира, y вверх. Сцена ПРАВОСТОРОННЯЯ (World3D: useRightHandedSystem), поэтому
// «вправо» от слушателя = вперёд × вверх = (fx,0,fz) × (0,1,0) = (-fz, 0, fx): камера смотрит в -z -> вправо +x.
// Громкость: полная в радиусе cfg.refDist (3 м), дальше ~1/d, за cfg.maxDist (90 м) тишина; панорама — по
// проекции направления на источник на «вправо» (Sound.play opts.pan, StereoPanner; без него звук по центру).
//
//   init()                                  один раз после Sound.init: регистрирует синтез, предзагружает файлы
//   setListener(x, y, z, fx, fz)            каждый кадр: камера и горизонтальный вектор «вперёд»
//   impact(mat, strength, x, y, z)          контакт твёрдых тел; зовут часто — лимит внутри (см. cfg.budget)
//   breakVoxels(mat, count, x, y, z)        разрушены воксели: стекло — осколки и звон, дерево — треск, камень — крошево и дробь
//   explosion(size, x, y, z)                0.3..2; ближний или дальний вариант по расстоянию, комната, приглушает музыку
//   debrisRumble(amount, x, y, z, mat?)     гул обвала 0..1 (от 0.7 — большой), не чаще раза в 0.6 с; крупное — скрип/стон
//   creak(mat, amount, x, y, z)             скрип дерева / стон металла от крупного тела (mat 'metal' — металл, иначе дерево)
//   shot(kind) / swing(hit) / footstep(mat, speed) / land(mat, strength) / grab(kind) / ui(kind)
//   fireLoop()                              -> { set(0..1), stop() }: треск огня циклом
//   ambience(theme)                         фон карты: lab farm suburb industrial docks city snow desert | none (или id карты)
//   themeFor(mapId)                         тема карты по таблице MAP_THEME ('none', если карты в таблице нет)
//   music(kind)                             'menu' | 'play' | 'tense' (последние 30 с раунда) | 'results' | 'none'; плавная смена
//
// Дальность: воздух гасит верха — Sound.play opts.lp (НЧ-фильтр) падает с 14 кГц за 12 м до ~1.8 кГц на 90 м; у взрывов
// ещё дальние варианты синтеза (темнее, длиннее). Комната: opts.reverb — посыл в ConvolverNode Sound (взрывы, обвалы,
// крупные разрушения, скрипы); cfg.reverb = false выключает. Хвосты и эхо слоями — opts.delay (звенящий хвост стекла,
// дробь обломков, звук далёкого взрыва). Фон и музыка — оригинальный синтез, собираются генераторами по кусочкам в фоне.
//
// Материалы: grass dirt wood brick concrete metal glass plaster foliage rock; незнакомый -> concrete.
// Файлы — из Sound Pack (Kenney, CC0; список и лицензии — assets/sounds/SOURCES.md), пути литералами в FILES.
// Чего нет в библиотеке (взрывы, выстрелы, осколки стекла, крошево, дробь, скрип, свист молота, огонь, «зерно» камня,
// фон карт, музыка) —
// синтез в буферы Sound.putBuffer('ga-…'), играется как 'synth:ga-…'. Синтез ленивый: init() только
// регистрирует генераторы, буферы собираются в фоне по одному-двум за такт (setTimeout) или в момент
// первого запроса. Любой вызов безопасен до init, при выключенном звуке и без Web Audio: тишина, не исключение.

/** @satisfies {Record<string, any>} */
const GameAudio = {
    // ---- настройки (Constants.js не трогаем: числа звукового слоя живут здесь, меняются из игры) ----
    cfg: {
        volume: 1,          // общий множитель поверх SOUND_VOLUME
        refDist: 3,         // м: в этом радиусе полная громкость
        maxDist: 90,        // м: дальше — тишина (взрывы слышны дальше, см. explosion)
        budget: 15,         // ударов в секунду (impact, глобально)
        burst: 6,           // сколько ударов подряд без пауз
        matCooldown: 0.05,  // с между ударами одного материала
        minStrength: 0.04,  // слабее — не звучит
        breakBudget: 9,     // разрушений в секунду
        breakGap: 0.07,     // с: вызовы breakVoxels одного материала в этом окне склеиваются в один звук
        soundDelay: true,   // задержка звука далёких взрывов (343 м/с, не больше 0.35 с)
        warmup: true,       // собирать синтез в фоне после init
        reverb: true,       // посылы в общую «комнату» Sound (взрывы, обвалы, крупные разрушения)
        musicVolume: 0.55,  // музыка (× MUSIC_VOLUME Sound): тише эффектов
        ambVolume: 0.3,     // фон карты (× SOUND_VOLUME Sound)
    },

    // ---- файлы (Kenney CC0). Ключ -> варианты: играются через Sound.play([...]) со случайным вариантом ----
    FILES: {
        'soft-m': ['assets/sounds/soft-m-1.ogg', 'assets/sounds/soft-m-2.ogg', 'assets/sounds/soft-m-3.ogg'],
        'soft-h': ['assets/sounds/soft-h-1.ogg', 'assets/sounds/soft-h-2.ogg', 'assets/sounds/soft-h-3.ogg'],
        'wood-l': ['assets/sounds/wood-l-1.ogg', 'assets/sounds/wood-l-2.ogg', 'assets/sounds/wood-l-3.ogg'],
        'wood-m': ['assets/sounds/wood-m-1.ogg', 'assets/sounds/wood-m-2.ogg', 'assets/sounds/wood-m-3.ogg'],
        'wood-h': ['assets/sounds/wood-h-1.ogg', 'assets/sounds/wood-h-2.ogg', 'assets/sounds/wood-h-3.ogg'],
        'plank': ['assets/sounds/plank-1.ogg', 'assets/sounds/plank-2.ogg'],
        'punch-m': ['assets/sounds/punch-m-1.ogg', 'assets/sounds/punch-m-2.ogg', 'assets/sounds/punch-m-3.ogg'],
        'punch-h': ['assets/sounds/punch-h-1.ogg', 'assets/sounds/punch-h-2.ogg', 'assets/sounds/punch-h-3.ogg'],
        'plate-h': ['assets/sounds/plate-h-1.ogg', 'assets/sounds/plate-h-2.ogg', 'assets/sounds/plate-h-3.ogg'],
        'metal-l': ['assets/sounds/metal-l-1.ogg', 'assets/sounds/metal-l-2.ogg', 'assets/sounds/metal-l-3.ogg'],
        'metal-m': ['assets/sounds/metal-m-1.ogg', 'assets/sounds/metal-m-2.ogg', 'assets/sounds/metal-m-3.ogg'],
        'metal-h': ['assets/sounds/metal-h-1.ogg', 'assets/sounds/metal-h-2.ogg', 'assets/sounds/metal-h-3.ogg'],
        'glass-l': ['assets/sounds/glass-l-1.ogg', 'assets/sounds/glass-l-2.ogg', 'assets/sounds/glass-l-3.ogg'],
        'glass-m': ['assets/sounds/glass-m-1.ogg', 'assets/sounds/glass-m-2.ogg', 'assets/sounds/glass-m-3.ogg'],
        'glass-h': ['assets/sounds/glass-h-1.ogg', 'assets/sounds/glass-h-2.ogg', 'assets/sounds/glass-h-3.ogg'],
        'tick': ['assets/sounds/tick-1.ogg', 'assets/sounds/tick-2.ogg', 'assets/sounds/tick-3.ogg'],
        'step-grass': ['assets/sounds/step-grass-1.ogg', 'assets/sounds/step-grass-2.ogg', 'assets/sounds/step-grass-3.ogg', 'assets/sounds/step-grass-4.ogg'],
        'step-concrete': ['assets/sounds/step-concrete-1.ogg', 'assets/sounds/step-concrete-2.ogg', 'assets/sounds/step-concrete-3.ogg', 'assets/sounds/step-concrete-4.ogg'],
        'step-wood': ['assets/sounds/step-wood-1.ogg', 'assets/sounds/step-wood-2.ogg', 'assets/sounds/step-wood-3.ogg', 'assets/sounds/step-wood-4.ogg'],
        'step-snow': ['assets/sounds/step-snow-1.ogg', 'assets/sounds/step-snow-2.ogg', 'assets/sounds/step-snow-3.ogg'],
        'step-dirt': ['assets/sounds/step-dirt-1.ogg', 'assets/sounds/step-dirt-2.ogg', 'assets/sounds/step-dirt-3.ogg', 'assets/sounds/step-dirt-4.ogg'],
        'grab': ['assets/sounds/grab-1.ogg', 'assets/sounds/grab-2.ogg'],
        'drop': ['assets/sounds/drop-1.ogg'],
        'ui-click': ['assets/sounds/ui-click.ogg'],
        'ui-select': ['assets/sounds/ui-select.ogg'],
        'ui-toggle': ['assets/sounds/ui-toggle.ogg'],
    },

    // ---- слои. Запись слоя: [ключ (FILES или синтез), громкость, скорость]. Ключ -> список url ----
    // Удар обломка: l — лёгкий (сила < 0.3), m — средний (< 0.62), h — тяжёлый.
    IMPACT: {
        grass: { l: [['soft-m', 0.75, 1.35]], m: [['soft-m', 1, 1.12], ['step-grass', 0.35, 1.2]], h: [['soft-h', 1, 1], ['step-grass', 0.55, 0.9]] },
        dirt: { l: [['soft-m', 0.9, 1.05]], m: [['soft-h', 0.8, 1.2]], h: [['soft-h', 1, 0.85], ['punch-m', 0.45, 0.8]] },
        wood: { l: [['wood-l', 1, 1]], m: [['wood-m', 1, 1]], h: [['wood-h', 1, 1], ['plank', 0.4, 0.95]] },
        brick: { l: [['clack-brick', 1, 1]], m: [['punch-m', 0.55, 1.3], ['clack-brick', 0.9, 1]], h: [['punch-h', 0.8, 1.2], ['clack-brick', 1, 0.9]] },
        concrete: { l: [['clack-concrete', 1, 1]], m: [['punch-m', 0.7, 1], ['clack-concrete', 0.8, 1]], h: [['plate-h', 0.7, 1], ['punch-h', 0.7, 0.95], ['clack-concrete', 0.8, 0.85]] },
        metal: { l: [['metal-l', 0.8, 1]], m: [['metal-m', 0.85, 1]], h: [['metal-h', 0.9, 1], ['plate-h', 0.3, 1.2]] },
        glass: { l: [['glass-l', 0.8, 1]], m: [['glass-m', 0.8, 1]], h: [['glass-h', 0.9, 1], ['glass-shard0', 0.4, 1]] },
        plaster: { l: [['clack-plaster', 1, 1]], m: [['clack-plaster', 0.9, 1.1], ['soft-m', 0.5, 1.5]], h: [['punch-m', 0.6, 1.5], ['clack-plaster', 1, 0.95], ['soft-h', 0.45, 1.2]] },
        foliage: { l: [['step-grass', 0.6, 1.5]], m: [['step-grass', 0.9, 1.3]], h: [['step-snow', 0.7, 1.25], ['soft-m', 0.5, 1.1]] },
        rock: { l: [['clack-rock', 1, 1]], m: [['punch-m', 0.55, 0.85], ['clack-rock', 1, 1]], h: [['plate-h', 0.85, 0.8], ['punch-h', 0.75, 0.8], ['clack-rock', 0.9, 0.85]] },
    },
    // Разрушение вокселей: индекс — размер по log10(count): 0 — единицы, 1 — десятки, 2 — сотни и больше.
    // Четвёртый элемент слоя — задержка (с): звенящий хвост стекла, дробь мелких обломков, скрип после обвала.
    BREAK: {
        glass: [[['glass-l', 0.7, 1.1], ['glass-shard0', 1, 1]],
            [['glass-m', 0.6, 1], ['glass-shard1', 1, 1], ['glass-h', 0.4, 1.1], ['glass-tinkle', 0.5, 1, 0.14]],
            [['glass-h', 0.7, 0.9], ['glass-shard2', 1, 1], ['glass-shard1', 0.6, 0.85], ['glass-tinkle', 0.7, 0.95, 0.2], ['glass-tinkle', 0.45, 1.2, 0.5]]],
        wood: [[['splint0', 1, 1], ['wood-m', 0.7, 1.1]],
            [['splint1', 1, 1], ['plank', 0.8, 1], ['wood-h', 0.7, 1], ['patter-wood0', 0.5, 1, 0.12]],
            [['splint2', 1, 1], ['plank', 1, 0.9], ['wood-h', 1, 0.8], ['thump', 0.6, 1], ['patter-wood1', 0.6, 1, 0.15], ['patter-wood2', 0.45, 0.9, 0.55], ['creak-wood', 0.3, 1, 0.3]]],
        brick: [[['crumble0', 1, 1.05], ['clack-brick', 0.8, 1]],
            [['crumble1', 1, 1], ['punch-m', 0.7, 1.15], ['clack-brick', 0.6, 1], ['patter-stone0', 0.5, 1, 0.12]],
            [['crumble2', 1, 0.95], ['punch-h', 0.9, 1.1], ['plate-h', 0.5, 1.1], ['thump', 0.7, 1], ['patter-stone1', 0.6, 1, 0.15], ['patter-stone2', 0.5, 0.9, 0.55]]],
        concrete: [[['crumble0', 1, 0.9], ['clack-concrete', 0.8, 1]],
            [['crumble1', 1, 0.85], ['punch-m', 0.8, 1], ['clack-concrete', 0.6, 0.9], ['patter-stone0', 0.5, 0.9, 0.12]],
            [['crumble2', 1, 0.8], ['punch-h', 1, 0.95], ['plate-h', 0.7, 0.95], ['thump', 0.8, 0.9], ['patter-stone1', 0.6, 0.9, 0.15], ['patter-stone2', 0.5, 0.85, 0.55]]],
        rock: [[['crumble0', 1, 0.78], ['clack-rock', 0.9, 1]],
            [['crumble1', 1, 0.72], ['punch-m', 0.7, 0.85], ['clack-rock', 0.7, 0.9], ['patter-stone0', 0.5, 0.8, 0.12]],
            [['crumble2', 1, 0.68], ['plate-h', 0.8, 0.85], ['punch-h', 0.8, 0.85], ['thump', 0.9, 0.85], ['patter-stone1', 0.6, 0.8, 0.15], ['patter-stone2', 0.5, 0.75, 0.55]]],
        plaster: [[['crumble0', 0.9, 1.35], ['clack-plaster', 1, 1.1]],
            [['crumble1', 0.9, 1.25], ['clack-plaster', 1, 1], ['soft-m', 0.5, 1.4], ['patter-stone0', 0.35, 1.3, 0.12]],
            [['crumble2', 0.9, 1.15], ['punch-m', 0.7, 1.4], ['soft-h', 0.5, 1.1], ['thump', 0.5, 1.1], ['patter-stone1', 0.45, 1.25, 0.15]]],
        metal: [[['metal-m', 1, 1.05]],
            [['metal-h', 1, 1], ['metal-l', 0.55, 0.9], ['patter-metal0', 0.45, 1, 0.1]],
            [['metal-h', 1, 0.8], ['plate-h', 0.8, 0.9], ['metal-m', 0.6, 0.75], ['thump', 0.5, 1], ['patter-metal1', 0.6, 1, 0.12], ['creak-metal', 0.35, 1, 0.2]]],
        grass: [[['soft-m', 0.8, 1.2], ['step-grass', 0.7, 1.1]],
            [['soft-h', 0.9, 1.05], ['step-grass', 0.9, 0.95]],
            [['soft-h', 1, 0.9], ['step-grass', 1, 0.8], ['thump', 0.4, 1]]],
        dirt: [[['soft-m', 0.9, 0.95]],
            [['soft-h', 0.9, 0.9], ['crumble1', 0.4, 0.7]],
            [['soft-h', 1, 0.8], ['crumble2', 0.6, 0.7], ['thump', 0.6, 0.9], ['patter-stone1', 0.35, 0.8, 0.2]]],
        foliage: [[['step-grass', 0.9, 1.35]],
            [['step-snow', 0.9, 1.2], ['soft-m', 0.45, 1.1]],
            [['step-snow', 1, 1], ['soft-h', 0.7, 1.05], ['crumble1', 0.3, 1.6]]],
    },
    // Шаг: слои как у ударов; громкость и скорость умножаются на скорость ходьбы.
    STEP: {
        grass: [['step-grass', 1, 1]],
        dirt: [['step-dirt', 0.9, 1]],
        wood: [['step-wood', 1, 1]],
        brick: [['step-concrete', 1, 1.05]],
        concrete: [['step-concrete', 1, 1]],
        plaster: [['step-concrete', 0.95, 0.95]],
        rock: [['step-concrete', 1, 0.82], ['tick', 0.25, 1.1]],
        metal: [['step-concrete', 0.5, 1], ['metal-l', 0.35, 0.8]],
        glass: [['step-concrete', 0.6, 1], ['glass-l', 0.22, 1.1]],
        foliage: [['step-snow', 0.8, 1.25], ['step-grass', 0.5, 1.3]],
    },

    // Фон карт: темы и их относительная громкость (× cfg.ambVolume). Тема каждой карты — таблица MAP_THEME (id карты ->
    // тема): правится здесь одной строкой; themeFor(id) читает её же. Новая карта без строки получает 'none'.
    THEMES: ['lab', 'farm', 'suburb', 'industrial', 'docks', 'city', 'snow', 'desert'],
    AMB_LEVEL: { lab: 0.7, farm: 0.85, suburb: 0.8, industrial: 0.9, docks: 0.9, city: 0.8, snow: 0.85, desert: 0.8 },
    MAP_THEME: {
        'base': 'suburb', 'test-lab': 'lab', 'farm': 'farm', 'suburb': 'suburb', 'gas-station': 'suburb', 'construction': 'industrial',
        'factory': 'industrial', 'docks': 'docks', 'downtown': 'city', 'village': 'snow', 'desert': 'desert',
    },
    // Музыка: громкость (× cfg.musicVolume) и время плавной смены (с).
    MUSIC: {
        menu: { vol: 0.9, fade: 2 },
        play: { vol: 1, fade: 2.5 },
        tense: { vol: 1, fade: 0.9 },
        results: { vol: 0.8, fade: 1.2 },
    },

    // Параметры синтеза взрывов по классам: s — малый (< 0.7), m — средний (≈ 1: бомба, ракета), l — крупный (бочка).
    // f0->f1 Гц: качание высоты суб-удара; n*: срез шума-вспышки (Гц) и его спад; rum*: гул; crackle — щелчков/с.
    _BLAST: {
        s: { dur: 2.3, f0: 118, f1: 44, fTau: 0.07, thumpTau: 0.22, nFc0: 7000, nFc1: 520, nFcTau: 0.28, nTauA: 0.12, nTauB: 0.6,
            crackTau: 0.007, rumFc: 150, rumTau: 0.9, crackle: 70, crackTail: 0.7, tailStart: 0.16, nw: 0.85 },
        m: { dur: 3.1, f0: 92, f1: 34, fTau: 0.09, thumpTau: 0.38, nFc0: 6000, nFc1: 450, nFcTau: 0.38, nTauA: 0.18, nTauB: 0.9,
            crackTau: 0.009, rumFc: 120, rumTau: 1.3, crackle: 100, crackTail: 0.9, tailStart: 0.2, nw: 1 },
        l: { dur: 4.0, f0: 78, f1: 29, fTau: 0.11, thumpTau: 0.55, nFc0: 5000, nFc1: 340, nFcTau: 0.5, nTauA: 0.26, nTauB: 1.2,
            crackTau: 0.012, rumFc: 95, rumTau: 1.8, crackle: 130, crackTail: 1.1, tailStart: 0.24, nw: 1.1 },
    },

    // ---- состояние ----
    stat: { played: 0, limited: 0, stolen: 0 },   // для отладки: пропущено / отброшено лимитом / вытеснено громким (входит в played)
    _inited: false,
    _hasListener: false,
    _lx: 0, _ly: 0, _lz: 0,
    _fx: 0, _fz: -1,       // горизонтальный «вперёд»
    _rx: 1, _rz: 0,        // горизонтальный «вправо» = (-fz, fx)
    /** @type {Record<string, boolean>} */
    _have: {},             // имя синтеза -> буфер собран и положен в Sound
    /** @type {Record<string, boolean>} */
    _bad: {},              // не собрался (нет Web Audio) — не пробуем снова
    /** @type {Record<string, () => any>} */
    _gen: {},              // имя синтеза -> генератор { s: Float32Array, sr }
    /** @type {Record<string, string[]>} */
    _syn: {},              // ключ слоя -> имена синтеза
    /** @type {Record<string, string[]>} */
    _synUrls: {},          // кэш: ключ слоя -> url 'synth:…'
    /** @type {string[]} */
    _queue: [],            // имена синтеза, ещё не собранные фоновой сборкой
    _warmTimer: 0,
    /** @type {Record<string, any>} */
    _matLast: {},
    /** @type {Record<string, any>} */
    _brk: {},
    _hitPool: { tokens: 6, t: -1, recent: [] },
    _brkPool: { tokens: 4, t: -1, recent: [] },
    _expPool: { tokens: 4, t: -1, recent: [] },
    _rumbleT: -9,
    /** @type {Record<string, number>} */
    _creakT: {},           // вид ('wood' | 'metal') -> время последнего скрипа
    /** @type {{ name: string, it: any, prio: number, cbs: (() => void)[] }[]} */
    _jobs: [],             // длинный синтез (музыка, фон) по кусочкам: генераторы
    /** @type {Record<string, () => any>} */
    _genAsync: {},         // имя буфера -> фабрика генератора
    _ambTheme: '',         // тема, которую просили последней ('' — ещё не просили)
    /** @type {any} */
    _ambH: null,           // живой цикл фона (Sound.loop)
    _musicKind: '',        // музыка, которую просили последней
    _wantAmb: '',          // что просили до init
    _wantMusic: '',
    _stepT: -9, _landT: -9, _shotT: -9, _swingT: -9, _uiT: -9, _grabT: -9,

    // ======================================================================================
    //  Публичный API
    // ======================================================================================

    init() {
        if (this._inited) return;
        if (typeof Sound === 'undefined' || !Sound) return;   // Sound ещё нет — попробуем при первом вызове
        this._inited = true;
        try {
            this._register();
            if (typeof Sound.preload === 'function') {
                const p = Sound.preload(Object.values(this.FILES));
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
            if (this.cfg.warmup) {
                // музыка собирается в фоне после эффектов; самое нужное первым (меню), раундовое — следом
                for (const n of ['ga-mus-menu', 'ga-mus-play']) this._needAsync(n, 1);
                this._warm();
            }
        } catch (e) { /* звук не должен ронять игру */ }
        // фон и музыка, которые просили до init (или пока не было Sound)
        const am = this._wantAmb, mu = this._wantMusic;
        if (am && am !== this._ambTheme) this.ambience(am);
        if (mu && mu !== this._musicKind) this.music(mu);
    },

    // Слушатель: камера (x,y,z) и горизонтальный «вперёд» (fx,fz). Вырожденный вектор (взгляд вверх/вниз) —
    // остаётся прошлое направление.
    setListener(x, y, z, fx, fz) {
        const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
        this._lx = n(x); this._ly = n(y); this._lz = n(z);
        let a = n(fx), b = n(fz);
        const l = Math.hypot(a, b);
        if (l > 1e-6) { this._fx = a / l; this._fz = b / l; }
        this._rx = -this._fz;
        this._rz = this._fx;
        this._hasListener = true;
    },

    // Контакт твёрдых тел. Зовут до сотни раз в секунду: кулдаун материала, общий бюджет, громкий вытесняет тихий.
    impact(mat, strength, x, y, z) {
        try {
            const c = this.cfg, s = Number(strength);
            if (!(s >= c.minStrength)) return;
            if (!this._ready()) return;
            const st = Math.min(1, s), m = this._mat(mat), now = this._now();
            const last = this._matLast[m];
            if (last && now - last.t < c.matCooldown && !(st > last.s * 1.6 + 0.12 && now - last.t > 0.015)) { this.stat.limited++; return; }
            const sp = this._spatial(x, y, z, c.refDist, c.maxDist);
            if (!sp) return;
            const vol = (0.14 + 0.86 * Math.pow(st, 0.75)) * sp.g * c.volume;
            if (vol < 0.02) return;
            const slot = this._admit(this._hitPool, vol, now, c.budget, c.burst);
            if (!slot) { this.stat.limited++; return; }
            this.stat.played++;
            if (last) { last.t = now; last.s = st; } else this._matLast[m] = { t: now, s: st };
            const lv = st < 0.3 ? 'l' : st < 0.62 ? 'm' : 'h';
            const rate = (1.2 - 0.4 * st) * (1 + (Math.random() - 0.5) * 0.12);
            for (const L of this.IMPACT[m][lv]) this._playKey(L[0], vol * L[1], rate * L[2], sp, slot);
            // сильный удар по дереву/металлу — тело ещё стонет (редко, с запозданием)
            if (st >= 0.8 && (m === 'wood' || m === 'metal') && Math.random() < 0.5) this._creakNow(m, st, sp, now, 0.12);
        } catch (e) { /* тишина */ }
    },

    // Воксели разрушены (инструмент, взрыв, удар): count 1..5000. Близкие по времени вызовы одного материала
    // склеиваются — один звук с суммарным count, а не очередь из сотен.
    breakVoxels(mat, count, x, y, z) {
        try {
            const c0 = Number(count);
            if (!(c0 >= 1) || !this._ready()) return;
            const cnt = Math.min(5000, Math.floor(c0));
            const m = this._mat(mat), now = this._now(), c = this.cfg;
            const b = this._brk[m] || (this._brk[m] = { t: -9, acc: 0, maxC: 0, x: 0, y: 0, z: 0, timer: 0 });
            if (now - b.t < c.breakGap) {
                // слишком быстро: копим, звук — одним хвостом, когда окно кончится
                b.acc += cnt;
                if (cnt >= b.maxC) { b.maxC = cnt; b.x = x; b.y = y; b.z = z; }
                if (!b.timer && typeof setTimeout === 'function') {
                    b.timer = setTimeout(() => {
                        b.timer = 0;
                        try { if (b.acc > 0) this._breakNow(m, b, this._now()); } catch (e) { /* тишина */ }
                    }, c.breakGap * 1000 + 5);
                }
                return;
            }
            b.maxC = cnt; b.x = x; b.y = y; b.z = z;
            this._breakNow(m, b, now, cnt);
        } catch (e) { /* тишина */ }
    },

    // Взрыв: size 0.3..2 (бомба ≈ 1, ракета ≈ 1.2, бочка ≈ 1.6). Ближе — резкий вариант, дальше — тёмный
    // протяжный; далёкий слышен с задержкой звука. Приглушает музыку, если есть Sound.duck.
    explosion(size, x, y, z) {
        try {
            if (!this._ready()) return;
            const sz = Math.max(0.2, Math.min(2.5, Number(size) || 1));
            const cls = sz < 0.7 ? 's' : sz < 1.35 ? 'm' : 'l';
            const sp = this._spatial(x, y, z, 4 + 10 * sz, this.cfg.maxDist * (0.8 + 0.6 * sz));
            if (!sp) return;
            const now = this._now();
            const near = sp.d < 26 + 18 * sz;
            const vol = Math.min(1, (0.55 + 0.4 * Math.min(1, sz / 1.6)) * sp.g * (near ? 1 : 1.6)) * this.cfg.volume;
            if (vol < 0.02) return;
            const slot = this._admit(this._expPool, vol * sz, now, 6, 4);
            if (!slot) return;
            const names = near ? [1, 2, 3].map(i => 'ga-b-' + cls + i) : [1, 2].map(i => 'ga-f-' + cls + i);
            const urls = this._built(names);
            if (!urls.length) return;
            const rate = Math.pow((cls === 's' ? 0.45 : cls === 'm' ? 1 : 1.6) / sz, 0.25) * (1 + (Math.random() - 0.5) * 0.05);
            // звук идёт 343 м/с: далёкий взрыв слышен позже (до 0.35 с); задержку отсчитывает сам Sound.play
            const travel = this.cfg.soundDelay && sp.d > 25 ? Math.min(0.35, (sp.d - 15) / 343) : 0;
            /** @type {Record<string, any>} */
            const o = { volume: vol * 1.3, rate, pan: sp.pan };   // взрыв громче ударов: лимитер на выходе держит микс
            if (travel > 0.02) o.delay = travel;
            const lp = near ? sp.lp : (sp.lp ? Math.max(sp.lp, 2500) : 0);   // дальний вариант и так тёмный
            if (lp) o.lp = lp;
            if (this.cfg.reverb) o.reverb = near ? 0.2 + 0.15 * sz : 0.1;
            const h = Sound.play(urls, o);
            if (h) slot.hs.push(h);
            // дробь обломков и осыпь: запаздывает за вспышкой
            if (sp.d < 70) {
                this._playKey(cls === 's' ? 'patter-stone1' : 'patter-stone2', vol * (cls === 's' ? 0.4 : cls === 'm' ? 0.5 : 0.6), rate, sp, slot, travel + 0.3 + 0.25 * sz, 0.1);
                if (cls !== 's') this._playKey('patter-stone1', vol * 0.35, rate * 0.9, sp, slot, travel + 0.9 + 0.4 * sz, 0.1);
            }
            if (typeof Sound.duck === 'function' && sp.d < 80) {
                const prox = 1 - sp.d / 80;
                Sound.duck(1 - (0.3 + 0.4 * Math.min(1, sz / 1.4)) * prox, 0.04, 0.3 + 0.5 * sz, 0.9 + 0.5 * sz);
            }
        } catch (e) { /* тишина */ }
    },

    // Гул большого обвала: amount 0..1, не чаще раза в 0.6 с. От 0.7 — «большой» обвал (длиннее, ниже), от 0.35 —
    // осыпь, дробь мелких обломков запаздывает; от 0.5 — ещё и скрип дерева или стон металла (mat: 'metal' — металл, иначе дерево).
    debrisRumble(amount, x, y, z, mat) {
        try {
            const a = Math.max(0, Math.min(1, Number(amount) || 0));
            if (a < 0.05 || !this._ready()) return;
            const now = this._now();
            if (now - this._rumbleT < 0.6) return;
            const sp = this._spatial(x, y, z, 10 + 25 * a, this.cfg.maxDist * (1 + 0.6 * a));
            if (!sp) return;
            const vol = Math.min(1, (0.25 + 0.75 * a) * sp.g * 1.3) * this.cfg.volume;
            if (vol < 0.02) return;
            this._rumbleT = now;
            const rate = (1.12 - 0.3 * a) * (1 + (Math.random() - 0.5) * 0.08);
            const big = a > 0.7;
            this._playKey(big ? 'collapse' : 'rumble', vol * 1.15, rate, sp, null, 0, 0.1 + 0.3 * a);
            if (a > 0.35) {
                this._playKey('crumble2', vol * 0.5 * a, 0.85 * rate, sp, null, 0.1);
                this._playKey(a > 0.55 ? 'patter-stone2' : 'patter-stone1', vol * 0.5 * a, rate, sp, null, 0.4 + 0.5 * a);
            }
            // крупное тело стонет: по умолчанию дерево, mat 'metal' — металл
            if (a > 0.5) this._creakNow(mat, a, sp, now, 0.25 + 0.3 * Math.random());
        } catch (e) { /* тишина */ }
    },

    // Оружие игрока, не позиционное: 'rifle' | 'shotgun' | 'launcher'.
    shot(kind, rate = 1) {
        try {
            if (!this._ready()) return;
            const now = this._now();
            if (now - this._shotT < 0.035) return;
            this._shotT = now;
            const k = kind === 'shotgun' || kind === 'launcher' ? kind : 'rifle';
            const v = (k === 'rifle' ? 0.7 : k === 'shotgun' ? 0.9 : 0.85) * this.cfg.volume;
            this._playKey(k, v, rate, 0, null);
        } catch (e) { /* тишина */ }
    },

    // Молот: false — свист мимо, true — тяжёлый глухой удар.
    swing(hit) {
        try {
            if (!this._ready()) return;
            const now = this._now();
            if (now - this._swingT < 0.1) return;
            this._swingT = now;
            const v = this.cfg.volume;
            if (!hit) { this._playKey('whoosh', 0.6 * v, 1, 0, null); return; }
            this._playKey('punch-h', 0.9 * v, 0.9, 0, null);
            this._playKey('soft-h', 0.8 * v, 0.75, 0, null);
            this._playKey('thump', 0.55 * v, 1, 0, null);
        } catch (e) { /* тишина */ }
    },

    // Шаг по материалу, speed 0..1 (ходьба ≈ 0.5, бег 1).
    footstep(mat, speed) {
        try {
            if (!this._ready()) return;
            const now = this._now();
            if (now - this._stepT < 0.1) return;
            this._stepT = now;
            const sp = Math.max(0, Math.min(1, Number(speed) || 0));
            const vol = (0.2 + 0.5 * sp) * this.cfg.volume;
            const rate = (0.92 + 0.14 * sp) * (1 + (Math.random() - 0.5) * 0.08);
            for (const L of this.STEP[this._mat(mat)]) this._playKey(L[0], vol * L[1], rate * L[2], 0, null);
        } catch (e) { /* тишина */ }
    },

    // Приземление после падения, strength 0..1: глухой удар тела и шаг-«шлёпок» по материалу.
    land(mat, strength) {
        try {
            if (!this._ready()) return;
            const now = this._now();
            if (now - this._landT < 0.15) return;
            this._landT = now;
            const s = Math.max(0, Math.min(1, Number(strength) || 0));
            const vol = (0.35 + 0.65 * s) * this.cfg.volume;
            for (const L of this.STEP[this._mat(mat)]) this._playKey(L[0], vol * L[1] * 0.9, 0.8 * L[2], 0, null);
            this._playKey('soft-h', vol * 0.8, 1.1 - 0.3 * s, 0, null);
            if (s > 0.6) this._playKey('punch-h', vol * 0.55, 1.05 - 0.2 * s, 0, null);
        } catch (e) { /* тишина */ }
    },

    // Предмет в руках: 'grab' | 'drop' | 'throw'.
    grab(kind) {
        try {
            if (!this._ready()) return;
            const now = this._now();
            if (now - this._grabT < 0.08) return;
            this._grabT = now;
            const v = this.cfg.volume;
            if (kind === 'drop') {
                this._playKey('drop', 0.9 * v, 1, 0, null);
                this._playKey('soft-m', 0.5 * v, 1.1, 0, null);
            } else if (kind === 'throw') {
                this._playKey('throw', 0.7 * v, 1, 0, null);
                this._playKey('grab', 0.5 * v, 1.2, 0, null);
            } else {
                this._playKey('grab', 1.2 * v, 1, 0, null);
                this._playKey('tick', 0.25 * v, 1.4, 0, null);
            }
        } catch (e) { /* тишина */ }
    },

    // Треск огня: цикл, громкость игра выставляет каждый кадр по ближайшему огню. Всегда возвращает { set, stop }.
    fireLoop() {
        const none = { set(v) {}, stop() {} };
        try {
            if (typeof Sound === 'undefined' || !Sound || typeof Sound.loop !== 'function') return none;
            if (!this._inited) this.init();
            if (!this._inited || !this._need('ga-fire')) return none;
            const h = Sound.loop('synth:ga-fire', { volume: 0 });
            let ended = false;
            return {
                set(v) {
                    if (ended) return;
                    try { h.set(Math.max(0, Math.min(1, Number(v) || 0)) * 0.9); } catch (e) { /* тишина */ }
                },
                stop() {
                    if (ended) return;
                    ended = true;
                    try { h.fade(0.25); } catch (e) { /* тишина */ }
                },
            };
        } catch (e) { return none; }
    },

    // Интерфейс: 'click' | 'select' | 'toggle'.
    ui(kind) {
        try {
            if (!this._ready()) return;
            const now = this._now();
            if (now - this._uiT < 0.03) return;
            this._uiT = now;
            const key = kind === 'select' ? 'ui-select' : kind === 'toggle' ? 'ui-toggle' : 'ui-click';
            this._playKey(key, 0.6 * this.cfg.volume, 1, 0, null);
        } catch (e) { /* тишина */ }
    },

    // Скрип дерева или стон металла от крупного тела (балка, перекрытие, секция забора): mat 'metal' — металл,
    // всё остальное — дерево; amount 0..1 — размер тела. Не чаще раза в 0.9 с на каждый вид.
    creak(mat, amount, x, y, z) {
        try {
            const a = Math.max(0, Math.min(1, Number(amount) || 0));
            if (a < 0.05 || !this._ready()) return;
            const sp = this._spatial(x, y, z, 6 + 12 * a, this.cfg.maxDist);
            if (!sp) return;
            this._creakNow(mat, a, sp, this._now(), 0);
        } catch (e) { /* тишина */ }
    },

    // Фон карты: 'lab' | 'farm' | 'suburb' | 'industrial' | 'docks' | 'city' | 'snow' | 'desert' | 'none'. Принимает и id
    // карты (см. MAP_THEME / themeFor). Тихий бесшовный цикл, плавно сменяет прежний; та же тема — ничего не делает.
    // Тема собирается синтезом в фоне (~0.2 с), фон включается, когда готов.
    ambience(theme) {
        try {
            const t = this._theme(theme);
            this._wantAmb = t;
            if (typeof Sound === 'undefined' || !Sound) return;
            if (!this._inited) this.init();
            if (!this._inited || t === this._ambTheme) return;
            this._ambTheme = t;
            const old = this._ambH;
            if (t === 'none') {
                if (old) { this._ambH = null; old.fade(2); }
                return;
            }
            this._needAsync('ga-amb-' + t, 0, () => {
                if (this._ambTheme !== t || typeof Sound.loop !== 'function') return;
                const prev = this._ambH;
                const h = Sound.loop('synth:ga-amb-' + t, { volume: 0 });
                h.set(this.cfg.ambVolume * this.AMB_LEVEL[t], null, 1.1);   // плавное нарастание (постоянная времени 1.1 с)
                this._ambH = h;
                if (prev) prev.fade(2.5);
            });
        } catch (e) { /* тишина */ }
    },

    // Тема фона карты по её id (таблица MAP_THEME); неизвестная карта — 'none'.
    themeFor(mapId) {
        return typeof mapId === 'string' && Object.prototype.hasOwnProperty.call(this.MAP_THEME, mapId) ? this.MAP_THEME[mapId] : 'none';
    },

    // Музыка: 'menu' | 'play' | 'tense' (последние 30 с раунда) | 'results' | 'none'. Плавная смена (Sound.music),
    // та же музыка — ничего не делает. Партитуры синтезируются в фоне, музыка стартует, когда буфер готов.
    // 'results' — ещё и короткая фанфара, затем спокойный пэд. Взрывы приглушают музыку (Sound.duck).
    music(kind) {
        try {
            const k = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(this.MUSIC, kind) ? kind : 'none';
            this._wantMusic = k;
            if (/** @type {any} */ (this).musicOff) return;
            if (typeof Sound === 'undefined' || !Sound) return;
            if (!this._inited) this.init();
            if (!this._inited || k === this._musicKind || typeof Sound.music !== 'function') return;
            this._musicKind = k;
            if (k === 'none') { Sound.music(null, { fade: 1.2 }); return; }
            const M = this.MUSIC[k];
            this._needAsync('ga-mus-' + k, 0, () => {
                if (this._musicKind !== k) return;
                Sound.music('synth:ga-mus-' + k, { volume: this.cfg.musicVolume * M.vol, fade: M.fade });
                if (k === 'results' || k === 'fail') {
                    const st = k === 'results' ? 'ga-mus-sting' : 'ga-mus-sting2';
                    this._needAsync(st, 0, () => {
                        if (this._musicKind === k) Sound.play(['synth:' + st], { volume: 0.7 * this.cfg.musicVolume / 0.55 });
                    });
                }
            });
        } catch (e) { /* тишина */ }
    },

    // Собрать весь синтез сразу (тесты, прогрев перед записью); обычно не нужно — идёт в фоне. withLong — ещё и
    // музыка с фоном карт (это сотни миллисекунд).
    buildAll(withLong) {
        if (!this._inited) this.init();
        for (const name of Object.keys(this._gen)) this._need(name);
        if (!withLong) return;
        for (const name of Object.keys(this._genAsync)) this._needAsync(name, 0, null, true);
    },

    // ======================================================================================
    //  Внутреннее: готовность, время, позиция, лимиты
    // ======================================================================================

    // Можно ли сейчас играть: Sound есть, звук не выключен/не на паузе, контекст уже разрешён жестом.
    _ready() {
        if (typeof Sound === 'undefined' || !Sound) return false;
        if (!this._inited) this.init();
        if (!this._inited) return false;
        if (typeof Sound.play !== 'function' || Sound.silent) return false;
        if (Sound.unlocked === false) return false;
        return true;
    },

    _now() {
        return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : Date.now()) / 1000;
    },

    _mat(m) {
        return typeof m === 'string' && Object.prototype.hasOwnProperty.call(this.IMPACT, m) ? m : 'concrete';
    },

    // Источник -> { g: громкость 0..1, pan: -1..1, d: расстояние, lp: срез НЧ-фильтра Гц (0 — без) } или null, если дальше range.
    // Без позиции (или без слушателя) — по центру, без затухания.
    _spatial(x, y, z, ref, range) {
        if (!this._hasListener || typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || !isFinite(x + y + z)) {
            return { g: 1, pan: 0, d: 0, lp: 0 };
        }
        const dx = x - this._lx, dy = y - this._ly, dz = z - this._lz;
        const dh = Math.hypot(dx, dz), d = Math.hypot(dh, dy);
        if (d >= range) return null;
        let g = d <= ref ? 1 : ref / d;
        const fs = range * 0.6;
        if (d > fs) { const u = (d - fs) / (range - fs); g *= 1 - u * u * (3 - 2 * u); }
        // проекция на «вправо»; близкий источник панорамируется слабее (иначе рывки при обходе)
        const side = dh > 1e-4 ? (dx * this._rx + dz * this._rz) / dh : 0;
        // воздух гасит верха с расстоянием: за 12 м НЧ-фильтр 14 кГц -> ~4 кГц на 40 м -> ~1.8 кГц на 90 м
        return { g, pan: side * Math.min(1, dh / 2) * 0.9, d, lp: d > 12 ? Math.max(800, 14000 / (1 + (d - 12) / 12)) : 0 };
    },

    // Бюджет звуков: токены (rate/с, не больше burst подряд); пусто — громкий вытесняет самый тихий из звучащих
    // (последние 0.3 с). Возвращает слот { t, p, hs } или null. hs — handle слоёв, чтобы вытеснить их.
    _admit(pool, prio, now, rate, burst) {
        const dt = pool.t < 0 ? 0 : Math.max(0, now - pool.t);
        pool.t = now;
        pool.tokens = Math.min(burst, pool.tokens + dt * rate);
        const rec = pool.recent;
        while (rec.length && now - rec[0].t > 0.3) rec.shift();
        if (pool.tokens >= 1) {
            pool.tokens -= 1;
            const s = { t: now, p: prio, hs: [] };
            rec.push(s);
            return s;
        }
        let q = -1;
        for (let i = 0; i < rec.length; i++) if (q < 0 || rec[i].p < rec[q].p) q = i;
        if (q >= 0 && prio > rec[q].p * 1.5 + 0.06) {
            const old = rec.splice(q, 1)[0];
            this.stat.stolen++;
            for (const h of old.hs) { try { h.fade(0.04); } catch (e) { /* уже стоит */ } }
            const s = { t: now, p: prio, hs: [] };
            rec.push(s);
            return s;
        }
        return null;
    },

    // Склеенное/одиночное разрушение материала m: считает размер по числу вокселей, бюджет, играет слои.
    _breakNow(m, b, now, cntNow) {
        const c = this.cfg;
        const total = Math.min(5000, (cntNow || 0) + b.acc);
        b.acc = 0; b.t = now;
        if (total < 1) return;
        const h = Math.max(0, Math.min(1, Math.log10(total) / 3.7));
        const sz = h < 0.3 ? 0 : h < 0.65 ? 1 : 2;
        const sp = this._spatial(b.x, b.y, b.z, 3 + 9 * h, c.maxDist * (1 + 0.4 * h));
        if (!sp) return;
        const vol = (0.3 + 0.7 * h) * sp.g * c.volume;
        if (vol < 0.02) return;
        const slot = this._admit(this._brkPool, vol, now, c.breakBudget, 4);
        if (!slot) { this.stat.limited++; return; }
        this.stat.played++;
        const rate = (1.12 - 0.35 * h) * (1 + (Math.random() - 0.5) * 0.1);
        for (const L of this.BREAK[m][sz]) this._playKey(L[0], vol * L[1], rate * L[2], sp, slot, L[3], sz === 2 ? 0.14 : 0);
    },

    // Слой -> url-ы: FILES (литералы) или синтез (собирается по требованию).
    _urls(key) {
        const f = this.FILES[key];
        if (f) return f;
        const cached = this._synUrls[key];
        if (cached) return cached;
        const names = this._syn[key];
        if (!names) return null;
        const u = this._built(names);
        if (u.length === names.length) this._synUrls[key] = u;   // полный список — в кэш; неполный (идёт сборка) — нет
        return u.length ? u : null;
    },

    // Готовые варианты синтеза из names -> url-ы. Ничего не готово — собрать ОДИН случайный сейчас (без рывка
    // на весь набор), остальные доберёт фоновая сборка.
    _built(names) {
        let u = names.filter(n => this._have[n]);
        if (!u.length) {
            const n = names[Math.floor(Math.random() * names.length)];
            if (this._need(n)) u = [n];
        }
        if (u.length < names.length && this.cfg.warmup) this._warm();
        return u.map(n => 'synth:' + n);
    },

    // Играет слой key. sp — результат _spatial (панорама и срез дальности) или число-панорама (0 — по центру);
    // delay — секунд до старта (хвосты и эхо слоями), reverb — посыл в «комнату» Sound (0..1).
    _playKey(key, vol, rate, sp, slot, delay, reverb) {
        const list = this._urls(key);
        if (!list || vol < 0.01) return null;
        /** @type {Record<string, any>} */
        const o = { volume: Math.min(1.5, vol), rate };
        if (sp && typeof sp === 'object') { o.pan = sp.pan; if (sp.lp) o.lp = sp.lp; } else o.pan = sp;
        if (delay > 0) o.delay = delay;
        if (reverb > 0 && this.cfg.reverb) o.reverb = reverb;
        const h = Sound.play(list, o);
        if (slot && h) slot.hs.push(h);
        return h;
    },

    // ======================================================================================
    //  Синтез: регистрация, сборка буферов
    // ======================================================================================

    // Порядок регистрации = порядок фоновой сборки: сначала то, что игрок услышит первым (молот, оружие, взрыв).
    _register() {
        const G = this._gen, S = this._syn, q = this._queue;
        const add = (key, names, make) => {
            S[key] = names;
            names.forEach((n, i) => { G[n] = () => make(i); q.push(n); });
        };
        const nm = (p, n) => Array.from({ length: n }, (_, i) => p + (i + 1));
        const blast = (c, far) => {
            const base = (c === 's' ? 0 : c === 'm' ? 100 : 200) + (far ? 2000 : 1000);
            nm(far ? 'ga-f-' + c : 'ga-b-' + c, far ? 2 : 3).forEach((n, i) => { G[n] = () => this._blast(c, far, base + i * 7); q.push(n); });
        };
        add('whoosh', nm('ga-whoosh', 3), i => this._whoosh('swing', 300 + i));
        add('thump', nm('ga-thump', 2), i => this._thump(400 + i));
        add('rifle', nm('ga-rifle', 3), i => this._shot('rifle', 600 + i));
        add('shotgun', nm('ga-shotgun', 3), i => this._shot('shotgun', 620 + i));
        add('launcher', nm('ga-launcher', 3), i => this._shot('launcher', 640 + i));
        blast('m', false);
        add('throw', nm('ga-throw', 2), i => this._whoosh('throw', 330 + i));
        for (const k of ['brick', 'concrete', 'rock', 'plaster']) add('clack-' + k, nm('ga-clack-' + k, 3), i => this._clack(k, 500 + i));
        for (let sz = 0; sz < 3; sz++) {
            add('crumble' + sz, [`ga-crumble-${sz}a`, `ga-crumble-${sz}b`], i => this._crumble(sz, 700 + sz * 10 + i));
            add('splint' + sz, [`ga-splint-${sz}a`, `ga-splint-${sz}b`], i => this._splinter(sz, 800 + sz * 10 + i));
            add('glass-shard' + sz, [`ga-glass-${sz}a`, `ga-glass-${sz}b`, `ga-glass-${sz}c`], i => this._shatter(sz, 900 + sz * 10 + i, [1, 0.8, 1.25][i]));
        }
        add('glass-tinkle', nm('ga-tinkle', 3), i => this._tinkle(950 + i));
        for (let sz = 0; sz < 3; sz++) {
            for (const kind of ['stone', 'wood', 'metal']) add('patter-' + kind + sz, [`ga-patter-${kind}${sz}a`, `ga-patter-${kind}${sz}b`], i => this._patter(kind, sz, 960 + sz * 10 + i));
        }
        add('creak-wood', nm('ga-creak-wood', 3), i => this._creak('wood', 980 + i));
        add('creak-metal', nm('ga-creak-metal', 3), i => this._creak('metal', 990 + i));
        blast('s', false); blast('l', false);
        blast('m', true); blast('l', true); blast('s', true);
        add('rumble', nm('ga-rumble-', 3), i => this._rumble(3000 + i * 11, false));
        add('collapse', nm('ga-collapse-', 2), i => this._rumble(3100 + i * 13, true));
        // длинный синтез — генераторы по кусочкам (_needAsync): фон карт и музыка
        for (const t of this.THEMES) this._genAsync['ga-amb-' + t] = () => this._ambGen(t);
        for (const k of ['menu', 'play', 'play2', 'play3', 'tense', 'results', 'fail', 'sting', 'sting2']) this._genAsync['ga-mus-' + k] = () => this._songGen(k);
        for (const k of ['rain', 'wind']) this._genAsync['ga-amb-' + k] = () => /** @type {any} */ (this)._weatherGen(k);
        G['ga-fire'] = () => this._fire(4000);
        q.push('ga-fire');
    },

    // Собрать буфер синтеза по имени (один раз). true — буфер лежит в Sound.
    _need(name) {
        if (this._have[name]) return true;
        if (this._bad[name]) return false;
        const g = this._gen[name];
        if (!g) return false;
        try {
            const r = g();
            const buf = Sound.makeBuffer(r.s, r.sr);
            if (buf) {
                Sound.putBuffer(name, buf);
                this._have[name] = true;
                return true;
            }
        } catch (e) { /* ниже */ }
        this._bad[name] = true;
        return false;
    },

    // Фоновая сборка по кусочкам до ~5 мс за такт (кадры не рвутся), приоритет: срочные задания (музыка и фон,
    // которые просит игра) -> эффекты -> фоновый прогрев музыки. Без setTimeout всё лениво, по первому вызову.
    _warm() {
        if (typeof setTimeout !== 'function' || this._warmTimer) return;
        if (!this._queue.length && !this._jobs.length) return;
        const step = () => {
            this._warmTimer = 0;
            const end = this._now() + 0.005;
            const urgent = () => this._jobs.find(x => x.prio === 0);
            for (let j = urgent(); j && this._now() < end; j = urgent()) this._stepJob(j, end);
            while (this._queue.length && this._now() < end) this._need(/** @type {string} */ (this._queue.shift()));
            for (let j = this._jobs[0]; j && this._now() < end; j = this._jobs[0]) this._stepJob(j, end);
            if (this._queue.length || this._jobs.length) this._warmTimer = setTimeout(step, 10);
        };
        this._warmTimer = setTimeout(step, 20);
    },

    // Фон/музыка: имя темы (или id карты) -> тема или 'none'.
    _theme(t) {
        if (typeof t !== 'string') return 'none';
        return this.THEMES.includes(t) ? t : this.themeFor(t);
    },

    // Собрать буфер name (генератор из _genAsync) по кусочкам; cb — когда готов (сразу, если уже есть).
    // prio 0 — срочно (просит игра), 1 — фоновый прогрев. sync (или нет setTimeout) — довести до конца сейчас.
    _needAsync(name, prio, cb, sync) {
        if (this._have[name]) { if (cb) cb(); return; }
        if (this._bad[name]) return;
        let job = this._jobs.find(j => j.name === name);
        if (!job) {
            const mk = this._genAsync[name];
            if (!mk) return;
            job = { name, it: mk(), prio, cbs: [] };
            this._jobs.push(job);
        } else if (prio < job.prio) job.prio = prio;
        if (cb) job.cbs.push(cb);
        if (sync || typeof setTimeout !== 'function') {
            while (this._jobs.includes(job)) this._stepJob(job, Infinity);
        } else this._warm();
    },

    // Шаг задания до дедлайна (секунды часов _now); конец — положить буфер в Sound и позвать cbs.
    _stepJob(job, deadline) {
        for (;;) {
            let r;
            try { r = job.it.next(); } catch (e) { r = { done: true, value: null }; }
            if (r.done) {
                this._jobs.splice(this._jobs.indexOf(job), 1);
                let ok = false;
                try {
                    const v = r.value, buf = v ? Sound.makeBuffer(v.s, v.sr) : null;
                    if (buf) { Sound.putBuffer(job.name, buf); this._have[job.name] = true; ok = true; }
                } catch (e) { /* ниже */ }
                if (!ok) this._bad[job.name] = true;
                else for (const cb of job.cbs) { try { cb(); } catch (e) { /* тишина */ } }
                return;
            }
            if (this._now() > deadline) return;
        }
    },

    // Скрип/стон по уже посчитанной позиции sp (a — размер 0..1, delay — с).
    _creakNow(mat, a, sp, now, delay) {
        const type = mat === 'metal' ? 'metal' : 'wood';
        if (now - (this._creakT[type] === undefined ? -9 : this._creakT[type]) < 0.9) return;
        const vol = (0.3 + 0.6 * a) * sp.g * this.cfg.volume;
        if (vol < 0.02) return;
        this._creakT[type] = now;
        this._playKey('creak-' + type, vol, (1.1 - 0.25 * a) * (1 + (Math.random() - 0.5) * 0.1), sp, null, delay, 0.2);
    },

    // ======================================================================================
    //  Синтез: инструменты
    // ======================================================================================

    // Детерминированный генератор (mulberry32): у каждого варианта своё зерно -> воспроизводимый звук.
    _rng(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },

    // Моменты событий потока с медленно меняющейся частотой rate(t) (событий/с) на [t0, t1): cb(t).
    // Шагаем по событиям, а не по отсчётам — дёшево.
    _poisson(r, t0, t1, rate, cb) {
        let t = t0;
        for (;;) {
            t -= Math.log(1 - r()) / Math.max(0.5, rate(t));
            if (t >= t1) return;
            cb(t);
        }
    },

    // Звонкий затухающий синус в buf с отсчёта i0: частота f, спад tau (с), амплитуда amp, фаза p0.
    // Вращающийся вектор: два умножения на отсчёт, без sin/exp в цикле. mul — длина в спадах tau (по умолчанию 5).
    _ping(buf, i0, sr, f, tau, amp, p0, mul) {
        const len = Math.min(buf.length - i0, Math.floor(sr * tau * (mul || 5)));
        if (len <= 0) return;
        const w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w), d = Math.exp(-1 / (sr * tau));
        let s = Math.sin(p0) * amp, c = Math.cos(p0) * amp;
        for (let k = 0; k < len; k++) {
            buf[i0 + k] += s;
            const ns = (s * cw + c * sw) * d;
            c = (c * cw - s * sw) * d;
            s = ns;
        }
    },

    // Шум длиной n, сглаженный каскадом однополюсных НЧ с срезом fc (0 — белый).
    _noise(r, n, sr, fc, passes) {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
        return fc > 0 ? this._lowpass(a, sr, fc, passes || 1) : a;
    },

    // out += tmp, нормированный: mode 'peak' — пик = w, 'rms' — RMS первых rmsN отсчётов = w.
    _addNorm(out, tmp, w, mode, rmsN) {
        let k = 0;
        if (mode === 'rms') {
            const n = Math.min(tmp.length, rmsN || tmp.length);
            let e = 0;
            for (let i = 0; i < n; i++) e += tmp[i] * tmp[i];
            k = w / Math.sqrt(e / Math.max(1, n) + 1e-12);
        } else {
            let pk = 1e-9;
            for (let i = 0; i < tmp.length; i++) { const a = Math.abs(tmp[i]); if (a > pk) pk = a; }
            k = w / pk;
        }
        const n = Math.min(out.length, tmp.length);
        for (let i = 0; i < n; i++) out[i] += tmp[i] * k;
    },

    // Финал: мягкое ограничение с нормировкой по пику, затухание хвоста (доля fade), пик -> peak.
    _finish(out, peak, fade) {
        const n = out.length;
        let pk = 1e-9;
        for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
        const drive = 1.2, norm = peak / Math.tanh(drive), k = drive / pk;
        for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * k) * norm;
        const f = Math.floor(n * fade);
        for (let i = 0; i < f; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / f);
        const f0 = Math.min(n, 24);
        for (let i = 0; i < f0; i++) out[i] *= i / f0;   // без щелчка в первом отсчёте
        return out;
    },

    // Однополюсный фильтр НЧ на месте (fc Гц), passes раз подряд: возвращает тот же массив.
    _lowpass(a, sr, fc, passes) {
        const k = 1 - Math.exp(-2 * Math.PI * fc / sr);
        for (let p = 0; p < (passes || 1); p++) {
            let l = 0;
            for (let i = 0; i < a.length; i++) { l += k * (a[i] - l); a[i] = l; }
        }
        return a;
    },

    // Эхо отражений: копия сигнала (НЧ fc) с задержками taps [[сек, усиление]…] добавляется к out.
    _echo(out, sr, fc, taps) {
        const src = this._lowpass(out.slice(), sr, fc, 1);
        for (const [d, g] of taps) {
            const ds = Math.floor(d * sr);
            for (let i = ds; i < out.length; i++) out[i] += src[i - ds] * g;
        }
    },

    // ======================================================================================
    //  Синтез: взрыв
    // ======================================================================================

    // Слои: (1) суб-удар — синус с падающей высотой ~90->30 Гц и экспоненциальным спадом (мягкое
    // ограничение даёт гармоники, слышные и на ноутбучных динамиках); (2) вспышка — шум через каскад НЧ
    // с падающим срезом; (3) «хлопок» — высокочастотный щелчок в первые миллисекунды; (4) хвост из
    // щелчков и звонких обломков с убывающей частотой; (5) длинный низкий гул (2–3 с) с дрожанием;
    // (6) отражения от построек. far — дальний вариант: темнее, без хлопка, длиннее, с широкими отражениями.
    _blast(cls, far, seed) {
        const P = this._BLAST[cls], TAU = Math.PI * 2;
        const sr = far ? 11025 : 24000, dur = P.dur * (far ? 1.4 : 1);
        const n = Math.floor(sr * dur);
        const r = this._rng(seed);
        const jit = (v, p) => v * (1 + (r() * 2 - 1) * p);
        const lpk = (fc) => 1 - Math.exp(-TAU * fc / sr);
        const att = Math.max(1, Math.floor(sr * (far ? 0.016 : 0.0025)));
        const out = new Float32Array(n);
        const half = Math.floor(sr * 0.5);

        // 1) суб-удар
        {
            const f0 = jit(P.f0, 0.1), f1 = jit(P.f1, 0.1);
            const dF = Math.exp(-1 / (sr * jit(P.fTau, 0.15))), dE = Math.exp(-1 / (sr * jit(P.thumpTau, 0.12)));
            const th = new Float32Array(n);
            let ph = 0, env = 1, fe = 1;
            for (let i = 0; i < n; i++) {
                ph += TAU * (f1 + (f0 - f1) * fe) / sr;
                th[i] = Math.tanh(1.7 * Math.sin(ph)) * env * (i < att ? i / att : 1);
                env *= dE; fe *= dF;
            }
            this._addNorm(out, th, far ? 0.8 : 1, 'peak');
        }
        // 2) вспышка: шум -> три НЧ подряд, срез падает от nFc0 к nFc1
        {
            const bl = new Float32Array(n);
            const aHi = lpk(far ? P.nFc0 * 0.2 : P.nFc0), aLo = lpk(far ? P.nFc1 * 0.55 : P.nFc1);
            const dFc = Math.exp(-1 / (sr * jit(P.nFcTau, 0.15) * (far ? 1.3 : 1)));
            const dA = Math.exp(-1 / (sr * jit(P.nTauA, 0.15))), dB = Math.exp(-1 / (sr * jit(P.nTauB, 0.15) * (far ? 1.3 : 1)));
            let fe = 1, ea = 1, eb = 1, l1 = 0, l2 = 0, l3 = 0;
            for (let i = 0; i < n; i++) {
                const a = aLo + (aHi - aLo) * fe;
                const x = r() * 2 - 1;
                l1 += a * (x - l1); l2 += a * (l1 - l2); l3 += a * (l2 - l3);
                bl[i] = l3 * (0.55 * ea + 0.45 * eb) * (i < att ? i / att : 1);
                fe *= dFc; ea *= dA; eb *= dB;
            }
            this._addNorm(out, bl, (far ? 0.6 : 0.9) * P.nw, 'rms', half);
        }
        // 3) хлопок
        if (!far) {
            const ck = new Float32Array(n), L = Math.floor(sr * 0.05), a = lpk(1500);
            const dC = Math.exp(-1 / (sr * jit(P.crackTau, 0.2)));
            let e = 1, l = 0;
            for (let i = 0; i < L; i++) { const x = r() * 2 - 1; l += a * (x - l); ck[i] = (x - l) * e; e *= dC; }
            this._addNorm(out, ck, cls === 'l' ? 0.45 : 0.6, 'peak');
        }
        // 4) хвост: щелчки и звонкие обломки, частота событий убывает
        {
            const cr = new Float32Array(n);
            const t0 = P.tailStart * (far ? 1.6 : 1), rate0 = P.crackle * (far ? 0.3 : 1), rTau = jit(P.crackTail, 0.2);
            this._poisson(r, t0, dur - 0.15, t => rate0 * Math.exp(-(t - t0) / rTau) + 6, t => {
                const i = Math.floor(t * sr);
                const amp = Math.pow(r(), 2.4) * (0.35 + 0.65 * Math.exp(-(t - t0) / 1.4));
                if (r() < 0.72) {
                    const len = Math.floor(sr * (0.0006 + r() * 0.0022));
                    let prev = 0, e = 1;
                    const d = Math.exp(-4 / len);
                    for (let k = 0; k < len && i + k < n; k++) { const x = r() * 2 - 1; cr[i + k] += (x - 0.55 * prev) * e * amp; prev = x; e *= d; }
                } else this._ping(cr, i, sr, 450 + r() * 2600, 0.004 + r() * 0.008, amp * 0.6, r() * TAU);
            });
            this._addNorm(out, cr, far ? 0.12 : 0.3, 'peak');
        }
        // 5) гул: шум через три НЧ, выровнен, затем огибающая, дрожание и мягкое ограничение (гармоники)
        {
            const rb = new Float32Array(n), a1 = lpk(far ? P.rumFc * 0.9 : P.rumFc);
            let l1 = 0, l2 = 0, l3 = 0;
            for (let i = 0; i < n; i++) { const x = r() * 2 - 1; l1 += a1 * (x - l1); l2 += a1 * (l1 - l2); l3 += a1 * (l2 - l3); rb[i] = l3; }
            let e = 0;
            for (let i = 0; i < half; i++) e += rb[i] * rb[i];
            const k = 0.5 / Math.sqrt(e / half + 1e-12);
            const w1 = TAU * (2.2 + r() * 2.5), p1 = r() * TAU, w2 = TAU * (5 + r() * 5), p2 = r() * TAU;
            const dR = Math.exp(-1 / (sr * jit(P.rumTau, 0.15) * (far ? 1.35 : 1)));
            const dRise = Math.exp(-1 / (sr * (far ? 0.28 : 0.14)));
            let env = 1, rs = 1;
            for (let i = 0; i < n; i++) {
                const t = i / sr, mod = 1 + 0.28 * Math.sin(w1 * t + p1) + 0.14 * Math.sin(w2 * t + p2);
                rb[i] = Math.tanh(rb[i] * k * 2.2) * env * mod * (1 - rs);
                env *= dR; rs *= dRise;
            }
            this._addNorm(out, rb, far ? 0.85 : 0.6, 'peak');
        }
        // 6) отражения
        if (far) this._echo(out, sr, 700, [[0.29, 0.3], [0.58, 0.22], [0.93, 0.14]]);
        else this._echo(out, sr, 1400, [[0.13 + r() * 0.05, 0.3], [0.27 + r() * 0.07, 0.2], [0.46 + r() * 0.08, 0.12]]);
        if (far) this._lowpass(out, sr, 1100, 2);
        return { s: this._finish(out, 0.95, 0.12), sr };
    },

    // Гул обвала: низкий шум с дрожанием и «глухими камнями» (затухающие низкие синусы), без хлопка.
    _rumble(seed, big) {
        const sr = 11025, TAU = Math.PI * 2, r = this._rng(seed);
        const dur = big ? 6 + r() * 1.2 : 3.6 + r() * 0.8, n = Math.floor(sr * dur);
        const out = new Float32Array(n);
        const rb = this._noise(r, n, sr, 85, 3);
        const w1 = TAU * (1.4 + r() * 1.6), p1 = r() * TAU, w2 = TAU * (4 + r() * 4), p2 = r() * TAU;
        const dE = Math.exp(-1 / (sr * (big ? 3.1 : 1.9))), dRise = Math.exp(-1 / (sr * 0.3));
        let env = 1, rs = 1;
        for (let i = 0; i < n; i++) {
            const t = i / sr;
            rb[i] *= env * (1 + 0.3 * Math.sin(w1 * t + p1) + 0.15 * Math.sin(w2 * t + p2)) * (1 - rs);
            env *= dE; rs *= dRise;
        }
        this._addNorm(out, rb, 0.6, 'peak');
        // глухие камни: события с убывающей частотой
        const st = new Float32Array(n);
        this._poisson(r, 0.2, dur - 0.4, t => (big ? 16 : 11) * Math.exp(-t / (big ? 2.8 : 1.6)) + 1.5, t => {
            this._ping(st, Math.floor(t * sr), sr, 42 + r() * 75, 0.025, Math.pow(r(), 1.8), r() * TAU);
        });
        this._addNorm(out, st, big ? 0.35 : 0.3, 'peak');
        // большой обвал: тяжёлые плиты бьют об землю — глухие удары-«бум» с провалом высоты
        if (big) {
            const sl = new Float32Array(n);
            const slabs = 4 + Math.floor(r() * 3);
            for (let k = 0; k < slabs; k++) {
                const i0 = Math.floor(sr * (0.1 + (dur - 1.6) * Math.pow(r(), 1.3))), f0 = 70 + r() * 40, len = Math.min(n - i0, Math.floor(sr * 0.5));
                let ph = 0, e = 0.5 + 0.5 * r();
                const d = Math.exp(-1 / (sr * 0.12));
                for (let i = 0; i < len; i++) { ph += TAU * (34 + (f0 - 34) * Math.exp(-i / (sr * 0.05))) / sr; sl[i0 + i] += Math.tanh(1.8 * Math.sin(ph)) * e; e *= d; }
            }
            this._addNorm(out, sl, 0.55, 'peak');
        }
        // песок и мелочь: шум 600 Гц по той же огибающей
        const gr = this._noise(r, n, sr, 600, 1);
        env = 1; rs = 1;
        const dRise2 = Math.exp(-1 / (sr * 0.4));
        for (let i = 0; i < n; i++) { gr[i] *= env * (1 - rs); env *= dE; rs *= dRise2; }
        this._addNorm(out, gr, 0.03, 'rms', Math.floor(sr * 1.5));
        for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.3);
        return { s: this._finish(out, 0.9, 0.15), sr };
    },

    // ======================================================================================
    //  Синтез: разрушение (стекло, камень, дерево), «зерно» ударов, молот, выстрелы, огонь
    // ======================================================================================

    // Стекло: хлопок + осколки (затухающие синусы 2.4–9 кГц) с убывающей частотой событий + лёгкое шипение.
    _shatter(size, seed, tone) {
        const sr = 24000, TAU = Math.PI * 2, r = this._rng(seed);
        const dur = [0.55, 0.95, 1.6][size], N = [26, 55, 110][size];
        const n = Math.floor(sr * dur), out = new Float32Array(n);
        // хлопок: ВЧ-шум и низкий «хруст» полотна
        const ck = new Float32Array(n), a = 1 - Math.exp(-TAU * 2200 / sr), L = Math.floor(sr * 0.04);
        let l = 0;
        for (let i = 0; i < L; i++) { const x = r() * 2 - 1; l += a * (x - l); ck[i] = (x - l) * Math.exp(-i / (sr * 0.007)); }
        this._addNorm(out, ck, 0.6, 'peak');
        const lo = new Float32Array(n), a2 = 1 - Math.exp(-TAU * 1500 / sr), a3 = 1 - Math.exp(-TAU * 500 / sr), L2 = Math.floor(sr * (0.04 + 0.03 * size));
        let u = 0, v = 0;
        for (let i = 0; i < L2; i++) {
            const x = r() * 2 - 1; u += a2 * (x - u); v += a3 * (u - v);
            lo[i] = (u - v) * Math.exp(-i / (sr * (0.012 + 0.01 * size)));
        }
        this._addNorm(out, lo, 0.35 + 0.1 * size, 'peak');
        // осколки
        const sh = new Float32Array(n);
        for (let k = 0; k < N; k++) {
            const t = dur * 0.85 * Math.pow(r(), 1.7);
            const f = Math.exp(Math.log(2400) + r() * (Math.log(9000) - Math.log(2400))) * (tone || 1);
            const tau = (0.006 + 0.03 * r()) * Math.sqrt(4000 / f);
            const amp = (0.15 + 0.85 * r() * r()) * (1 - 0.6 * t / dur), i0 = Math.floor(t * sr);
            this._ping(sh, i0, sr, f, tau, amp, r() * TAU);
            this._ping(sh, i0, sr, f * (1.5 + 0.9 * r()), tau * 0.7, amp * 0.4, r() * TAU);
        }
        this._addNorm(out, sh, 0.9, 'peak');
        // шипение осыпающегося стекла: полоса 3–7 кГц
        const hs = this._noise(r, n, sr, 7000, 1), a4 = 1 - Math.exp(-TAU * 3000 / sr);
        let p = 0;
        for (let i = 0; i < n; i++) { p += a4 * (hs[i] - p); hs[i] = (hs[i] - p) * Math.exp(-i / (sr * dur * 0.25)); }
        this._addNorm(out, hs, 0.035, 'rms', Math.floor(sr * 0.3));
        return { s: this._finish(out, 0.9, 0.1), sr };
    },

    // Крошево камня/кирпича/бетона: зерно — частые мелкие щелчки (шум 2 кГц + резонанс 200–1900 Гц), пыль, глухой удар.
    _crumble(size, seed) {
        const sr = 22050, TAU = Math.PI * 2, r = this._rng(seed);
        const dur = [0.45, 1.0, 1.9][size], n = Math.floor(sr * dur), out = new Float32Array(n);
        const sn = this._noise(r, n, sr, 2200, 1);
        const gr = new Float32Array(n), rate0 = [70, 120, 170][size], tauR = dur / 2.4;
        this._poisson(r, 0, dur - 0.03, t => rate0 * Math.exp(-t / tauR) + 8, t => {
            const i = Math.floor(t * sr);
            const amp = Math.pow(r(), 2.8) * (0.3 + 0.7 * Math.exp(-t / (dur * 0.5)));
            const fc = 220 + Math.pow(r(), 1.6) * 1700, tau = 0.003 + 0.014 * (1 - fc / 1920) * r();
            const len = Math.min(n - i, Math.floor(sr * tau * 4)), d = Math.exp(-1 / (sr * tau));
            let e = amp;
            for (let k = 0; k < len; k++) { gr[i + k] += sn[i + k] * e; e *= d; }
            this._ping(gr, i, sr, fc, tau, amp * 0.9, r() * TAU);
        });
        this._addNorm(out, gr, 0.8, 'peak');
        // пыль: НЧ-шум 900 Гц
        const du = this._noise(r, n, sr, 900, 1);
        for (let i = 0; i < n; i++) du[i] *= Math.exp(-i / (sr * dur * 0.32));
        this._addNorm(out, du, 0.12, 'rms', Math.floor(sr * 0.3));
        // глухой удар крупного куска
        if (size >= 1) {
            const th = new Float32Array(n), L = Math.floor(sr * 0.12);
            let ph = 0;
            for (let i = 0; i < L; i++) { ph += TAU * (55 + 90 * Math.exp(-i / (sr * 0.03))) / sr; th[i] = Math.sin(ph) * Math.exp(-i / (sr * 0.045)); }
            this._addNorm(out, th, 0.3 + 0.15 * size, 'peak');
        }
        return { s: this._finish(out, 0.9, 0.12), sr };
    },

    // Щепа: сухой треск (полоса 0.7–4 кГц), «тонк» дерева, потом редкие яркие щелчки и звонкие щепки.
    _splinter(size, seed) {
        const sr = 24000, TAU = Math.PI * 2, r = this._rng(seed);
        const dur = [0.3, 0.6, 1.0][size], n = Math.floor(sr * dur), out = new Float32Array(n);
        const ck = new Float32Array(n), ah = 1 - Math.exp(-TAU * 700 / sr), al = 1 - Math.exp(-TAU * 4000 / sr), L = Math.floor(sr * 0.05);
        let h = 0, l = 0;
        for (let i = 0; i < L; i++) { const x = r() * 2 - 1; h += ah * (x - h); l += al * ((x - h) - l); ck[i] = l * Math.exp(-i / (sr * 0.008)); }
        this._addNorm(out, ck, 1, 'peak');
        const tk = new Float32Array(n), f = 180 + r() * 240 - size * 30, tau = 0.025 + 0.01 * size;
        this._ping(tk, 0, sr, f, tau, 1, 0);
        this._ping(tk, 0, sr, f * 1.9, tau * 0.8, 0.5, 0);
        this._addNorm(out, tk, 0.6 + 0.1 * size, 'peak');
        const sp = new Float32Array(n), rate0 = [30, 60, 90][size];
        this._poisson(r, 0.05, dur - 0.05, t => rate0 * Math.exp(-t / (dur * 0.4)) + 3, t => {
            const i = Math.floor(t * sr), amp = Math.pow(r(), 1.6);
            if (r() < 0.6) {
                const len = Math.floor(sr * (0.001 + r() * 0.003));
                for (let k = 0; k < len && i + k < n; k++) sp[i + k] += (r() * 2 - 1) * Math.exp(-4 * k / len) * amp;
            } else this._ping(sp, i, sr, 900 + r() * 1500, 0.003 + r() * 0.004, amp * 0.7, r() * TAU);
        });
        this._addNorm(out, sp, 0.45, 'peak');
        return { s: this._finish(out, 0.9, 0.1), sr };
    },

    // «Зерно» удара твёрдого обломка: 9 неравномерных мод (без ясной высоты), шум-щелчок и глухой толчок.
    // Свойства по материалу: высота мод, спад, доля шума и толчка.
    _clack(kind, seed) {
        const sr = 22050, TAU = Math.PI * 2, r = this._rng(seed);
        const T = {
            brick: { f: 1100, d: 0.016, nz: 0.55, th: 0.5 },
            concrete: { f: 650, d: 0.026, nz: 0.6, th: 0.7 },
            rock: { f: 1800, d: 0.013, nz: 0.35, th: 0.3 },
            plaster: { f: 420, d: 0.01, nz: 0.9, th: 0.4 },
        }[kind];
        const n = Math.floor(sr * 0.22), out = new Float32Array(n);
        const f0 = T.f * (0.85 + r() * 0.3), md = new Float32Array(n);
        for (let m = 0; m < 9; m++) this._ping(md, 0, sr, f0 * (0.8 + 3.4 * r()), T.d * (0.4 + 0.9 * r()), 1 - m * 0.08, r() * TAU);
        this._addNorm(out, md, 1 - 0.3 * T.nz, 'peak');
        const nz = new Float32Array(n), a = 1 - Math.exp(-TAU * 1000 / sr);
        let l = 0;
        for (let i = 0; i < n; i++) { const x = r() * 2 - 1; l += a * (x - l); nz[i] = (x - l) * Math.exp(-i / (sr * (0.004 + 0.006 * T.nz))); }
        this._addNorm(out, nz, T.nz, 'peak');
        const th = new Float32Array(n), L = Math.floor(sr * 0.1);
        let ph = 0;
        for (let i = 0; i < L; i++) { ph += TAU * (f0 / 7 + 60 * Math.exp(-i / (sr * 0.02))) / sr; th[i] = Math.sin(ph) * Math.exp(-i / (sr * 0.03)); }
        this._addNorm(out, th, T.th, 'peak');
        return { s: this._finish(out, 0.9, 0.12), sr };
    },

    // Свист молота / броска: шум через полосовой фильтр (Chamberlin SVF), центр частоты и громкость идут по колоколу.
    _whoosh(kind, seed) {
        const sr = 22050, r = this._rng(seed), throwy = kind === 'throw';
        const n = Math.floor(sr * (throwy ? 0.32 : 0.46)), out = new Float32Array(n);
        const fA = (throwy ? 500 : 280) * (0.9 + r() * 0.2), fB = (throwy ? 2600 : 1700) * (0.9 + r() * 0.2), q = 1 / (throwy ? 1.5 : 1.1);
        const aLp = 1 - Math.exp(-2 * Math.PI * 220 / sr);
        let low = 0, band = 0, lp = 0;
        for (let i = 0; i < n; i++) {
            const u = i / n, e = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 1.7);
            const f = 2 * Math.sin(Math.PI * Math.min(0.45, (fA + (fB - fA) * Math.pow(e, 0.6)) / sr));
            const x = r() * 2 - 1;
            low += f * band;
            const high = x - low - q * band;
            band += f * high;
            lp += aLp * (x - lp);
            out[i] = (band * 0.9 + lp * 1.6) * e;
        }
        return { s: this._finish(out, 0.9, 0.08), sr };
    },

    // Глухой «бум» для тяжёлых ударов: синус 130->48 Гц, быстрый спад, мягкое ограничение.
    _thump(seed) {
        const sr = 11025, TAU = Math.PI * 2, r = this._rng(seed);
        const n = Math.floor(sr * 0.4), out = new Float32Array(n);
        const f0 = 130 * (0.92 + r() * 0.16);
        let ph = 0;
        for (let i = 0; i < n; i++) {
            ph += TAU * (48 + (f0 - 48) * Math.exp(-i / (sr * 0.04))) / sr;
            out[i] = Math.tanh(1.8 * Math.sin(ph)) * Math.exp(-i / (sr * 0.09)) * (i < 12 ? i / 12 : 1);
        }
        return { s: this._finish(out, 0.9, 0.1), sr };
    },

    // Выстрелы: хлопок (ВЧ), тело (шум НЧ), суб-удар, хвост и эхо. rifle — сухой, shotgun — тяжелее и длиннее,
    // launcher — глухое «пум» трубы и шипение ракеты.
    _shot(kind, seed) {
        const sr = 24000, TAU = Math.PI * 2, r = this._rng(seed);
        const P = {
            rifle: { dur: 0.55, ct: 0.004, ca: 1, bf: 3200, bt: 0.03, ba: 0.8, f0: 260, f1: 90, tt: 0.045, ta: 0.7, tf: 900, tl: 0.16, tla: 0.3, echo: [[0.085, 0.22], [0.19, 0.12]] },
            shotgun: { dur: 0.85, ct: 0.006, ca: 1, bf: 2200, bt: 0.06, ba: 1, f0: 170, f1: 55, tt: 0.09, ta: 1, tf: 700, tl: 0.3, tla: 0.4, echo: [[0.11, 0.28], [0.24, 0.18], [0.4, 0.1]] },
            launcher: { dur: 1.35, ct: 0.003, ca: 0.45, bf: 1100, bt: 0.09, ba: 0.7, f0: 120, f1: 40, tt: 0.2, ta: 1, tf: 500, tl: 0.35, tla: 0.25, echo: [[0.15, 0.2], [0.33, 0.1]] },
        }[kind];
        const n = Math.floor(sr * P.dur), out = new Float32Array(n);
        const jit = (v, p) => v * (1 + (r() * 2 - 1) * p);
        // хлопок
        const ck = new Float32Array(n), ac = 1 - Math.exp(-TAU * 1800 / sr), cl = Math.floor(sr * 0.04);
        let l = 0;
        for (let i = 0; i < cl; i++) { const x = r() * 2 - 1; l += ac * (x - l); ck[i] = (x - l) * Math.exp(-i / (sr * jit(P.ct, 0.2))); }
        this._addNorm(out, ck, P.ca, 'peak');
        // тело: шум через НЧ с падающим срезом
        const bd = new Float32Array(n);
        let l1 = 0, l2 = 0, fe = 1, eb = 1;
        const dFe = Math.exp(-1 / (sr * 0.05)), dB = Math.exp(-1 / (sr * jit(P.bt, 0.15)));
        for (let i = 0; i < n; i++) {
            const a = 1 - Math.exp(-TAU * (P.bf * (0.25 + 0.75 * fe)) / sr);
            const x = r() * 2 - 1;
            l1 += a * (x - l1); l2 += a * (l1 - l2);
            bd[i] = l2 * eb;
            fe *= dFe; eb *= dB;
        }
        this._addNorm(out, bd, P.ba, 'rms', Math.floor(sr * 0.1));
        // суб-удар
        const th = new Float32Array(n);
        let ph = 0, ft = 1, et = 1;
        const dFt = Math.exp(-1 / (sr * 0.03)), dT = Math.exp(-1 / (sr * jit(P.tt, 0.15)));
        for (let i = 0; i < n; i++) {
            ph += TAU * (P.f1 + (P.f0 - P.f1) * ft) / sr;
            th[i] = Math.tanh(1.5 * Math.sin(ph)) * et * (i < 40 ? i / 40 : 1);
            ft *= dFt; et *= dT;
        }
        this._addNorm(out, th, P.ta, 'peak');
        // хвост
        const tl = this._noise(r, n, sr, P.tf, 2);
        for (let i = 0; i < n; i++) tl[i] *= Math.exp(-i / (sr * P.tl)) * (1 - Math.exp(-i / (sr * 0.01)));
        this._addNorm(out, tl, P.tla, 'rms', Math.floor(sr * 0.2));
        // ракета: шипение 0.8–3 кГц, нарастает после выхода из трубы и гаснет
        if (kind === 'launcher') {
            const hs = this._noise(r, n, sr, 3000, 1), ah = 1 - Math.exp(-TAU * 800 / sr);
            let h = 0;
            for (let i = 0; i < n; i++) {
                const t = i / sr;
                h += ah * (hs[i] - h);
                hs[i] = (hs[i] - h) * (1 - Math.exp(-t / 0.08)) * Math.exp(-t / 0.5);
            }
            this._addNorm(out, hs, 0.14, 'rms', Math.floor(sr * 0.6));
        }
        this._echo(out, sr, 1600, P.echo);
        return { s: this._finish(out, 0.95, 0.1), sr };
    },

    // Огонь: ровный цикл 4 с — НЧ-гул с медленным дрожанием, шипение пламени с мерцанием и треск (мелкие щелчки
    // и редкие «лопания»), пачками. Шов цикла сглажен равномощным перекрытием хвоста с началом.
    _fire(seed) {
        const sr = 22050, TAU = Math.PI * 2, r = this._rng(seed);
        const N = Math.floor(sr * 4), X = Math.floor(sr * 0.5), n = N + X, dur = n / sr;
        const out = new Float32Array(n);
        // гул
        const ro = this._noise(r, n, sr, 260, 2), aM = 1 - Math.exp(-TAU * 1.3 / sr);
        let m = 0;
        for (let i = 0; i < n; i++) { m += aM * ((r() * 2 - 1) - m); ro[i] *= Math.max(0.2, 1 + 5 * m); }
        this._addNorm(out, ro, 0.09, 'rms');
        // шипение пламени: 2.5–8 кГц, мерцает
        const hs = this._noise(r, n, sr, 8000, 1), ah = 1 - Math.exp(-TAU * 2500 / sr), aF = 1 - Math.exp(-TAU * 7 / sr);
        let h = 0, fl = 0;
        for (let i = 0; i < n; i++) {
            h += ah * (hs[i] - h);
            fl += aF * ((r() * 2 - 1) - fl);
            hs[i] = (hs[i] - h) * Math.max(0.1, 0.6 + 3.5 * fl);
        }
        this._addNorm(out, hs, 0.03, 'rms');
        // треск: события пачками (медленная «активность»), тихие щелчки и редкие громкие «лопания»
        const cr = new Float32Array(n), p1 = r() * TAU, p2 = r() * TAU;
        this._poisson(r, 0, dur - 0.05, t => 20 * (0.35 + 1.5 * Math.max(0, Math.sin(TAU * 0.7 * t + p1) * Math.sin(TAU * 1.3 * t + p2))), t => {
            const i = Math.floor(t * sr), big = r() < 0.1, amp = big ? 0.6 + 0.4 * r() : Math.pow(r(), 1.7) * 0.5;
            if (big || r() < 0.3) {
                const tau = 0.003 + r() * 0.006, len = Math.min(n - i, Math.floor(sr * tau * 5));
                this._ping(cr, i, sr, 300 + r() * 700, tau * 1.5, amp * 0.5, r() * TAU);
                const d = Math.exp(-1 / (sr * tau));
                let e = amp * 0.5;
                for (let k = 0; k < len; k++) { cr[i + k] += (r() * 2 - 1) * e; e *= d; }
            } else {
                const len = Math.min(n - i, Math.floor(sr * (0.0006 + r() * 0.0035))), d = Math.exp(-4 / Math.max(1, len));
                let prev = 0, e = amp;
                for (let k = 0; k < len; k++) { const x = r() * 2 - 1; cr[i + k] += (x - 0.5 * prev) * e; prev = x; e *= d; }
            }
        });
        this._addNorm(out, cr, 1, 'peak');
        // цикл: хвост [N, N+X) плавно переходит в начало [0, X)
        const loop = new Float32Array(N);
        for (let i = 0; i < N; i++) loop[i] = out[i];
        for (let i = 0; i < X; i++) {
            const w = i / X;
            loop[i] = out[i] * Math.sin(w * Math.PI / 2) + out[N + i] * Math.cos(w * Math.PI / 2);
        }
        let pk = 1e-9;
        for (let i = 0; i < N; i++) { const a = Math.abs(loop[i]); if (a > pk) pk = a; }
        for (let i = 0; i < N; i++) loop[i] = loop[i] / pk * 0.85;
        return { s: loop, sr };
    },

    // ======================================================================================
    //  Синтез: стекло-хвост, дробь обломков, скрип дерева и стон металла
    // ======================================================================================

    // Звенящий хвост стекла: редкие высокие осколки (2.8–10 кГц) с долгим затуханием, изредка чистый «звон» куска.
    _tinkle(seed) {
        const sr = 24000, TAU = Math.PI * 2, r = this._rng(seed);
        const dur = 1.5 + r() * 0.7, n = Math.floor(sr * dur), out = new Float32Array(n);
        this._poisson(r, 0.02, dur - 0.3, t => 38 * Math.exp(-t / 0.55) + 4, t => {
            const i = Math.floor(t * sr), f = Math.exp(Math.log(2800) + r() * (Math.log(10500) - Math.log(2800)));
            const tau = (0.02 + 0.07 * r()) * Math.sqrt(4000 / f), amp = Math.pow(r(), 1.8) * (0.4 + 0.6 * Math.exp(-t / 0.7));
            this._ping(out, i, sr, f, tau, amp, r() * TAU);
            if (r() < 0.5) this._ping(out, i, sr, f * (1.7 + 0.7 * r()), tau * 0.6, amp * 0.35, r() * TAU);
            if (r() < 0.06) this._ping(out, i, sr, 2200 + r() * 1800, 0.25 + 0.2 * r(), amp * 0.5 + 0.2, 1.2);   // чистый звон куска
        });
        return { s: this._finish(out, 0.85, 0.2), sr };
    },

    // Дробь мелких обломков: много отдельных падений, частота убывает. kind: stone | wood | metal; size 0..2.
    _patter(kind, size, seed) {
        const sr = 22050, TAU = Math.PI * 2, r = this._rng(seed);
        const dur = [0.9, 1.7, 2.8][size], n = Math.floor(sr * dur), out = new Float32Array(n);
        const rate0 = [50, 75, 100][size] * (kind === 'metal' ? 0.5 : 1);
        this._poisson(r, 0, dur - 0.15, t => rate0 * Math.exp(-t / (dur * 0.45)) + 2, t => {
            const i = Math.floor(t * sr), amp = Math.pow(r(), 2.2) * (0.35 + 0.65 * Math.exp(-t / (dur * 0.6)));
            if (kind === 'wood') {
                const f = 250 + r() * 850, tau = 0.012 + 0.02 * r();
                this._ping(out, i, sr, f, tau, amp, 1.2);
                this._ping(out, i, sr, f * (1.6 + 0.8 * r()), tau * 0.6, amp * 0.4, 1.2);
            } else if (kind === 'metal') {
                const f = 900 + Math.pow(r(), 1.5) * 3300, tau = 0.05 + 0.2 * r();
                this._ping(out, i, sr, f, tau, amp, 1.2);
                this._ping(out, i, sr, f * 2.76, tau * 0.5, amp * 0.4, 1.2);
            } else {
                const f = Math.exp(Math.log(300) + r() * (Math.log(2600) - Math.log(300))), tau = (0.004 + 0.014 * r()) * Math.pow(2600 / f, 0.3);
                this._ping(out, i, sr, f, tau, amp, 1.2);
                const len = Math.min(n - i, Math.floor(sr * 0.002));
                for (let k = 0; k < len; k++) out[i + k] += (r() * 2 - 1) * amp * 0.5 * (1 - k / len);
                if (r() < 0.08) this._ping(out, i, sr, 90 + r() * 90, 0.04, amp * 0.9 + 0.1, 1.2);     // кусок покрупнее глухо стукнул
            }
        });
        return { s: this._finish(out, 0.9, 0.2), sr };
    },

    // Скрип дерева (wood): трение «прилип-скользнул» — неровная серия импульсов через резонанс 0.5–1.1 кГц, 2–3 нажатия.
    // Стон металла (metal): низкие неточные обертоны 60–110 Гц с плавающей высотой, колебаниями и «потрескиванием».
    _creak(kind, seed) {
        const sr = 16000, TAU = Math.PI * 2, r = this._rng(seed), wood = kind === 'wood';
        const dur = wood ? 1.0 + r() * 1.3 : 1.8 + r() * 1.4, n = Math.floor(sr * dur), out = new Float32Array(n);
        const env = new Float32Array(n), sw = wood ? 2 + Math.floor(r() * 2) : 1;
        for (let k = 0; k < sw; k++) {
            const c = wood ? dur * (0.15 + 0.7 * r()) : dur * 0.45, w = wood ? 0.15 + 0.3 * r() : dur * 0.3, amp = wood ? 0.6 + 0.4 * r() : 1;
            for (let i = 0; i < n; i++) { const u = (i / sr - c) / w; if (u > -3 && u < 3) env[i] += amp * Math.exp(-u * u); }
        }
        const sl = this._slow(r, n, sr, wood ? 3 : 0.8);
        if (wood) {
            let ph = 0, low = 0, band = 0;
            const q = 1 / 9, base = 24 + r() * 30;
            for (let i = 0; i < n; i++) {
                const e = env[i];
                ph += base * (0.6 + 0.9 * Math.min(1.5, e)) * (1 + 0.25 * sl[i]) / sr;
                let x = 0;
                if (ph >= 1) { ph -= 1; x = 0.5 + 0.5 * r(); }
                x += (r() * 2 - 1) * 0.05 * e;
                const fc = 520 + 260 * sl[i] + 380 * Math.min(1, e), f = 2 * Math.sin(Math.PI * Math.min(0.4, fc / sr));
                low += f * band;
                const high = x - low - q * band;
                band += f * high;
                out[i] = band * Math.min(1, e);
            }
        } else {
            const base = 62 + r() * 50, ratios = [1, 2.003, 3.01, 4.16, 5.43, 6.8], amps = [1, 0.75, 0.5, 0.33, 0.2, 0.12];
            const ph = ratios.map(() => r() * TAU), lf = ratios.map(() => TAU * (0.3 + r())), lp = ratios.map(() => r() * TAU);
            for (let i = 0; i < n; i++) {
                const t = i / sr, f0 = base * (1 + 0.06 * sl[i] + 0.025 * Math.sin(TAU * 5.5 * t));
                let v = 0;
                for (let k = 0; k < 6; k++) { ph[k] += TAU * f0 * ratios[k] / sr; v += Math.sin(ph[k]) * amps[k] * (0.6 + 0.4 * Math.sin(lf[k] * t + lp[k])); }
                out[i] = v * Math.min(1, env[i]);
            }
            // резонанс ползёт 250 -> 650 Гц: стон «проходит» через конструкцию
            let low = 0, band = 0;
            const q = 1 / 2.5;
            for (let i = 0; i < n; i++) {
                const f = 2 * Math.sin(Math.PI * (250 + 400 * i / n) / sr), x = out[i];
                low += f * band;
                const high = x - low - q * band;
                band += f * high;
                out[i] = 0.55 * x + 1.2 * band;
            }
            // потрескивание напряжённого металла
            const pops = new Float32Array(n);
            this._poisson(r, 0.1, dur - 0.1, t => 3 + 6 * env[Math.floor(t * sr)], t => this._ping(pops, Math.floor(t * sr), sr, 1100 + r() * 1700, 0.012, 0.25 + 0.25 * r(), 1.2));
            this._addNorm(out, pops, 0.35, 'peak');
            for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.4);
        }
        const fin = this._finish(out, 0.9, 0.12);
        if (!wood) for (let i = 0; i < n; i++) fin[i] *= 0.5;   // стон — густой, RMS вдвое выше остальных: приглушить
        return { s: fin, sr };
    },

    // ======================================================================================
    //  Фон карт: бесшовные циклы 16–24 с (синтез генератором по кусочкам)
    // ======================================================================================

    // Гладкий случайный сигнал: шум через НЧ fc Гц, выровнен до std = 1. Считается на пониженной частоте
    // (в 40 раз выше fc) и растягивается линейной интерполяцией — на порядок дешевле, чем на полной.
    _slow(r, n, sr, fc) {
        const dec = Math.max(1, Math.floor(sr / (fc * 40))), m = Math.ceil(n / dec) + 2, a = this._noise(r, m, sr / dec, fc, 2);
        let e = 0;
        for (let i = 0; i < m; i++) e += a[i] * a[i];
        const k = 1 / Math.sqrt(e / m + 1e-12), out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const j = Math.floor(i / dec), f = i / dec - j;
            out[i] = (a[j] * (1 - f) + a[j + 1] * f) * k;
        }
        return out;
    },

    // Сумма синусов parts [[частота, амплитуда, фаза]] в buf[0..N) с общим «дыханием» громкости (fl Гц, глубина dp):
    // вращающиеся векторы вместо sin на каждый отсчёт. Частоты кратны 1/длина цикла — шов не слышен.
    _hum(buf, N, sr, parts, fl, dp) {
        const TAU = Math.PI * 2, P = parts.map(([f, a, p0]) => ({ cw: Math.cos(TAU * f / sr), sw: Math.sin(TAU * f / sr), s: Math.sin(p0), c: Math.cos(p0), a }));
        const fcw = Math.cos(TAU * fl / sr), fsw = Math.sin(TAU * fl / sr);
        let fs = 0, fc = 1;
        for (let i = 0; i < N; i++) {
            let v = 0;
            for (let k = 0; k < P.length; k++) {
                const o = P[k], ns = o.s * o.cw + o.c * o.sw;
                o.c = o.c * o.cw - o.s * o.sw; o.s = ns;
                v += ns * o.a;
            }
            buf[i] += v * (1 + dp * fs);
            const nfs = fs * fcw + fc * fsw;
            fc = fc * fcw - fs * fsw; fs = nfs;
        }
    },

    // Цикл длиной N из заготовки N+X: хвост [N, N+X) равномощно перетекает в начало [0, X) (для шума).
    _loopify(src, N, X) {
        const loop = new Float32Array(N);
        for (let i = 0; i < N; i++) loop[i] = src[i];
        for (let i = 0; i < X; i++) { const w = i / X; loop[i] = src[i] * Math.sin(w * Math.PI / 2) + src[N + i] * Math.cos(w * Math.PI / 2); }
        return loop;
    },

    // Ветер: шум через полосовой фильтр (SVF), центр плавает f0..f1 по «порывам» (gust Гц), глубина порывов depth 0..1.
    _windBand(r, n, sr, f0, f1, q, gust, depth) {
        const m1 = this._slow(r, n, sr, gust), m2 = this._slow(r, n, sr, gust * 2.7), out = new Float32Array(n);
        const qd = 1 / q;
        let low = 0, band = 0;
        let f = 0;
        for (let i = 0; i < n; i++) {
            if ((i & 7) === 0) f = 2 * Math.sin(Math.PI * Math.min(0.4, (f0 + (f1 - f0) * Math.min(1, Math.max(0, 0.5 + 0.3 * m1[i]))) / sr));
            low += f * band;
            const high = (r() * 2 - 1) - low - qd * band;
            band += f * high;
            out[i] = band * Math.max(0.25, 1 - depth + depth * (0.5 + 0.35 * m2[i] + 0.25 * m1[i]) * 1.4);
        }
        return out;
    },

    // Свист птицы в buf с отсчёта i0: частота f0 -> f1 за dur секунд, огибающая «колокол», vib — глубина дрожания Гц.
    _chirp(buf, i0, sr, f0, f1, dur, amp, vib) {
        const len = Math.min(buf.length - i0, Math.floor(sr * dur));
        let ph = 0;
        for (let k = 0; k < len; k++) {
            const u = k / len;
            ph += 2 * Math.PI * (f0 + (f1 - f0) * u + (vib ? vib * Math.sin(2 * Math.PI * 38 * k / sr) : 0)) / sr;
            buf[i0 + k] += Math.sin(ph) * Math.pow(Math.sin(Math.PI * u), 1.5) * amp;
        }
    },

    // Птичий напев с времени t (с): 'a' — «цви-цви-цви», 'b' — двухтонный свист, 'c' — трель.
    _bird(buf, sr, t, kind, amp, r) {
        const i0 = Math.floor(t * sr);
        if (kind === 'a') {
            const cnt = 3 + Math.floor(r() * 3), f = 3600 + r() * 300;
            for (let j = 0; j < cnt; j++) this._chirp(buf, i0 + Math.floor(j * 0.12 * sr), sr, f, f + 1300, 0.07, amp * (1 - 0.12 * j), 0);
        } else if (kind === 'b') {
            this._chirp(buf, i0, sr, 2700, 2300, 0.2, amp, 0);
            this._chirp(buf, i0 + Math.floor(0.26 * sr), sr, 2000, 2500, 0.24, amp * 0.9, 0);
        } else {
            for (let j = 0; j < 9; j++) this._chirp(buf, i0 + Math.floor(j * 0.065 * sr), sr, 3300 + j * 25, 3700 + j * 25, 0.05, amp * 0.8, 120);
        }
    },

    // Звук одного фона: слои шума -> цикл, затем тональные слои и события (с частотами кратными 1/длина цикла, чтобы
    // шов не слышался). Уровень цикла выровнен по слышимой части (см. ниже), события заданы относительно него.
    *_ambGen(theme) {
        const sr = 16000, TAU = Math.PI * 2;
        const LEN = { lab: 16, farm: 20, suburb: 20, industrial: 20, docks: 24, city: 24, snow: 20, desert: 20 }[theme] || 20;
        const N = sr * LEN, X = Math.floor(sr * 1.5), n = N + X;
        const r = this._rng(5000 + theme.charCodeAt(0) * 17 + theme.length);
        const bed = new Float32Array(n);
        /** @type {(() => void)[]} */
        const post = [];
        let loop = bed;
        const q = (f) => Math.round(f * LEN) / LEN;                        // частота, кратная циклу
        const mix = (layer, w) => this._addNorm(bed, layer, w, 'rms');
        const lowN = (fc, passes) => this._noise(r, n, sr, fc, passes);
        const modulate = (a, fc, depth) => { const m = this._slow(r, n, sr, fc); for (let i = 0; i < n; i++) a[i] *= Math.max(0.05, 1 + depth * m[i]); return a; };
        const bandNoise = (fHi, fLo) => { const a = this._noise(r, n, sr, fHi, 1), b = this._lowpass(a.slice(), sr, fLo, 1); for (let i = 0; i < n; i++) a[i] -= b[i]; return a; };
        const tone = (f, amp, t0, dur, att, rel, ph0) => {            // синус с огибающей в цикл (событие)
            const i0 = Math.floor(t0 * sr), len = Math.min(N - i0, Math.floor(sr * dur));
            for (let i = 0; i < len; i++) {
                const t = i / sr, e = Math.min(1, t / att) * Math.min(1, (dur - t) / rel);
                loop[i0 + i] += Math.sin(ph0 + TAU * f * t) * e * amp;
            }
        };
        const clink = (t0, f0, amp, taus, ratios) => {                 // металлический удар/колокол
            const i0 = Math.floor(t0 * sr);
            for (let k = 0; k < ratios.length; k++) this._ping(loop, i0, sr, f0 * ratios[k], taus[k], amp * (1 - 0.18 * k), 1.2);
        };
        const hiss = (t0, dur, amp, fHi, fLo) => {                     // порыв шипения: шум, полоса, колокол
            const i0 = Math.floor(t0 * sr), len = Math.min(N - i0, Math.floor(sr * dur));
            const a = this._noise(r, len, sr, fHi, 1), b = this._lowpass(a.slice(), sr, fLo, 1);
            for (let i = 0; i < len; i++) loop[i0 + i] += (a[i] - b[i]) * Math.pow(Math.sin(Math.PI * i / len), 2) * amp;
        };
        const place = (a, b) => (a + (b - a) * r());

        switch (theme) {
            case 'lab':
                mix(modulate(lowN(700, 2), 0.09, 0.25), 1); yield;
                mix(bandNoise(6000, 2500), 0.15); yield;
                post.push(() => {
                    this._hum(loop, N, sr, [[q(50), 0.1, 0], [q(100), 0.055, 0], [q(150), 0.03, 0], [q(200), 0.014, 0], [q(300), 0.007, 0]], q(0.25), 0.1);
                    for (const t of [5.2, 12.4]) { tone(1320, 0.05, t, 0.05, 0.004, 0.02, 0); tone(1760, 0.05, t + 0.07, 0.05, 0.004, 0.02, 0); }
                    this._poisson(r, 2, LEN - 1.5, () => 0.35, t => { const i = Math.floor(t * sr); this._ping(loop, i, sr, 1800, 0.004, 0.1, 1.2); });
                });
                break;
            case 'farm':
                mix(this._windBand(r, n, sr, 280, 850, 0.9, 0.1, 0.55), 1); yield;
                mix(modulate(bandNoise(6500, 2500), 0.1, 0.9), 0.12); yield;
                post.push(() => {
                    for (const [t, k] of [[3.2, 'a'], [6.1, 'b'], [9.5, 'a'], [13.4, 'b'], [15.7, 'a'], [17.4, 'c']]) this._bird(loop, sr, t, k, k === 'a' ? 0.1 : 0.08, r);
                });
                break;
            case 'suburb':
                mix(modulate(lowN(200, 2), 0.07, 0.35), 0.8); yield;
                mix(modulate(bandNoise(3000, 900), 0.12, 0.5), 0.4); yield;
                mix(this._windBand(r, n, sr, 250, 600, 0.7, 0.1, 0.4), 0.5); yield;
                post.push(() => {
                    for (const [t, k] of [[4, 'a'], [9.2, 'b'], [14.3, 'a']]) this._bird(loop, sr, t, k, 0.08, r);
                    tone(q(92), 0.015, 0, LEN, 0.5, 0.5, 0);   // далёкий моторчик: еле слышный гул
                });
                break;
            case 'industrial':
                mix(lowN(220, 3).map((v, i) => v * (1 + 0.5 * Math.sin(TAU * q(2.4) * (i / sr)))), 0.8); yield;
                mix(bandNoise(1400, 350).map((v, i) => v * (1 + 0.6 * Math.sin(TAU * q(2.4) * (i / sr) + 1))), 0.5); yield;
                mix(this._windBand(r, n, sr, 220, 520, 1.1, 0.08, 0.5), 0.4); yield;
                mix(bandNoise(7000, 3000), 0.08); yield;
                post.push(() => {
                    this._hum(loop, N, sr, [[q(55), 0.13, 0], [q(110), 0.09, 1], [q(165), 0.04, 2], [q(82.75), 0.05, 3]], q(0.2), 0.2);
                    for (const t of [4.5, 8.9, 12.2, 17.1]) clink(t, place(280, 900), 0.14, [0.5, 0.3, 0.15, 0.08], [1, 2.76, 5.4, 8.93]);
                    hiss(6.8, 1.1, 0.1, 7000, 2000); hiss(14.6, 1.3, 0.09, 7000, 2000);
                });
                break;
            case 'docks': {
                // волны: «колокол» нарастает 2 с и спадает 3 с, шипит на гребне
                const wave = new Float32Array(n).fill(0.25);
                for (let c = 2; c < LEN + 1; c += 4.6 + r() * 1.4) {
                    const ic = Math.floor(c * sr), d = Math.exp(-1 / (1.4 * sr));
                    for (let i = Math.max(0, ic - 2 * sr), u = 0; i < ic && i < n; i++) { u = 1 - (ic - i) / (2 * sr); wave[i] += u * u * (3 - 2 * u) * 0.9; }
                    for (let i = ic, e = 0.9; i < Math.min(n, ic + 3 * sr); i++) { wave[i] += e; e *= d; }
                }
                const sea = lowN(800, 2), crest = bandNoise(4000, 1000);
                for (let i = 0; i < n; i++) { sea[i] *= wave[i]; crest[i] *= wave[i] * wave[i] * wave[i]; }
                mix(sea, 1); mix(crest, 0.45); yield;
                mix(this._windBand(r, n, sr, 240, 700, 0.9, 0.09, 0.5), 0.45); yield;
                mix(modulate(lowN(250, 2), 0.4, 0.5), 0.4); yield;
                post.push(() => {
                    // гудок далёкого буксира
                    const f = 116.5, i0 = Math.floor(9.8 * sr), len = Math.floor(sr * 2.8), buf = new Float32Array(len);
                    this._hum(buf, len, sr, [1, 2, 3, 4, 5, 6].map((h, k) => [f * h, [1, 0.8, 0.55, 0.4, 0.25, 0.15][k], 0]), 1, 0);
                    this._lowpass(buf, sr, 1000, 1);
                    for (let i = 0; i < len; i++) { const t = i / sr; loop[i0 + i] += buf[i] * Math.min(1, t / 0.25) * Math.min(1, (2.8 - t) / 1) * 0.07; }
                    // колокол буйка и скрип каната
                    for (const t of [5.5, 12.3, 19]) clink(t, 330, 0.05, [1.3, 0.9, 0.5, 0.3], [1, 2.32, 3.9, 5.7]);
                });
                for (const [t, sd] of [[3.5, 1], [14.2, 2], [21, 3]]) {
                    post.push(() => { const c = this._creak('wood', 980 + sd).s, i1 = Math.floor(t * sr); for (let i = 0; i < c.length && i1 + i < N; i++) loop[i1 + i] += c[i] * 0.07; });
                }
                break;
            }
            case 'city':
                mix(modulate(lowN(300, 3), 0.08, 0.35), 0.8); yield;
                mix(modulate(bandNoise(3500, 800), 0.12, 0.5), 0.5); yield;
                mix(lowN(60, 3), 0.3); yield;
                mix(this._windBand(r, n, sr, 300, 700, 0.8, 0.1, 0.4), 0.3); yield;
                post.push(() => {
                    // далёкие гудки машин (двойной тон) и сирена
                    for (const t of [5, 11.2, 19.5]) {
                        const i0 = Math.floor(t * sr), len = Math.floor(sr * 0.26), buf = new Float32Array(len);
                        for (let i = 0; i < len; i++) { const x = i / sr; buf[i] = (Math.sin(TAU * 415 * x) + 0.4 * Math.sin(TAU * 1245 * x) + Math.sin(TAU * 520 * x) + 0.4 * Math.sin(TAU * 1560 * x)) * Math.min(1, x / 0.01) * Math.min(1, (0.26 - x) / 0.02); }
                        this._lowpass(buf, sr, 1500, 1);
                        for (let i = 0; i < len; i++) loop[i0 + i] += buf[i] * 0.05;
                    }
                    const i0 = Math.floor(12 * sr), len = Math.floor(sr * 6), buf = new Float32Array(len);
                    let ph = 0;
                    for (let i = 0; i < len; i++) {
                        const t = i / sr;
                        ph += TAU * (900 + 350 * Math.sin(TAU * 0.33 * t)) / sr;
                        buf[i] = (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph)) * Math.min(1, t) * Math.min(1, 6 - t);
                    }
                    this._lowpass(buf, sr, 2500, 1);
                    for (let i = 0; i < len; i++) loop[i0 + i] += buf[i] * 0.045;
                });
                break;
            case 'snow':
                mix(this._windBand(r, n, sr, 350, 620, 5, 0.09, 0.8), 1); yield;
                mix(this._windBand(r, n, sr, 700, 1150, 4, 0.12, 0.8), 0.5); yield;
                mix(modulate(lowN(130, 2), 0.09, 0.7), 0.6); yield;
                mix(bandNoise(8000, 4000), 0.05); yield;
                break;
            case 'desert':
                mix(this._windBand(r, n, sr, 500, 1300, 0.9, 0.08, 0.7), 1); yield;
                mix(modulate(bandNoise(7500, 3500), 0.09, 0.8), 0.35); yield;
                mix(modulate(lowN(90, 2), 0.08, 0.7), 0.4); yield;
                post.push(() => {
                    const i0 = Math.floor(8.5 * sr), len = Math.floor(sr * 5);
                    let ph = 0;
                    for (let i = 0; i < len; i++) { const t = i / sr; ph += TAU * (1000 + 40 * Math.sin(TAU * 0.6 * t)) / sr; loop[i0 + i] += Math.sin(ph) * Math.pow(Math.sin(Math.PI * t / 5), 2) * 0.018 * (0.6 + 0.4 * Math.sin(TAU * 0.3 * t)); }
                });
                break;
            default: break;
        }
        yield;
        loop = this._loopify(bed, N, X);
        yield;
        // выровнять цикл: RMS слышимой части (выше 150 Гц) = 0.15, полного сигнала не больше 0.3; события заданы под этот уровень
        const lo = this._lowpass(loop.slice(), sr, 150, 1);
        let e = 0, ef = 0;
        for (let i = 0; i < N; i++) { const h = loop[i] - lo[i]; e += h * h; ef += loop[i] * loop[i]; }
        const kk = Math.min(0.15 / Math.sqrt(e / N + 1e-12), 0.3 / Math.sqrt(ef / N + 1e-12));
        for (let i = 0; i < N; i++) loop[i] *= kk;
        for (const f of post) { f(); yield; }
        let pk = 1e-9;
        for (let i = 0; i < N; i++) { const a = Math.abs(loop[i]); if (a > pk) pk = a; }
        if (pk > 0.85) { const g = 0.85 / pk; for (let i = 0; i < N; i++) loop[i] *= g; }
        return { s: loop, sr };
    },

    // ======================================================================================
    //  Музыка: оригинальные партитуры, синтез в стерео-буфер по кусочкам (генераторы)
    // ======================================================================================

    _mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },

    // Равномощная панорама p -1..1 -> [левый, правый].
    _pg(p) { const a = (Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; },

    // Набор песни: стерео-буфер n отсчётов (L, R), посыл в реверб (send), рабочий буфер голоса S (maxSec секунд),
    // огибающая сайдчейна sc (после _scBuild).
    _kit(sr, n, maxSec) {
        return { sr, n, L: new Float32Array(n), R: new Float32Array(n), send: new Float32Array(n), S: new Float32Array(Math.floor(sr * (maxSec || 5))), sc: /** @type {Float32Array | null} */ (null) };
    },

    // Голос k.S[0..len) -> L/R с усилениями gl, gr, в реверб sg; duck — глубина сайдчейна. Хвост за концом буфера
    // заворачивается в начало (бесшовный цикл).
    _put(k, len, i0, gl, gr, sg, duck) {
        const n = k.n, S = k.S, L = k.L, R = k.R, send = k.send, sc = k.sc;
        let j = ((Math.floor(i0) % n) + n) % n;
        for (let i = 0; i < len; i++) {
            const g = duck && sc ? 1 - duck * sc[j] : 1, v = S[i] * g;
            L[j] += v * gl; R[j] += v * gr;
            if (sg) send[j] += v * sg;
            if (++j >= n) j = 0;
        }
    },

    // Сайдчейн: огибающая ударов (1 в момент удара, спад tau секунд) — басс и пэд «дышат» в такт.
    _scBuild(k, kicks, tau) {
        const n = k.n, sr = k.sr, sc = new Float32Array(n), len = Math.floor(sr * tau * 4), d = Math.exp(-1 / (sr * tau));
        for (const i0 of kicks) {
            let e = 1, j = i0 % n;
            for (let i = 0; i < len; i++) { if (e > sc[j]) sc[j] = e; e *= d; if (++j >= n) j = 0; }
        }
        k.sc = sc;
    },

    // Бочка: синус с падением 166 -> 46 Гц и мягким ограничением, щелчок в начале.
    _vKick(S, sr, amp, r) {
        const len = Math.floor(sr * 0.4), d1 = Math.exp(-1 / (sr * 0.04)), d2 = Math.exp(-1 / (sr * 0.13));
        let ph = 0, e1 = 1, e2 = 1;
        for (let i = 0; i < len; i++) {
            ph += 2 * Math.PI * (46 + 120 * e1) / sr;
            S[i] = Math.tanh(1.4 * Math.sin(ph)) * e2 * amp * (i < 8 ? i / 8 : 1) + (i < 40 ? (r() * 2 - 1) * 0.25 * amp * (1 - i / 40) * Math.min(1, i / 4) : 0);
            e1 *= d1; e2 *= d2;
        }
        return len;
    },

    // Малый барабан: шум 0.5–6.5 кГц + тон 190 Гц с падением.
    _vSnare(S, sr, amp, r) {
        const len = Math.floor(sr * 0.35), a1 = 1 - Math.exp(-2 * Math.PI * 6500 / sr), a2 = 1 - Math.exp(-2 * Math.PI * 500 / sr);
        const d1 = Math.exp(-1 / (sr * 0.1)), d2 = Math.exp(-1 / (sr * 0.05));
        let l1 = 0, l2 = 0, e1 = 1, e2 = 1, ph = 0;
        for (let i = 0; i < len; i++) {
            const x = r() * 2 - 1;
            l1 += a1 * (x - l1); l2 += a2 * (l1 - l2);
            ph += 2 * Math.PI * (175 + 40 * e2) / sr;
            S[i] = ((l1 - l2) * 1.7 * e1 + Math.sin(ph) * 0.5 * e2) * amp;
            e1 *= d1; e2 *= d2;
        }
        return len;
    },

    // Тарелка-хэт: высокочастотный шум, tau — спад (закрытый 0.02, открытый 0.09).
    _vHat(S, sr, amp, r, tau) {
        const len = Math.floor(sr * tau * 6), a = 1 - Math.exp(-2 * Math.PI * 7000 / sr), d = Math.exp(-1 / (sr * tau));
        let l = 0, e = 1;
        for (let i = 0; i < len; i++) { const x = r() * 2 - 1; l += a * (x - l); S[i] = (x - l) * e * amp * (i < 6 ? i / 6 : 1); e *= d; }
        return len;
    },

    // Крэш: шум выше 3 кГц, спад 0.6 с.
    _vCrash(S, sr, amp, r) { return this._vHat(S, sr, amp * 1.1, r, 0.5); },

    // Металлический удар (труба, балка): пять неравномерных обертонов и щелчок.
    _vClank(S, sr, f0, amp, r) {
        const len = Math.floor(sr * 1.2);
        S.fill(0, 0, len);
        [[1, 0.35, 1], [2.76, 0.22, 0.7], [5.4, 0.12, 0.45], [8.93, 0.07, 0.3], [13.34, 0.04, 0.2]].forEach(([ra, tau, a]) => { if (f0 * ra < sr * 0.45) this._ping(S, 0, sr, f0 * ra, tau, amp * a, 1.2); });
        for (let i = 0; i < 90; i++) S[i] += (r() * 2 - 1) * amp * 0.4 * (1 - i / 90);
        return len;
    },

    // Басс: синус + 2-я/3-я гармоники (из вращающегося вектора, без sin в цикле), мягкое ограничение;
    // dur — длина ноты (с) + спад 0.14 с.
    _vBass(S, sr, f, dur, amp) {
        const len = Math.min(S.length, Math.floor(sr * (dur + 0.14))), w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
        const c3 = Math.cos(0.3), s3 = Math.sin(0.3), n0 = Math.floor(sr * dur), dd = Math.exp(-1 / (sr * 0.25)), dr = Math.exp(-1 / (sr * 0.04));
        let s1 = 0, c1 = 1, e = 1, rel = 1;
        for (let i = 0; i < len; i++) {
            const ns = s1 * cw + c1 * sw;
            c1 = c1 * cw - s1 * sw; s1 = ns;
            const s2 = 2 * s1 * c1 * c3 + (2 * c1 * c1 - 1) * s3, s3h = 3 * s1 - 4 * s1 * s1 * s1;       // sin(2ph + 0.3), sin(3ph)
            const v = s1 + 0.28 * s2 + 0.12 * s3h;
            if (i > n0) rel *= dr;
            S[i] = Math.tanh(1.5 * v) * (i < 44 ? i / 44 : 1) * (0.7 + 0.3 * e) * rel * amp * 0.7;
            e *= dd;
        }
        return len;
    },

    // Щипок/колокольчик: четыре обертона с разным спадом (ts — растяжка спада). kind: 'pluck' | 'bell'.
    _vPluck(S, sr, f, amp, kind, ts) {
        const P = kind === 'bell' ? [[1, 1.5, 1], [2.01, 0.8, 0.5], [3.98, 0.45, 0.22], [5.43, 0.25, 0.12]] : [[1, 0.55, 1], [2, 0.35, 0.5], [3.01, 0.2, 0.25], [4.2, 0.12, 0.12]];
        const sc = ts || 1, len = Math.min(S.length, Math.floor(sr * P[0][1] * sc * 4));
        S.fill(0, 0, len);
        for (const [ra, tau, a] of P) { const fr = f * ra; if (fr < sr * 0.45) this._ping(S, 0, sr, fr, tau * sc, amp * a, 1.15, 4); }
        const at = Math.min(len, Math.floor(sr * 0.002));
        for (let i = 0; i < at; i++) S[i] *= i / at;
        return len;
    },

    // Нарастающий шум (райзер): полоса (fc/2 … 1.6·fc, разность двух НЧ) ползёт f0 -> f1 (экспонента), громкость растёт как u².
    _vSweep(S, sr, dur, amp, f0, f1, r) {
        const len = Math.min(S.length, Math.floor(sr * dur));
        let a = 0, b = 0, ka = 0, kb = 0;
        for (let i = 0; i < len; i++) {
            const u = i / len;
            if ((i & 15) === 0) {
                const fc = f0 * Math.pow(f1 / f0, u);
                ka = 1 - Math.exp(-2 * Math.PI * fc * 1.6 / sr); kb = 1 - Math.exp(-2 * Math.PI * fc * 0.5 / sr);
            }
            const x = r() * 2 - 1;
            a += ka * (x - a); b += kb * (x - b);
            S[i] = (a - b) * u * u * amp * 3;
        }
        return len;
    },

    // Нота пэда в буфер pad (частота srP — половина основной): две пилы ±det центов -> два НЧ (срез fc0 -> fc1),
    // огибающая: нарастание att, держим dur, спад rel (всё в секундах). Хвост заворачивается.
    _padNote(pad, srP, i0, f, dur, att, rel, fc0, fc1, det, r) {
        const len = Math.floor(srP * (dur + rel)), n = pad.length, d1 = Math.pow(2, det / 1200), w1 = f * d1 / srP, w2 = f / d1 / srP;
        let p1 = r(), p2 = r(), l1 = 0, l2 = 0, a = 0, j = i0 % n;
        for (let i = 0; i < len; i++) {
            if ((i & 31) === 0) a = 1 - Math.exp(-2 * Math.PI * (fc0 + (fc1 - fc0) * Math.min(1, i / (srP * dur))) / srP);
            p1 += w1; if (p1 >= 1) p1 -= 1;
            p2 += w2; if (p2 >= 1) p2 -= 1;
            l1 += a * (p1 + p2 - 1 - l1); l2 += a * (l1 - l2);
            const t = i / srP, u = t / att, e = (t < att ? u * u * (3 - 2 * u) : 1) * (t > dur ? 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (t - dur) / rel)) : 1);
            pad[j] += l2 * e;
            if (++j >= n) j = 0;
        }
    },

    // Пэд (полу-частота) -> L/R: интерполяция вверх, правый канал чуть позже (Haas 11 мс), сайдчейн, посыл в реверб.
    *_padMix(k, pad, gain, duck, sg) {
        const n = k.n, L = k.L, R = k.R, send = k.send, sc = k.sc, m = pad.length, hz = Math.round(k.sr * 0.011);
        const at = (i) => { const a = i >> 1, f = (i & 1) * 0.5; return pad[a] * (1 - f) + pad[a + 1 < m ? a + 1 : 0] * f; };
        for (let i = 0; i < n; i++) {
            const g = (duck && sc ? 1 - duck * sc[i] : 1) * gain, j = i >= hz ? i - hz : i - hz + n;
            const v = at(i) * g;
            L[i] += v; R[i] += at(j) * g;
            if (sg) send[i] += v * sg;
            if ((i & 65535) === 0) yield;
        }
    },

    // Реверб Шрёдера (4 гребёнки с потерями + 2 all-pass) на половинной частоте; два прохода — хвост конца
    // перетекает в начало, цикл бесшовный. Возвращает «мокрый» сигнал длиной n.
    *_reverbGen(src, sr) {
        const n = src.length, m = n >> 1, srR = sr / 2, x = new Float32Array(m), out = new Float32Array(n), w = new Float32Array(m + 1);
        for (let j = 0; j < m; j++) x[j] = (src[2 * j] + src[2 * j + 1]) * 0.5;
        const D = [0.0297, 0.0371, 0.0411, 0.0437].map(d => Math.round(d * srR)), G = D.map(d => Math.pow(10, -3 * (d / srR) / 2.3));
        const cb = D.map(d => new Float32Array(d)), cp = [0, 0, 0, 0], cl = [0, 0, 0, 0];
        const AD = [Math.round(0.005 * srR), Math.round(0.0017 * srR)], ab = AD.map(d => new Float32Array(d)), ap = [0, 0];
        for (let pass = 0; pass < 2; pass++) {
            for (let j = 0; j < m; j++) {
                const inp = x[j] * 0.28;
                let sum = 0;
                for (let c = 0; c < 4; c++) {
                    const y = cb[c][cp[c]];
                    cl[c] = y * 0.6 + cl[c] * 0.4;                    // потери: верха затухают быстрее
                    cb[c][cp[c]] = inp + G[c] * cl[c];
                    if (++cp[c] >= D[c]) cp[c] = 0;
                    sum += y;
                }
                for (let a = 0; a < 2; a++) {                         // all-pass: рассеивает «гребёнчатость»
                    const bv = ab[a][ap[a]], z = sum + 0.7 * bv;
                    ab[a][ap[a]] = z;
                    sum = bv - 0.7 * z;
                    if (++ap[a] >= AD[a]) ap[a] = 0;
                }
                if (pass === 1) w[j] = sum;
                if ((j & 16383) === 0) yield;
            }
        }
        w[m] = w[0];
        for (let i = 0; i < n; i++) { const j = i >> 1; out[i] = w[j] + (w[j + 1] - w[j]) * (i & 1) * 0.5; }
        return out;
    },

    // Финал песни: реверб-возврат в оба канала (правый на 9 мс позже), выровнять RMS -> rmsT, мягкий лимитер, пик <= 0.92.
    *_finishSong(k, rmsT, wetGain) {
        const n = k.n, L = k.L, R = k.R, wet = yield* this._reverbGen(k.send, k.sr), hz = Math.round(k.sr * 0.009);
        for (let i = 0; i < n; i++) { const v = wet[i] * wetGain, j = i + hz < n ? i + hz : i + hz - n; L[i] += v; R[j] += v; }
        yield;
        let e = 0;
        for (let i = 0; i < n; i++) e += L[i] * L[i] + R[i] * R[i];
        yield;
        const g = rmsT / Math.sqrt(e / (2 * n) + 1e-12) * 1.1;
        const clip = (x) => (x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x)) / 0.8;   // ≈ tanh (Паде), без Math.tanh на миллион отсчётов
        let pk = 1e-9;
        for (let i = 0; i < n; i++) {
            L[i] = clip(L[i] * g); R[i] = clip(R[i] * g);
            const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
            if (a > pk) pk = a;
            if ((i & 131071) === 0) yield;
        }
        if (pk > 0.92) { const sc = 0.92 / pk; for (let i = 0; i < n; i++) { L[i] *= sc; R[i] *= sc; } }
    },

    // Пыль винила: редкие щелчки в обоих каналах.
    _dust(k, r, rate, amp) {
        const L = k.L, R = k.R, n = k.n;
        this._poisson(r, 0, n / k.sr - 0.01, () => rate, t => {
            const i = Math.floor(t * k.sr), a = Math.pow(r(), 2.5) * amp * (r() < 0.5 ? -1 : 1);
            L[i] += a; L[i + 1] -= a * 0.5; R[i] += a * 0.7 * (r() < 0.5 ? -1 : 1); R[i + 1] -= a * 0.3;
        });
    },

    // Партитура по имени: 'menu' | 'play' | 'tense' | 'results' | 'sting'.
    *_songGen(kind) {
        if (kind === 'play') return yield* this._songPlay();
        if (kind === 'tense') return yield* this._songTense();
        if (kind === 'menu') return yield* this._songMenu();
        if (kind === 'results') return yield* this._songResults();
        return yield* this._songSting();
    },

    // 'play' — мрачный индастриал-трип-хоп, 80 уд/мин, 16 тактов (48 с), ре минор: Dm9 – Bbmaj7 – Gm7 – A7 ... Dm – F – Gm9 – A9sus.
    // Свинг на 16-х, бочка с сайдчейном на басс и пэд, пыль винила, лязг труб на слабых долях, райзеры перед сменой раздела;
    // мелодия — колокольчик в ре-минорной пентатонике с эхо-повторами (пунктирная восьмая).
    *_songPlay() {
        const sr = 22050, bpm = 80, bars = 16, stepS = sr * 60 / bpm / 4, n = Math.round(stepS * 16 * bars);
        const k = this._kit(sr, n, 5), S = k.S, r = this._rng(7001);
        const at = (bar, st) => Math.floor((bar * 16 + st) * stepS + ((st & 1) ? 0.14 * stepS : 0));
        const kicks = [];
        // --- ударные
        for (let bar = 0; bar < bars; bar++) {
            const b4 = bar % 4, sec2 = bar >= 8;
            const ks = b4 === 3 ? (sec2 ? [0, 3, 10, 14] : [0, 3, 10, 13]) : (sec2 && b4 === 1 ? [0, 5, 7, 10] : [0, 7, 10]);
            for (const st of ks) { const i0 = at(bar, st); kicks.push(i0); this._put(k, this._vKick(S, sr, 0.85, r), i0, 0.75, 0.75, 0, 0); }
            for (const st of [4, 12]) this._put(k, this._vSnare(S, sr, 0.55, r), at(bar, st), 0.7, 0.7, 0.4, 0);
            if (bar % 2 === 1) this._put(k, this._vSnare(S, sr, 0.18, r), at(bar, 15), 0.6, 0.6, 0.3, 0);
            if (bar === 7 || bar === 15) for (let q = 0; q < 3; q++) this._put(k, this._vSnare(S, sr, 0.25 + 0.1 * q, r), at(bar, 13 + q), 0.7, 0.7, 0.4, 0);
            for (let st = 0; st < 16; st += 2) {
                const acc = st % 4 === 2, [gl, gr] = this._pg(acc ? 0.4 : -0.25);
                this._put(k, this._vHat(S, sr, acc ? 0.2 : 0.12, r, 0.022), at(bar, st), gl, gr, 0.08, 0);
            }
            if (sec2) for (let st = 1; st < 16; st += 2) this._put(k, this._vHat(S, sr, 0.06, r, 0.015), at(bar, st), 0.5, 0.7, 0.05, 0);
            if (bar % 2 === 1) this._put(k, this._vHat(S, sr, 0.16, r, 0.09), at(bar, 14), 0.8, 0.5, 0.1, 0);
            if (b4 === 2) { const [gl, gr] = this._pg(0.5); this._put(k, this._vClank(S, sr, 540, 0.32, r), at(bar, 11), gl, gr, 0.45, 0); }
            if (b4 === 3) { const [gl, gr] = this._pg(-0.5); this._put(k, this._vClank(S, sr, 905, 0.26, r), at(bar, 14), gl, gr, 0.45, 0); }
            if (bar === 7 || bar === 15) this._put(k, this._vSweep(S, sr, stepS * 8 / sr, 0.5, 300, 6500, r), at(bar, 8), 0.6, 0.6, 0.3, 0);
            if (bar === 0 || bar === 8) this._put(k, this._vCrash(S, sr, 0.22, r), at(bar, 0), 0.6, 0.6, 0.3, 0);
            yield;
        }
        this._scBuild(k, kicks, 0.11);
        yield;
        // --- басс (корни: Ре, Си-бемоль, Соль, Ля; во второй половине Ре, Фа, Соль, Ля)
        const rootsA = [38, 34, 31, 33], rootsB = [38, 41, 43, 45];
        const TPL = [[[0, 0, 6], [7, 0, 2], [10, 0, 3], [14, 12, 1]], [[0, 0, 5], [6, 0, 1], [8, 7, 3], [12, 0, 3]], [[0, 0, 6], [8, 0, 2], [10, 7, 2], [12, 12, 2], [14, 7, 2]]];
        for (let bar = 0; bar < bars; bar++) {
            const root = (bar < 8 ? rootsA : rootsB)[(bar >> 1) & 3], tpl = TPL[bar % 4 === 3 ? 2 : bar % 2];
            for (const [st, off, ln] of tpl) this._put(k, this._vBass(S, sr, this._mtof(root + off), ln * stepS / sr * 0.92, 0.5), at(bar, st), 0.62, 0.62, 0, 0.5);
            if ((bar & 3) === 3) yield;
        }
        // --- пэд: аккорды по два такта
        const CH = [[50, 53, 57, 60, 64], [46, 50, 53, 57, 60], [43, 46, 50, 53, 57], [45, 52, 55, 61, 64], [50, 57, 62, 65, 69], [53, 57, 60, 64, 67], [43, 50, 53, 58, 62], [45, 50, 52, 55, 59]];
        const srP = sr / 2, pad = new Float32Array(Math.ceil(n / 2));
        for (let c = 0; c < 8; c++) for (const m of CH[c]) { this._padNote(pad, srP, Math.floor(at(c * 2, 0) / 2), this._mtof(m), 6, 1.3, 2.2, 520, 1050, 7, r); yield; }
        yield* this._padMix(k, pad, 0.18, 0.5, 0.25);
        // --- мелодия: [шаг от начала двух тактов, нота, длина в 16-х, сила]
        const LEAD = [
            [[4, 69, 3, 0.8], [7, 72, 3, 0.7], [10, 74, 5, 0.8], [18, 77, 3, 0.7], [22, 76, 3, 0.6], [26, 74, 4, 0.7], [30, 69, 2, 0.5]],
            [[2, 77, 3, 0.7], [6, 74, 3, 0.7], [10, 72, 5, 0.7], [20, 70, 3, 0.6], [24, 74, 3, 0.7], [28, 69, 4, 0.6]],
            [[0, 74, 3, 0.7], [4, 70, 3, 0.6], [8, 67, 6, 0.7], [19, 69, 3, 0.6], [23, 70, 3, 0.6], [27, 74, 5, 0.7]],
            [[2, 76, 3, 0.7], [6, 73, 3, 0.7], [10, 69, 5, 0.7], [20, 67, 3, 0.5], [24, 64, 3, 0.5], [28, 73, 4, 0.7]],
            [[0, 81, 2, 0.6], [3, 77, 2, 0.6], [6, 74, 3, 0.7], [10, 76, 2, 0.6], [14, 77, 4, 0.7], [20, 74, 3, 0.6], [24, 72, 3, 0.6], [28, 69, 3, 0.6]],
            [[0, 72, 3, 0.6], [4, 77, 3, 0.7], [8, 76, 3, 0.6], [12, 72, 4, 0.6], [18, 69, 3, 0.6], [22, 72, 3, 0.7], [26, 76, 5, 0.7]],
            [[2, 74, 3, 0.7], [6, 77, 3, 0.7], [10, 79, 4, 0.7], [18, 77, 3, 0.6], [22, 74, 3, 0.6], [26, 70, 5, 0.6]],
            [[0, 76, 3, 0.7], [4, 73, 3, 0.7], [8, 69, 3, 0.6], [12, 76, 3, 0.7], [16, 81, 4, 0.6], [22, 76, 4, 0.6], [28, 73, 2, 0.6]],
        ];
        for (let c = 0; c < 8; c++) {
            for (const [st, m, ln, a] of LEAD[c]) {
                const i0 = at(c * 2 + (st >> 4), st & 15), len = this._vPluck(S, sr, this._mtof(m), 0.62 * a, 'pluck', 0.5 + ln * 0.15);
                this._put(k, len, i0, 0.8, 0.55, 0.45, 0);
                this._put(k, len, i0 + Math.floor(3 * stepS), 0.05, 0.38, 0.2, 0);      // эхо: пунктирная восьмая, вправо
                this._put(k, len, i0 + Math.floor(6 * stepS), 0.22, 0.04, 0.1, 0);      // и дальше влево
            }
            yield;
        }
        this._dust(k, r, 28, 0.05);
        yield* this._finishSong(k, 0.17, 0.55);
        return { s: [k.L, k.R], sr };
    },

    // 'tense' — последние 30 с раунда: 120 уд/мин, 8 тактов (16 с, два круга — 32 с), пульс баса восьмыми на Ре со сдвигом
    // на полутон, бочка на каждую долю, арпеджио 16-ми (восемь нот: цикл кратен петле), лязг на слабых, райзер и ролл малого.
    *_songTense() {
        const sr = 22050, bpm = 120, bars = 8, stepS = sr * 60 / bpm / 4, n = Math.round(stepS * 16 * bars);
        const k = this._kit(sr, n, 9), S = k.S, r = this._rng(7002);
        const at = (bar, st) => Math.floor((bar * 16 + st) * stepS);
        const kicks = [];
        for (let bar = 0; bar < bars; bar++) {
            const ramp = 0.75 + 0.45 * bar / (bars - 1);
            for (const st of [0, 4, 8, 12]) { const i0 = at(bar, st); kicks.push(i0); this._put(k, this._vKick(S, sr, 0.8, r), i0, 0.75, 0.75, 0, 0); }
            if (bar >= 4) { const i0 = at(bar, 14); kicks.push(i0); this._put(k, this._vKick(S, sr, 0.5, r), i0, 0.75, 0.75, 0, 0); }
            if (bar < 7) for (const st of [4, 12]) this._put(k, this._vSnare(S, sr, 0.5, r), at(bar, st), 0.7, 0.7, 0.3, 0);
            else for (let st = 8; st < 16; st++) this._put(k, this._vSnare(S, sr, 0.18 + 0.07 * (st - 8), r), at(bar, st), 0.7, 0.7, 0.3, 0);
            for (let st = 0; st < 16; st++) { const acc = st % 4 === 2, [gl, gr] = this._pg((st & 1) ? 0.35 : -0.35); this._put(k, this._vHat(S, sr, (acc ? 0.17 : 0.09) * ramp, r, 0.016), at(bar, st), gl, gr, 0.04, 0); }
            const [cl, cr] = this._pg(bar % 2 ? 0.55 : -0.55);
            this._put(k, this._vClank(S, sr, 720, 0.25, r), at(bar, 6), cl, cr, 0.4, 0);
            this._put(k, this._vClank(S, sr, 1018, 0.2, r), at(bar, 14), cr, cl, 0.4, 0);
            yield;
        }
        this._put(k, this._vCrash(S, sr, 0.3, r), 0, 0.6, 0.6, 0.3, 0);
        this._put(k, this._vSweep(S, sr, stepS * 64 / sr, 0.55, 200, 8000, r), at(4, 0), 0.6, 0.6, 0.3, 0);
        this._scBuild(k, kicks, 0.09);
        const roots = [38, 38, 38, 38, 39, 39, 38, 37];
        for (let bar = 0; bar < bars; bar++) {
            for (let st = 0; st < 16; st += 2) {
                const off = (st === 6 || st === 14) ? (bar >= 4 ? 6 : 3) : (st === 10 ? 12 : 0);
                this._put(k, this._vBass(S, sr, this._mtof(roots[bar] + off), stepS * 1.6 / sr, 0.55), at(bar, st), 0.62, 0.62, 0, 0.45);
            }
            yield;
        }
        const srP = sr / 2, pad = new Float32Array(Math.ceil(n / 2));
        for (const [c, notes] of /** @type {[number, number[]][]} */ ([[0, [50, 53, 57, 63]], [4, [50, 53, 56, 60]]])) {
            for (const m of notes) { this._padNote(pad, srP, Math.floor(at(c, 0) / 2), this._mtof(m), 8, 0.8, 1.2, 600, 1500, 9, r); yield; }
        }
        yield* this._padMix(k, pad, 0.14, 0.45, 0.2);
        const ARP = [[62, 65, 69, 74, 77, 74, 69, 65], [62, 65, 68, 72, 77, 72, 68, 65]];
        for (let bar = 0; bar < bars; bar++) {
            const a = ARP[bar >= 4 ? 1 : 0];
            for (let st = 0; st < 16; st++) {
                const len = this._vPluck(S, sr, this._mtof(a[(bar * 16 + st) % 8]), 0.2 * (st % 4 === 0 ? 1.25 : 0.85), 'pluck', 0.35);
                const [gl, gr] = this._pg(((st >> 1) % 2 ? 0.3 : -0.3));
                this._put(k, len, at(bar, st), gl, gr, 0.22, 0);
            }
            yield;
        }
        this._dust(k, r, 10, 0.03);
        yield* this._finishSong(k, 0.19, 0.45);
        return { s: [k.L, k.R], sr };
    },

    // 'menu' — спокойная тема: 60 уд/мин, 8 тактов (32 с), ля минор: Am9 – Fmaj7 – Cmaj7 – G6/9, широкий пэд, бас-дрон,
    // «музыкальная шкатулка» в пентатонике, тихий шейкер и редкие искры на высоких.
    *_songMenu() {
        const sr = 22050, bpm = 60, bars = 8, stepS = sr * 60 / bpm / 4, n = Math.round(stepS * 16 * bars);
        const k = this._kit(sr, n, 10), S = k.S, r = this._rng(7003);
        const at = (bar, st) => Math.floor((bar * 16 + st) * stepS + ((st & 1) ? 0.1 * stepS : 0));
        const CH = [[45, 52, 55, 59, 64], [41, 48, 52, 57, 60], [48, 52, 55, 59, 64], [43, 50, 55, 59, 64]], DR = [33, 29, 36, 31];
        const srP = sr / 2, pad = new Float32Array(Math.ceil(n / 2));
        for (let c = 0; c < 4; c++) {
            for (const m of CH[c]) { this._padNote(pad, srP, Math.floor(at(c * 2, 0) / 2), this._mtof(m), 8, 2, 3, 450, 800, 6, r); yield; }
            this._put(k, this._vBass(S, sr, this._mtof(DR[c]), 7.5, 0.35), at(c * 2, 0), 0.6, 0.6, 0.15, 0);
            yield;
        }
        yield* this._padMix(k, pad, 0.2, 0, 0.45);
        const MEL = [
            [[2, 76, 8], [10, 72, 6], [16, 74, 6], [24, 69, 8]],
            [[0, 72, 6], [8, 77, 6], [14, 76, 6], [22, 72, 8], [28, 69, 4]],
            [[2, 79, 6], [10, 76, 6], [18, 72, 6], [26, 67, 6]],
            [[0, 74, 6], [6, 79, 6], [14, 81, 6], [22, 76, 6], [28, 74, 4]],
        ];
        for (let c = 0; c < 4; c++) {
            for (const [st, m, ln] of MEL[c]) {
                const i0 = at(c * 2 + (st >> 4), st & 15), len = this._vPluck(S, sr, this._mtof(m), 0.4, 'bell', 0.8 + ln * 0.05);
                this._put(k, len, i0, 0.8, 0.6, 0.6, 0);
                this._put(k, len, i0 + Math.floor(6 * stepS), 0.1, 0.35, 0.3, 0);
            }
            yield;
        }
        for (let bar = 0; bar < bars; bar += 2) this._put(k, this._vKick(S, sr, 0.3, r), at(bar, 0), 0.7, 0.7, 0.1, 0);
        for (let bar = 0; bar < bars; bar++) for (let st = 0; st < 16; st += 2) { const [gl, gr] = this._pg((st % 4) ? 0.4 : -0.4); this._put(k, this._vHat(S, sr, 0.035, r, 0.03), at(bar, st), gl, gr, 0.1, 0); }
        const PENTA = [81, 84, 88, 91, 93];
        this._poisson(r, 0.5, n / sr - 3, () => 0.35, t => {
            const m = PENTA[Math.floor(r() * PENTA.length)], len = this._vPluck(S, sr, this._mtof(m), 0.14 + 0.06 * r(), 'bell', 1);
            const [gl, gr] = this._pg(r() * 2 - 1);
            this._put(k, len, Math.floor(t * sr), gl, gr, 0.7, 0);
        });
        yield;
        this._dust(k, r, 14, 0.02);
        yield* this._finishSong(k, 0.15, 0.7);
        return { s: [k.L, k.R], sr };
    },

    // 'results' — пэд-петля 16 с под экран итогов, ре мажор: Dmaj7 – Bm7 – Gmaj7 – A; редкие колокольчики, басс-дрон, без ударных.
    *_songResults() {
        const sr = 22050, bpm = 60, bars = 4, stepS = sr * 60 / bpm / 4, n = Math.round(stepS * 16 * bars);
        const k = this._kit(sr, n, 8), S = k.S, r = this._rng(7004);
        const at = (bar, st) => Math.floor((bar * 16 + st) * stepS);
        const CH = [[50, 57, 61, 66, 69], [47, 54, 57, 62, 66], [43, 50, 54, 59, 62], [45, 52, 57, 61, 64]], DR = [38, 35, 31, 33];
        const srP = sr / 2, pad = new Float32Array(Math.ceil(n / 2));
        for (let c = 0; c < 4; c++) {
            for (const m of CH[c]) { this._padNote(pad, srP, Math.floor(at(c, 0) / 2), this._mtof(m), 4, 1.5, 3, 500, 900, 6, r); yield; }
            this._put(k, this._vBass(S, sr, this._mtof(DR[c]), 3.8, 0.3), at(c, 0), 0.6, 0.6, 0.15, 0);
            yield;
        }
        yield* this._padMix(k, pad, 0.2, 0, 0.5);
        const ARP = [[74, 78, 81], [71, 74, 78], [67, 71, 74], [69, 73, 76]];
        for (let c = 0; c < 4; c++) {
            [0, 6, 12].forEach((st, j) => {
                const len = this._vPluck(S, sr, this._mtof(ARP[c][j]), 0.26, 'bell', 1);
                const [gl, gr] = this._pg(j === 1 ? 0.4 : -0.3);
                this._put(k, len, at(c, st), gl, gr, 0.6, 0);
            });
            yield;
        }
        yield* this._finishSong(k, 0.15, 0.7);
        return { s: [k.L, k.R], sr };
    },

    // Фанфара итогов: удар, восходящий колокольчик Ре-Фа#-Ля-Ре и светлый аккорд, затухает за 7 с (одноразовая, не петля).
    *_songSting() {
        const sr = 22050, n = sr * 7, k = this._kit(sr, n, 8), S = k.S, r = this._rng(7005);
        this._put(k, this._vKick(S, sr, 0.7, r), 0, 0.8, 0.8, 0.1, 0);
        [[74, 0.05], [78, 0.3], [81, 0.55], [86, 0.8]].forEach(([m, t], j) => {
            const len = this._vPluck(S, sr, this._mtof(m), 0.34, 'bell', 1.3), [gl, gr] = this._pg(-0.4 + j * 0.27);
            this._put(k, len, Math.floor(t * sr), gl, gr, 0.6, 0);
        });
        yield;
        const srP = sr / 2, pad = new Float32Array(Math.ceil(n / 2));
        for (const m of [50, 57, 62, 64]) { this._padNote(pad, srP, 0, this._mtof(m), 3, 0.5, 2.4, 600, 1400, 6, r); yield; }
        for (const m of [66, 69, 73]) { this._padNote(pad, srP, Math.floor(1.0 * srP), this._mtof(m), 3, 0.7, 2.4, 600, 1500, 6, r); yield; }
        yield* this._padMix(k, pad, 0.2, 0, 0.5);
        this._poisson(r, 1.0, 4.5, () => 3, t => {
            const len = this._vPluck(S, sr, this._mtof([86, 90, 93, 98][Math.floor(r() * 4)]), 0.08, 'bell', 0.8), [gl, gr] = this._pg(r() * 2 - 1);
            this._put(k, len, Math.floor(t * sr), gl, gr, 0.7, 0);
        });
        yield* this._finishSong(k, 0.2, 0.8);
        const f = Math.floor(sr * 1.6);
        for (let i = 0; i < f; i++) { const g = 0.5 + 0.5 * Math.cos(Math.PI * i / f); k.L[n - f + i] *= g; k.R[n - f + i] *= g; }
        return { s: [k.L, k.R], sr };
    },
};
