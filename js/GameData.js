// GameData.js — таблицы игры Steal a Destruction Egg: редкости и яйца, вылазки, оружие, улучшения, цены.
// Данные игры, а не константы редактора (как GAME_GROUNDS): правятся здесь, логика — в GameRaid / GameBase / GameTools.

/** Редкости по возрастанию. color — цвет плашек интерфейса, glow — свечение нимба яйца. */
const RARITIES = [
    { id: 'common', ru: 'Обычное', en: 'Common', color: '#b7bec9', dark: '#5e6672', slow: 0.92 },
    { id: 'rare', ru: 'Редкое', en: 'Rare', color: '#35a7ff', dark: '#0a4f96', slow: 0.88 },
    { id: 'epic', ru: 'Эпическое', en: 'Epic', color: '#b44dff', dark: '#5a1aa0', slow: 0.84 },
    { id: 'legendary', ru: 'Легендарное', en: 'Legendary', color: '#ffc21a', dark: '#a86a00', slow: 0.8 },
    { id: 'mythic', ru: 'Мифическое', en: 'Mythic', color: '#ff3b5c', dark: '#a30f2c', slow: 0.76 },
    { id: 'divine', ru: 'Божественное', en: 'Divine', color: '#2ff5d0', dark: '#067f6b', slow: 0.72 },
    { id: 'secret', ru: 'Секретное', en: 'Secret', color: '#ff5cf2', dark: '#1b1030', slow: 0.68 },
];

/**
 * Яйца. rarity — номер в RARITIES; income — $/с в гнезде; a, b — материалы узора (VoxMat); pattern — рисунок вокселями
 * (spots, stripes, zigzag, rings, cracks, checker, split, stars, glitch); icon — значок из assets/ui/eggs.
 */
