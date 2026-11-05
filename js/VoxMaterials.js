// VoxMaterials.js — материалы вокселей Rubble Lab: цвет, плотность, прочность, трение, горючесть.
// Воксель хранится одним байтом: 0 — пусто, 1..127 — номер материала, бит 128 — обгорел (темнее).
// Числа физики материалов — данные таблицы (как GAME_GROUNDS), а не константы редактора.
//
//   hard      — класс прочности: 0 неразрушимый, 1 мягкий (стекло, листва), 2 средний (дерево,
//               штукатурка, земля, кирпич), 3 твёрдый (бетон, камень), 4 металл. Инструмент ломает
//               материал, если его сила >= hard; взрыв — по сопротивлению resist.
//   resist    — доля радиуса взрыва, на которой материал ещё разрушается (стекло > 1, металл ~0.3)
//   density   — кг/м³ (масса вокселя = density · VOX_SIZE³)
//   friction, restitution — для контактов твёрдых тел; brittle — порог удара (м/с), выше которого
//               материал крошится сам (стекло, листва); 0 — не крошится от ударов
//   burn      — 0..1 горючесть; sound — класс звука GameAudio; noise — разброс цвета по вокселям
//   spec      — блик (0..1); glow — свечение (0..1, лава/лампы)

/** @typedef {{ id: number, key: string, sound: string, color: number[], noise: number, hard: number, resist: number,
 *   density: number, friction: number, restitution: number, brittle: number, burn: number, spec: number, glow: number,
 *   glass: boolean, explosive: boolean, plastic: boolean, toy: boolean }} VoxMaterial */

/** @satisfies {Record<string, any>} */
const VoxMat = {
    /** @type {VoxMaterial[]} */
    list: [],
    /** @type {Record<string, number>} */
    id: {},
    CHAR: 128,              // бит «обгорел»
    MASK: 127,
    SATURATE: 1.55,         // насыщенность старых материалов (мир как в Roblox)
    BRIGHTEN: 1.14,         // яркость старых материалов
    NOISE: 0.4,             // шум цвета старых материалов
    // Палитра для сетки: r, g, b (0..1, экранные), шум, блик, свечение — по номеру байта 0..255 (с обгоревшими).
    rgb: new Float32Array(256 * 3),
    aux: new Float32Array(256 * 4),

    /** @param {string} key @param {any} o */
    def(key, o) {
        const id = this.list.length ? this.list[this.list.length - 1].id + 1 : 1;
        const hex = o.color;
        // мир в стиле Roblox: реалистичные цвета старых материалов — ярче и чище, почти без шума
        const toy = !!(o.plastic || o.toy);
        let col = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
        if (!toy) {
            const g = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
            col = col.map(c => Math.min(1, (g + (c - g) * VoxMat.SATURATE) * VoxMat.BRIGHTEN));
        }
        const m = /** @type {VoxMaterial} */ ({
            id, key, sound: o.sound || key,
            color: col,
            plastic: !!o.plastic, toy,
            noise: (o.noise != null ? o.noise : 0.08) * (toy ? 1 : VoxMat.NOISE), hard: o.hard != null ? o.hard : 2, resist: o.resist != null ? o.resist : 1,
            density: o.density || 1000, friction: o.friction != null ? o.friction : 0.6, restitution: o.restitution || 0.1,
            brittle: o.brittle || 0, burn: o.burn || 0, spec: o.spec || 0, glow: o.glow || 0,
            glass: !!o.glass, explosive: !!o.explosive,
        });
        this.list.push(m);
        this.id[key] = id;
        return id;
    },

    /** Имя-синоним: номеров всего 127 (бит 128 — обгорел), близкие оттенки делят один номер. */
    alias(key, target) { this.id[key] = this.id[target]; },

    /** @param {number} v байт вокселя @returns {VoxMaterial} */
    of(v) { return this.list[(v & 127) - 1] || this.list[0]; },

    build() {
        if (this.list.length > 127) console.error('VoxMat: материалов больше 127: ' + this.list.length);
        for (let v = 0; v < 256; v++) {
            const m = this.list[(v & 127) - 1];
            if (!m || !(v & 127)) continue;
            const k = (v & 128) ? 0.34 : 1;
            this.rgb[v * 3] = m.color[0] * k;
            this.rgb[v * 3 + 1] = m.color[1] * k * ((v & 128) ? 0.92 : 1);
            this.rgb[v * 3 + 2] = m.color[2] * k * ((v & 128) ? 0.85 : 1);
            this.aux[v * 4] = (v & 128) ? m.noise * 1.6 : m.noise;
            this.aux[v * 4 + 1] = (v & 128) ? 0 : m.spec;
            this.aux[v * 4 + 2] = m.glow;
            this.aux[v * 4 + 3] = m.glass ? 1 : 0;
        }
    },
};

