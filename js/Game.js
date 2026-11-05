// Game.js — Steal a Destruction Egg. Свой 3D-мир (Game.ownWorld — main.js не создаёт Location3D): воксельный мир из
// маркеров Maps.js, физика твёрдых тел, разрушение, игрок от первого лица, арсенал, враги с активным рэгдоллом.
// Режимы: 'base' — своя база (гнёзда, магазины, полигон), 'raid' — вылазка за яйцом (GameRaid). Смена карты — без
// перезагрузки страницы (switchMap). Логика — update (не на паузе), рендер — каждый кадр.

/** @satisfies {Record<string, any>} */
const Game = {
    ownWorld: true,
    /** @type {LoryApp | null} */
    app: null,
    /** @type {VoxWorld | null} */
    world: null,
    /** @type {GamePlayer | null} */
    player: null,
    /** @type {any} */
    map: null,
    /** 'base' | 'raid' */
    mode: 'base',
    timeScale: 1,
    ready_: false,
    /** Единое сохранение игры. @type {any} */
    state: {},
    stats: { fps: 60, physMs: 0, frameMs: 0 },
    hp: 100, hpMax: 100, regenT: 0, dead: false,
    /** @type {any} */
    lastLook: null,
    _saveT: 0,
    _switching: false,

    /** Новое или загруженное сохранение с полями по умолчанию. */
    _loadState(s) {
        const st = Object.assign({
            money: 0, nests: [], owned: ['hammer', 'ar_ginger'], loadout: ['ar_ginger', 'hammer'], upgrades: {}, raidsDone: {}, raidOpen: 1,
            stats: {}, tutorialDone: false, lastSeen: 0, pendingEgg: null, quality: null, sens: 1, adViews: {},
        }, s || {});
        while (st.nests.length < NESTS.start) st.nests.push({ egg: null, cash: 0 });
        for (const k of ['owned', 'loadout']) st[k] = st[k].map(id => (id === 'ar_skibidi' ? 'ar_ginger' : id)).filter(id => GameData.weapon(id));
        return st;
    },

    async init(app) {
        this.app = app;
        this.state = this._loadState(await Platform.load());
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
        canvas.style.display = 'block';
        const params = new URLSearchParams(location.search);
        const maps = typeof GAME_MAPS !== 'undefined' ? GAME_MAPS : [];
        this.map = maps.find(m => m.id === 'base') || maps[0];
        const world = this.world = new VoxWorld(512, 192, 512);
        GameMapBuild.build(world, this.map);
        world.recount();
        LoadingScreen.set(70);
        VoxRender.init(canvas, world);
        VoxRender.setQuality(this.state.quality || this.detectQuality());
        await VoxRender.buildAll(p => LoadingScreen.set(70 + Math.round(16 * p)));
        VoxPhysics.init(world);
        VoxFX.init(VoxRender.scene, world);
        VoxDestruction.init(world);
        GameMapBuild.spawnBodies(world, this.map);
        GameAudio.init();
        if (this.state.musicOn === false) /** @type {any} */ (GameAudio).setMusicOn(false);
        this.player = new GamePlayer(world, this._spawnPos(), this._spawnYaw());

        Input.init({
            app, mouse: 'lock', actions: {
                ...Input.DEFAULTS,
                attack: { keys: ['Mouse0'], pad: [7] },
                aim: { keys: ['Mouse2'], pad: [6] },
                interact: { keys: ['KeyE'], pad: [2] },
                reload: { keys: ['KeyR'], pad: [3] },
                tool1: { keys: ['Digit1'] }, tool2: { keys: ['Digit2'] }, tool3: { keys: ['Digit3'] },
                tool4: { keys: ['Digit4'] }, tool5: { keys: ['Digit5'] }, tool6: { keys: ['Digit6'] },
                toolNext: { keys: ['KeyQ'], pad: [5] }, toolPrev: { keys: [], pad: [4] },
                drop: { keys: ['KeyG'] },
            },
        });
        GameInput.init();
        try { await GameWeapons.load(VoxRender.scene); } catch (e) { console.warn('GameWeapons:', e); }
        GameEnemies.init(this);
        GameTools.init(this);
        GameBase.init(this);
        GameRaid.init(this);
        GameWeather.init(this);
        this.applyUpgrades();
        const offline = GameBase.offlineIncome();
        this.mode = 'base';
        GamePets.init(this);
        GameBase.enter();
        this._ambience();
        GameHud.init(this);
        GameCosmetics.init(this);
        if (offline > 0 && GameHud.offline) GameHud.offline(offline);
        this._bindUiAds();
        window.addEventListener('beforeunload', () => { this.state.lastSeen = Date.now(); this.persist(); });
        app.onFrame(dt => this.frame(dt));
        this.ready_ = true;
        // отладка: ?raid=<id> — сразу на вылазку, ?gallery — все враги на базе
        const r = params.get('raid');
        if (r) setTimeout(() => { Pause.set('manual', false); GameRaid.start(r); }, 30);
        if (params.has('gallery')) this._gallery();
    },

    _gallery() {
        const ids = Object.keys(VoxFolk.TYPES), vs = this.world.vs;
        ids.forEach((id, i) => {
            const col = i % 8, row = (i / 8) | 0;
            const e = GameEnemies.spawn(id, 16 + col * 2.8, BASE_GROUND * vs + 0.05, 30 - row * 3.6, 0, { ai: false });
            if (e) e.isDummy = true;
        });
        this.player.pos.x = 25.5; this.player.pos.z = 33.5; this.player.yaw = 0;
    },

    detectQuality() {
        let lvl = 2;
        try { if (typeof Quality !== 'undefined') lvl = Quality.detect(Quality.environment()); } catch (e) { lvl = 2; }
        if (typeof IS_MOBILE !== 'undefined' && IS_MOBILE) lvl = Math.min(lvl, 1);
        return lvl <= 0 ? 'low' : (lvl === 1 ? 'medium' : 'high');
    },

    marker(name) { return (this.map.objects || []).find(o => o.kind === 'marker' && o.name === name) || null; },
    markers(name) {
        const re = new RegExp('^' + name + '(-\\d+)?$');
        return (this.map.objects || []).filter(o => o.kind === 'marker' && re.test(o.name));
    },

    _spawnPos() {
        const sp = this.marker('spawn') || { x: 2560, y: 2560 }, vs = this.world.vs;
        return { x: sp.x / 10 * vs, y: (this.world.groundTop || 20) * vs + 0.02, z: sp.y / 10 * vs };
    },
    _spawnYaw() {
        const sp = this.marker('spawn');
        const heading = ((sp && sp.rot && sp.rot[1]) || 0) * Math.PI / 180;
        return Math.atan2(-Math.cos(heading), -Math.sin(heading));
    },

    _ambience() {
        const A = /** @type {any} */ (GameAudio);
        if (A.ambience) A.ambience(A.themeFor ? A.themeFor(this.map.id) : 'lab');
    },

    /** Перейти на карту без перезагрузки: мир, тела и враги — с нуля. mode — 'base' | 'raid'. */
    async switchMap(id, mode, label) {
        if (this._switching) return;
        this._switching = true;
        const maps = typeof GAME_MAPS !== 'undefined' ? GAME_MAPS : [];
        const map = maps.find(m => m.id === id);
        if (!map) { this._switching = false; return; }
        if (this.mode === 'raid') GameRaid.leave(); else GameBase.leave();
        try {
            await LoadingScreen.run(async progress => {
                GameTools.clearWorld();
                GameEnemies.clear();
                GameWeather.clear();
                GamePortal.clear();
                VoxFX.clear();
                const w = this.world;
                w.data.fill(0); w.mark.fill(0);
                this.map = map;
                GameMapBuild.build(w, map);
                w.recount();
                progress(30);
                VoxRender.resetWorld();
                await VoxRender.buildAll(p => progress(30 + Math.round(55 * p)));
                VoxRender.remakeFarLand();
                VoxPhysics.init(w);
                VoxDestruction.init(w);
                GameMapBuild.spawnBodies(w, map);
                const p = this.player;
                const at = this._spawnPos();
                p.pos.x = at.x; p.pos.y = at.y; p.pos.z = at.z;
                p.vel.x = p.vel.y = p.vel.z = 0; p.yaw = this._spawnYaw(); p.pitch = 0; p.trauma = 0;
                this.mode = mode;
                this.dead = false;
                this.hp = this.hpMax; this.regenT = 0;
                GameEnemies.init(this);
                const R = mode === 'raid' ? GameRaid.raid : null;
                GameWeather.set(R ? R.sky : 'day', R ? R.weather : 'clear');
                if (mode === 'raid') GameRaid.enter();
                else { GameBase.enter(); this._settleEgg(); }
                this._ambience();
                progress(92);
            }, { title: label, scene: VoxRender.scene });
        } finally {
            this._switching = false;
        }
        if (typeof GameHud !== 'undefined' && GameHud.onMode) GameHud.onMode(mode);
        this._arrive();
    },

    /** Обратно на базу: естественная пауза, здесь движок показывает заработанный межстраничный ролик. */
    backToBase() { return new Promise(res => Platform.ads.next(() => res(this.switchMap('base', 'base')))); },

    /** Появление: вихрь портала прямо перед игроком схлопывается. На вылазке — фиолетовый, дома — зелёный. */
    _arrive() {
        const p = this.player, e = p.eye, d = p.dir(), l = Math.hypot(d.x, d.z) || 1;
        const raid = this.mode === 'raid';
        GamePortal.spawn(e.x + d.x / l * 3.1, e.y - 0.05, e.z + d.z / l * 3.1, raid ? GamePortal.skinOpts() : { colA: [0.05, 0.75, 0.3], colB: [0.7, 1, 0.3] });
    },

    /** Принесённое яйцо — в гнездо. */
    _settleEgg() {
        const st = this.state;
        if (!st.pendingEgg) return;
        const def = GameData.egg(st.pendingEgg), placed = GameBase.placeEgg(st.pendingEgg);
        if (!placed) GamePets.toBag(st.pendingEgg);
        if (typeof GameHud !== 'undefined' && GameHud.toast) {
            if (placed && def) GameHud.toast('sde.pet.placed', { t: GamePets.timeLabel(GamePets.hatchTime(def)) });
            else if (!placed) GameHud.toast('sde.eggBagged');
        }
        st.pendingEgg = null;
        this.persist();
    },

    // ------------------------------------------------------------------ игрок

    applyUpgrades() {
        const u = this.state.upgrades, H = (a) => (u[a] || 0) * GameData.upgrade(a).per;
        this.hpMax = PLAYER_BASE.hp + H('hp');
        GameEnemies.powerMul = 1 + H('power');
        if (this.hp > this.hpMax || !this.hp) this.hp = this.hpMax;
    },
    speedBonus() { return 1 + (this.state.upgrades.speed || 0) * GameData.upgrade('speed').per; },
    carrySlow() { return GameRaid.carried && GameRaid.eggDef ? RARITIES[GameRaid.eggDef.rarity].slow : 1; },
    reloadMul() { return 1; },
    inputBlocked() { return this.dead || (typeof GameHud !== 'undefined' && GameHud.blocksInput && GameHud.blocksInput()); },

    /** Удар по игроку. x, z — откуда (стрелка на HUD). */
    hurtPlayer(dmg, x, z, by) {
        if (this.dead || this.mode !== 'raid') return;
        const armor = (this.state.upgrades.armor || 0) * GameData.upgrade('armor').per;
        dmg *= Math.max(0.35, 1 - armor);
        this.hp -= dmg;
        this.regenT = PLAYER_BASE.regenDelay;
        if (typeof GameHud !== 'undefined' && GameHud.onHurt) GameHud.onHurt(dmg, x, z);
        if (this.hp <= 0) this._playerDied(by);
    },

    _playerDied(by) {
        this.hp = 0; this.dead = true;
        const p = this.player;
        p.addTrauma(1);
        GameRaid.carriedAtDeath = !!GameRaid.carried;
        if (GameRaid.carried) GameRaid.dropEgg();
        setTimeout(() => GameRaid.finish(false), 1300);
    },

    // ------------------------------------------------------------------ кадр

    update(dt) {
        if (!this.ready_ || this._switching) return;
        const look = Input.consumeLook();
        const sens = this.state.sens || 1;
        look.dx *= sens; look.dy *= sens;
        this.lastLook = look;
        const mv = this.dead ? { x: 0, y: 0 } : Input.move();
        const p = this.player;
        if (this.dead) { look.dx = 0; look.dy = 0; p.pitch += (0.75 - p.pitch) * Math.min(1, dt * 3); }
        p.update(dt, look, mv, {
            jump: !this.dead && Input.down('jump'), jumpPressed: !this.dead && Input.pressed('jump'),
            sprint: Input.down('sprint'), crouch: this.dead || Input.down('crouch'),
        });
        const t0 = performance.now();
        VoxPhysics.update(dt);
        VoxDestruction.update(dt);
        this.stats.physMs += ((performance.now() - t0) - this.stats.physMs) * 0.1;
        GameEnemies.active = this.mode === 'raid';
        GameEnemies.update(dt);
        GameTools.update(dt, dt);
        GameBase.accrue(dt);
        if (this.mode === 'base') GameBase.update(dt);
        else { GameRaid.update(dt); GameWeather.update(dt); }
        // восстановление здоровья вне боя
        if (!this.dead && this.hp < this.hpMax) {
            this.regenT -= dt;
            if (this.regenT <= 0) this.hp = Math.min(this.hpMax, this.hp + PLAYER_BASE.regen * dt);
        }
        // упал за край
        if (p.pos.y < -5) { p.pos.y = (this.world.groundTop || 20) * this.world.vs + 3; p.vel.y = 0; }
        GamePortal.update(dt);
        GamePets.update(dt);
        VoxFX.update(dt, dt);
        this._saveT -= dt;
        if (this._saveT <= 0) { this._saveT = 90; this.state.lastSeen = Date.now(); this.persist(); }
    },

    frame(dt) {
        if (!this.ready_) return;
        const t0 = performance.now();
        this.stats.fps += ((dt > 0 ? 1 / dt : 60) - this.stats.fps) * 0.05;
        const cam = VoxRender.camera;
        this.player.applyCamera(cam);
        VoxRender.vmCam.position.copyFrom(cam.position);
        VoxRender.vmCam.rotationQuaternion.copyFrom(cam.rotationQuaternion);
        const d = this.player.dir(), l = Math.hypot(d.x, d.z) || 1;
        GameAudio.setListener(cam.position.x, cam.position.y, cam.position.z, d.x / l, d.z / l);
        this._music();
        VoxRender.updateDirty(7);
        VoxRender.update(dt);
        if (typeof GameHud !== 'undefined' && GameHud.update) GameHud.update(dt);
        VoxRender.render();
        if (this.mode === 'base' && !this._switching) GameNames.update(GameBase.nameTags());
        else GameNames.hide();
        this.stats.frameMs += ((performance.now() - t0) - this.stats.frameMs) * 0.1;
    },

    /** YouTube Playables: реклама на клики по интерфейсу вне игрового процесса — как в исходной игре. */
    _bindUiAds() {
        if (typeof Platform === 'undefined' || Platform.name !== 'playables') return;
        /** @type {Element | null} */
        let pass = null;
        let busy = false;
        document.addEventListener('click', ev => {
            const t = /** @type {HTMLElement} */ (ev.target);
            const btn = t && t.closest ? t.closest('button,[role="button"]') : null;
            if (!btn || btn.hasAttribute('disabled')) return;
            if (btn === pass) { pass = null; return; }
            if (btn.matches('.sd-ad') || Platform.adActive || this._inPlay()) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (busy) return;
            busy = true;
            if (Platform.ads) Platform.ads.results = 0;
            Promise.resolve(Platform.interstitial()).catch(() => false).then(() => {
                busy = false;
                if (!btn.isConnected || btn.hasAttribute('disabled')) return;
                pass = btn;
                /** @type {HTMLElement} */ (btn).click();
            });
        }, true);
    },
    _inPlay() { return !(typeof Pause !== 'undefined' && Pause.active) && !(GameHud.blocksInput && GameHud.blocksInput()); },

    _musicKind: '',
    _music() {
        const A = /** @type {any} */ (GameAudio);
        if (!A.music) return;
        let kind = 'play';
        const R = GameRaid.raid;
        if (this.mode === 'base') kind = 'menu';
        else if (GameRaid.phase === 'carry') kind = 'tense';
        else if (GameRaid.phase === 'done') kind = GameRaid.won ? 'results' : 'fail';
        else if (R && R.sky === 'night') kind = 'play3';
        else if (R && R.n % 2 === 0) kind = 'play2';
        if (kind !== this._musicKind) { this._musicKind = kind; A.music(kind); }
    },

    persist() { Platform.save(this.state); },
    persistSoon() { this._saveT = Math.min(this._saveT, 8); },
};