const EGGS = [
    { id: 'brick', rarity: 0, income: 5, ru: 'Кирпичное яйцо', en: 'Brick Egg', a: 'brick', b: 'mortar', pattern: 'checker', icon: 'brown' },
    { id: 'gravel', rarity: 0, income: 7, ru: 'Щебёночное яйцо', en: 'Gravel Egg', a: 'egg_stone', b: 'egg_dark', pattern: 'spots', icon: 'stone' },
    { id: 'crack', rarity: 0, income: 9, ru: 'Треснутое яйцо', en: 'Cracked Egg', a: 'egg_white', b: 'egg_dark', pattern: 'cracks', icon: 'cracked' },
    { id: 'slime', rarity: 1, income: 22, ru: 'Слизневое яйцо', en: 'Slime Egg', a: 'egg_green', b: 'toy_dgreen', pattern: 'spots', icon: 'slime' },
    { id: 'ice', rarity: 1, income: 30, ru: 'Ледяное яйцо', en: 'Ice Egg', a: 'egg_blue', b: 'egg_white', pattern: 'stripes', icon: 'ice' },
    { id: 'leafy', rarity: 1, income: 38, ru: 'Листовое яйцо', en: 'Leaf Egg', a: 'egg_green', b: 'egg_gold', pattern: 'zigzag', icon: 'leaf' },
    { id: 'soul', rarity: 2, income: 95, ru: 'Яйцо души', en: 'Soul Egg', a: 'egg_purple', b: 'egg_pink', pattern: 'zigzag', icon: 'soul' },
    { id: 'skull', rarity: 2, income: 125, ru: 'Череп-яйцо', en: 'Skull Egg', a: 'egg_white', b: 'egg_dark', pattern: 'rings', icon: 'skull' },
    { id: 'crystal', rarity: 2, income: 155, ru: 'Кристальное яйцо', en: 'Crystal Egg', a: 'egg_purple', b: 'egg_cyan', pattern: 'checker', icon: 'crystal' },
    { id: 'golden', rarity: 3, income: 420, ru: 'Золотое яйцо', en: 'Golden Egg', a: 'egg_gold', b: 'egg_white', pattern: 'rings', icon: 'golden' },
    { id: 'flame', rarity: 3, income: 560, ru: 'Огненное яйцо', en: 'Flame Egg', a: 'egg_red', b: 'egg_gold', pattern: 'zigzag', icon: 'flaming' },
    { id: 'diamond', rarity: 3, income: 720, ru: 'Алмазное яйцо', en: 'Diamond Egg', a: 'egg_cyan', b: 'egg_white', pattern: 'checker', icon: 'diamond' },
    { id: 'volcano', rarity: 4, income: 1900, ru: 'Вулканическое яйцо', en: 'Volcanic Egg', a: 'egg_dark', b: 'egg_red', pattern: 'cracks', icon: 'volcanic' },
    { id: 'aurora', rarity: 4, income: 2500, ru: 'Яйцо-сияние', en: 'Aurora Egg', a: 'egg_cyan', b: 'egg_pink', pattern: 'stripes', icon: 'aurora' },
    { id: 'asteroid', rarity: 4, income: 3200, ru: 'Астероидное яйцо', en: 'Asteroid Egg', a: 'egg_dark', b: 'egg_gold', pattern: 'spots', icon: 'asteroid' },
    { id: 'solar', rarity: 5, income: 9500, ru: 'Солнечное яйцо', en: 'Solar Egg', a: 'egg_gold', b: 'egg_red', pattern: 'stars', icon: 'solaris' },
    { id: 'galaxy', rarity: 5, income: 12500, ru: 'Галактическое яйцо', en: 'Galaxy Egg', a: 'egg_dark', b: 'egg_cyan', pattern: 'stars', icon: 'galaxy' },
    { id: 'titan', rarity: 5, income: 16000, ru: 'Яйцо титана', en: 'Titan Egg', a: 'egg_gold', b: 'egg_purple', pattern: 'split', icon: 'egg-giant' },
    { id: 'blackhole', rarity: 6, income: 52000, ru: 'Яйцо чёрной дыры', en: 'Black Hole Egg', a: 'egg_dark', b: 'egg_pink', pattern: 'rings', icon: 'blackhole' },
    { id: 'dragon', rarity: 6, income: 68000, ru: 'Драконье яйцо', en: 'Dragon Egg', a: 'egg_red', b: 'egg_dark', pattern: 'checker', icon: 'egg-dragon' },
    { id: 'glitch', rarity: 6, income: 90000, ru: 'Глитч-яйцо', en: 'Glitch Egg', a: 'egg_pink', b: 'egg_cyan', pattern: 'glitch', icon: 'aurora' },
];

/** Карты вылазок: выпадают случайно, но одинаково у всех игроков (сид в buildRaids). */
const RAID_MAPS = [
    { map: 'farm', ru: 'Ферма', en: 'Farm' }, { map: 'suburb', ru: 'Пригород', en: 'Suburb' }, { map: 'gas-station', ru: 'Заправка', en: 'Gas Station' },
    { map: 'village', ru: 'Горная деревня', en: 'Mountain Village' }, { map: 'desert', ru: 'Пустынный аванпост', en: 'Desert Outpost' }, { map: 'construction', ru: 'Стройка', en: 'Construction Site' },
    { map: 'docks', ru: 'Порт', en: 'Docks' }, { map: 'factory', ru: 'Завод', en: 'Factory' }, { map: 'downtown', ru: 'Центр города', en: 'Downtown' },
];
const RAID_COUNT = 100;

/**
 * 100 вылазок: карта, небо и погода — случайно по сиду, сложность только растёт: число охраны, виды врагов (tier), множители
 * здоровья и урона, подкрепление, редкость яиц, награда. Каждая 10-я — с боссом. Поля записи: id, n (номер), map, ru, en,
 * stars (1..10), enemies, waves [сколько, раз в сколько с], tier, hpMul, dmgMul, odds (шансы редкостей, в сумме 100), bonus ($),
 * boss, bossCount, sky ('day' | 'dawn' | 'sunset' | 'night'), weather ('clear' | 'rain' | 'snow' | 'storm').
 */
