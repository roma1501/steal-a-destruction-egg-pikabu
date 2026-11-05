// GameBase.js — логика базы: гнёзда и деньги, покупки, точки взаимодействия. Состояние — Game.state (единое сохранение).
//
// Гнёзда: state.nests — массив (длина = открыто гнёзд), элемент { egg: id | null, cash: накоплено }.
// Яйцо копит деньги на своей плите; наступил на плиту — забрал. Копится и пока игрок на вылазке.

/** @satisfies {Record<string, any>} */
const GameBase = {
    /** @type {any} */
    game: null,
    /** Виды гнёзд текущей загрузки базы. @type {any[]} */
    views: [],
    /** Точка взаимодействия рядом: { id, x, y, z, label, nest? } | null. */
    /** @type {any} */
    near: null,
    /** Манекены-мишени. @type {any[]} */
    dummies: [],
    /** Продавцы за прилавками. @type {any[]} */
    npcs: [],
    /** Боты, гуляющие по базе: их можно убить, они появляются снова. @type {any[]} */
    bots: [],
    BOT_COUNT: 7,
    BOT_NICKS: ['xX_Sigma_Xx', 'Pelmen_Pro', 'Shlep_King', 'MegaEgg2013', 'KrutoyPacan', 'lolkek_rus', 'Dimon4ik', 'egg_stealer', 'pro100_vasya', 'ChickenDad', 'TurboGoose', 'GigaBanan', 'CoolBaconXD', 'mama_ya_pro', 'Kukareku', 'BoomBoomKid', 'PixelMaster', 'Eggzorcist', 'Boltik', 'CrashTest'],
    /** @type {any} */
    _gateFx: null,

    init(game) { this.game = game; },
    get state() { return this.game.state; },

    /** Базовый доход: сколько $/с дают все яйца. */
    incomePerSec() {
        let s = 0;
        for (const n of this.state.nests) s += GamePets.nestIncome(n);
        return s;
    },

    /** Начисление дохода за время (и пока игрока нет на базе). */
    accrue(dt) {
        for (const n of this.state.nests) {
            if (!n.egg) continue;
            n.cash += GamePets.nestIncome(n) * dt;
            if (!n.pet) n.t = (n.t || 0) + dt;
        }
    },

    /** Доход за время отсутствия (игра была закрыта): половина, не больше 2 часов. */
    offlineIncome() {
        const st = this.state, now = Date.now();
        if (!st.lastSeen) { st.lastSeen = now; return 0; }
        const sec = Math.min(7200, Math.max(0, (now - st.lastSeen) / 1000));
        st.lastSeen = now;
        if (sec < 30) return 0;
        const before = this.incomePerSec() * sec * 0.5;
        this.accrue(sec * 0.5);
        return before;
    },

    // ------------------------------------------------------------------ покупки

    nestPrice() { return NESTS.price(this.state.nests.length); },
    canBuyNest() { return this.state.nests.length < NESTS.max && this.state.money >= this.nestPrice(); },
    buyNest() {
        if (!this.canBuyNest()) return false;
        this.state.money -= this.nestPrice();
        this._giveNest();
        return true;
    },
    _giveNest() {
        delete this.state.adViews.nest;
        this.state.nests.push({ egg: null, cash: 0 });
        this.game.persist();
        this.refreshViews();
        if (typeof GameAudio !== 'undefined') GameAudio.ui('select');
    },
    owns(id) { return this.state.owned.includes(id); },
    canBuyWeapon(id) { const w = GameData.weapon(id); return !!w && !this.owns(id) && this.state.money >= w.price; },
    buyWeapon(id) {
        if (!this.canBuyWeapon(id)) return false;
        this.state.money -= GameData.weapon(id).price;
        this._giveWeapon(id);
        return true;
    },
    _giveWeapon(id) {
        delete this.state.adViews['weapon:' + id];
        this.state.owned.push(id);
        // свободный слот — сразу в хотбар
        if (this.state.loadout.length < this.slots()) { this.state.loadout.push(id); GameTools.setLoadout(this.state.loadout); }
        this.game.persist();
        if (typeof GameAudio !== 'undefined') GameAudio.ui('select');
    },
    slots() { return PLAYER_BASE.slots + (this.state.upgrades.slots || 0); },
    /** Поставить оружие в слот i хотбара или убрать (id = null). */
    equip(i, id) {
        const lo = this.state.loadout.slice();
        const had = lo.indexOf(id);
        if (id && had >= 0) lo.splice(had, 1);
        if (id) { if (i >= lo.length) lo.push(id); else lo.splice(i, 0, id); }
        else lo.splice(i, 1);
        while (lo.length > this.slots()) lo.pop();
        if (!lo.length) lo.push('hammer');
        this.state.loadout = lo;
        GameTools.setLoadout(lo);
        this.game.persist();
    },
    upgradeLevel(id) { return this.state.upgrades[id] || 0; },
    upgradePrice(id) { const u = GameData.upgrade(id), l = this.upgradeLevel(id); return l >= u.max ? Infinity : Math.round(u.base * Math.pow(u.grow, l)); },
    buyUpgrade(id) {
        const p = this.upgradePrice(id);
        if (this.state.money < p) return false;
        this.state.money -= p;
        this._giveUpgrade(id);
        return true;
    },
    _giveUpgrade(id) {
        delete this.state.adViews['upgrade:' + id];
        this.state.upgrades[id] = this.upgradeLevel(id) + 1;
        this.game.applyUpgrades();
        this.game.persist();
        if (typeof GameAudio !== 'undefined') GameAudio.ui('select');
    },
    /** Покупка за рекламу: kind 'weapon' | 'upgrade' | 'nest'. Сколько просмотров нужно и сколько уже накоплено (сохраняется). */
    adGoal(kind, id) {
        const price = kind === 'weapon' ? GameData.weapon(id).price : (kind === 'upgrade' ? this.upgradePrice(id) : this.nestPrice());
        const key = kind === 'nest' ? 'nest' : kind + ':' + id;
        return { key, need: GameData.adViews(price), have: this.state.adViews[key] || 0 };
    },
    /** Один просмотр в счёт покупки. 'done' — вещь выдана, 'more' — просмотр засчитан, '' — не досмотрел или реклама не показана. */
    async adStep(kind, id) {
        const g = this.adGoal(kind, id), views = this.state.adViews;
        if (!(await Platform.rewarded('buy_' + kind))) return '';
        if (g.have + 1 < g.need) { views[g.key] = g.have + 1; this.game.persistSoon(); return 'more'; }
        if (kind === 'weapon') this._giveWeapon(id);
        else if (kind === 'upgrade') this._giveUpgrade(id);
        else this._giveNest();
        return 'done';
    },
    /** Продать яйцо из гнезда: цена — 90 секунд его дохода. */
    sellPrice(i) { return GamePets.nestIncome(this.state.nests[i]) * 90; },
    sellEgg(i) {
        const n = this.state.nests[i];
        if (!n || !n.egg) return false;
        this.state.money += this.sellPrice(i) + n.cash;
        if (n.pet) { const p = GamePets.byEgg(n.egg); if (p && this.state.pets[p.id]) this.state.pets[p.id]--; }
        n.egg = null; n.cash = 0; n.t = 0; n.pet = false;
        this.game.persist();
        this.refreshViews();
        return true;
    },
    /** Новое яйцо в первое свободное гнездо. true — поставлено. */
    placeEgg(eggId) {
        const i = this.state.nests.findIndex(n => !n.egg);
        if (i < 0) return false;
        const n = this.state.nests[i];
        n.egg = eggId; n.cash = 0; n.t = 0; n.pet = false;
        this.game.persist();
        this.refreshViews();
        return true;
    },

    // ------------------------------------------------------------------ вид базы

    /** Карта 'base' загружена: виды гнёзд и манекены. */
    enter() {
        const g = this.game;
        this.views = [];
        this.dummies = [];
        const marks = g.markers('nest').sort((a, b) => this._nestNum(a) - this._nestNum(b));
        const vs = g.world.vs, top = BASE_GROUND * vs;
        marks.forEach((mk, i) => {
            const rot = ((Math.round(((mk.rot && mk.rot[1]) || 0) / 90) % 4) + 4) % 4;
            const dirX = [1, 0, -1, 0][rot], dirZ = [0, 1, 0, -1][rot];
            const x = mk.x / 10 * vs + 0.05, z = mk.y / 10 * vs + 0.05;
            this.views.push({ i, x, z, y: top + 0.3, padX: x + dirX * 1.8, padZ: z + dirZ * 1.8, egg: null, mesh: null, lock: null });
        });
        this.refreshViews();
        // манекены: живут на подставках, не бьют, встают после падения
        for (const mk of g.markers('dummy')) this._spawnDummy(mk.x / 10 * vs, top + 0.1, mk.y / 10 * vs);
        // продавцы: посреди лотка, за прилавком (подиум лотка — 1 воксель над землёй)
        this.npcs = [];
        for (const [name, type] of /** @type {[string, string][]} */ ([['arsenal', 'npc_gunner'], ['upgrades', 'npc_prof'], ['vendor-pets', 'npc_hen'], ['vendor-codex', 'npc_book'], ['vendor-shop', 'npc_style']])) {
            const mk = g.marker(name);
            if (!mk || !VoxFolk.TYPES[type]) continue;
            const x = mk.x / 10 * vs + 0.05, z = mk.y / 10 * vs + 0.05, y = top + 0.1;
            const e = GameEnemies.spawn(type, x, y, z, 0, { ai: false });
            if (e) { e.isDummy = true; this.npcs.push({ e, x, y, z, yaw: 0, greet: 0, greeted: false }); }
        }
        // боты
        this.bots = [];
        const nb = typeof IS_MOBILE !== 'undefined' && IS_MOBILE ? Math.ceil(this.BOT_COUNT * 0.6) : this.BOT_COUNT;
        for (let i = 0; i < nb; i++) this.bots.push(this._spawnBot({ nick: '', t: 0, e: null }, true));
        const gate = g.marker('raidgate');
        if (gate) {
            this.gate = { x: gate.x / 10 * vs, z: gate.y / 10 * vs, y: top };
            this._makeGateFx();
        }
        const ars = g.marker('arsenal'), up = g.marker('upgrades');
        this.arsenalAt = ars ? { x: ars.x / 10 * vs, z: ars.y / 10 * vs } : null;
        this.upgradesAt = up ? { x: up.x / 10 * vs, z: up.y / 10 * vs } : null;
        for (const [k, name] of [['petsAt', 'vendor-pets'], ['codexAt', 'vendor-codex'], ['shopAt', 'vendor-shop']]) {
            const mk = g.marker(name);
            this[k] = mk ? { x: mk.x / 10 * vs, z: mk.y / 10 * vs } : null;
        }
    },
    _nestNum(mk) { const m = /-(\d+)$/.exec(mk.name); return m ? +m[1] : 0; },

    leave() {
        for (const v of this.views) { if (v.mesh) { v.mesh.dispose(); v.mesh = null; } }
        this.views = [];
        this._gateFx = null;
        this.dummies = [];
        this.npcs = [];
        this.bots = [];
        if (typeof GameNames !== 'undefined') GameNames.hide();
    },

    /** Виды для мишеней и прохожих: без боссов, продавцов и летунов. */
    _walkerTypes() {
        const out = [];
        for (const id in VoxFolk.TYPES) { const t = VoxFolk.TYPES[id]; if (!t.npc && !t.boss && t.behavior !== 'flyer' && !(t.scale && t.scale > 1.4)) out.push(id); }
        return out;
    },

    _spawnDummy(x, y, z) {
        const types = this._walkerTypes();
        const id = types[Math.floor(Math.random() * types.length)];
        const e = GameEnemies.spawn(id, x, y, z, Math.PI, { ai: false, hpMul: 3 });
        if (e) { e.isDummy = true; e.reward = 0; e.home = { x, z }; this.dummies.push({ e, x, y, z, t: 0 }); }
    },

    /** Случайная проходимая точка карты. minD — не ближе к игроку. */
    _freeSpot(minD) {
        const E = GameEnemies, vs = this.game.world.vs, cs = E.CELL * vs, p = this.game.player;
        for (let k = 0; k < 80; k++) {
            const cx = 3 + Math.floor(Math.random() * (E.nx - 6)), cz = 3 + Math.floor(Math.random() * (E.nz - 6));
            const h = E.hgt[cx + cz * E.nx];
            if (!h || h > BASE_GROUND + 3) continue;
            const x = (cx + 0.5) * cs, z = (cz + 0.5) * cs;
            if (Math.hypot(x - p.pos.x, z - p.pos.z) < minD) continue;
            return { x, y: h * vs + 0.05, z };
        }
        return null;
    },

    /** Новый прохожий (в ту же запись). first — при входе на базу: без вспышки. */
    _spawnBot(b, first) {
        const types = this._walkerTypes();
        const at = this._freeSpot(first ? 4 : 9);
        b.e = null; b.t = 0; b.panic = 0; b.idle = 0; b.wish = null; b.stuck = 0;
        if (!at || !types.length) { b.t = -2; return b; }
        const id = types[Math.floor(Math.random() * types.length)];
        const e = GameEnemies.spawn(id, at.x, at.y, at.z, Math.random() * 6.28, { ai: false, bot: true });
        if (!e) { b.t = -2; return b; }
        e.isDummy = true;
        b.e = e; b.hp = e.hp; b.lastX = at.x; b.lastZ = at.z;
        b.nick = this.BOT_NICKS[Math.floor(Math.random() * this.BOT_NICKS.length)];
        b.step = 0;
        if (!first) { VoxFX.sparks(at.x, at.y + 1, at.z, 0, 1, 0, 26, 1.1); VoxRender.flash(at.x, at.y + 1.2, at.z, [0.5, 1, 0.6], 6, 7, 0.3); }
        return b;
    },

    /** Боты гуляют, стоят, глазеют на игрока; подстреленный убегает в панике; убитый рассыпается и появляется снова. */
    _updateBots(dt) {
        const p = this.game.player;
        for (const b of this.bots) {
            const e = b.e;
            if (!e) { b.t += dt; if (b.t > 4) this._spawnBot(b, false); continue; }
            const gone = e.rig.gone || !GameEnemies.list.includes(e);
            if (gone || e.dead) {
                b.t += dt;
                if (!gone && b.t > 4.5) { e.rig.shatter(1.8, 4); const ix = GameEnemies.list.indexOf(e); if (ix >= 0) GameEnemies.list.splice(ix, 1); }
                if (b.t > 6.5) this._spawnBot(b, false);
                continue;
            }
            const rig = e.rig, R = rig.root;
            if (e.hp < b.hp) { b.panic = 4; b.hp = e.hp; b.wish = null; }
            if (rig.state === 'stumble' || rig.state === 'getup') { e.wishX = e.wishZ = 0; continue; }
            if (rig.state === 'down' && !rig.crawl) continue;
            const speed0 = Math.max(1.3, Math.min(2.6, (e.type.speed || 3) * 0.5));
            if (b.panic > 0) {
                b.panic -= dt;
                rig.upper = 'panic';
                let ax = R.x - p.pos.x, az = R.z - p.pos.z;
                const al = Math.hypot(ax, az) || 1;
                ax = ax / al + Math.sin(rig.time * 2.1) * 0.5; az = az / al + Math.cos(rig.time * 1.7) * 0.5;
                const q = Math.hypot(ax, az) || 1, sp = Math.max(4, (e.type.speed || 4) * 1.1);
                e.wishX = ax / q * sp; e.wishZ = az / q * sp;
                GameEnemies._face(rig, e.wishX, e.wishZ, dt, 9);
            } else if (b.idle > 0) {
                b.idle -= dt;
                rig.upper = 'idle';
                e.wishX = e.wishZ = 0;
                // глазеет на игрока, если он рядом
                const dx = p.pos.x - R.x, dz = p.pos.z - R.z;
                if (Math.hypot(dx, dz) < 8) GameEnemies._face(rig, dx, dz, dt, 3);
            } else {
                if (!b.wish) { b.wish = this._freeSpot(0); b.step = 0; }
                if (!b.wish) { b.idle = 1; continue; }
                rig.upper = 'run';
                const dx = b.wish.x - R.x, dz = b.wish.z - R.z, d = Math.hypot(dx, dz) || 1;
                if (d < 0.8) { b.wish = null; b.idle = Math.random() < 0.55 ? 1 + Math.random() * 3.5 : 0; continue; }
                let wx = dx / d, wz = dz / d;
                // друг друга обходят
                for (const o of this.bots) {
                    if (o === b || !o.e || o.e.dead) continue;
                    const ox = R.x - o.e.rig.root.x, oz = R.z - o.e.rig.root.z, od = Math.hypot(ox, oz);
                    if (od < 1.3 && od > 0.01) { wx += ox / od * (1.3 - od); wz += oz / od * (1.3 - od); }
                }
                const wl = Math.hypot(wx, wz) || 1;
                e.wishX = wx / wl * speed0; e.wishZ = wz / wl * speed0;
                GameEnemies._face(rig, e.wishX, e.wishZ, dt, 5);
                // застрял у препятствия — другая цель
                b.step += dt;
                if (b.step > 1) {
                    b.step = 0;
                    if (Math.hypot(R.x - b.lastX, R.z - b.lastZ) < 0.35) { b.wish = null; if (R.onGround) R.vy = 4.8; }
                    b.lastX = R.x; b.lastZ = R.z;
                }
            }
        }
    },

    /** Продавцы: возвращаются за прилавок, смотрят на подошедшего, машут ему. */
    _updateNpcs(dt) {
        const p = this.game.player;
        for (const n of this.npcs) {
            const e = n.e, rig = e.rig, R = rig.root;
            if (rig.state === 'stumble' || rig.state === 'getup' || rig.state === 'down') { e.wishX = e.wishZ = 0; if (rig.state !== 'stumble') rig.upper = 'idle'; continue; }
            const bx = n.x - R.x, bz = n.z - R.z, bd = Math.hypot(bx, bz);
            if (bd > 0.3) {
                rig.upper = 'run';
                const s = Math.min(2.4, bd * 2);
                e.wishX = bx / bd * s; e.wishZ = bz / bd * s;
                GameEnemies._face(rig, bx, bz, dt, 6);
                continue;
            }
            e.wishX = e.wishZ = 0;
            const dx = p.pos.x - R.x, dz = p.pos.z - R.z, d = Math.hypot(dx, dz);
            if (d < 9 && dz > -1) GameEnemies._face(rig, dx, dz, dt, 3.5);
            else GameEnemies._face(rig, Math.sin(n.yaw), Math.cos(n.yaw), dt, 2.5);
            // подошли — помахал
            if (d < 6.5) { if (!n.greeted) { n.greeted = true; n.greet = 2.2; } }
            else if (d > 10) n.greeted = false;
            if (n.greet > 0) { n.greet -= dt; rig.upper = 'wave'; }
            else rig.upper = 'counter';
        }
    },

    /** Таблички над головами: GameNames. */
    nameTags() {
        const out = [];
        for (const n of this.npcs) out.push({ rig: n.e.rig, name: GameData.label(n.e.type.name), cls: 'npc' });
        for (const b of this.bots) if (b.e && !b.e.dead && !b.e.rig.gone) out.push({ rig: b.e.rig, name: b.nick, cls: b.panic > 0 ? 'hurt' : '' });
        return out;
    },

    _makeGateFx() {
        const g = this.gate;
        // проём арки: радиус 2.4 м, центр круга на 2.8 м, прямые стороны до пола
        this._gateFx = GamePortal.gate(g.x, g.y + 0.1, g.z, { R: 2.38, cy: 2.7, arch: true, skin: true });
    },

    /** Яйца и замки в гнёздах по состоянию. */
    refreshViews() {
        for (const v of this.views) {
            const n = this.state.nests[v.i];
            const egg = n && n.egg ? n.egg + (n.pet ? '#pet' : '') : null;
            if (v.egg !== egg) {
                if (v.mesh) { v.mesh.dispose(); v.mesh = null; }
                v.egg = egg;
                v.pet = null;
                if (egg) {
                    const d = GameData.egg(n.egg);
                    v.pet = n.pet ? GamePets.byEgg(n.egg) : null;
                    v.mesh = v.pet ? GamePets.mesh(v.pet) : GameEggs.mesh(d);
                    v.mesh.position.set(v.x, v.y + 0.1, v.z);
                    v.def = d;
                    v.ph = Math.random() * 6.28;
                    v.told = GamePets.progress(n).ready;
                }
            }
        }
    },

    /** Точки взаимодействия: гнёзда (деньги — наступить), покупка гнезда, портал, лотки. */
    update(dt) {
        const g = this.game, p = g.player, state = this.state;
        this.near = null;
        let best = 3.2;
        const consider = (id, x, y, z, extra) => {
            const d = Math.hypot(p.pos.x - x, p.pos.z - z);
            if (d < best) { best = d; this.near = Object.assign({ id, x, y, z }, extra || {}); }
        };
        for (const v of this.views) {
            const n = state.nests[v.i];
            if (v.mesh && v.pet) {
                // питомец прыгает по кругу или парит над гнездом, рядом с игроком смотрит на него
                v.ph += dt;
                const dp = Math.hypot(p.pos.x - v.x, p.pos.z - v.z);
                if (dp < 6) {
                    let dy = Math.atan2(p.pos.x - v.mesh.position.x, p.pos.z - v.mesh.position.z) - v.mesh.rotation.y;
                    while (dy > Math.PI) dy -= 6.2832;
                    while (dy < -Math.PI) dy += 6.2832;
                    v.mesh.rotation.y += dy * Math.min(1, dt * 5);
                    v.mesh.position.x += (v.x - v.mesh.position.x) * Math.min(1, dt * 3);
                    v.mesh.position.z += (v.z - v.mesh.position.z) * Math.min(1, dt * 3);
                } else {
                    const a = v.ph * 0.5;
                    v.mesh.position.x = v.x + Math.cos(a) * 0.55;
                    v.mesh.position.z = v.z + Math.sin(a) * 0.55;
                    v.mesh.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
                }
                v.mesh.position.y = v.y + 0.1 + (v.pet.fly ? 0.55 + Math.sin(v.ph * 2) * 0.1 : Math.abs(Math.sin(v.ph * 3.2)) * 0.22);
                if (v.def) GameEggs.sparkle(v.def, v.x, v.y, v.z, dt);
            } else if (v.mesh) {
                v.mesh.rotation.y += dt * 0.5;
                const ready = n && GamePets.progress(n).ready;
                // готовое яйцо дрожит: пора вылуплять
                v.mesh.position.y = v.y + 0.1 + Math.sin(performance.now() / 700 + v.i) * 0.03;
                v.mesh.rotation.z = ready ? Math.sin(performance.now() / 45) * 0.09 : 0;
                if (v.def) GameEggs.sparkle(v.def, v.x, v.y, v.z, ready ? dt * 4 : dt);
            }
            if (!n) {
                if (v.i === state.nests.length) consider('buyNest', v.x, v.y + 0.5, v.z, { price: this.nestPrice() });
                continue;
            }
            // деньги на плите: наступил — забрал
            if (n.cash >= 1 && Math.hypot(p.pos.x - v.padX, p.pos.z - v.padZ) < 1.05 && p.onGround) {
                const got = Math.floor(n.cash);
                state.money += got; n.cash -= got;
                g.persistSoon();
                if (typeof GameHud !== 'undefined' && GameHud.floatText) GameHud.floatText(v.padX, v.y + 0.7, v.padZ, '+' + GameData.money(got), 'cash');
                if (typeof GameAudio !== 'undefined') GameAudio.ui('select');
                for (let i = 0; i < 6; i++) VoxFX.sparks(v.padX, v.y + 0.1, v.padZ, 0, 1, 0, 2, 0.9);
            }
            if (n.egg) {
                consider('nest', v.x, v.y + 0.9, v.z, { nest: v.i });
                const pr = GamePets.progress(n);
                if (pr.ready && !v.told) { v.told = true; if (typeof GameHud !== 'undefined' && GameHud.toast) GameHud.toast('sde.pet.ready', { name: GameData.label(v.def) }); }
            } else if (GamePets.bagCount() > 0 || GamePets.list().some(q => GamePets.free(q.id) > 0)) consider('nestEmpty', v.x, v.y + 0.9, v.z, { nest: v.i });
        }
        if (this.gate) { const q = this.gate; consider('raid', q.x, q.y + 1.2, q.z); }
        if (this.arsenalAt) consider('arsenal', this.arsenalAt.x, BASE_GROUND * g.world.vs + 1.2, this.arsenalAt.z);
        if (this.upgradesAt) consider('upgrades', this.upgradesAt.x, BASE_GROUND * g.world.vs + 1.2, this.upgradesAt.z);
        if (this.petsAt) consider('pets', this.petsAt.x, BASE_GROUND * g.world.vs + 1.2, this.petsAt.z);
        if (this.codexAt) consider('codex', this.codexAt.x, BASE_GROUND * g.world.vs + 1.2, this.codexAt.z);
        if (this.shopAt) consider('shop', this.shopAt.x, BASE_GROUND * g.world.vs + 1.2, this.shopAt.z);
        // манекены: убитый рассыпается и появляется снова
        for (const d of this.dummies) {
            if (!d.e || d.e.dead) {
                d.t += dt;
                if (d.t > 3.5) {
                    d.t = 0;
                    if (d.e && !d.e.rig.gone) { d.e.rig.shatter(1.5, 4); const ix = GameEnemies.list.indexOf(d.e); if (ix >= 0) GameEnemies.list.splice(ix, 1); }
                    const types = this._walkerTypes(), id = types[Math.floor(Math.random() * types.length)];
                    const e = GameEnemies.spawn(id, d.x, d.y, d.z, Math.PI, { ai: false, hpMul: 3 });
                    if (e) { e.isDummy = true; e.reward = 0; d.e = e; }
                }
            }
        }
        this._updateNpcs(dt);
        this._updateBots(dt);
        if (Input.pressed('interact') && this.near) this.use(this.near);
    },

    use(n) {
        const H = typeof GameHud !== 'undefined' ? /** @type {any} */ (GameHud) : null;
        if (!H) return;
        if (n.id === 'buyNest') {
            if (this.buyNest()) { this.game._settleEgg(); return; }
            H.toast('sde.noMoney');
            if (Platform.rewardedSupported()) H.openUpgrades();   // там кнопка «за рекламу»
        }
        else if (n.id === 'nest') H.openNest(n.nest);
        else if (n.id === 'raid') H.openRaids();
        else if (n.id === 'arsenal') H.openArsenal();
        else if (n.id === 'upgrades') H.openUpgrades();
        else if (n.id === 'nestEmpty') GamePetsUi.openEmptyNest(n.nest);
        else if (n.id === 'pets') GamePetsUi.openPets();
        else if (n.id === 'codex') GamePetsUi.openCodex();
        else if (n.id === 'shop') GameShopUi.open('shop');
    },
};