// Порядок задаёт номера материалов: новые — в конец (карты и тела хранят номера).
VoxMat.def('bedrock',  { color: 0x45413d, hard: 0, resist: 0, density: 2700, noise: 0.10, sound: 'rock' });
VoxMat.def('dirt',     { color: 0x6e5038, hard: 2, resist: 0.5, density: 1600, noise: 0.12, friction: 0.8, sound: 'dirt' });
VoxMat.def('grass',    { color: 0x5a8a37, hard: 2, resist: 0.55, density: 1500, noise: 0.07, friction: 0.8, sound: 'grass' });
VoxMat.def('wood',     { color: 0x9b6a3d, hard: 2, resist: 1.0, density: 650, noise: 0.10, friction: 0.55, restitution: 0.15, burn: 0.9, sound: 'wood' });
VoxMat.def('plank',    { color: 0xb8875a, hard: 2, resist: 1.05, density: 600, noise: 0.09, friction: 0.55, restitution: 0.15, burn: 1, sound: 'wood' });
VoxMat.def('darkwood', { color: 0x5e3f28, hard: 2, resist: 0.95, density: 700, noise: 0.08, friction: 0.55, restitution: 0.12, burn: 0.8, sound: 'wood' });
VoxMat.def('brick',    { color: 0x98483a, hard: 2, resist: 0.72, density: 1900, noise: 0.13, friction: 0.7, sound: 'brick' });
VoxMat.def('brick2',   { color: 0x7c3a2e, hard: 2, resist: 0.72, density: 1900, noise: 0.12, friction: 0.7, sound: 'brick' });
VoxMat.def('mortar',   { color: 0xb3aa9a, hard: 2, resist: 0.8, density: 1700, noise: 0.06, friction: 0.7, sound: 'brick' });
VoxMat.def('concrete', { color: 0x9c9a94, hard: 3, resist: 0.52, density: 2400, noise: 0.07, friction: 0.75, sound: 'concrete' });
VoxMat.def('concrete2',{ color: 0x7d7b76, hard: 3, resist: 0.52, density: 2400, noise: 0.07, friction: 0.75, sound: 'concrete' });
VoxMat.def('plaster',  { color: 0xe0d6c2, hard: 1, resist: 1.1, density: 1100, noise: 0.04, friction: 0.6, sound: 'plaster' });
VoxMat.def('plaster2', { color: 0x8fa6a0, hard: 1, resist: 1.1, density: 1100, noise: 0.04, friction: 0.6, sound: 'plaster' });
VoxMat.def('metal',    { color: 0x6f7880, hard: 4, resist: 0.3, density: 7800, noise: 0.05, friction: 0.45, restitution: 0.25, spec: 0.6, sound: 'metal' });
VoxMat.def('rust',     { color: 0x7d4a2c, hard: 4, resist: 0.34, density: 7800, noise: 0.14, friction: 0.5, restitution: 0.2, spec: 0.2, sound: 'metal' });
VoxMat.def('glass',    { color: 0x9fd2e0, hard: 1, resist: 1.6, density: 2500, noise: 0.02, friction: 0.4, restitution: 0.2, brittle: 2.5, spec: 1, glass: true, sound: 'glass' });
VoxMat.def('leaves',   { color: 0x48782c, hard: 1, resist: 1.5, density: 250, noise: 0.22, friction: 0.9, brittle: 4, burn: 0.7, sound: 'foliage' });
VoxMat.def('rock',     { color: 0x7b7770, hard: 3, resist: 0.45, density: 2600, noise: 0.12, friction: 0.8, sound: 'rock' });
VoxMat.def('roof',     { color: 0x6e2f25, hard: 2, resist: 0.85, density: 1800, noise: 0.10, friction: 0.65, sound: 'brick' });
VoxMat.def('asphalt',  { color: 0x3c3c3e, hard: 3, resist: 0.6, density: 2200, noise: 0.06, friction: 0.85, sound: 'concrete' });
VoxMat.def('tile',     { color: 0xd9dcd6, hard: 2, resist: 0.9, density: 2000, noise: 0.03, friction: 0.5, spec: 0.5, sound: 'plaster' });
VoxMat.def('barrel',   { color: 0xb3261e, hard: 2, resist: 1.2, density: 900, noise: 0.05, friction: 0.5, restitution: 0.2, spec: 0.4, explosive: true, sound: 'metal' });
VoxMat.def('hazard',   { color: 0xe0b021, hard: 4, resist: 0.3, density: 7800, noise: 0.03, friction: 0.45, spec: 0.5, sound: 'metal' });
VoxMat.def('lamp',     { color: 0xfff1c4, hard: 1, resist: 1.4, density: 1500, noise: 0.0, brittle: 3, glow: 1, glass: false, sound: 'glass' });
VoxMat.def('sand',     { color: 0xc8b07c, hard: 2, resist: 0.6, density: 1600, noise: 0.10, friction: 0.85, sound: 'dirt' });
VoxMat.def('foam',     { color: 0xe6e2da, hard: 1, resist: 1.3, density: 120, noise: 0.03, friction: 0.7, restitution: 0.3, sound: 'plaster' });
VoxMat.def('crate',    { color: 0xa97a45, hard: 2, resist: 1.0, density: 500, noise: 0.12, friction: 0.6, restitution: 0.15, burn: 1, sound: 'wood' });
VoxMat.def('blue',     { color: 0x2f5d8c, hard: 2, resist: 0.9, density: 1200, noise: 0.05, friction: 0.6, spec: 0.3, sound: 'plaster' });
// Материалы карты (GameMapBuild): оттенки и мелочи обстановки.
VoxMat.alias('grass2', 'grass');
VoxMat.alias('roof2', 'roof');
VoxMat.def('hay',      { color: 0xd2b25c, hard: 1, resist: 1.3, density: 160, noise: 0.16, friction: 0.9, burn: 1, sound: 'foliage' });
VoxMat.def('fabric',   { color: 0x55606d, hard: 1, resist: 1.3, density: 300, noise: 0.06, friction: 0.85, restitution: 0.2, burn: 0.9, sound: 'plaster' });
VoxMat.def('terracotta', { color: 0xb0603a, hard: 1, resist: 1.2, density: 1800, noise: 0.07, friction: 0.6, brittle: 4, sound: 'brick' });
VoxMat.def('paint',    { color: 0xd9d8cf, hard: 3, resist: 0.6, density: 2200, noise: 0.04, friction: 0.85, sound: 'concrete' });
VoxMat.def('steelg',   { color: 0x2f6650, hard: 4, resist: 0.3, density: 7800, noise: 0.05, friction: 0.45, restitution: 0.25, spec: 0.45, sound: 'metal' });
VoxMat.def('rubber',   { color: 0x232325, hard: 2, resist: 1.0, density: 1100, noise: 0.04, friction: 1.0, restitution: 0.45, burn: 0.5, sound: 'dirt' });
VoxMat.alias('leaves2', 'leaves');
// набор карт C: город, горная деревня, пустынный аванпост
VoxMat.def('snow',     { color: 0xedf1f5, hard: 1, resist: 1.3, density: 400, noise: 0.03, friction: 0.35, sound: 'foliage' });
VoxMat.alias('snow2', 'snow');
VoxMat.def('ice',      { color: 0xa7d3e6, hard: 1, resist: 1.4, density: 920, noise: 0.03, friction: 0.05, restitution: 0.1, brittle: 3, spec: 0.9, glass: true, sound: 'glass' });
VoxMat.def('water',    { color: 0x2f6f96, hard: 1, resist: 1.8, density: 1000, noise: 0.02, friction: 0.1, spec: 1, glass: true, sound: 'glass' });
VoxMat.def('stone',    { color: 0x908b82, hard: 3, resist: 0.5, density: 2500, noise: 0.12, friction: 0.75, sound: 'rock' });
VoxMat.def('stone2',   { color: 0x6e6961, hard: 3, resist: 0.5, density: 2500, noise: 0.10, friction: 0.75, sound: 'rock' });
VoxMat.def('slate',    { color: 0x4b515a, hard: 2, resist: 0.85, density: 2700, noise: 0.07, friction: 0.6, sound: 'rock' });
VoxMat.def('adobe',    { color: 0xb88660, hard: 2, resist: 0.8, density: 1550, noise: 0.10, friction: 0.75, sound: 'brick' });
VoxMat.alias('adobe2', 'adobe');
VoxMat.def('sandstone',  { color: 0xc69a68, hard: 3, resist: 0.55, density: 2300, noise: 0.11, friction: 0.8, sound: 'rock' });
VoxMat.alias('sandstone2', 'sandstone');
VoxMat.def('fueltank', { color: 0xe2e0d8, hard: 2, resist: 1.15, density: 900, noise: 0.03, friction: 0.5, restitution: 0.2, spec: 0.55, explosive: true, sound: 'metal' });
VoxMat.def('carred',   { color: 0xb3242b, hard: 3, resist: 0.55, density: 450, noise: 0.03, friction: 0.5, restitution: 0.15, spec: 0.7, sound: 'metal' });
VoxMat.def('carwhite', { color: 0xdcddd8, hard: 3, resist: 0.55, density: 450, noise: 0.03, friction: 0.5, restitution: 0.15, spec: 0.7, sound: 'metal' });
VoxMat.def('caryellow',{ color: 0xe3b021, hard: 3, resist: 0.55, density: 450, noise: 0.03, friction: 0.5, restitution: 0.15, spec: 0.7, sound: 'metal' });
VoxMat.def('neonred',  { color: 0xff4d3d, hard: 1, resist: 1.4, density: 1500, noise: 0.0, brittle: 3, glow: 0.85, sound: 'glass' });
VoxMat.def('neongreen',{ color: 0x4ce38a, hard: 1, resist: 1.4, density: 1500, noise: 0.0, brittle: 3, glow: 0.85, sound: 'glass' });
VoxMat.def('neonamber',{ color: 0xffb43a, hard: 1, resist: 1.4, density: 1500, noise: 0.0, brittle: 3, glow: 0.85, sound: 'glass' });
VoxMat.def('canvas',   { color: 0xc2473b, hard: 1, resist: 1.4, density: 350, noise: 0.05, friction: 0.8, burn: 1, sound: 'plaster' });
VoxMat.def('canvas2',  { color: 0xeadfc6, hard: 1, resist: 1.4, density: 350, noise: 0.05, friction: 0.8, burn: 1, sound: 'plaster' });
VoxMat.alias('pine', 'leaves');
VoxMat.def('cable',    { color: 0x2a2c30, hard: 2, resist: 0.6, density: 1200, noise: 0.03, friction: 0.5, restitution: 0.1, spec: 0.4, sound: 'metal' });
VoxMat.def('bronze',   { color: 0x8a6a35, hard: 3, resist: 0.45, density: 8700, noise: 0.06, friction: 0.5, restitution: 0.2, spec: 0.65, sound: 'metal' });
VoxMat.alias('stained', 'glass');
VoxMat.alias('stained2', 'glass');
// набор карт B: стройка, завод, порт (листовой металл — «эффективная» плотность тонкого листа на воксель)
VoxMat.def('rebar',    { color: 0x5b4535, hard: 3, resist: 0.42, density: 7800, noise: 0.12, friction: 0.5, restitution: 0.2, spec: 0.25, sound: 'metal' });
VoxMat.def('scaffold', { color: 0xa2aaae, hard: 3, resist: 0.42, density: 2600, noise: 0.05, friction: 0.45, restitution: 0.2, spec: 0.7, sound: 'metal' });
VoxMat.def('ctr_red',  { color: 0x9a3325, hard: 3, resist: 0.5, density: 450, noise: 0.07, friction: 0.5, restitution: 0.15, spec: 0.3, sound: 'metal' });
VoxMat.def('ctr_blue', { color: 0x2c5b88, hard: 3, resist: 0.5, density: 450, noise: 0.07, friction: 0.5, restitution: 0.15, spec: 0.3, sound: 'metal' });
VoxMat.def('ctr_green',{ color: 0x3e6a44, hard: 3, resist: 0.5, density: 450, noise: 0.07, friction: 0.5, restitution: 0.15, spec: 0.3, sound: 'metal' });
VoxMat.def('ctr_orange',{ color: 0xcc6a21, hard: 3, resist: 0.5, density: 450, noise: 0.07, friction: 0.5, restitution: 0.15, spec: 0.3, sound: 'metal' });
VoxMat.def('corrugated',{ color: 0x98a0a3, hard: 2, resist: 0.9, density: 700, noise: 0.05, friction: 0.5, restitution: 0.15, spec: 0.5, sound: 'metal' });
VoxMat.def('corrugated2',{ color: 0x4a7a7e, hard: 2, resist: 0.9, density: 700, noise: 0.05, friction: 0.5, restitution: 0.15, spec: 0.4, sound: 'metal' });
VoxMat.def('oxygen',   { color: 0x3566a5, hard: 2, resist: 1.2, density: 900, noise: 0.04, friction: 0.5, restitution: 0.2, spec: 0.5, explosive: true, sound: 'metal' });
VoxMat.def('tanksteel',{ color: 0xc2c6c3, hard: 4, resist: 0.36, density: 2400, noise: 0.04, friction: 0.45, restitution: 0.2, spec: 0.6, sound: 'metal' });
VoxMat.alias('mud', 'dirt');
VoxMat.def('gravel',   { color: 0x8a857c, hard: 2, resist: 0.55, density: 1700, noise: 0.17, friction: 0.85, sound: 'dirt' });
VoxMat.alias('redwash', 'brick');
// набор карт A: ферма, пригород, заправка
VoxMat.def('barnred',  { color: 0x9a2e24, hard: 2, resist: 1.0, density: 600, noise: 0.08, friction: 0.55, restitution: 0.15, burn: 0.9, sound: 'wood' });
VoxMat.def('trim',     { color: 0xe9e5da, hard: 2, resist: 1.0, density: 600, noise: 0.04, friction: 0.55, restitution: 0.15, burn: 0.8, sound: 'wood' });
VoxMat.def('tin',      { color: 0xa8b0b4, hard: 3, resist: 0.62, density: 900, noise: 0.06, friction: 0.45, restitution: 0.2, spec: 0.55, sound: 'metal' });
VoxMat.alias('soil', 'dirt');
VoxMat.def('crop',     { color: 0xc8a443, hard: 1, resist: 1.5, density: 120, noise: 0.2, friction: 0.9, brittle: 3, burn: 1, sound: 'foliage' });
VoxMat.def('carblue',  { color: 0x2b5ca6, hard: 3, resist: 0.55, density: 450, noise: 0.03, friction: 0.5, restitution: 0.15, spec: 0.7, sound: 'metal' });
VoxMat.def('cargreen', { color: 0x2f7f35, hard: 3, resist: 0.55, density: 600, noise: 0.03, friction: 0.5, restitution: 0.15, spec: 0.6, sound: 'metal' });
VoxMat.def('siding',   { color: 0xe0cd96, hard: 2, resist: 1.0, density: 600, noise: 0.05, friction: 0.55, restitution: 0.15, burn: 0.85, sound: 'wood' });
VoxMat.alias('siding2', 'siding');
VoxMat.def('brandteal',  { color: 0x16857e, hard: 2, resist: 0.9, density: 800, noise: 0.03, friction: 0.5, spec: 0.45, sound: 'metal' });
VoxMat.def('brandorange',{ color: 0xef8a1f, hard: 2, resist: 0.9, density: 800, noise: 0.03, friction: 0.5, spec: 0.45, sound: 'metal' });
VoxMat.alias('goods_y', 'crate');
VoxMat.alias('goods_g', 'crate');
// набор карт B (дополнение): мутная вода луж и доков
VoxMat.alias('murk', 'water');
// ---- Steal a Destruction Egg ----
// Плиты базы (как баз в Roblox: яркий пластик с шипами) — неразрушимые, класс шейдера 11.
VoxMat.def('plate_red',    { color: 0xff2a1f, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_green',  { color: 0x12d923, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_orange', { color: 0xff7a1a, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_blue',   { color: 0x1a7dff, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_purple', { color: 0xa23cff, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_yellow', { color: 0xffd21a, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_gray',   { color: 0x8e96a3, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_dark',   { color: 0x3b4252, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('plate_white',  { color: 0xf4f6fa, hard: 0, resist: 0, density: 2400, noise: 0, friction: 0.8, sound: 'concrete', plastic: true });
VoxMat.def('neon_cash',    { color: 0x3dff6e, hard: 0, resist: 0, density: 1500, noise: 0, glow: 0.3, sound: 'glass', plastic: true });
// Игрушечный пластик врагов и яиц (класс 12: без шипов). Внутри врагов — наполнитель toy_foam, никакой крови.
for (const [k, c, x] of /** @type {[string, number, any?][]} */ ([
    ['toy_white', 0xf6f7fb], ['toy_black', 0x1b1d24], ['toy_gray', 0x8d94a3], ['toy_dgray', 0x4a4f5c],
    ['toy_red', 0xf0312b], ['toy_orange', 0xff8a1f], ['toy_yellow', 0xffd52e], ['toy_lime', 0x9fe62c],
    ['toy_green', 0x2fbf3f], ['toy_dgreen', 0x1c7a33], ['toy_teal', 0x18b5a4], ['toy_cyan', 0x38d8f5],
    ['toy_blue', 0x2c6ff0], ['toy_navy', 0x1d2f7a], ['toy_purple', 0x8d3df0], ['toy_magenta', 0xe935c4],
    ['toy_pink', 0xff8fc4], ['toy_brown', 0x8a5428], ['toy_tan', 0xdcae78], ['toy_skin', 0xf7c79a],
    ['toy_cream', 0xfff0cf], ['toy_gold', 0xf7c021, { spec: 0.7 }], ['toy_chrome', 0xc9d3de, { spec: 0.85 }],
    ['toy_eye', 0xffffff, { glow: 0.15 }], ['toy_glow_red', 0xff3a2a, { glow: 0.9 }], ['toy_glow_cyan', 0x4cf0ff, { glow: 0.9 }],
    ['toy_foam', 0xffc531], ['toy_ice', 0xb9ecff, { spec: 0.9 }],
])) VoxMat.def(k, Object.assign({ color: c, hard: 2, resist: 1, density: 900, noise: 0.02, friction: 0.7, restitution: 0.25, sound: 'plaster', toy: true }, x || {}));
// Яйца: неразрушимые воксельные тела, узор — по редкости (GameEggs).
for (const [k, c, x] of /** @type {[string, number, any?][]} */ ([
    ['egg_stone', 0xb9bdc6], ['egg_green', 0x48e05a], ['egg_blue', 0x3f8cff], ['egg_purple', 0xb14dff],
    ['egg_gold', 0xffc928, { spec: 0.8 }], ['egg_red', 0xff3b30, { glow: 0.35 }], ['egg_pink', 0xff5cc8, { glow: 0.5 }],
    ['egg_cyan', 0x3cf2ff, { glow: 0.65 }], ['egg_dark', 0x22242e], ['egg_white', 0xfdfdf5],
])) VoxMat.def(k, Object.assign({ color: c, hard: 0, resist: 0, density: 700, noise: 0, friction: 0.55, restitution: 0.35, sound: 'plaster', toy: true }, x || {}));
VoxMat.build();

/** Номера материалов по имени: M.brick, M.glass … */
const M = VoxMat.id;