function buildRaids() {
    let seed = 1337;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (table) => { let r = rnd(), last = table[0][0]; for (const [v, w] of table) { last = v; r -= w; if (r <= 0) break; } return last; };
    const out = [];
    /** @type {any[]} */
    let bag = [];
    let last = '';
    for (let n = 1; n <= RAID_COUNT; n++) {
        if (!bag.length) { bag = RAID_MAPS.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = bag[i]; bag[i] = bag[j]; bag[j] = t; } }
        let m = n === 1 ? bag.splice(bag.findIndex(q => q.map === 'farm'), 1)[0] : bag.pop();
        if (m.map === last && bag.length) { const q = bag.pop(); bag.unshift(m); m = q; }
        last = m.map;
        // редкость плавно ползёт от обычных к секретным
        const c = (n - 1) / (RAID_COUNT - 1) * 6.4;
        const wt = RARITIES.map((_, r) => Math.exp(-(((r - c) / 0.85) ** 2)));
        const sum = wt.reduce((a, b) => a + b, 0);
        const odds = wt.map(v => { const q = v / sum * 100; return q < 0.5 ? 0 : Math.round(q * 10) / 10; });
        let sky = 'day', weather = 'clear';
        if (n > 2) {
            sky = pick([['day', 0.38], ['dawn', 0.16], ['sunset', 0.16], ['night', 0.3]]);
            weather = pick([['clear', 0.46], ['rain', 0.24], ['snow', 0.12], ['storm', 0.18]]);
            if (n < 8 && weather === 'storm') weather = 'rain';
            if (m.map === 'village' && weather !== 'storm') weather = 'snow';
            if (m.map === 'desert' && (weather === 'rain' || weather === 'snow')) weather = 'clear';
        }
        const isBoss = n % 10 === 0;
        out.push({
            id: 'r' + n, n, map: m.map, ru: m.ru, en: m.en, stars: Math.ceil(n / 10),
            enemies: Math.round(6 + n * 0.2) + (isBoss ? 2 : 0), waves: [3 + Math.floor(n / 22), Math.max(9, 16 - n * 0.07)],
            tier: Math.min(7, 1 + Math.floor((n - 1) / 7)), hpMul: Math.round((1 + (n - 1) * 0.09) * 100) / 100, dmgMul: Math.round((1 + (n - 1) * 0.03) * 100) / 100,
            odds, bonus: Math.round(100 * Math.pow(1.09, n - 1) / 10) * 10 * (isBoss ? 3 : 1), boss: isBoss ? 'qhen' : null, bossCount: isBoss ? (n >= 50 ? 2 : 1) : 0, sky, weather,
        });
    }
    return out;
}
const RAIDS = buildRaids();

/**
 * Оружие. kind: bullet | plasma | pellets | proj | rail | tesla | freeze | flame | hole | melee | grab | bomb.
 * Общие поля: price ($, 0 — выдано сразу), mag, reload (с), rate (с между выстрелами), auto, dmg, cut — вырез во враге (м),
 * bore — вырез в мире (м), power — класс материала (VoxMat.hard), impulse — толчок врага (м/с), spread, pen — сквозь сколько.
 */
