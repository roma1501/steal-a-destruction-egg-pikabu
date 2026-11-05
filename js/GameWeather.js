// GameWeather.js — время суток и погода вылазки: день, рассвет, закат, ночь; дождь, снег, ураган.
// Небо и свет — VoxRender.setAtmosphere, осадки — VoxFX (rainfall, snowfall). Ураган: порывы ветра толкают игрока, врагов и
// обломки, молнии бьют в землю, по карте ходит смерч: тянет к себе, отрывает куски, кидает врагов.

/** @satisfies {Record<string, any>} */
const GameWeather = {
    /** @type {any} */
    game: null,
    sky: 'day',
    weather: 'clear',
    windX: 0, windZ: 0,
    _gustT: 0, _gust: 0, _dir: 0,
    _boltT: 0,
    _thunder: /** @type {number[]} */ ([]),
    /** @type {{ x: number, z: number, vx: number, vz: number, t: number, cut: number, tx: number, tz: number } | null} */
    tornado: null,
    /** @type {any} */
    _rainLoop: null,
    /** @type {any} */
    _windLoop: null,
    _cover: 1,
    _coverT: 0,
    _glowT: 0,

    init(game) { this.game = game; },

    /** Поставить небо и погоду (при входе на карту). */
    set(sky, weather) {
        this.sky = sky || 'day'; this.weather = weather || 'clear';
        VoxRender.setAtmosphere(this.sky, this.weather);
        VoxRender.setHeadlamp(this.sky === 'night' || this.weather === 'storm');
        const q = VoxRender.quality === 'low' ? 0.5 : 1;
        VoxFX.snowfall(this.weather === 'snow');
        VoxFX.rainfall(this.weather === 'rain' ? 0.75 * q : this.weather === 'storm' ? 1 * q : 0);
        this._dir = Math.random() * 6.28;
        this.windX = this.windZ = 0;
        this._gustT = 2 + Math.random() * 3; this._gust = 0;
        this._boltT = 4 + Math.random() * 6;
        this._thunder = [];
        this.tornado = null;
        if (this.weather === 'storm') {
            const w = this.game.world, vs = w.vs;
            this.tornado = { x: (0.2 + Math.random() * 0.6) * w.sx * vs, z: (0.2 + Math.random() * 0.6) * w.sz * vs, vx: 0, vz: 0, t: 0, cut: 0, tx: 0, tz: 0 };
            this.tornado.tx = this.tornado.x; this.tornado.tz = this.tornado.z;
        }
        this._sound();
    },

    /** Дождь и ветер — бесшумные петли, громкость по погоде. */
    _sound() {
        const A = /** @type {any} */ (GameAudio);
        const want = (name, vol, field) => {
            if (typeof Sound === 'undefined' || !Sound.loop || A.silent) return;
            const h = this[field];
            if (h) h.set(vol);
            else if (vol > 0) A._needAsync(name, 0, () => { if (!this[field]) { this[field] = Sound.loop('synth:' + name, { volume: 0 }); if (this[field] && this[field].set) this[field].set(this._volOf(field)); } });
        };
        want('ga-amb-rain', this._volOf('_rainLoop'), '_rainLoop');
        want('ga-amb-wind', this._volOf('_windLoop'), '_windLoop');
    },
    _volOf(field) {
        if (field === '_rainLoop') return this.weather === 'rain' ? 0.22 : this.weather === 'storm' ? 0.3 : 0;
        return this.weather === 'storm' ? 0.42 : this.weather === 'snow' ? 0.14 : 0;
    },

    /** Кадр: только на вылазке (база всегда ясная). */
    update(dt) {
        const w = this.weather, g = this.game, p = g.player;
        if (this.sky === 'night') this._fireflies(dt, p);
        if (w === 'clear' || w === 'snow') return;
        if (w === 'storm') { this._wind(dt, p); this._tornado(dt, p); }
        this._lightning(dt, p, w === 'storm' ? 1 : 0.35);
    },

    /** Ночные светлячки вокруг игрока: мелочь, а живее. */
    _fireflies(dt, p) {
        if (this.weather === 'rain' || this.weather === 'storm' || VoxRender.quality === 'low') return;
        if (Math.random() > dt * 3.5) return;
        const a = Math.random() * 6.28, r = 3 + Math.random() * 7;
        VoxFX.puff(p.pos.x + Math.cos(a) * r, p.pos.y + 0.3 + Math.random() * 1.6, p.pos.z + Math.sin(a) * r, { add: true, mode: 5, size: 0.045, life: 1.8, alpha: 1, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.3) * 0.5, vz: (Math.random() - 0.5) * 0.6, drag: 0.4, r: 2.4, g: 3, b: 0.8, fadeOut: 0.7 });
    },

    /** Порывы: ветер нарастает волнами, сносит игрока вне укрытия, обломки и лежачих. */
    _wind(dt, p) {
        this._gustT -= dt;
        if (this._gustT <= 0) { this._gustT = 3.5 + Math.random() * 5; this._gust = 1; this._dir += (Math.random() - 0.5) * 1.4; if (typeof GameAudio !== 'undefined') GameAudio.debrisRumble(0.25, p.pos.x, p.pos.y, p.pos.z); }
        this._gust = Math.max(0, this._gust - dt * 0.55);
        const str = 3.2 + this._gust * 8.5;
        this.windX = Math.cos(this._dir) * str; this.windZ = Math.sin(this._dir) * str;
        VoxFX.setWind(this.windX, this.windZ);
        // укрытие: крыша над головой — ветра нет
        this._coverT -= dt;
        if (this._coverT <= 0) {
            this._coverT = 0.25;
            const e = p.eye, hit = this.game.world.raycast(e.x, e.y, e.z, 0, 1, 0, 14);
            this._cover = hit ? 0.1 : 1;
        }
        p.push(this.windX * dt * 0.34 * this._cover, 0, this.windZ * dt * 0.34 * this._cover);
        p.addTrauma(this._gust * dt * 0.12 * this._cover);
        // лёгкие тела сдувает: понемногу за кадр
        const bodies = VoxPhysics.bodies;
        if (bodies.length && this._gust > 0.25) {
            for (let k = 0; k < 6; k++) {
                const b = bodies[(Math.random() * bodies.length) | 0];
                if (!b || b.dead || b.mass > 260) continue;
                const J = b.mass * 2.6 * this._gust;
                VoxPhysics.applyImpulse(b, b.x[0], b.x[1], b.x[2], Math.cos(this._dir) * J, J * 0.25, Math.sin(this._dir) * J);
            }
        }
        // лежачие и трупы катятся, живых качает
        for (const e of GameEnemies.list) {
            const rig = e.rig, m = e.type.mass || 1;
            if (rig.state === 'down' || rig.state === 'dead') rig.kickAll(this.windX * dt * 0.5 / m, this._gust * dt * 1.2 / m, this.windZ * dt * 0.5 / m);
            else if (this._gust > 0.7 && !e.type.boss) { rig.root.kx += this.windX * dt * 0.8 / m; rig.root.kz += this.windZ * dt * 0.8 / m; }
        }
    },

    _lightning(dt, p, rate) {
        for (let i = this._thunder.length - 1; i >= 0; i--) {
            this._thunder[i] -= dt;
            if (this._thunder[i] <= 0) { this._thunder.splice(i, 1); GameAudio.explosion(1.2, p.pos.x + 30, p.pos.y + 10, p.pos.z + 30); }
        }
        this._boltT -= dt * rate;
        if (this._boltT > 0) return;
        this._boltT = 6 + Math.random() * 9;
        VoxRender.lightning();
        this._thunder.push(0.25 + Math.random() * 1.2);
        if (this.weather !== 'storm' || Math.random() > 0.6) return;
        // удар в землю: подальше от игрока
        const w = this.game.world, vs = w.vs, a = Math.random() * 6.28, d = 8 + Math.random() * 16;
        const x = Math.max(1, Math.min(w.sx * vs - 1, p.pos.x + Math.cos(a) * d)), z = Math.max(1, Math.min(w.sz * vs - 1, p.pos.z + Math.sin(a) * d));
        const hit = w.raycast(x, 18.5, z, 0, -1, 0, 19);
        if (!hit) return;
        const y = 18.5 - hit.t;
        let lx = x, ly = 18.5, lz = z;
        for (let i = 0; i < 9; i++) {
            const ny = 18.5 - (i + 1) / 9 * (18.5 - y), nx = x + (i < 8 ? (Math.random() - 0.5) * 1.3 : 0), nz = z + (i < 8 ? (Math.random() - 0.5) * 1.3 : 0);
            VoxFX.tracer(lx, ly, lz, nx, ny, nz);
            lx = nx; ly = ny; lz = nz;
        }
        VoxDestruction.explode(x, y + 0.1, z, 1.5);
        VoxRender.flash(x, y + 1, z, [0.75, 0.85, 1], 30, 26, 0.3);
    },

    /** Смерч: бродит по карте, кружит пыль и обломки, вырывает куски, тянет врагов и игрока. */
    _tornado(dt, p) {
        const T = this.tornado;
        if (!T) return;
        T.t += dt;
        const w = this.game.world, vs = w.vs, W = w.sx * vs;
        if (Math.hypot(T.tx - T.x, T.tz - T.z) < 2) {
            // каждый третий заход — к игроку, иначе в случайное место
            const toP = Math.random() < 0.34;
            T.tx = toP ? p.pos.x + (Math.random() - 0.5) * 10 : 6 + Math.random() * (W - 12);
            T.tz = toP ? p.pos.z + (Math.random() - 0.5) * 10 : 6 + Math.random() * (W - 12);
        }
        const dx = T.tx - T.x, dz = T.tz - T.z, d = Math.hypot(dx, dz) || 1, sp = 2.4;
        T.vx += (dx / d * sp - T.vx) * Math.min(1, dt); T.vz += (dz / d * sp - T.vz) * Math.min(1, dt);
        T.x += T.vx * dt; T.z += T.vz * dt;
        const ground = (w.groundTop || 20) * vs;
        // воронка: пыль по спирали
        const n = VoxRender.quality === 'low' ? 3 : 8;
        for (let i = 0; i < n; i++) {
            const h = Math.random(), rad = 0.5 + h * h * 4.5, a = T.t * 6 + Math.random() * 6.28, y = ground + h * 16;
            VoxFX.puff(T.x + Math.cos(a) * rad, y, T.z + Math.sin(a) * rad, { size: 0.55 + h * 1.1, grow: 0.6, life: 0.7 + Math.random() * 0.5, alpha: 0.36, vx: -Math.sin(a) * (5 + h * 6), vy: 2.4, vz: Math.cos(a) * (5 + h * 6), drag: 0.6, buoy: 0.3, r: 0.42, g: 0.4, b: 0.42 });
        }
        // рвёт постройки у основания
        T.cut -= dt;
        if (T.cut <= 0) {
            T.cut = 0.28;
            const a = Math.random() * 6.28, rr = Math.random() * 1.6;
            const res = VoxDestruction.carve(T.x + Math.cos(a) * rr, ground + 0.5 + Math.random() * 3.5, T.z + Math.sin(a) * rr, 0.9, { power: 2, jitter: 0.6, speed: 7, burst: 60 });
            if (res.count) VoxDestruction.detach(null);
        }
        // тела кружат и поднимает
        for (const b of VoxPhysics.bodies) {
            if (b.dead) continue;
            const bx = T.x - b.x[0], bz = T.z - b.x[2], bd = Math.hypot(bx, bz) || 1;
            if (bd > 8 || b.mass > 900) continue;
            VoxPhysics.wake(b);
            const f = (1 - bd / 8) * b.mass * dt;
            VoxPhysics.applyImpulse(b, b.x[0], b.x[1], b.x[2], (bx / bd * 12 - bz / bd * 16) * f, 17 * f, (bz / bd * 12 + bx / bd * 16) * f);
        }
        GameEnemies.pull(T.x, ground + 3, T.z, 7, 22, dt);
        const pd = Math.hypot(p.pos.x - T.x, p.pos.z - T.z) || 1;
        if (pd < 8) {
            const f = 1 - pd / 8;
            p.push((T.x - p.pos.x) / pd * dt * 14 * f - (T.z - p.pos.z) / pd * dt * 6 * f, dt * 16 * f, (T.z - p.pos.z) / pd * dt * 14 * f + (T.x - p.pos.x) / pd * dt * 6 * f);
            p.addTrauma(dt * 1.4 * f);
            this.game.hurtPlayer(14 * f * dt, T.x, T.z, 'tornado');
        }
    },

    /** На смену карты: уборка. */
    clear() {
        VoxFX.rainfall(0);
        VoxFX.setWind(0, 0);
        if (this._rainLoop && this._rainLoop.set) this._rainLoop.set(0);
        if (this._windLoop && this._windLoop.set) this._windLoop.set(0);
        this.tornado = null;
    },
};
