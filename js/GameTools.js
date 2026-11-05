// GameTools.js — арсенал игрока: стрельба, снаряды, перезарядка, модели в руках. Таблица оружия — WEAPONS (GameData.js),
// в хотбаре — то, что игрок взял на вылазку (GameState.loadout). Попадания идут по миру, по телам и по врагам.
// События для HUD: GameTools.on(fn) -> { type: 'select' | 'fire' | 'reload' | 'reloaded' | 'empty' | 'hit' | 'hitEnemy' | 'explode' | 'grab' | 'throw' | 'loadout', … }.

/** @satisfies {Record<string, any>} */
const GameTools = {
    /** @type {any} */
    game: null,
    /** Текущий хотбар: записи WEAPONS. @type {any[]} */
    list: [],
    current: 0,
    prev: 0,
    cool: 0,
    swing: -1,
    _swingHit: false,
    switchT: 0,
    /** Патроны в магазине по id оружия. @type {Record<string, number>} */
    ammo: {},
    reloading: 0,
    spinUp: 0,
    charge: 0,
    burstLeft: 0,
    burstT: 0,
    zoomed: 0,
    /** @type {any[]} */
    shots: [],
    /** @type {any[]} */
    bomblets: [],
    /** @type {any[]} */
    holes: [],
    /** @type {any[]} */
    bombs: [],
    /** @type {any} */
    held: null,
    /** @type {((e: any) => void)[]} */
    _ls: [],
    /** @type {BABYLON.TransformNode | null} */
    vmRoot: null,
    /** @type {Record<string, BABYLON.TransformNode>} */
    vm: {},
    _sway: { x: 0, y: 0 },
    recoil: 0,
    /** @type {{ set(v: number): void, stop(): void } | null} */
    _torchLoop: null,
    aim: /** @type {any} */ (null),
    /** Счётчик ударов кувалды по прочному: клетка 0.4 м -> ударов. @type {Map<number, number>} */
    _dents: new Map(),
    /** В мирной базе — можно стрелять (полигон), но заряды не тратятся. */
    freeAmmo: false,

    on(fn) { this._ls.push(fn); },
    emit(e) { for (const fn of this._ls) { try { fn(e); } catch (err) { console.warn(err); } } },
    get tool() { return this.list[this.current] || WEAPONS[0]; },
    get mag() { const t = this.tool; return t.mag ? Math.ceil(this.ammo[t.id] != null ? this.ammo[t.id] : t.mag) : 0; },

    init(game) {
        this.game = game;
        this._buildViewmodelRoot();
        this.setLoadout(game.state ? game.state.loadout : ['hammer', 'ar_ginger']);
    },

    /** Новый хотбар: список id. Патроны полные. */
    setLoadout(ids) {
        const list = ids.map(id => GameData.weapon(id)).filter(Boolean);
        this.list = list.length ? list : [WEAPONS[0]];
        for (const w of this.list) {
            this.ammo[w.id] = w.mag || 0;
            this._ensureVm(w.id);
            if (w.proj && GameWeapons.PROJ[w.proj] && GameWeapons._proj[w.proj] === undefined) GameWeapons._loadProj(VoxRender.scene, w.proj);
        }
        this.current = Math.min(this.current, this.list.length - 1);
        this.prev = 0;
        this.select(this.current, true);
        this.emit({ type: 'loadout' });
    },

    /** Всё летящее и лежащее — убрать (смена карты). */
    clearWorld() {
        for (const s of this.shots) if (s.node) s.node.dispose();
        this.shots = []; this.bomblets = [];
        for (const h of this.holes) if (h.mesh) h.mesh.dispose();
        this.holes = [];
        for (const b of this.bombs) if (b.holder) b.holder.dispose();
        this.bombs = [];
        this.held = null;
        this.reloading = 0; this.cool = 0; this.swing = -1; this.spinUp = 0; this.charge = 0; this.burstLeft = 0;
        this._dents.clear();
        for (const w of this.list) this.ammo[w.id] = w.mag || 0;
    },

    select(i, silent = false) {
        const n = this.list.length;
        i = ((i % n) + n) % n;
        if (i === this.current && !silent) return;
        if (this.held) this._release(false);
        if (i !== this.current) this.prev = this.current;
        this.current = i;
        this.switchT = 0.28; this.swing = -1; this.reloading = 0; this.spinUp = 0; this.charge = 0; this.burstLeft = 0;
        const id = this.tool.id;
        for (const k in this.vm) this.vm[k].setEnabled(k === id);
        if (!silent && typeof GameAudio !== 'undefined') GameAudio.ui('select');
        this.emit({ type: 'select', index: i, id });
    },

    _cycle(dir) { this.select(this.current + dir); },

    // ------------------------------------------------------------------ прицел

    /** Ближайшее попадание: мир, тело или враг. { t, x, y, z, nx, ny, nz, v, body, enemy, part, gx, gy, gz } | null */
    ray(ox, oy, oz, dx, dy, dz, max, skipEnemies) {
        const w = this.game.world;
        const hw = w.raycast(ox, oy, oz, dx, dy, dz, max);
        let lim = hw ? hw.t : max;
        const hb = VoxPhysics.raycastBodies(ox, oy, oz, dx, dy, dz, lim);
        if (hb) lim = Math.min(lim, hb.t);
        const he = skipEnemies ? null : GameEnemies.raycast(ox, oy, oz, dx, dy, dz, lim);
        if (he) return he;
        if (hb && (!hw || hb.t < hw.t)) return { t: hb.t, x: ox + dx * hb.t, y: oy + dy * hb.t, z: oz + dz * hb.t, nx: hb.nx, ny: hb.ny, nz: hb.nz, v: hb.v, body: hb.body, lx: hb.x, ly: hb.y, lz: hb.z };
        if (hw) return { t: hw.t, x: ox + dx * hw.t, y: oy + dy * hw.t, z: oz + dz * hw.t, nx: hw.nx, ny: hw.ny, nz: hw.nz, v: hw.v, body: null, lx: hw.x, ly: hw.y, lz: hw.z };
        return null;
    },
    _eyeRay(max) {
        const p = this.game.player, e = p.eye, d = p.dir();
        return { e, d, hit: this.ray(e.x, e.y, e.z, d.x, d.y, d.z, max) };
    },

    // ------------------------------------------------------------------ кадр

    update(dt, sdt) {
        const g = this.game, p = g.player;
        for (let i = 0; i < 6; i++) if (Input.pressed('tool' + (i + 1)) && i < this.list.length) this.select(i);
        if (Input.pressed('toolNext') && this.prev !== this.current) this.select(this.prev);
        if (Input.pressed('toolPrev')) this._cycle(-1);
        const wheel = Input.consumeWheel ? Input.consumeWheel() : 0;
        if (wheel && !this.held) this._cycle(wheel > 0 ? 1 : -1);
        else if (wheel && this.held) this.held.dist = Math.max(1.2, Math.min(5.5, this.held.dist - Math.sign(wheel) * 0.35));
        this.cool = Math.max(0, this.cool - dt);
        this.switchT = Math.max(0, this.switchT - dt);
        const t = this.tool;
        const canFire = this.switchT <= 0 && !(g.inputBlocked && g.inputBlocked());
        const fire = canFire && Input.down('attack'), firePressed = canFire && Input.pressed('attack'), alt = canFire && Input.pressed('aim'), altDown = canFire && Input.down('aim');
        if (Input.pressed('reload')) this.reload();
        if (this.reloading > 0) {
            this.reloading -= dt;
            if (this.reloading <= 0) { this.ammo[t.id] = t.mag; this.emit({ type: 'reloaded', id: t.id }); if (typeof GameAudio !== 'undefined') GameAudio.ui('toggle'); }
        }
        // минеган раскручивается
        if (t.spin) this.spinUp = fire && this.reloading <= 0 ? Math.min(t.spin, this.spinUp + dt) : Math.max(0, this.spinUp - dt * 0.8);
        // очередь
        if (this.burstLeft > 0) {
            this.burstT -= dt;
            if (this.burstT <= 0 && this.mag > 0) { this._fire(t); this.burstLeft--; this.burstT = t.burstGap || 0.07; } else if (this.mag <= 0) this.burstLeft = 0;
        }
        const trigger = t.auto ? fire : firePressed;
        if (this.reloading <= 0 && this.cool <= 0 && this.burstLeft <= 0) {
            if (t.kind === 'melee') { if (trigger) { this.swing = 0; this._swingHit = false; this.cool = t.rate; if (typeof GameAudio !== 'undefined') GameAudio.swing(false); this.emit({ type: 'fire', id: t.id }); } }
            else if (t.kind === 'grab') {
                if (firePressed && !this.held) this._tryGrab();
            }
            else if (t.kind === 'rail') {
                if (fire && this.mag > 0) {
                    this.charge += dt;
                    if (this.charge >= t.charge) { this.charge = 0; this._fire(t); this.cool = t.rate; }
                } else this.charge = Math.max(0, this.charge - dt * 2);
            }
            else if (trigger) {
                if (this.mag <= 0) { this.reload(); if (!this.reloading && firePressed) this.emit({ type: 'empty' }); }
                else if (!t.spin || this.spinUp >= t.spin) {
                    if (t.burst) { this.burstLeft = t.burst - 1; this.burstT = t.burstGap || 0.07; }
                    this._fire(t);
                    this.cool = t.rate;
                }
            }
        }
        if (t.alt === 'detonate' && alt) this._detonateSticky();
        if (t.kind === 'grab' && this.held) {
            if (!fire) this._release(false);
            if (alt) this._release(true);
        }
        // огонь: цикл звука
        if (t.kind !== 'flame' && this._torchLoop) this._torchLoop.set(0);
        if (t.kind === 'flame' && (!fire || this.mag <= 0 || this.reloading > 0) && this._torchLoop) this._torchLoop.set(0);
        // снайперка: прицел
        const wantZoom = t.zoom && altDown ? 1 : 0;
        this.zoomed += (wantZoom - this.zoomed) * Math.min(1, dt * 13);
        p.fovMul = 1 - (1 - (t.zoom || 1)) * this.zoomed;
        // скорость игрока
        p.speedMul = (t.slow && (this.spinUp > 0.1 || fire) ? t.slow : 1) * (g.carrySlow ? g.carrySlow() : 1) * (g.speedBonus ? g.speedBonus() : 1);
        // кувалда: удар в середине замаха
        if (this.swing >= 0) {
            this.swing += dt;
            if (!this._swingHit && this.swing > 0.11) { this._swingHit = true; this._hammer(t); }
            if (this.swing > 0.42) this.swing = -1;
        }
        if (this.held) this._updateHeld(dt);
        this._updateShots(sdt);
        this._updateBomblets(sdt);
        this._updateBombs(sdt);
        this._updateHoles(sdt);
        // прицел для HUD
        const r = this._eyeRay(40);
        this.aim = r.hit ? { t: r.hit.t, enemy: r.hit.enemy || null, body: r.hit.body || null } : null;
        this._animate(dt);
    },

    reload() {
        const t = this.tool;
        if (!t.mag || this.reloading > 0 || this.mag >= t.mag || !t.reload) return;
        this.reloading = t.reload * (this.game.reloadMul ? this.game.reloadMul() : 1);
        this.burstLeft = 0;
        if (typeof GameAudio !== 'undefined') GameAudio.ui('toggle');
        this.emit({ type: 'reload', id: t.id, time: this.reloading });
    },

    _use(t, n = 1) { if (t.mag && !this.freeAmmo) this.ammo[t.id] = Math.max(0, (this.ammo[t.id] != null ? this.ammo[t.id] : t.mag) - n); },

    /** Один выстрел текущего оружия. */
    _fire(t) {
        this._use(t, t.ammoUse || 1);
        switch (t.kind) {
            case 'bullet': this._shootBullet(t); break;
            case 'plasma': this._shootPlasma(t); break;
            case 'pellets': this._shootPellets(t); break;
            case 'proj': this._launch(t); break;
            case 'rail': this._shootRail(t); break;
            case 'tesla': this._shootTesla(t); break;
            case 'freeze': this._shootFreeze(t); break;
            case 'flame': this._shootFlame(t); break;
            case 'hole': this._launchHole(t); break;
            case 'bomb': this._throwBomb(t); break;
        }
        const p = this.game.player;
        if (t.kind !== 'flame' && t.kind !== 'freeze') GameEnemies.noise(p.pos.x, p.pos.z, 18);
        this.emit({ type: 'fire', id: t.id });
    },

    _muzzlePos() {
        const n = this.vm[this.tool.id];
        if (n && n.metadata && n.metadata.muzzle) {
            n.computeWorldMatrix(true);
            const mz = n.metadata.muzzle;
            const v = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(mz[0], mz[1], mz[2]), n.getWorldMatrix());
            return { x: v.x, y: v.y, z: v.z };
        }
        const p = this.game.player, e = p.eye, d = p.dir();
        const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
        return { x: e.x + d.x * 0.7 + cy * 0.16, y: e.y + d.y * 0.7 - 0.12, z: e.z + d.z * 0.7 - sy * 0.16 };
    },

    _spreadDir(d, s) {
        if (!s) return { x: d.x, y: d.y, z: d.z };
        return this._norm(d.x + (Math.random() - 0.5) * s, d.y + (Math.random() - 0.5) * s, d.z + (Math.random() - 0.5) * s);
    },

    /** Пуля: насквозь через мягкое и через врагов. Возвращает { last, first, total }. */
    _bullet(e, d, t) {
        let ox = e.x, oy = e.y, oz = e.z, left = 160, last = null, first = null, total = 0;
        let power = t.power != null ? t.power : 2;
        let dmg = t.dmg;
        for (let k = 0; k < (t.pen || 1); k++) {
            const hit = this.ray(ox, oy, oz, d.x, d.y, d.z, left);
            if (!hit) break;
            last = hit;
            if (!first) first = hit;
            if (hit.enemy) {
                const killed0 = hit.enemy.dead;
                GameEnemies.damage(hit, { dmg, radius: t.cut || 0.09, impulse: t.impulse || 3, dx: d.x, dy: d.y, dz: d.z, pixels: 3 + (t.impulse || 3) * 0.3 });
                this.emit({ type: 'hitEnemy', crit: hit.part.role === 'head', killed: !killed0 && hit.enemy.dead, x: hit.x, y: hit.y, z: hit.z });
                if (typeof GameAudio !== 'undefined') GameAudio.impact('plaster', 0.4, hit.x, hit.y, hit.z);
                dmg *= 0.7;
                ox = hit.x + d.x * 0.18; oy = hit.y + d.y * 0.18; oz = hit.z + d.z * 0.18;
                left -= hit.t + 0.18;
                continue;
            }
            const m = VoxMat.of(hit.v);
            const res = VoxDestruction.carve(hit.x + d.x * 0.04, hit.y + d.y * 0.04, hit.z + d.z * 0.04, t.bore || 0.14, { power, jitter: 0.5, speed: 4.5, burst: 24 });
            total += res.count;
            if (hit.body && !hit.body.dead) { const J = (t.impulse || 3) * 70; VoxPhysics.applyImpulse(hit.body, hit.x, hit.y, hit.z, d.x * J, d.y * J, d.z * J); }
            if (hit.body && hit.body.explosive) VoxDestruction.queueExplosion(hit.body.x[0], hit.body.x[1], hit.body.x[2], 2.8, 0.05);
            if (m.sound === 'metal' || m.hard >= 3 || !m.hard) VoxFX.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, m.sound === 'metal' ? 8 : 4, 0.9);
            VoxFX.dust(hit.x, hit.y, hit.z, hit.v & 127, res.count ? 0.5 : 0.25, hit.nx, hit.ny, hit.nz);
            if (typeof GameAudio !== 'undefined') {
                if (res.count) GameAudio.breakVoxels(m.sound, res.count, hit.x, hit.y, hit.z);
                else GameAudio.impact(m.sound, 0.45, hit.x, hit.y, hit.z);
            }
            if (!m.hard || m.hard >= 3 || power < 2) break;
            power = Math.max(1, power - (m.hard >= 2 && k >= 1 ? 1 : 0));
            ox = hit.x + d.x * 0.12; oy = hit.y + d.y * 0.12; oz = hit.z + d.z * 0.12;
            left -= hit.t + 0.12;
        }
        if (total) VoxDestruction.detach(null);
        return { last, first, total };
    },

    _shootBullet(t) {
        const p = this.game.player, e = p.eye, d0 = p.dir();
        const s = (t.spread || 0) * (1 - this.zoomed * 0.95) * (Math.hypot(p.vel.x, p.vel.z) > 3 ? 1.5 : 1);
        const d = this._spreadDir(d0, s);
        const r = this._bullet(e, d, t);
        const mz = this._muzzlePos();
        GameCosmetics.muzzle(mz.x, mz.y, mz.z, d.x, d.y, d.z, t.cat === 'minigun' ? 0.75 : (t.id === 'sniper_giga' ? 1.8 : 1));
        const end = r.last ? r.last : { x: e.x + d.x * 120, y: e.y + d.y * 120, z: e.z + d.z * 120 };
        GameCosmetics.tracer(mz.x, mz.y, mz.z, end.x, end.y, end.z);
        p.kick += t.kick || 0.02; p.kickYaw += (Math.random() - 0.5) * (t.kick || 0.02) * 0.45; p.addTrauma(0.03 + (t.kick || 0) * 1.2);
        if (t.punch) p.push(-d0.x * t.punch, 0, -d0.z * t.punch);
        this.recoil = Math.min(1.6, 0.5 + (t.kick || 0.02) * 12);
        if (typeof GameAudio !== 'undefined') GameAudio.shot(t.sound || 'rifle', t.pitch || 1);
    },

    _shootPellets(t) {
        const p = this.game.player, e = p.eye, d0 = p.dir();
        const mz = this._muzzlePos();
        let hx = 0, hy = 0, hz = 0, hn = 0, near = 1e9, total = 0;
        for (let i = 0; i < t.pellets; i++) {
            const d = this._spreadDir(d0, t.spread);
            const r = this._bullet(e, d, t);
            total += r.total;
            if (r.first && !r.first.enemy) { hx += r.first.x; hy += r.first.y; hz += r.first.z; hn++; near = Math.min(near, r.first.t); }
            if (r.last && i % 3 === 0) GameCosmetics.tracer(mz.x, mz.y, mz.z, r.last.x, r.last.y, r.last.z);
        }
        // вблизи заряд выносит кусок целиком
        if (hn && near < 5) {
            const k = 1 - near / 5;
            const cx = hx / hn + d0.x * 0.1, cy = hy / hn + d0.y * 0.1, cz = hz / hn + d0.z * 0.1;
            const big = VoxDestruction.carve(cx, cy, cz, 0.18 + 0.32 * k, { power: 2, jitter: 0.55, speed: 5 });
            if (big.count) { VoxDestruction.detach(null); VoxFX.dust(cx, cy, cz, (big.mat || 9) & 127, 1.2, -d0.x, -d0.y, -d0.z); }
        }
        GameCosmetics.muzzle(mz.x, mz.y, mz.z, d0.x, d0.y, d0.z, 1.8);
        p.kick += t.kick || 0.08; p.addTrauma(0.2);
        if (t.punch) p.push(-d0.x * t.punch, 0, -d0.z * t.punch);
        this.recoil = 1.5;
        if (typeof GameAudio !== 'undefined') GameAudio.shot('shotgun', t.pitch || 1);
    },

    /** Плазма: быстрый светящийся снаряд с маленьким взрывом. */
    _shootPlasma(t) {
        const p = this.game.player, d0 = p.dir(), d = this._spreadDir(d0, t.spread), mz = this._muzzlePos();
        const node = GameEnemies._boltMesh('cyan');
        node.scaling.set(0.11, 0.11, 0.3);
        this.shots.push({ def: t, plasma: true, x: mz.x, y: mz.y, z: mz.z, vx: d.x * 62, vy: d.y * 62, vz: d.z * 62, t: 0, node, g: 0, life: 2 });
        GameCosmetics.muzzle(mz.x, mz.y, mz.z, d.x, d.y, d.z, 0.7);
        p.kick += t.kick; p.kickYaw += (Math.random() - 0.5) * t.kick * 0.5; p.addTrauma(0.035);
        this.recoil = 0.7;
        if (typeof GameAudio !== 'undefined') GameAudio.shot('rifle', 1.7);
    },

    /** Рельса: всё на линии — насквозь, туннель в мире. */
    _shootRail(t) {
        const p = this.game.player, e = p.eye, d = p.dir(), mz = this._muzzlePos();
        const max = 90;
        const he = [];
        // враги на линии — все
        for (const q of GameEnemies.list) { const h = q.rig.raycast(e.x, e.y, e.z, d.x, d.y, d.z, max); if (h) { h.enemy = q; he.push(h); } }
        for (const h of he) {
            const was = h.enemy.dead;
            GameEnemies.damage(h, { dmg: t.dmg, radius: t.cut, impulse: t.impulse, dx: d.x, dy: d.y, dz: d.z, pixels: 8, fall: true });
            this.emit({ type: 'hitEnemy', crit: h.part.role === 'head', killed: !was && h.enemy.dead, x: h.x, y: h.y, z: h.z });
        }
        // тоннель: шаги вдоль луча
        let total = 0, len = 0;
        for (let s = 0.6; s < max; s += 0.28) {
            const x = e.x + d.x * s, y = e.y + d.y * s, z = e.z + d.z * s;
            if (x < 0 || z < 0 || y < 0 || x > this.game.world.sx * 0.1 || z > this.game.world.sz * 0.1 || y > 19) break;
            len = s;
            const r = VoxDestruction.carve(x, y, z, t.bore, { power: 4, all: true, jitter: 0.35, speed: 7, burst: 16 });
            total += r.count;
        }
        if (total) VoxDestruction.detach(null);
        GameCosmetics.tracer(mz.x, mz.y, mz.z, e.x + d.x * len, e.y + d.y * len, e.z + d.z * len);
        for (let s = 1; s < Math.min(len, 40); s += 1.1) VoxFX.puff(e.x + d.x * s, e.y + d.y * s, e.z + d.z * s, { add: true, mode: 5, size: 0.14, life: 0.5, alpha: 1, r: 1.0, g: 2.6, b: 3.6, fadeOut: 0.4 });
        VoxRender.flash(mz.x, mz.y, mz.z, [0.4, 0.8, 1], 18, 12, 0.2);
        p.kick += t.kick; p.addTrauma(0.42);
        if (t.punch) p.push(-d.x * t.punch, 0, -d.z * t.punch);
        this.recoil = 1.7;
        if (typeof GameAudio !== 'undefined') { GameAudio.shot('launcher', 1.5); if (total) GameAudio.breakVoxels('concrete', total, e.x + d.x * 8, e.y, e.z + d.z * 8); }
    },

    /** Молния: первая цель по прицелу, дальше прыгает на соседей; мышцы бьёт судорогой. */
    _shootTesla(t) {
        const p = this.game.player, e = p.eye, d = p.dir(), mz = this._muzzlePos();
        let cur = null;
        const hit = this.ray(e.x, e.y, e.z, d.x, d.y, d.z, t.range);
        if (hit && hit.enemy) cur = hit.enemy;
        if (!cur) {
            // слабая наводка: ближайший враг в конусе
            let best = 0.965;
            for (const q of GameEnemies.list) {
                if (q.dead) continue;
                const c = q.rig.center([0, 0, 0]), dx = c[0] - e.x, dy = c[1] - e.y, dz = c[2] - e.z, l = Math.hypot(dx, dy, dz) || 1;
                if (l > t.range) continue;
                const dot = (dx * d.x + dy * d.y + dz * d.z) / l;
                if (dot > best) { best = dot; cur = q; }
            }
        }
        let fx = mz.x, fy = mz.y, fz = mz.z;
        const used = new Set();
        for (let k = 0; k < t.chain && cur; k++) {
            used.add(cur);
            const c = cur.rig.center([0, 0, 0]);
            this._bolt(fx, fy, fz, c[0], c[1], c[2]);
            const was = cur.dead;
            GameEnemies.shock(cur, 0.5);
            GameEnemies.hurt(cur, t.dmg * Math.pow(0.8, k), c[0], c[1] + 0.3, c[2], false);
            GameEnemies.alert(cur);
            this.emit({ type: 'hitEnemy', crit: false, killed: !was && cur.dead, x: c[0], y: c[1], z: c[2] });
            fx = c[0]; fy = c[1]; fz = c[2];
            let next = null, bd = t.chainR;
            for (const q of GameEnemies.list) {
                if (q.dead || used.has(q)) continue;
                const o = q.rig.center([0, 0, 0]), dd = Math.hypot(o[0] - fx, o[1] - fy, o[2] - fz);
                if (dd < bd) { bd = dd; next = q; }
            }
            cur = next;
        }
        if (!used.size) {
            const end = hit ? hit : { x: e.x + d.x * t.range, y: e.y + d.y * t.range, z: e.z + d.z * t.range };
            this._bolt(mz.x, mz.y, mz.z, end.x, end.y, end.z);
            if (hit && !hit.enemy) VoxFX.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 5, 1);
        }
        VoxRender.flash(mz.x, mz.y, mz.z, [0.5, 0.75, 1], 7, 8, 0.1, 0.8);
        p.addTrauma(0.03); this.recoil = 0.3;
        if (typeof GameAudio !== 'undefined' && Math.random() < 0.6) GameAudio.ui('click');
    },

    /** Ломаная молния частицами. */
    _bolt(ax, ay, az, bx, by, bz) {
        const n = Math.max(3, Math.round(Math.hypot(bx - ax, by - ay, bz - az) / 0.38));
        let x = ax, y = ay, z = az;
        for (let i = 1; i <= n; i++) {
            const f = i / n, j = i === n ? 0 : 0.22;
            const nx = ax + (bx - ax) * f + (Math.random() - 0.5) * j * 2, ny = ay + (by - ay) * f + (Math.random() - 0.5) * j * 2, nz = az + (bz - az) * f + (Math.random() - 0.5) * j * 2;
            GameCosmetics.tracer(x, y, z, nx, ny, nz);
            x = nx; y = ny; z = nz;
        }
    },

    /** Струя мороза: копит холод, при полном — лёд. */
    _shootFreeze(t) {
        const p = this.game.player, e = p.eye, d = p.dir(), mz = this._muzzlePos();
        for (let i = 0; i < 3; i++) {
            const s = 0.14, sp = 8 + Math.random() * 4;
            VoxFX.puff(mz.x, mz.y, mz.z, { size: 0.1, grow: 2.2, life: 0.55, alpha: 0.55, vx: (d.x + (Math.random() - 0.5) * s) * sp, vy: (d.y + (Math.random() - 0.5) * s) * sp, vz: (d.z + (Math.random() - 0.5) * s) * sp, drag: 2.2, buoy: -0.3, r: 0.7, g: 0.95, b: 1.1 });
        }
        for (const q of GameEnemies.list) {
            if (q.dead) continue;
            const c = q.rig.center([0, 0, 0]), dx = c[0] - e.x, dy = c[1] - e.y, dz = c[2] - e.z, l = Math.hypot(dx, dy, dz) || 1;
            if (l > t.range || (dx * d.x + dy * d.y + dz * d.z) / l < 0.93) continue;
            q.chill = (q.chill || 0) + t.freeze * t.rate * 3;
            q.wishX *= 0.8; q.wishZ *= 0.8;
            GameEnemies.alert(q);
            if (q.chill >= 1 && q.rig.frozen <= 0) { q.chill = 0; GameEnemies.freeze(q, t.freezeSec); VoxFX.sparks(c[0], c[1], c[2], 0, 1, 0, 8, 0.4); }
        }
        this.recoil = 0.2;
    },

    /** Огнемёт: конус поджигает врагов и горючее. */
    _shootFlame(t) {
        if (typeof GameAudio !== 'undefined' && !this._torchLoop && GameAudio.fireLoop) this._torchLoop = GameAudio.fireLoop();
        if (this._torchLoop) this._torchLoop.set(0.9);
        const p = this.game.player, e = p.eye, d = p.dir(), mz = this._muzzlePos();
        for (let i = 0; i < 4; i++) {
            const s = 0.13, sp = 9 + Math.random() * 4;
            VoxFX.puff(mz.x, mz.y, mz.z, { add: true, fire: true, size: 0.12, grow: 1.6, life: 0.45 + Math.random() * 0.2,
                vx: (d.x + (Math.random() - 0.5) * s) * sp + p.vel.x, vy: (d.y + (Math.random() - 0.5) * s) * sp + 0.5, vz: (d.z + (Math.random() - 0.5) * s) * sp + p.vel.z, drag: 2.2, buoy: 2.5, fadeIn: 0.02 });
        }
        for (const q of GameEnemies.list) {
            const c = q.rig.center([0, 0, 0]), dx = c[0] - e.x, dy = c[1] - e.y, dz = c[2] - e.z, l = Math.hypot(dx, dy, dz) || 1;
            if (l > t.range || (dx * d.x + dy * d.y + dz * d.z) / l < 0.9) continue;
            if (!q.dead) { GameEnemies.hurt(q, t.dmg, c[0], c[1] + 0.3, c[2], false); GameEnemies.ignite(q, t.burn); GameEnemies.alert(q); this.emit({ type: 'hitEnemy', crit: false, killed: q.dead, x: c[0], y: c[1], z: c[2] }); }
            q.rig.char(0.01);
        }
        const hit = this.ray(e.x, e.y, e.z, d.x, d.y, d.z, 5.5, true);
        if (hit) {
            VoxDestruction.igniteSphere(hit.x - hit.nx * 0.05, hit.y - hit.ny * 0.05, hit.z - hit.nz * 0.05, 0.25);
            VoxRender.flash(hit.x + hit.nx * 0.3, hit.y + hit.ny * 0.3, hit.z + hit.nz * 0.3, [1, 0.55, 0.2], 5, 7, 0.15, 0.6);
            if (hit.body && !hit.body.dead) VoxPhysics.applyImpulse(hit.body, hit.x, hit.y, hit.z, d.x * 6, d.y * 6, d.z * 6);
        }
        VoxRender.flash(mz.x + d.x * 1.5, mz.y + d.y * 1.5, mz.z + d.z * 1.5, [1, 0.6, 0.25], 3, 6, 0.1, 0.5);
    },

    _hammer(t) {
        const { e, d, hit } = this._eyeRay(2.8);
        const p = this.game.player;
        if (!hit) return;
        if (hit.enemy) {
            const was = hit.enemy.dead;
            GameEnemies.damage(hit, { dmg: t.dmg, radius: t.cut, impulse: t.impulse, dx: d.x, dy: d.y + 0.3, dz: d.z, pixels: 6, fall: true });
            this.emit({ type: 'hitEnemy', crit: hit.part.role === 'head', killed: !was && hit.enemy.dead, x: hit.x, y: hit.y, z: hit.z });
            if (typeof GameAudio !== 'undefined') { GameAudio.swing(true); GameAudio.impact('plaster', 1, hit.x, hit.y, hit.z); }
            p.addTrauma(0.26); this.recoil = 0.7;
            return;
        }
        const m = VoxMat.of(hit.v);
        const cx = hit.x - hit.nx * 0.1, cy = hit.y - hit.ny * 0.1, cz = hit.z - hit.nz * 0.1;
        let res = VoxDestruction.carve(cx, cy, cz, t.bore, { power: 2, jitter: 0.45, speed: 2.6 });
        // прочнее кувалды (бетон, камень, металл): сколы с каждым ударом, после нескольких — пролом. Неразрушимо только hard 0.
        if (m.hard > 2) {
            const key = (Math.floor(cx * 2.5) * 73856093) ^ (Math.floor(cy * 2.5) * 19349663) ^ (Math.floor(cz * 2.5) * 83492791) ^ (hit.body ? hit.body.id : 0);
            const need = m.hard >= 4 ? 5 : 3;
            const n = (this._dents.get(key) || 0) + 1;
            if (this._dents.size > 400) this._dents.clear();
            if (n >= need) {
                this._dents.delete(key);
                res = VoxDestruction.carve(cx, cy, cz, 0.5, { power: 4, all: true, jitter: 0.5, speed: 4.2, burst: 90 });
                p.addTrauma(0.2);
            } else {
                this._dents.set(key, n);
                res = VoxDestruction.carve(cx, cy, cz, 0.14 + n * 0.04, { power: 4, all: true, jitter: 0.7, speed: 2.4, burst: 14 });
            }
            this.emit({ type: 'dent', n, need, x: hit.x, y: hit.y, z: hit.z });
        }
        if (hit.body && !hit.body.dead) VoxPhysics.applyImpulse(hit.body, hit.x, hit.y, hit.z, d.x * 420, d.y * 420, d.z * 420);
        VoxDestruction.detach(null);
        VoxFX.dust(hit.x, hit.y, hit.z, hit.v & 127, res.count ? Math.min(1.5, res.count / 40) : 0.2, hit.nx, hit.ny, hit.nz);
        if (m.sound === 'metal' || !res.count) VoxFX.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, m.sound === 'metal' ? 12 : 3, 0.8);
        if (typeof GameAudio !== 'undefined') {
            GameAudio.swing(true);
            if (res.count) GameAudio.breakVoxels(VoxMat.of(res.mat || hit.v).sound, res.count, hit.x, hit.y, hit.z);
            else GameAudio.impact(m.sound, 0.7, hit.x, hit.y, hit.z);
        }
        p.addTrauma(0.18);
        this.recoil = 0.6;
    },

    // ------------------------------------------------------------------ снаряды

    _projNode(id, scale) {
        const GW = typeof GameWeapons !== 'undefined' ? /** @type {any} */ (GameWeapons) : null;
        let node = null;
        if (GW && GW.projectile) { try { node = GW.projectile(id); } catch (e) { node = null; } }
        if (!node) {
            node = GameEnemies._boltMesh(id === 'proj_sticky' ? 'green' : (id === 'proj_saw' ? 'yellow' : 'orange'));
            node.scaling.setAll(0.16);
            return node;
        }
        if (scale) node.scaling.setAll(scale);
        node.rotationQuaternion = node.rotationQuaternion || new BABYLON.Quaternion();
        return node;
    },

    _launch(t) {
        const p = this.game.player, d = p.dir(), mz = this._muzzlePos();
        const node = this._projNode(t.proj, t.projScale);
        if (node) node.position.set(mz.x, mz.y, mz.z);
        const s = t.speed;
        this.shots.push({ def: t, x: mz.x, y: mz.y, z: mz.z, vx: d.x * s + p.vel.x * 0.5, vy: d.y * s + p.vel.y * 0.3 + (t.gravity > 4 ? 1.4 : 0), vz: d.z * s + p.vel.z * 0.5, t: 0, node, g: t.gravity || 0, life: t.fuse || 7, bounces: 0, hits: new Set(), stuck: null, roll: Math.random() * 6 });
        GameCosmetics.muzzle(mz.x, mz.y, mz.z, d.x, d.y, d.z, 1.2);
        if (t.trail) for (let i = 0; i < 5; i++) VoxFX.puff(mz.x - d.x * 0.8, mz.y - d.y * 0.8, mz.z - d.z * 0.8, { size: 0.4, grow: 1.5, life: 1.6, alpha: 0.5, vx: -d.x * 3 + (Math.random() - 0.5), vy: -d.y * 3 + 0.4, vz: -d.z * 3 + (Math.random() - 0.5), drag: 3, buoy: 0.2, r: 0.8, g: 0.8, b: 0.8 });
        p.kick += t.kick || 0.05; p.addTrauma(0.16);
        this.recoil = 1.2;
        const wh = this._warhead();
        if (wh) wh.setEnabled(false);
        if (typeof GameAudio !== 'undefined') GameAudio.shot('launcher', t.pitch || 1);
    },

    _warhead() {
        const GW = typeof GameWeapons !== 'undefined' ? /** @type {any} */ (GameWeapons) : null;
        const m = GW && GW.models && GW.models.launcher;
        return (m && m.parts && m.parts.warhead) || null;
    },

    _updateShots(dt) {
        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i], t = s.def;
            s.t += dt;
            if (s.stuck) { if (this._stuckTick(s, dt)) { this.shots.splice(i, 1); } continue; }
            s.vy -= s.g * dt;
            // самонаведение акулы
            if (t.homing) {
                let best = null, bd = 34;
                for (const q of GameEnemies.list) { if (q.dead) continue; const c = q.rig.center([0, 0, 0]), dd = Math.hypot(c[0] - s.x, c[1] - s.y, c[2] - s.z); if (dd < bd) { bd = dd; best = c; } }
                if (best) {
                    const sp0 = Math.hypot(s.vx, s.vy, s.vz) || 1;
                    const dx = best[0] - s.x, dy = best[1] - s.y, dz = best[2] - s.z, l = Math.hypot(dx, dy, dz) || 1, k = Math.min(1, t.homing * dt);
                    s.vx += (dx / l * sp0 - s.vx) * k; s.vy += (dy / l * sp0 - s.vy) * k; s.vz += (dz / l * sp0 - s.vz) * k;
                }
            }
            const sp = Math.hypot(s.vx, s.vy, s.vz) || 1, st = sp * dt;
            const dx = s.vx / sp, dy = s.vy / sp, dz = s.vz / sp;
            const hit = this.ray(s.x, s.y, s.z, dx, dy, dz, st + 0.1);
            const timeUp = s.t > (s.life || 7);
            if (t.saw && hit) {
                // пила режет и рикошетит
                if (hit.enemy) {
                    if (!s.hits.has(hit.enemy)) {
                        s.hits.add(hit.enemy);
                        const was = hit.enemy.dead;
                        GameEnemies.damage(hit, { dmg: t.dmg, radius: t.cut, impulse: t.impulse, dx, dy, dz, pixels: 6 });
                        this.emit({ type: 'hitEnemy', crit: hit.part.role === 'head', killed: !was && hit.enemy.dead, x: hit.x, y: hit.y, z: hit.z });
                        VoxFX.sparks(hit.x, hit.y, hit.z, -dx, -dy, -dz, 8, 0.8);
                    }
                    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
                } else {
                    const res = VoxDestruction.carve(hit.x + dx * 0.05, hit.y + dy * 0.05, hit.z + dz * 0.05, t.bore, { power: t.power, jitter: 0.3, speed: 4, burst: 14 });
                    if (res.count) VoxDestruction.detach(null);
                    VoxFX.sparks(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 10, 1);
                    if (typeof GameAudio !== 'undefined') GameAudio.impact('metal', 0.5, hit.x, hit.y, hit.z);
                    s.hits.clear();
                    s.bounces++;
                    if (s.bounces > t.ricochet) { this._endShot(s, i, hit.x, hit.y, hit.z, dx, dy, dz); continue; }
                    const vn = s.vx * hit.nx + s.vy * hit.ny + s.vz * hit.nz;
                    s.vx -= 2 * vn * hit.nx; s.vy -= 2 * vn * hit.ny; s.vz -= 2 * vn * hit.nz;
                }
            } else if (hit && t.sticky) {
                s.stuck = { enemy: hit.enemy || null, part: hit.part || null, body: hit.body || null };
                s.x = hit.x; s.y = hit.y; s.z = hit.z;
                if (hit.enemy) { const n = hit.part; s.local = hit.enemy.rig.worldVox(n, hit.x, hit.y, hit.z, [0, 0, 0]); }
                if (typeof GameAudio !== 'undefined') GameAudio.impact('plaster', 0.5, hit.x, hit.y, hit.z);
                continue;
            } else if (hit && t.bounce && !hit.enemy && s.bounces < 6) {
                // граната отскакивает; по врагу — сразу взрыв
                const vn = s.vx * hit.nx + s.vy * hit.ny + s.vz * hit.nz;
                s.vx = (s.vx - (1 + t.bounce) * vn * hit.nx) * 0.84; s.vy -= (1 + t.bounce) * vn * hit.ny; s.vz = (s.vz - (1 + t.bounce) * vn * hit.nz) * 0.84;
                s.x = hit.x + hit.nx * 0.06; s.y = hit.y + hit.ny * 0.06; s.z = hit.z + hit.nz * 0.06;
                s.bounces++;
                if (typeof GameAudio !== 'undefined' && Math.abs(vn) > 2) GameAudio.impact('metal', 0.4, s.x, s.y, s.z);
                if (timeUp) { this._endShot(s, i, s.x, s.y, s.z, dx, dy, dz); continue; }
            } else if (hit || timeUp || s.y < 0) {
                const hx = hit ? hit.x - dx * 0.12 : s.x, hy = hit ? hit.y - dy * 0.12 : s.y, hz = hit ? hit.z - dz * 0.12 : s.z;
                this._endShot(s, i, hx, hy, hz, dx, dy, dz);
                continue;
            } else { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; }
            if (t.trail) { const n = Math.max(1, Math.round(st / 0.14)); for (let k = 0; k < n; k++) VoxFX.trail(s.x - dx * st * k / n, s.y - dy * st * k / n, s.z - dz * st * k / n); }
            if (s.node) {
                s.node.position.set(s.x, s.y, s.z);
                if (s.node.rotationQuaternion) {
                    const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
                    s.roll += dt * (t.saw ? 26 : 6);
                    BABYLON.Quaternion.RotationYawPitchRollToRef(t.saw ? s.roll : yaw, t.saw ? 0 : pitch, t.saw ? 0 : s.roll, s.node.rotationQuaternion);
                } else if (s.node.lookAt) s.node.lookAt(new BABYLON.Vector3(s.x + dx, s.y + dy, s.z + dz));
            }
        }
    },

    /** Липкий заряд: едет на том, к чему прилип. true — закончился. */
    _stuckTick(s, dt) {
        const st = s.stuck, t = s.def;
        if (st.enemy && st.part) {
            const r = st.enemy.rig;
            if (!r.gone && st.part.count) { const W = r.voxWorld(st.part, s.local[0] - 0.5, s.local[1] - 0.5, s.local[2] - 0.5, [0, 0, 0]); s.x = W[0]; s.y = W[1]; s.z = W[2]; } else st.enemy = null;
        } else if (st.body && !st.body.dead) {
            s.x += st.body.v[0] * dt; s.y += st.body.v[1] * dt; s.z += st.body.v[2] * dt;
        }
        if (s.node) s.node.position.set(s.x, s.y, s.z);
        if (Math.random() < dt * 6) VoxFX.sparks(s.x, s.y + 0.05, s.z, 0, 1, 0, 1, 0.6);
        if (s.t > (s.life || 6) || s.boom) {
            if (s.node) s.node.dispose();
            this._blast(t, s.x, s.y, s.z);
            return true;
        }
        return false;
    },

    _detonateSticky() {
        let k = 0;
        for (const s of this.shots) if (s.def.sticky && s.stuck) { s.boom = true; s.t = Math.max(s.t, 0); k++; }
        if (k && typeof GameAudio !== 'undefined') GameAudio.ui('click');
    },

    _endShot(s, i, x, y, z, dx, dy, dz) {
        this.shots.splice(i, 1);
        if (s.node) s.node.dispose();
        const t = s.def;
        if (s.plasma) {
            const hit = GameEnemies.raycast(x - dx * 0.4, y - dy * 0.4, z - dz * 0.4, dx, dy, dz, 0.8);
            if (hit) {
                const was = hit.enemy.dead;
                GameEnemies.damage(hit, { dmg: t.dmg, radius: 0.13, impulse: 4, dx, dy, dz, pixels: 5 });
                this.emit({ type: 'hitEnemy', crit: hit.part.role === 'head', killed: !was && hit.enemy.dead, x: hit.x, y: hit.y, z: hit.z });
            }
            const res = VoxDestruction.carve(x, y, z, t.blast * 0.5, { power: 3, jitter: 0.5, speed: 5, burst: 28 });
            if (res.count) VoxDestruction.detach(null);
            VoxFX.sparks(x, y, z, -dx, -dy, -dz, 6, 1);
            VoxRender.flash(x, y, z, [0.3, 0.9, 1], 8, 5, 0.12);
            if (typeof GameAudio !== 'undefined' && res.count) GameAudio.breakVoxels(VoxMat.of(res.mat || 10).sound, res.count, x, y, z);
            return;
        }
        if (t.saw) { VoxFX.sparks(x, y, z, 0, 1, 0, 14, 1); return; }
        this._blast(t, x, y, z, dx, dy, dz);
    },

    _blast(t, x, y, z, dx = 0, dy = 0, dz = 0) {
        VoxDestruction.explode(x, y, z, t.blast);
        if (t.cluster) this._scatter(x - dx * 0.3, y - dy * 0.3 + 0.3, z - dz * 0.3, t.cluster, 7.5, t.bomblet || 1.5);
        this.emit({ type: 'explode' });
    },

    _scatter(x, y, z, n, speed, r) {
        for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2 + Math.random() * 0.6, up = 0.35 + Math.random() * 0.6;
            const sp = speed * (0.6 + Math.random() * 0.6);
            this.bomblets.push({ x, y, z, vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp, t: 0, life: 0.7 + Math.random() * 0.9, r });
        }
    },

    _updateBomblets(dt) {
        for (let i = this.bomblets.length - 1; i >= 0; i--) {
            const q = this.bomblets[i];
            q.t += dt;
            q.vy -= 9.8 * dt;
            const sp = Math.hypot(q.vx, q.vy, q.vz) || 1, step = sp * dt;
            const hit = this.ray(q.x, q.y, q.z, q.vx / sp, q.vy / sp, q.vz / sp, step + 0.05);
            if (hit || q.t > q.life || q.y < 0.5) {
                this.bomblets.splice(i, 1);
                VoxDestruction.explode(hit ? hit.x - q.vx / sp * 0.1 : q.x, hit ? hit.y - q.vy / sp * 0.1 : q.y, hit ? hit.z - q.vz / sp * 0.1 : q.z, q.r);
                continue;
            }
            q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
            if (Math.random() < 0.6) VoxFX.sparks(q.x, q.y, q.z, 0, 1, 0, 1, 0.9);
        }
    },

    // ------------------------------------------------------------------ чёрная дыра

    _launchHole(t) {
        const p = this.game.player, d = p.dir(), mz = this._muzzlePos();
        const mesh = BABYLON.MeshBuilder.CreateSphere('hole', { diameter: 1, segments: 12 }, VoxRender.scene);
        const mat = new BABYLON.StandardMaterial('hole', VoxRender.scene);
        mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(0, 0, 0); mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mesh.material = mat; mesh.isPickable = false; mesh.scaling.setAll(0.25);
        mesh.position.set(mz.x, mz.y, mz.z);
        const ringMat = new BABYLON.StandardMaterial('holeRing', VoxRender.scene);
        ringMat.disableLighting = true; ringMat.emissiveColor = new BABYLON.Color3(1.4, 0.4, 2.2); ringMat.alpha = 0.85; ringMat.backFaceCulling = false;
        const ring = BABYLON.MeshBuilder.CreateTorus('holeRing', { diameter: 1.5, thickness: 0.09, tessellation: 28 }, VoxRender.scene);
        ring.material = ringMat; ring.isPickable = false; ring.parent = mesh;
        this.holes.push({ def: t, mesh, ring, x: mz.x, y: mz.y, z: mz.z, vx: d.x * t.speed, vy: d.y * t.speed, vz: d.z * t.speed, t: 0, open: false, life: t.life });
        p.kick += t.kick; p.addTrauma(0.2); this.recoil = 1;
        if (typeof GameAudio !== 'undefined') GameAudio.shot('launcher');
    },

    _updateHoles(dt) {
        for (let i = this.holes.length - 1; i >= 0; i--) {
            const h = this.holes[i], t = h.def;
            h.t += dt;
            if (!h.open) {
                const sp = Math.hypot(h.vx, h.vy, h.vz) || 1, st = sp * dt;
                const hit = this.ray(h.x, h.y, h.z, h.vx / sp, h.vy / sp, h.vz / sp, st + 0.3);
                if (hit || h.t > 1.4) { h.open = true; h.t = 0; if (hit) { h.x = hit.x - h.vx / sp * 0.6; h.y = hit.y - h.vy / sp * 0.6 + 0.4; h.z = hit.z - h.vz / sp * 0.6; } if (typeof GameAudio !== 'undefined') GameAudio.debrisRumble(0.9, h.x, h.y, h.z); }
                else { h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt; }
                h.mesh.position.set(h.x, h.y, h.z);
                continue;
            }
            const grow = Math.min(1, h.t / 0.5);
            h.mesh.scaling.setAll(0.3 + 1.1 * grow + Math.sin(h.t * 22) * 0.05);
            h.ring.rotation.x += dt * 2; h.ring.rotation.z += dt * 3.4;
            GameEnemies.pull(h.x, h.y, h.z, t.pullR, t.pull, dt);
            // твёрдые тела и обломки тянет тоже; стены объедает у центра
            for (const b of VoxPhysics.bodies) {
                if (b.dead) continue;
                const dx = h.x - b.x[0], dy = h.y - b.x[1], dz = h.z - b.x[2], d = Math.hypot(dx, dy, dz) || 1;
                if (d > t.pullR) continue;
                VoxPhysics.wake(b);
                const J = Math.min(b.mass * 40, b.mass * t.pull * (1 - d / t.pullR)) * dt;
                VoxPhysics.applyImpulse(b, b.x[0], b.x[1], b.x[2], dx / d * J, dy / d * J, dz / d * J);
            }
            if (Math.random() < dt * 9) {
                const res = VoxDestruction.carve(h.x, h.y, h.z, 1.1 + grow * 0.9, { power: 3, jitter: 0.7, speed: -3, burst: 30, fx: true });
                if (res.count) VoxDestruction.detach(b => { VoxPhysics.applyImpulse(b, b.x[0], b.x[1], b.x[2], (h.x - b.x[0]) * b.mass * 2, (h.y - b.x[1]) * b.mass * 2, (h.z - b.x[2]) * b.mass * 2); });
            }
            if (Math.random() < dt * 40) {
                const a = Math.random() * 6.28, r = 2 + Math.random() * 2.5;
                VoxFX.puff(h.x + Math.cos(a) * r, h.y + (Math.random() - 0.5) * 1.4, h.z + Math.sin(a) * r, { add: true, mode: 5, size: 0.08, life: 0.5, alpha: 1, vx: -Math.cos(a) * r * 2.4, vy: 0, vz: -Math.sin(a) * r * 2.4, r: 2.2, g: 0.7, b: 3.2, fadeOut: 0.4 });
            }
            const pl = this.game.player, pd = Math.hypot(h.x - pl.pos.x, h.y - pl.pos.y, h.z - pl.pos.z) || 1;
            if (pd < t.pullR * 0.75) { pl.push((h.x - pl.pos.x) / pd * dt * 9, (h.y - pl.pos.y) / pd * dt * 3, (h.z - pl.pos.z) / pd * dt * 9); pl.addTrauma(dt * 0.8); }
            if (h.t > h.life) {
                h.mesh.dispose();
                this.holes.splice(i, 1);
                VoxDestruction.explode(h.x, h.y, h.z, t.blast);
                this.emit({ type: 'explode' });
            }
        }
    },

    // ------------------------------------------------------------------ бомба (твёрдое тело с запалом)

    _throwBomb(t) {
        const p = this.game.player, e = p.eye, d = p.dir();
        const sx = 2, sy = 2, sz = 4;
        const grid = new Uint8Array(sx * sy * sz);
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) grid[x + sx * (z + sz * y)] = (z === 0 || z === sz - 1) ? M.metal : M.hazard;
        const k = 1 / VoxPhysics.vs, tv = 12;
        const b = VoxPhysics.createBody(grid, sx, sy, sz, Math.floor((e.x + d.x * 0.6) * k), Math.floor((e.y + d.y * 0.6 - 0.15) * k), Math.floor((e.z + d.z * 0.6) * k), {
            minCount: 1, v: [d.x * tv + p.vel.x, d.y * tv + 2.5 + p.vel.y * 0.5, d.z * tv + p.vel.z], w: [(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12],
        });
        if (!b) return;
        b.x[0] = e.x + d.x * 0.6; b.x[1] = e.y + d.y * 0.6 - 0.15; b.x[2] = e.z + d.z * 0.6;
        b.px.set(b.x);
        const s = 2.4 / Math.max(1e-6, b.mass);
        b.mass = 2.4; b.invMass = 1 / 2.4;
        for (let i = 0; i < 9; i++) b.Il[i] /= s;
        VoxPhysics._syncR(b);
        this._attachBombModel(b);
        this.bombs.push({ body: b, fuse: t.fuse, def: t, holder: null });
        this.recoil = 0.6;
        if (typeof GameAudio !== 'undefined') GameAudio.grab('throw');
    },

    _attachBombModel(b) {
        const GW = typeof GameWeapons !== 'undefined' ? /** @type {any} */ (GameWeapons) : null;
        const m = GW && GW.models && GW.models.bomb;
        if (!m || !m.node || !b.node) return;
        const root = /** @type {BABYLON.TransformNode} */ (m.node.clone('bombWorld', null));
        if (!root) return;
        root.setEnabled(true);
        root.rotationQuaternion = null;
        root.position.setAll(0); root.rotation.setAll(0); root.scaling.setAll(1);
        root.computeWorldMatrix(true);
        const meshes = root.getChildMeshes(false);
        for (const ms of meshes) {
            ms.renderingGroupId = 0; ms.layerMask = 0x0FFFFFFF; ms.isPickable = false; ms.receiveShadows = true; ms.computeWorldMatrix(true);
            if (ms.material) { const mc = ms.material.clone(ms.material.name + '-w'); const sub = /** @type {any} */ (mc).subMaterials; for (const q of sub || [mc]) if (q) q.imageProcessingConfiguration = VoxRender.scene.imageProcessingConfiguration; ms.material = mc; }
        }
        const bb = root.getHierarchyBoundingVectors(true);
        const size = bb.max.subtract(bb.min), c = bb.min.add(bb.max).scale(0.5);
        const long = Math.max(size.x, size.y, size.z) || 1;
        const k = 0.4 / long;
        const pivot = new BABYLON.TransformNode('bombPivot', VoxRender.scene);
        pivot.parent = b.node;
        if (size.x >= size.y && size.x >= size.z) pivot.rotation.y = Math.PI / 2;
        else if (size.y >= size.z) pivot.rotation.x = Math.PI / 2;
        root.parent = pivot;
        root.scaling.setAll(k);
        root.position.set(-c.x * k, -c.y * k, -c.z * k);
        if (b.meshO) b.meshO.setEnabled(false);
        if (b.meshG) b.meshG.setEnabled(false);
    },

    _updateBombs(dt) {
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const bm = this.bombs[i], b = bm.body;
            bm.fuse -= dt;
            const x = b.x[0], y = b.x[1], z = b.x[2];
            if (Math.random() < 0.7) VoxFX.sparks(x, y + 0.1, z, 0, 1, 0, 1, 0.8);
            if (bm.fuse <= 0 || b.dead) {
                this.bombs.splice(i, 1);
                VoxPhysics.remove(b);
                VoxDestruction.explode(x, y, z, bm.def.blast);
                this.emit({ type: 'explode' });
            }
        }
    },

    // ------------------------------------------------------------------ захват

    _tryGrab() {
        const { hit } = this._eyeRay(5);
        if (hit && hit.enemy) {
            const q = hit.enemy;
            q.rig.fall(3);
            GameEnemies.alert(q);
            this.held = { enemy: q, dist: Math.max(1.6, Math.min(3.4, hit.t)) };
            if (typeof GameAudio !== 'undefined') GameAudio.grab('grab');
            this.emit({ type: 'grab' });
            return true;
        }
        if (!hit || !hit.body || hit.body.mass > (typeof RL_GRAB_MAX_MASS !== 'undefined' ? RL_GRAB_MAX_MASS : 450)) { if (typeof GameAudio !== 'undefined') GameAudio.ui('click'); return false; }
        const b = hit.body, R = b.R;
        const ldx = hit.x - b.x[0], ldy = hit.y - b.x[1], ldz = hit.z - b.x[2];
        const local = [R[0] * ldx + R[3] * ldy + R[6] * ldz, R[1] * ldx + R[4] * ldy + R[7] * ldz, R[2] * ldx + R[5] * ldy + R[8] * ldz];
        const g = typeof RL_GRAVITY !== 'undefined' ? RL_GRAVITY : 9.81;
        const joint = VoxPhysics.grab(b, local, [hit.x, hit.y, hit.z], b.mass * g * 2.5 + 900);
        this.held = { joint, body: b, dist: Math.max(1.4, Math.min(3.2, hit.t)) };
        if (typeof GameAudio !== 'undefined') GameAudio.grab('grab');
        this.emit({ type: 'grab' });
        return true;
    },

    _updateHeld(dt) {
        const h = this.held, p = this.game.player, e = p.eye, d = p.dir();
        const tx = e.x + d.x * h.dist, ty = e.y + d.y * h.dist, tz = e.z + d.z * h.dist;
        if (h.enemy) {
            const r = h.enemy.rig;
            if (r.gone) { this.held = null; return; }
            r.stateT = 0;   // пока держат, не встаёт
            if (r.state !== 'down' && r.state !== 'dead') r.fall(3);
            const ids = r.type.skeleton.ids, c = [ids.neck, ids.waist, ids.pelvis].filter(i => i != null);
            for (const i of c) {
                const j = i * 3;
                const k = Math.min(1, dt * 12);
                r.P[j] += (tx - r.P[j]) * k * 0.5; r.P[j + 1] += (ty - r.P[j + 1]) * k * 0.5; r.P[j + 2] += (tz - r.P[j + 2]) * k * 0.5;
            }
            return;
        }
        const b = h.body;
        if (b.dead) { this._release(false); return; }
        const t = h.joint.target;
        t[0] = tx; t[1] = ty; t[2] = tz;
    },

    _release(throwIt) {
        const h = this.held;
        if (!h) return;
        this.held = null;
        const d = this.game.player.dir();
        if (h.enemy) {
            if (throwIt) {
                const massK = h.enemy.type.mass || 1, s = 20 / massK;
                h.enemy.rig.kickAll(d.x * s, d.y * s + 3, d.z * s, 0.9);
                h.enemy.flung = 1;
                if (typeof GameAudio !== 'undefined') GameAudio.grab('throw');
                this.emit({ type: 'throw' });
            } else if (typeof GameAudio !== 'undefined') GameAudio.grab('drop');
            return;
        }
        VoxPhysics.release(h.joint);
        if (throwIt && !h.body.dead) {
            const J = Math.min(h.body.mass * 14, 2600);
            VoxPhysics.applyImpulse(h.body, h.body.x[0], h.body.x[1], h.body.x[2], d.x * J, d.y * J + J * 0.1, d.z * J);
            if (typeof GameAudio !== 'undefined') GameAudio.grab('throw');
            this.emit({ type: 'throw' });
        } else if (typeof GameAudio !== 'undefined') GameAudio.grab('drop');
    },

    _norm(x, y, z) { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; },

    // ------------------------------------------------------------------ модели в руках

    _buildViewmodelRoot() {
        const scene = VoxRender.scene, cam = VoxRender.camera;
        this.vmRoot = new BABYLON.TransformNode('vm', scene);
        this.vmRoot.parent = cam;
        scene.setRenderingAutoClearDepthStencil(2, true, true, true);
    },

    /** Воксельная заготовка, пока модель грузится. */
    _fallbackVm(id) {
        const scene = VoxRender.scene;
        const sx = 3, sy = 3, sz = 12;
        const pad = new Uint8Array((sx + 2) * (sy + 2) * (sz + 2));
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) pad[(x + 1) + (sx + 2) * ((z + 1) + (sz + 2) * (y + 1))] = z < 4 ? M.toy_orange : M.toy_dgray;
        const r = VoxMesher.build(pad, sx, sy, sz, 0, 0, 0, 0.1);
        const m = new BABYLON.Mesh('vmPart', scene);
        VoxRender.applyBuffers(m, r.opaque);
        m.material = VoxRender.vmMat;
        m.renderingGroupId = 2;
        m.layerMask = VoxRender.VM_LAYER;
        m.isPickable = false;
        m.position.set(-sx * 0.05, -sy * 0.05, -sz * 0.1);
        const n = new BABYLON.TransformNode('vm-' + id, scene);
        n.parent = this.vmRoot;
        m.parent = n;
        n.position.set(0.24, -0.26, -0.5);
        n.scaling.setAll(0.34);
        n.setEnabled(false);
        n.metadata = { base: [0.24, -0.26, -0.5], fallback: true };
        return n;
    },

    /** Модель оружия в руках: готовая или заготовка, настоящая подгружается сама и подменяет заготовку. */
    _ensureVm(id) {
        if (this.vm[id]) return;
        this.vm[id] = this._fallbackVm(id);
        GameWeapons.ensure(VoxRender.scene, id).then(m => {
            if (!m || !m.node) return;
            const old = this.vm[id];
            const on = this.tool.id === id;
            if (old) old.dispose(false, false);
            m.node.parent = this.vmRoot;
            if (m.scale) m.node.scaling.setAll(m.scale);
            m.node.position.set(m.base[0], m.base[1], m.base[2]);
            m.node.metadata = Object.assign({}, m.node.metadata || {}, { base: m.base.slice(), muzzle: m.muzzle || null, model: m });
            m.node.setEnabled(on);
            this.vm[id] = m.node;
        }).catch(e => console.warn('GameTools: модель ' + id + ': ' + ((e && e.message) || e)));
    },

    _animate(dt) {
        const n = this.vm[this.tool.id];
        if (!n || !n.metadata) return;
        const p = this.game.player;
        const base = n.metadata.base;
        const look = this.game.lastLook || { dx: 0, dy: 0 };
        this._sway.x += ((-look.dx * 0.0006) - this._sway.x) * Math.min(1, dt * 10);
        this._sway.y += ((look.dy * 0.0006) - this._sway.y) * Math.min(1, dt * 10);
        this.recoil += (0 - this.recoil) * Math.min(1, dt * 12);
        const bob = p.bobAmp;
        const sw = this.switchT > 0 ? Math.sin(this.switchT / 0.28 * Math.PI) * 0.25 : 0;
        const rl = this.reloading > 0 ? Math.min(1, Math.min(this.reloading, 0.3) / 0.3) : 0;
        const zm = this.zoomed;
        n.position.set(
            base[0] * (1 - zm * 0.85) + this._sway.x + Math.cos(p.bob) * bob * 0.6,
            base[1] + this._sway.y - Math.abs(Math.sin(p.bob)) * bob * 0.5 - sw - p.landDip * 0.3 - rl * 0.22 + zm * 0.08,
            base[2] + this.recoil * 0.06);
        let rx = this.recoil * 0.12 + this._sway.y * 2 + rl * 0.55, ry = this._sway.x * 2, rz = rl * 0.3;
        const t = this.tool;
        if (t.kind === 'melee' && this.swing >= 0) {
            const s0 = this.swing;
            const a = s0 < 0.11 ? 0.6 - s0 / 0.11 * 1.35 : -0.75 * (1 - (s0 - 0.11) / 0.31);
            const s = s0 < 0.11 ? s0 / 0.11 : 1 - (s0 - 0.11) / 0.31;
            rx += a; ry += 0.3 * s; rz += -0.3 * s;
        }
        if (t.kind === 'melee') { rx += -0.55; ry += -0.25; }
        if (this.held) rx += -0.12;
        n.rotation.set(rx, ry, rz);
        // вращающиеся части: блок стволов, барабан, пильный диск
        const parts = n.metadata.model && n.metadata.model.parts;
        if (parts) {
            if (parts.spin) { this._spinA = (this._spinA || 0) + dt * (t.spin ? 40 * Math.min(1, this.spinUp / t.spin) : 0); parts.spin.rotation.z = this._spinA; }
            if (parts.drum && this.recoil > 0.3) { parts.drum.rotation.z += dt * 9; }
            if (parts.disc) { parts.disc.rotation.y += dt * (this.cool > 0 ? 34 : 8); }
            if (parts.core) { const q = 1 + Math.sin(performance.now() / 180) * 0.08; parts.core.scaling.setAll(q); }
            if (parts.shell) parts.shell.setEnabled(this.cool <= 0 && this.reloading <= 0);
        }
    },
};