const WEAPONS = [
    { id: 'hammer', cat: 'melee', kind: 'melee', ru: 'Кувалда', en: 'Sledgehammer', price: 0, mag: 0, rate: 0.5, auto: true, dmg: 38, cut: 0.2, bore: 0.3, power: 2, impulse: 15 },
    { id: 'ar_ginger', cat: 'rifle', kind: 'bullet', ru: 'АР «Рыжик»', en: 'Ginger AR', price: 0, mag: 30, reload: 1.6, rate: 0.105, auto: true, dmg: 9, cut: 0.08, bore: 0.13, power: 2, impulse: 3.2, spread: 0.012, pen: 2, kick: 0.018 },
    { id: 'sg_granny', cat: 'shotgun', kind: 'pellets', ru: 'Обрез Бабули', en: "Granny's Sawn-off", price: 800, mag: 2, reload: 1.7, rate: 0.26, auto: false, pellets: 12, dmg: 7, cut: 0.075, bore: 0.11, power: 2, impulse: 2.6, spread: 0.1, pen: 2, kick: 0.095, punch: 1.3 },
    { id: 'bomb', cat: 'special', kind: 'bomb', ru: 'Динамит', en: 'Dynamite', price: 500, mag: 3, reload: 4, rate: 0.55, auto: false, blast: 2.8, fuse: 2.2 },
    { id: 'gl_thumper', cat: 'launcher', kind: 'proj', ru: 'Тумпер', en: 'Thumper', price: 1200, mag: 1, reload: 1.25, rate: 0.2, auto: false, pitch: 1.2, proj: 'proj_grenade', projScale: 1.7, speed: 24, gravity: 11, bounce: 0.52, fuse: 1.7, blast: 2.7, kick: 0.07 },
    { id: 'grab', cat: 'special', kind: 'grab', ru: 'Гравипушка', en: 'Gravity Gun', price: 1500, mag: 0, rate: 0.3, auto: false },
    { id: 'carbine_sigma', cat: 'rifle', kind: 'bullet', ru: 'Карабин «Сигма»', en: 'Sigma Carbine', price: 2500, mag: 24, reload: 1.7, rate: 0.34, auto: true, pitch: 1.12, burst: 3, burstGap: 0.065, dmg: 17, cut: 0.1, bore: 0.15, power: 3, impulse: 4.4, spread: 0.006, pen: 3, kick: 0.022 },
    { id: 'torch', cat: 'special', kind: 'flame', ru: 'Огнемёт', en: 'Flamethrower', price: 3500, mag: 100, reload: 2.5, rate: 0.05, auto: true, dmg: 4.5, range: 6.2, burn: 3 },
    { id: 'launcher', cat: 'launcher', kind: 'proj', ru: 'РПГ «Бум»', en: 'Boom RPG', price: 6000, mag: 1, reload: 1.8, rate: 0.2, auto: false, proj: 'rocket', speed: 38, gravity: 1.6, blast: 3.1, kick: 0.05, trail: true },
    { id: 'gl_drum', cat: 'launcher', kind: 'proj', ru: 'Барабан-6', en: 'Drum-6', price: 9000, mag: 6, reload: 3, rate: 0.42, auto: true, pitch: 1.3, proj: 'proj_grenade', projScale: 1.5, speed: 27, gravity: 9, blast: 2.2, kick: 0.05 },
    { id: 'sg_autodrum', cat: 'shotgun', kind: 'pellets', ru: 'Авто-Дробь', en: 'Auto-Shot', price: 14000, mag: 20, reload: 3.1, rate: 0.23, auto: true, pitch: 1.18, pellets: 8, dmg: 8.5, cut: 0.08, bore: 0.11, power: 2, impulse: 2.8, spread: 0.075, pen: 2, kick: 0.05, punch: 0.5 },
    { id: 'minigun_brrt', cat: 'minigun', kind: 'bullet', ru: 'Брррт-9000', en: 'Brrrt-9000', price: 18000, mag: 220, reload: 3.8, rate: 0.043, auto: true, pitch: 1.38, spin: 0.65, dmg: 8.5, cut: 0.085, bore: 0.13, power: 3, impulse: 2.8, spread: 0.024, pen: 2, kick: 0.009, slow: 0.62 },
    { id: 'gl_sticky', cat: 'launcher', kind: 'proj', ru: 'Липучка', en: 'Sticky', price: 28000, mag: 5, reload: 2.6, rate: 0.55, auto: false, pitch: 0.85, proj: 'proj_sticky', projScale: 1.3, speed: 21, gravity: 10, sticky: true, fuse: 6, blast: 2.8, kick: 0.05, alt: 'detonate' },
    { id: 'sawgun', cat: 'special', kind: 'proj', ru: 'Пилострел', en: 'Sawgun', price: 45000, mag: 8, reload: 2.4, rate: 0.45, auto: true, pitch: 1.5, proj: 'proj_saw', projScale: 1.5, speed: 26, gravity: 0, saw: true, ricochet: 5, fuse: 3.2, dmg: 62, cut: 0.2, bore: 0.26, power: 3, impulse: 8, kick: 0.04 },
    { id: 'sniper_giga', cat: 'rifle', kind: 'bullet', ru: 'Гига-Снайпер', en: 'Giga Sniper', price: 60000, mag: 5, reload: 2.4, rate: 1.05, auto: false, sound: 'shotgun', pitch: 0.62, dmg: 190, cut: 0.23, bore: 0.3, power: 4, impulse: 13, spread: 0, pen: 9, kick: 0.09, zoom: 0.42, punch: 0.4 },
    { id: 'tesla', cat: 'special', kind: 'tesla', ru: 'Тесла-Шокер', en: 'Tesla Shocker', price: 70000, mag: 100, reload: 2.4, rate: 0.11, auto: true, dmg: 15, range: 15, chain: 4, chainR: 5.5, ammoUse: 2 },
    { id: 'gl_cluster', cat: 'launcher', kind: 'proj', ru: 'Кассетная Мортира', en: 'Cluster Mortar', price: 85000, mag: 3, reload: 2.8, rate: 0.75, auto: true, pitch: 0.72, proj: 'proj_cluster', projScale: 1.4, speed: 19, gravity: 11, cluster: 7, blast: 1.9, bomblet: 1.6, kick: 0.08 },
    { id: 'freezer', cat: 'special', kind: 'freeze', ru: 'Морозилка', en: 'Freezer', price: 110000, mag: 100, reload: 2.6, rate: 0.06, auto: true, range: 9, freeze: 0.9, freezeSec: 4.5, ammoUse: 1.3 },
    { id: 'railgun', cat: 'special', kind: 'rail', ru: 'Рельсотрон', en: 'Railgun', price: 150000, mag: 3, reload: 2.8, rate: 1.1, auto: false, charge: 0.45, dmg: 320, cut: 0.34, bore: 0.34, impulse: 19, kick: 0.12, punch: 2.2 },
    { id: 'minigun_vulcan', cat: 'minigun', kind: 'plasma', ru: 'Плазма-Вулкан', en: 'Plasma Vulcan', price: 220000, mag: 140, reload: 3.6, rate: 0.082, auto: true, spin: 0.8, dmg: 14, blast: 0.82, spread: 0.018, kick: 0.012, slow: 0.66 },
    { id: 'sharkgun', cat: 'launcher', kind: 'proj', ru: 'Акулострел', en: 'Shark Launcher', price: 320000, mag: 4, reload: 2.7, rate: 0.62, auto: true, pitch: 0.9, proj: 'proj_shark', projScale: 1.5, speed: 19, gravity: 0, homing: 5, blast: 3, fuse: 6, kick: 0.05, trail: true },
    { id: 'blackhole', cat: 'special', kind: 'hole', ru: 'Чёрная Дыра', en: 'Black Hole', price: 450000, mag: 1, reload: 8, rate: 0.5, auto: false, speed: 11, life: 4.5, pullR: 13, pull: 42, blast: 4.4, kick: 0.05 },
];

