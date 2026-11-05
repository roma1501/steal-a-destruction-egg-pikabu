// GameRaid.js — вылазка: охрана и алтарь с яйцом, портал выхода, тревога с подкреплением, здоровье игрока, итоги.
//
// Ход: start(id) -> карта вылазки -> яйцо на алтаре дальше от входа, вокруг — охрана. Взял яйцо (E) -> тревога, волны,
// яйцо в руках замедляет. Донёс до портала -> успех: деньги и яйцо на базе. Умер -> яйцо потеряно, половина добычи.

/** @satisfies {Record<string, any>} */
const GameRaid = {
    /** @type {any} */
    game: null,
    /** @type {any} */
    raid: null,
    won: false,
    /** idle | fight | carry | done */
    phase: 'idle',
    /** Текущее яйцо. @type {any} */
    eggDef: null,
    /** Где лежит яйцо: { x, y, z } и меш. @type {any} */
    egg: null,
    /** @type {any} */
    gate: null,
    /** @type {any} */
    carried: null,
    /** Выпавшее тело яйца. @type {any} */
    eggBody: null,
    loot: 0,
    kills: 0,
    damage: 0,
    wave: 0,
    waveT: 0,
    time: 0,
    /** @type {any[]} */
    fxMeshes: [],
    /** @type {any} */
    near: null,
    /** Портал эвакуации: таймер идёт с первого взятия яйца. */
    evacOn: false, evacT: 0, evacTotal: 0, gateOpen: false, gateYaw: 0,
    revived: false, canRevive: false, doubled: false, aborted: false, carriedAtDeath: false, dropped: false,

    init(game) {
        this.game = game;
        GameEnemies.onKill = e => this._killed(e);
        GameEnemies.onHurtPlayer = (d, x, z, by) => this.game.hurtPlayer(d, x, z, by);
        GameEnemies.onDamage = (e, d, x, y, z, crit, killed) => { if (typeof GameHud !== 'undefined' && GameHud.floatText) GameHud.floatText(x, y, z, String(Math.max(1, Math.round(d))), crit ? 'crit' : 'dmg'); };
        VoxDestruction.on(e => {
            if (e.type === 'removed' && this.phase !== 'idle' && this.phase !== 'done' && this.game.mode === 'raid') {
                let n = 0;
                for (const c of e.counts.values()) n += c;
                this.damage += n;
            }
            if (e.type === 'explosion') this._playerBlast(e);
        });
    },

    /** Урон игроку от взрывов: свой — слабее. */
    _playerBlast(e) {
        const p = this.game.player;
        if (!p || !this.game.player.pos) return;
        const eye = p.eye;
        const d = Math.hypot(eye.x - e.x, (eye.y - 0.7) - e.y, eye.z - e.z);
        const R = e.r * 1.7;
        if (d > R) return;
        const f = 1 - d / R;
        const dmg = (GameEnemies.enemyBlast ? 40 * (GameEnemies._blastDmg || 1) : 16) * f * (e.r / 2.4);
        this.game.hurtPlayer(dmg, e.x, e.z, 'blast');
    },

    /** Запуск вылазки. */
    async start(id) {
        const raid = GameData.raid(id);
        if (!raid) return;
        this.raid = raid;
        this.won = false;
        await this.game.switchMap(raid.map, 'raid', GameData.raidTitle(raid));
    },

    /** Карта вылазки загружена: расставить всё. */
    enter() {
        const g = this.game, w = g.world, raid = this.raid;
        this.phase = 'fight';
        this.revived = false; this.canRevive = false; this.doubled = false; this.aborted = false;
        Telemetry.progress('started', 'raid_' + raid.n, { step_index: raid.n, sky: raid.sky, weather: raid.weather });
        this.loot = 0; this.kills = 0; this.damage = 0; this.wave = 0; this.waveT = raid.waves[1]; this.time = 0;
        this.carried = null; this.eggBody = null;
        this.eggDef = GameData.rollEgg(raid);
        const vs = w.vs, p = g.player;
        // портал выхода — у точки входа, чуть перед игроком
        this.gate = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
        this._makeGate();
        // алтарь: самая дальняя проходимая клетка от входа, с запасом места
        const spot = this._altarSpot();
        this._buildAltar(spot.x, spot.z, spot.y);
        const ey = spot.y + 0.32;
        this.egg = { x: spot.x, y: ey, z: spot.z, mesh: GameEggs.mesh(this.eggDef) };
        this.egg.mesh.position.set(spot.x, ey, spot.z);
        // охрана
        const pool = this._pool(raid);
        const n = Math.round(raid.enemies * (typeof IS_MOBILE !== 'undefined' && IS_MOBILE ? 0.7 : 1));
        const nearEgg = Math.ceil(n * 0.55);
        for (let i = 0; i < n; i++) {
            const type = pool[Math.floor(Math.random() * pool.length)];
            const at = i < nearEgg ? this._freeNear(spot.x, spot.z, 2.5, 8.5) : this._freeAwayFromPlayer(13);
            if (!at) continue;
            GameEnemies.spawn(type, at.x, at.y, at.z, Math.random() * 6.28, { home: { x: at.x, z: at.z }, radius: 4, hpMul: raid.hpMul, dmgMul: raid.dmgMul });
        }
        if (raid.boss && VoxFolk.TYPES[raid.boss]) {
            for (let b = 0; b < (raid.bossCount || 1); b++) {
                const at = this._freeNear(spot.x, spot.z, 3, 7);
                if (at) GameEnemies.spawn(raid.boss, at.x, at.y, at.z, 0, { home: { x: at.x, z: at.z }, radius: 3, hpMul: raid.hpMul * 0.6, dmgMul: raid.dmgMul * 0.8 });
            }
        }
        GameEnemies._blastDmg = raid.dmgMul;
    },

    leave() {
        for (const m of this.fxMeshes) m.dispose(false, true);
        this.fxMeshes = [];
        if (this.egg && this.egg.mesh) { this.egg.mesh.dispose(); }
        this.egg = null;
        if (this.carried) { this.carried.dispose(); this.carried = null; }
        this.eggBody = null;
        this.phase = 'idle';
    },

    /** Виды врагов для вылазки: сильные — чаще. */
    _pool(raid) {
        const out = [];
        for (const id in VoxFolk.TYPES) {
            const t = VoxFolk.TYPES[id];
            if (t.boss || t.noRaid || t.tier > raid.tier) continue;
            const w = Math.max(1, 1 + t.tier - Math.max(1, raid.tier - 2));
            for (let i = 0; i < w; i++) out.push(id);
        }
        return out.length ? out : Object.keys(VoxFolk.TYPES);
    },

    /** Самая дальняя от входа ровная клетка. */
    _altarSpot() {
        const E = GameEnemies, nx = E.nx, nz = E.nz, cs = E.CELL * this.game.world.vs, top = this.game.world.groundTop;
        const p = this.game.player;
        let best = null, bestD = -1;
        for (let k = 0; k < 900; k++) {
            const cx = 16 + Math.floor(Math.random() * (nx - 32)), cz = 16 + Math.floor(Math.random() * (nz - 32));
            const h = E.hgt[cx + cz * nx];
            if (!h || h > top + 3) continue;
            // клетки вокруг ровные (площадка)
            let flat = true;
            for (let dz = -2; dz <= 2 && flat; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(E.hgt[cx + dx + (cz + dz) * nx] - h) > 2) { flat = false; break; }
            if (!flat) continue;
            const x = (cx + 0.5) * cs, z = (cz + 0.5) * cs;
            const d = Math.hypot(x - p.pos.x, z - p.pos.z);
            if (d > bestD) { bestD = d; best = { x, z, y: h * this.game.world.vs }; }
        }
        return best || { x: p.pos.x + 12, z: p.pos.z + 12, y: top * this.game.world.vs };
    },

    _freeNear(x, z, r0, r1) {
        const E = GameEnemies, cs = E.CELL * this.game.world.vs, vs = this.game.world.vs;
        for (let k = 0; k < 60; k++) {
            const a = Math.random() * 6.28, r = r0 + Math.random() * (r1 - r0), qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
            const cx = Math.floor(qx / cs), cz = Math.floor(qz / cs);
            if (cx < 1 || cz < 1 || cx >= E.nx - 1 || cz >= E.nz - 1) continue;
            const h = E.hgt[cx + cz * E.nx];
            if (h) return { x: (cx + 0.5) * cs, y: h * vs + 0.05, z: (cz + 0.5) * cs };
        }
        return null;
    },
    _freeAwayFromPlayer(minD) {
        const E = GameEnemies, cs = E.CELL * this.game.world.vs, vs = this.game.world.vs, p = this.game.player;
        for (let k = 0; k < 90; k++) {
            const cx = 2 + Math.floor(Math.random() * (E.nx - 4)), cz = 2 + Math.floor(Math.random() * (E.nz - 4));
            const h = E.hgt[cx + cz * E.nx];
            if (!h) continue;
            const x = (cx + 0.5) * cs, z = (cz + 0.5) * cs;
            if (Math.hypot(x - p.pos.x, z - p.pos.z) < minD) continue;
            return { x, y: h * vs + 0.05, z };
        }
        return null;
    },

    _buildAltar(x, z, y) {
        const w = this.game.world, k = 1 / w.vs, cx = Math.floor(x * k), cz = Math.floor(z * k), cy = Math.round(y * k);
        /** @type {any} */ (GameMapBuild).altar(w, cx, cy, cz);
        // столб света над яйцом: видно издалека
        const c = GameEggs.rarityRgb(this.eggDef);
        const beam = BABYLON.MeshBuilder.CreateCylinder('eggBeam', { height: 22, diameterTop: 1.6, diameterBottom: 0.9, tessellation: 14, cap: BABYLON.Mesh.NO_CAP }, VoxRender.scene);
        const mat = new BABYLON.StandardMaterial('eggBeam', VoxRender.scene);
        mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2); mat.alpha = 0.2; mat.backFaceCulling = false; mat.disableDepthWrite = true;
        beam.material = mat; beam.isPickable = false; beam.renderingGroupId = 1;
        beam.position.set(x, y + 11, z);
        this.beam = beam;
        this.fxMeshes.push(beam);
    },

    _makeGate() {
        const g = this.game, w = g.world, p = g.player, k = 1 / w.vs, d = p.dir(), l = Math.hypot(d.x, d.z) || 1, fx = d.x / l, fz = d.z / l;
        // за спиной, если там свободно; иначе сбоку; в крайнем случае прямо на месте появления
        const tries = [[-3.4, 0], [-2.6, 2.4], [-2.6, -2.4], [0, 3.4], [0, -3.4], [3.4, 2.4], [3.4, -2.4]];
        const y0 = Math.round(p.pos.y * k);
        const free = (cx, cz) => {
            if (!w.get(cx, y0 - 1, cz)) return false;     // земля того же уровня
            for (let y = y0; y < y0 + 34; y += 3) for (let dz = -15; dz <= 15; dz += 3) for (let dx = -15; dx <= 15; dx += 3) if (w.get(cx + dx, y, cz + dz)) return false;
            return true;
        };
        let at = null;
        for (const [a, b] of tries) {
            const x = p.pos.x + fx * a - fz * b, z = p.pos.z + fz * a + fx * b;
            const cx = Math.floor(x * k), cz = Math.floor(z * k);
            if (cx < 20 || cz < 20 || cx > w.sx - 20 || cz > w.sz - 20) continue;
            if (!free(cx, cz)) continue;
            at = { x, z };
            break;
        }
        if (at) { this.gate.x = at.x; this.gate.z = at.z; }
        // лицом к точке появления
        this.gateYaw = at ? Math.atan2(p.pos.x - at.x, p.pos.z - at.z) : Math.atan2(fx, fz);
        this.evacOn = false; this.gateOpen = false; this.evacT = 0;
    },

    /** Сколько ждать портал эвакуации после взятия яйца, секунд: 15 на первой вылазке, около 150 на сотой. */
    evacTime() { return Math.round(15 + (this.raid.n - 1) * 1.36); },

    /** Портал эвакуации открылся. */
    _openGate() {
        const G = this.gate;
        this.gateOpen = true;
        GamePortal.gate(G.x, G.y, G.z, { R: 1.55, cy: 1.75, yaw: this.gateYaw, colA: [0.03, 0.62, 0.22], colB: [0.55, 1.0, 0.3], pixels: 16 });
        VoxRender.flash(G.x, G.y + 1.5, G.z, [0.5, 1, 0.45], 16, 14, 0.6);
        VoxFX.sparks(G.x, G.y + 1.5, G.z, 0, 1, 0, 40, 1.3);
        if (typeof GameHud !== 'undefined' && GameHud.banner) GameHud.banner('sde.evacOpen');
        if (typeof GameAudio !== 'undefined') GameAudio.ui('select');
    },

    /** Кадр вылазки. */
    update(dt) {
        const g = this.game, p = g.player;
        if (this.phase === 'done' || this.phase === 'idle') return;
        this.time += dt;
        this.near = null;
        if (this.egg && !this.carried) {
            let ex = this.egg.x, ey = this.egg.y, ez = this.egg.z;
            if (this.eggBody && !this.eggBody.dead) { ex = this.eggBody.x[0]; ey = this.eggBody.x[1]; ez = this.eggBody.x[2]; this.egg.x = ex; this.egg.y = ey; this.egg.z = ez; }
            if (this.egg.mesh) { this.egg.mesh.rotation.y += dt * 0.8; }
            GameEggs.sparkle(this.eggDef, ex, ey, ez, dt);
            if (Math.hypot(p.pos.x - ex, p.pos.z - ez) < 2.6 && Math.abs(p.pos.y - ey) < 2.6) {
                this.near = { id: 'egg', x: ex, y: ey + 1, z: ez };
                if (Input.pressed('interact')) this.takeEgg();
            }
        }
        if (this.phase === 'carry' && Input.pressed('drop')) this.dropEgg();
        if (this.evacOn && !this.gateOpen) { this.evacT -= dt; if (this.evacT <= 0) this._openGate(); }
        // подкрепление по тревоге
        if (this.phase === 'carry') {
            this.waveT -= dt;
            if (this.waveT <= 0) { this.waveT = this.raid.waves[1]; this._spawnWave(); }
            const gd = Math.hypot(p.pos.x - this.gate.x, p.pos.z - this.gate.z);
            if (this.gateOpen && gd < 1.55) this.finish(true);
        }
    },

    takeEgg() {
        const g = this.game;
        this.phase = 'carry';
        if (!this.evacOn) { this.evacOn = true; this.evacT = this.evacTotal = this.evacTime(); }
        if (this.egg.mesh) { this.egg.mesh.dispose(); this.egg.mesh = null; }
        if (this.eggBody && !this.eggBody.dead) { VoxPhysics.remove(this.eggBody); this.eggBody = null; }
        if (this.beam) { this.beam.setEnabled(false); }
        // в руках: яйцо снизу кадра слева
        const m = this.carried = GameEggs.mesh(this.eggDef, { group: 2, scale: 0.42 });
        m.parent = GameTools.vmRoot;
        m.position.set(-0.5, -0.58, -0.92);
        m.receiveShadows = false;
        GameEnemies.alertAll();
        if (this.waveT > 3) this.waveT = 3;
        if (typeof GameHud !== 'undefined' && GameHud.banner) GameHud.banner('sde.alarm');
        if (typeof GameAudio !== 'undefined') GameAudio.ui('select');
        g.player.addTrauma(0.3);
    },

    /** Уронить яйцо (толчок, смерть). */
    dropEgg() {
        if (!this.carried) return;
        const p = this.game.player;
        this.carried.dispose(); this.carried = null;
        this.phase = 'fight';
        const d = p.dir();
        const b = this.eggBody = GameEggs.spawnBody(this.eggDef, p.pos.x + d.x * 0.7, p.pos.y + 1.1, p.pos.z + d.z * 0.7, d.x * 3 + p.vel.x, 2, d.z * 3 + p.vel.z);
        this.egg = { x: p.pos.x, y: p.pos.y, z: p.pos.z, mesh: null };
    },

    _spawnWave() {
        const raid = this.raid;
        if (GameEnemies.aliveCount() > 28) return;
        const pool = this._pool(raid), p = this.game.player;
        this.wave++;
        for (let i = 0; i < raid.waves[0]; i++) {
            // с края карты, подальше от игрока
            const at = this._freeAwayFromPlayer(16);
            if (!at) continue;
            GameEnemies.spawn(pool[Math.floor(Math.random() * pool.length)], at.x, at.y, at.z, 0, { alerted: true, hpMul: raid.hpMul, dmgMul: raid.dmgMul });
        }
    },

    _killed(e) {
        // прохожий на базе: мелочь по приколу
        if (e.bot) {
            const got = 2 + Math.floor(Math.random() * 4), c = e.rig.center([0, 0, 0]);
            this.game.state.money += got;
            if (typeof GameHud !== 'undefined' && GameHud.floatText) GameHud.floatText(c[0], c[1] + 1, c[2], '+' + GameData.money(got), 'cash');
            return;
        }
        if (e.isDummy) return;
        const g = this.game, mul = (1 + (g.state.upgrades.loot || 0) * 0.15) * GamePets.lootMul();
        const got = Math.round((e.reward || 10) * (this.raid ? 1 + (this.raid.stars - 1) * 0.9 : 1) * mul);
        this.loot += got;
        this.kills++;
        g.state.stats.kills = (g.state.stats.kills || 0) + 1;
        if (e.rig && e.rig.root) GameCosmetics.boom(e.rig.root.x, e.rig.root.y + 0.8, e.rig.root.z, 40);
        const c = e.rig.center([0, 0, 0]);
        if (typeof GameHud !== 'undefined' && GameHud.floatText) GameHud.floatText(c[0], c[1] + 1, c[2], '+' + GameData.money(got), 'cash');
        // золотые кубики-монетки
        for (let i = 0; i < 12; i++) VoxFX.spawnDebris(c[0], c[1] + 0.3, c[2], M.toy_gold, (Math.random() - 0.5) * 4, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.7);
    },

    /** Можно ли воскреснуть за рекламу: раз на попытку, не во время показа. */
    reviveOffered() { return this.canRevive && !this.revived && !Platform.adActive; },

    /** Воскрешение после rewarded: полное здоровье, рядом с местом гибели, враги оттолкнуты взрывной волной без урона. */
    revive() {
        const g = this.game, p = g.player;
        this.revived = true; this.canRevive = false;
        g.dead = false; g.hp = g.hpMax; g.regenT = 0;
        p.pitch = 0; p.h = p.hStand;
        this.phase = this.carriedAtDeath ? 'carry' : 'fight';
        // деньги и награда, начисленные при итогах, назад не забираются, но и не дублируются: добыча с нуля
        this.loot = 0; this.damage = 0;
        for (const e of GameEnemies.list) {
            const dx = e.rig.root.x - p.pos.x, dz = e.rig.root.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
            if (d > 9) continue;
            e.rig.kickAll(dx / d * 9, 4, dz / d * 9, 0.8);
            if (!e.dead && !e.type.boss) e.rig.fall(1.8);
        }
        if (this.carriedAtDeath && this.eggBody && !this.eggBody.dead) { VoxPhysics.remove(this.eggBody); this.eggBody = null; }
        if (this.carriedAtDeath) { this.egg = { x: p.pos.x, y: p.pos.y, z: p.pos.z, mesh: null }; this.takeEgg(); }
        VoxRender.flash(p.pos.x, p.pos.y + 1, p.pos.z, [0.4, 1, 0.5], 12, 14, 0.5);
        VoxFX.sparks(p.pos.x, p.pos.y + 1, p.pos.z, 0, 1, 0, 40, 1.2);
    },

    /** Удвоить добычу и бонус за рекламу: один раз за итоги. Возвращает сумму или 0. */
    doubleReward(res) {
        if (this.doubled || !res || !res.ok) return 0;
        this.doubled = true;
        const add = res.loot + res.bonus + res.dmgBonus;
        this.game.state.money += add;
        this.game.persist();
        return add;
    },

    /** Деньги за разрушения: кубики в доллары. */
    damageBonus() { return Math.round(this.damage * 0.06 * (this.raid ? this.raid.stars : 1)); },

    /** Конец вылазки: ok — донёс. */
    finish(ok) {
        if (this.phase === 'done') return;
        this.phase = 'done';
        this.won = !!ok;
        const g = this.game, st = g.state, raid = this.raid;
        const dmgBonus = this.damageBonus();
        if (!ok && !this.revived && !this.aborted && Platform.rewardedSupported() && !this.dropped) this.canRevive = true;
        Telemetry.progress(ok ? 'completed' : 'failed', 'raid_' + raid.n, { step_index: raid.n, sky: raid.sky, weather: raid.weather });
        if (Platform.ads) Platform.ads.roundEnded(ok);
        const res = { ok, raid, egg: ok ? this.eggDef : null, loot: ok ? this.loot : Math.round(this.loot * 0.5), bonus: ok ? raid.bonus : 0, dmgBonus: ok ? dmgBonus : Math.round(dmgBonus * 0.5), kills: this.kills, time: this.time, placed: false, unlocked: null };
        st.money += res.loot + res.bonus + res.dmgBonus;
        GameCosmetics.addScore(res.loot + res.bonus + res.dmgBonus);
        if (ok) {
            st.stats.eggs = (st.stats.eggs || 0) + 1;
            st.raidsDone[raid.id] = (st.raidsDone[raid.id] || 0) + 1;
            // следующая вылазка открывается после первого успеха
            const idx = RAIDS.indexOf(raid);
            if (idx >= st.raidOpen - 1 && idx + 1 < RAIDS.length) { st.raidOpen = idx + 2; res.unlocked = RAIDS[idx + 1]; }
            res.found = GamePets.gotEgg(this.eggDef.id);
            st.pendingEgg = this.eggDef.id;
            const i = st.nests.findIndex(n => !n.egg);
            res.placed = i >= 0;
            if (typeof GameAudio !== 'undefined') GameAudio.ui('select');
        }
        if (this.carried) { this.carried.dispose(); this.carried = null; }
        g.persist();
        res.canRevive = !ok && this.reviveOffered();
        res.canDouble = ok && Platform.rewardedSupported();
        if (typeof GameHud !== 'undefined' && GameHud.showResults) GameHud.showResults(res);
    },
};