/** Категории для вкладок арсенала. */
const WEAPON_CATS = [
    { id: 'rifle', ru: 'Винтовки', en: 'Rifles' },
    { id: 'minigun', ru: 'Миниганы', en: 'Miniguns' },
    { id: 'launcher', ru: 'Гранатомёты', en: 'Launchers' },
    { id: 'shotgun', ru: 'Дробовики', en: 'Shotguns' },
    { id: 'special', ru: 'Необычное', en: 'Special' },
    { id: 'melee', ru: 'Ближний бой', en: 'Melee' },
];

/** Улучшения: base — цена первого уровня, grow — множитель цены, max — уровней. */
const UPGRADES = [
    { id: 'power', ru: 'Мощь оружия', en: 'Weapon Power', icon: 'bolt', base: 700, grow: 1.62, max: 30, per: 0.1 },
    { id: 'hp', ru: 'Здоровье', en: 'Health', icon: 'heart', base: 400, grow: 2.2, max: 12, per: 25 },
    { id: 'speed', ru: 'Скорость', en: 'Speed', icon: 'shoe', base: 600, grow: 2.3, max: 8, per: 0.06 },
    { id: 'armor', ru: 'Броня', en: 'Armor', icon: 'shield', base: 1500, grow: 2.4, max: 8, per: 0.06 },
    { id: 'slots', ru: 'Слоты оружия', en: 'Weapon Slots', icon: 'backpack', base: 1800, grow: 7, max: 3, per: 1 },
    { id: 'loot', ru: 'Добыча', en: 'Loot', icon: 'money', base: 900, grow: 2.5, max: 10, per: 0.15 },
];

/** Цена следующего гнезда: start — бесплатных, дальше по таблице. */
/** Покупка за рекламу: просмотров от 1 до 8 по логарифму цены (самое дорогое оружие — 8). */
const AD_VIEWS = { min: 500, max: 450000, most: 8 };

const NESTS = { start: 3, max: 18, price: n => Math.round(350 * Math.pow(2.05, n - 3)) };

const PLAYER_BASE = { hp: 100, regenDelay: 6, regen: 12, slots: 3 };

/** @satisfies {Record<string, any>} */
const GameData = {
    weapon(id) { return WEAPONS.find(w => w.id === id) || null; },
    egg(id) { return EGGS.find(e => e.id === id) || null; },
    raid(id) { return RAIDS.find(r => r.id === id) || null; },
    upgrade(id) { return UPGRADES.find(u => u.id === id) || null; },
    /** Случайное яйцо по шансам вылазки. */
    rollEgg(raid) {
        let r = Math.random() * 100, rar = 0;
        for (let i = 0; i < raid.odds.length; i++) { r -= raid.odds[i]; if (r <= 0) { rar = i; break; } rar = i; }
        const pool = EGGS.filter(e => e.rarity === rar);
        return pool[Math.floor(Math.random() * pool.length)] || EGGS[0];
    },
    /** «Вылазка 37 · Завод». */
    adViews(price) {
        const k = Math.log(Math.max(price, AD_VIEWS.min) / AD_VIEWS.min) / Math.log(AD_VIEWS.max / AD_VIEWS.min);
        return Math.max(1, Math.min(AD_VIEWS.most, 1 + Math.round((AD_VIEWS.most - 1) * k)));
    },
    raidTitle(r) { const en = typeof Lang !== 'undefined' && Lang.code === 'en'; return (en ? 'Raid ' : 'Вылазка ') + r.n + ' · ' + (en ? r.en : r.ru); },
    /** Подпись на языке игры из записи { ru, en }. */
    label(o) { return (typeof Lang !== 'undefined' && Lang.code === 'en') ? (o.en || o.ru) : (o.ru || o.en); },
    /** Деньги коротко: 1 234, 12.3K, 4.5M. */
    money(n) {
        n = Math.floor(n);
        if (n < 10000) return '$' + n.toLocaleString('ru-RU').replace(/ /g, ' ');
        const u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
        for (const [v, s] of /** @type {[number, string][]} */ (u)) if (n >= v) { const q = n / v; return '$' + (q >= 100 ? q.toFixed(0) : q.toFixed(1)) + s; }
        return '$' + n;
    },
};
