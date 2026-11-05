// GameEnemies.js — враги на VoxFolk: появление, поиск пути (поле потока по сетке 0.5 м, сетка живёт вместе с
// разрушением), поведение по типам, удары и снаряды, реакции на попадания (вздрагивает, спотыкается, падает,
// ползёт без ног, бегает без головы), награды. Оружие игрока зовёт raycast / damage / blast / pull / freeze / shock / ignite.
//
// Поведения type.behavior: melee, shooter, lobber, kamikaze, charger, sniper, flyer, boss.
// Игре: onKill(enemy), onHurtPlayer(dmg, x, z), onDamage(enemy, dmg, x, y, z, crit, killed) — заполняет GameRaid.

/** @satisfies {Record<string, any>} */
const GameEnemies = {
    /** @type {any} */
    game: null,
    /** @type {any[]} */
    list: [],
    /** @type {any[]} */
    bolts: [],
    /** @type {((e: any) => void) | null} */
    onKill: null,
    /** @type {((dmg: number, x: number, z: number, cause?: string) => void) | null} */
    onHurtPlayer: null,
    /** @type {((e: any, dmg: number, x: number, y: number, z: number, crit: boolean, killed: boolean) => void) | null} */
    onDamage: null,
    /** @type {((e: any, part: any) => void) | null} */
    onSever: null,
    powerMul: 1,              // улучшение «Мощь оружия»
    enemyBlast: false,        // идёт взрыв врага (игрок получает полный урон)
    _blastDmg: 1,             // множитель взрывов врагов на этой вылазке
    active: true,             // false — враги не думают (мирная база, галерея)
    _bound: false,

    // ---- поле потока
    CELL: 5,                  // вокселей в клетке (0.5 м)
    nx: 0, nz: 0,
    /** @type {Int16Array} */ hgt: new Int16Array(0),     // высота пола клетки в вокселях, 0 — стена
    /** @type {Int8Array} */ flowX: new Int8Array(0),
    /** @type {Int8Array} */ flowZ: new Int8Array(0),
    /** @type {Int32Array} */ _queue: new Int32Array(0),
    /** @type {Uint16Array} */ _dist: new Uint16Array(0),
    _scanRow: 0,
    _flowT: 0,

    init(game) {
        this.game = game;
        VoxFolk.init(game.world, VoxRender.scene);
        const w = game.world;
        this.nx = Math.floor(w.sx / this.CELL); this.nz = Math.floor(w.sz / this.CELL);
        const n = this.nx * this.nz;
        this.hgt = new Int16Array(n); this.flowX = new Int8Array(n); this.flowZ = new Int8Array(n);
        this._queue = new Int32Array(n + 8); this._dist = new Uint16Array(n);
        this._scanRow = 0;
        this.rescanAll();
        if (!this._bound) {
            this._bound = true;
            VoxDestruction.on(e => { if (e.type === 'explosion') this.blast(e.x, e.y, e.z, e.r); });
        }
    },

    /** Новая карта: всё убрать. */
    clear() {
        for (const e of this.list) e.rig.dispose();
        this.list = [];
        for (const b of this.bolts) if (b.mesh) b.mesh.dispose();
        this.bolts = [];
        VoxFolk.clear();
    },

    /** Появление. o: { home: {x,z}, radius, alerted, scale, hpMul, dmgMul, ai: false — стоит манекеном }. */
    spawn(typeId, x, y, z, yaw = 0, o = {}) {
        const type = VoxFolk.TYPES[typeId];
        if (!type) { console.warn('нет типа врага', typeId); return null; }
        const rig = new FolkRig(type, x, y, z, yaw, { scale: o.scale });
        const hp = (type.hp || 100) * (o.hpMul || 1);
        const e = {
            npc: !!type.npc, bot: !!o.bot, rig, type, id: typeId, hp, hpMax: hp, dmgMul: o.dmgMul || 1, reward: type.reward || 10,
            home: o.home || { x, z }, patrol: o.radius != null ? o.radius : 5, alerted: !!o.alerted, ai: o.ai !== false,
            wishX: 0, wishZ: 0, think: Math.random() * 0.3, cool: 1 + Math.random(), los: false, dist: 99,
            attacking: 0, charge: 0, chargeX: 0, chargeZ: 0, fuse: -1, aimT: 0, wander: 0, wx: x, wz: z, burnT: 0, tagged: 0, dead: false, stuck: 0, lastX: x, lastZ: z,
            flyH: type.behavior === 'flyer' ? 5 + Math.random() * 2.5 : 0,
        };
        rig.upper = o.ai === false ? 'idle' : 'run';
        rig.onSever = (part) => this._severed(e, part);
        this.list.push(e);
        return e;
    },

    aliveCount() { let n = 0; for (const e of this.list) if (!e.dead) n++; return n; },

    // =================================================================== поле потока

    _scanCell(cx, cz) {
        const w = this.game.world, C = this.CELL, x = cx * C + (C >> 1), z = cz * C + (C >> 1);
        const head = 17;
        let free = 0;
        for (let y = 8; y < w.sy - head; y++) {
            if (w.data[x + (z << w.bx) + (y << w.by)]) { free = 0; continue; }
            free++;
            if (free >= head) {
                const floor = y - head + 1;
                if (w.data[x + (z << w.bx) + ((floor - 1) << w.by)]) return floor;
                free = head - 1;
            }
        }
        return 0;
    },
    rescanAll() { for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) this.hgt[x + z * this.nx] = this._scanCell(x, z); },

    _updateFlow(dt) {
        // сетка: несколько рядов за кадр — разрушение попадает в неё в пределах секунды
        for (let k = 0; k < 2; k++) {
            const z = this._scanRow;
            for (let x = 0; x < this.nx; x++) this.hgt[x + z * this.nx] = this._scanCell(x, z);
            this._scanRow = (z + 1) % this.nz;
        }
        this._flowT -= dt;
        if (this._flowT > 0) return;
        this._flowT = 0.28;
        const p = this.game.player, vs = this.game.world.vs, C = this.CELL;
        const nx = this.nx, nz = this.nz, hgt = this.hgt, Q = this._queue, D = this._dist;
        let sx = Math.floor(p.pos.x / vs / C), sz = Math.floor(p.pos.z / vs / C);
        sx = Math.max(0, Math.min(nx - 1, sx)); sz = Math.max(0, Math.min(nz - 1, sz));
        D.fill(65535);
        let head = 0, tail = 0;
        // игрок на крыше или в стене: старт из ближайших проходимых клеток
        for (let r = 0; r < 9 && !tail; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = sx + dx, z = sz + dz;
            if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
            const c = x + z * nx;
            if (hgt[c] && D[c] === 65535) { D[c] = 0; Q[tail++] = c; }
        }
        const step = 7;     // перепад пола между клетками, вокселей
        while (head < tail) {
            const c = Q[head++], x = c % nx, z = (c / nx) | 0, d = D[c] + 1, h = hgt[c];
            if (x > 0) { const q = c - 1; if (D[q] > d && hgt[q] && Math.abs(hgt[q] - h) <= step) { D[q] = d; this.flowX[q] = 1; this.flowZ[q] = 0; Q[tail++] = q; } }
            if (x < nx - 1) { const q = c + 1; if (D[q] > d && hgt[q] && Math.abs(hgt[q] - h) <= step) { D[q] = d; this.flowX[q] = -1; this.flowZ[q] = 0; Q[tail++] = q; } }
            if (z > 0) { const q = c - nx; if (D[q] > d && hgt[q] && Math.abs(hgt[q] - h) <= step) { D[q] = d; this.flowX[q] = 0; this.flowZ[q] = 1; Q[tail++] = q; } }
            if (z < nz - 1) { const q = c + nx; if (D[q] > d && hgt[q] && Math.abs(hgt[q] - h) <= step) { D[q] = d; this.flowX[q] = 0; this.flowZ[q] = -1; Q[tail++] = q; } }
        }
    },

    /** Направление к игроку по полю потока; нет пути — null. */
    _flowDir(x, z, out) {
        const vs = this.game.world.vs, C = this.CELL;
        const cx = Math.floor(x / vs / C), cz = Math.floor(z / vs / C);
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return null;
        const c = cx + cz * this.nx;
        if (this._dist[c] === 65535 || this._dist[c] === 0) return null;
        // сглаживание: сумма стрелок соседей
        let fx = this.flowX[c] * 2, fz = this.flowZ[c] * 2;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx2 = cx + dx, nz2 = cz + dz;
            if (nx2 < 0 || nz2 < 0 || nx2 >= this.nx || nz2 >= this.nz) continue;
            const q = nx2 + nz2 * this.nx;
            if (this._dist[q] !== 65535) { fx += this.flowX[q]; fz += this.flowZ[q]; }
        }
        const l = Math.hypot(fx, fz);
        if (l < 1e-3) { out[0] = this.flowX[c]; out[1] = this.flowZ[c]; return out; }
        out[0] = fx / l; out[1] = fz / l;
        return out;
    },

    // =================================================================== кадр

    update(dt) {
        if (!this.game) return;
        if (this.active && this.list.length) this._updateFlow(dt);
        VoxFolk.update(dt);
        const p = this.game.player;
        const cam = VoxRender.camera;
        let corpses = 0;
        for (let i = this.list.length - 1; i >= 0; i--) {
            const e = this.list[i], rig = e.rig;
            e.dist = Math.hypot(rig.root.x - p.pos.x, rig.root.z - p.pos.z);
            rig.lod = Math.hypot(rig.root.x - cam.position.x, rig.root.z - cam.position.z) > 26;
            if (e.frozen) { /* кусок льда */ }
            this._states(e, dt);
            if (!e.dead && this.active && e.ai && rig.state !== 'down' && rig.frozen <= 0) this._think(e, dt, p);
            if (rig.state !== 'dead' && rig.frozen <= 0) this._moveRoot(e, dt);
            this._burn(e, dt);
            rig.update(dt);
            if (e.dead) {
                corpses++;
                rig.corpseT += dt;
                if (rig.corpseT > 9) { rig.shatter(1.6, 5); this.list.splice(i, 1); continue; }
            }
        }
        // слишком много трупов — самые старые рассыпаются
        if (corpses > 14) {
            let k = -1, best = -1;
            for (let i = 0; i < this.list.length; i++) { const e = this.list[i]; if (e.dead && e.rig.corpseT > best) { best = e.rig.corpseT; k = i; } }
            if (k >= 0) { this.list[k].rig.shatter(1.6, 5); this.list.splice(k, 1); }
        }
        this._bodyHits(dt);
        this._updateBolts(dt);
    },

    /** Переходы состояний: упал -> встал или ползёт; заморозка. */
    _states(e, dt) {
        const rig = e.rig;
        if (rig.frozen > 0) {
            rig.frozen -= dt;
            if (rig.frozen <= 0) { rig.frozen = 0.0001; rig.setFrozen(0); rig.frozen = 0; }
            return;
        }
        if (rig.state === 'stumble' && rig.stateT > (rig.stumbleFor || 0.7)) { rig.state = 'active'; rig.stateT = 0; rig.upper = e.dead ? rig.upper : 'run'; }
        if (rig.state === 'getup' && rig.stateT > 1.15) { rig.state = 'active'; rig.stateT = 0; rig.upper = 'run'; }
        if (rig.state === 'down' && !rig.crawl && rig.stateT > (rig.downFor || 2.2) && !e.dead) {
            const c = VoxFolk._v;
            rig.center(c);
            const R = rig.root;
            R.x = c[0]; R.z = c[2]; R.vx = R.vz = R.kx = R.kz = 0;
            // встать на пол под тазом
            R.y = this._floorAt(R.x, R.z, c[1]);
            if (this._legsOk(rig)) { rig.state = 'getup'; rig.stateT = 0; rig.upper = 'flail'; }
            else { rig.crawl = true; rig.stateT = 0; }
        }
        if (rig.headless && !e.dead) {
            e.headlessT = (e.headlessT || 0) + dt;
            if (e.headlessT > 1.6) this.kill(e);
        }
    },

    _legsOk(rig) { for (const p of rig.parts) if (p.role === 'leg' && !p.attached) return false; return true; },

    _floorAt(x, z, fromY) {
        const w = this.game.world, k = 1 / w.vs, ix = Math.floor(x * k), iz = Math.floor(z * k);
        for (let y = Math.min(w.sy - 1, Math.floor(fromY * k)); y > 0; y--) if (w.get(ix, y, iz)) return (y + 1) * w.vs;
        return w.groundTop * w.vs;
    },

    /** Решения: куда идти и когда бить. */
    _think(e, dt, p) {
        const rig = e.rig, R = rig.root, type = e.type, dx = p.pos.x - R.x, dz = p.pos.z - R.z, dist = e.dist;
        e.cool -= dt;
        e.think -= dt;
        if (e.think <= 0) {
            e.think = 0.22 + Math.random() * 0.1;
            // видимость: глаза -> глаза игрока
            const eye = p.eye, hy = R.y + rig.h * 0.88;
            const ldx = eye.x - R.x, ldy = eye.y - hy, ldz = eye.z - R.z, ll = Math.hypot(ldx, ldy, ldz) || 1;
            e.los = ll < 48 && !this.game.world.raycast(R.x, hy, R.z, ldx / ll, ldy / ll, ldz / ll, ll);
            if (!e.alerted && ((e.los && dist < (type.aggro || 16)) || dist < 4)) this.alert(e);
        }
        rig.upper = rig.state === 'stumble' ? 'flail' : (e.burnT > 0 ? 'panic' : rig.upper);
        if (!e.alerted) {
            // охрана: бродит у поста
            e.wander -= dt;
            if (e.wander <= 0) {
                e.wander = 2 + Math.random() * 3.5;
                const a = Math.random() * 6.28, r = Math.random() * e.patrol;
                e.wx = e.home.x + Math.cos(a) * r; e.wz = e.home.z + Math.sin(a) * r;
                e.idle = Math.random() < 0.4;
            }
            rig.upper = 'idle';
            const wx = e.wx - R.x, wz = e.wz - R.z, wl = Math.hypot(wx, wz);
            if (wl > 0.4 && !e.idle) { const s = (type.speed || 3) * 0.32; e.wishX = wx / wl * s; e.wishZ = wz / wl * s; this._face(rig, wx, wz, dt); }
            else { e.wishX = e.wishZ = 0; }
            return;
        }
        if (rig.state === 'stumble' || rig.state === 'getup') { e.wishX = e.wishZ = 0; return; }
        const B = this.BEHAVIORS[type.behavior] || this.BEHAVIORS.melee;
        B.call(this, e, dt, p, dx, dz, dist);
        // без рук не стрелять и не бить рукой — только идти
    },

    /** Поднять тревогу у врага и соседей. */
    alert(e) {
        if (e.alerted) return;
        e.alerted = true;
        // заметил: восклицательный знак над головой
        if (!e.dead && typeof GameHud !== 'undefined' && GameHud.floatText) GameHud.floatText(e.rig.root.x, e.rig.root.y + e.rig.h + 0.3, e.rig.root.z, '!', 'crit');
        e.cool = Math.min(e.cool, 0.5 + Math.random() * 0.7);
        for (const o of this.list) if (!o.alerted && Math.hypot(o.rig.root.x - e.rig.root.x, o.rig.root.z - e.rig.root.z) < 9) { o.alerted = true; o.cool = Math.min(o.cool, 0.6 + Math.random()); }
    },
    alertAll() { for (const e of this.list) if (!e.dead) e.alerted = true; },
    /** Шум в точке: стрельба и взрывы будят охрану в радиусе. */
    noise(x, z, R) { for (const e of this.list) if (!e.alerted && !e.dead && Math.hypot(e.rig.root.x - x, e.rig.root.z - z) < R) e.alerted = true; },

    _face(rig, dx, dz, dt, rate = 7) {
        const want = Math.atan2(dx, dz);
        let d = want - rig.root.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        rig.root.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
    },

    /** Идти к игроку: поле потока, вблизи и при прямой видимости — напрямую; расталкиваются между собой. */
    _chase(e, dt, dx, dz, dist, speed) {
        const rig = e.rig, R = rig.root;
        let vx = dx / (dist || 1), vz = dz / (dist || 1);
        if (!(e.los && dist < 12)) { const f = this._flowDir(R.x, R.z, VoxFolk._v2); if (f) { vx = f[0]; vz = f[1]; } }
        let sx = 0, sz = 0;
        for (const o of this.list) {
            if (o === e || o.dead) continue;
            const ox = R.x - o.rig.root.x, oz = R.z - o.rig.root.z, d2 = ox * ox + oz * oz, m = (rig.r + o.rig.r) * 1.6;
            if (d2 < m * m && d2 > 1e-5) { const d = Math.sqrt(d2); sx += ox / d * (1 - d / m); sz += oz / d * (1 - d / m); }
        }
        vx += sx * 1.3; vz += sz * 1.3;
        const l = Math.hypot(vx, vz) || 1;
        e.wishX = vx / l * speed; e.wishZ = vz / l * speed;
        this._face(rig, e.wishX, e.wishZ, dt);
    },

    /** Поведения: this — GameEnemies. */
    BEHAVIORS: {
        melee(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type, range = (type.range || 1.5) * rig.scale;
            if (e.attacking > 0) {
                e.attacking -= dt;
                const dur = type.attackTime || 0.62;
                rig.attackT = 1 - e.attacking / dur;
                rig.upper = 'melee';
                e.wishX *= 0.85; e.wishZ *= 0.85;
                this._face(rig, dx, dz, dt);
                if (!e.struck && rig.attackT > 0.5) {
                    e.struck = true;
                    if (dist < range * 1.35 && Math.abs(p.pos.y - rig.root.y) < 2.2 * rig.scale) this._hitPlayer(e, type.dmg || 12, dx, dz, type.push || 5);
                }
                if (e.attacking <= 0) { rig.attackT = -1; rig.upper = 'run'; e.cool = type.rate || 0.9; }
                return;
            }
            rig.upper = 'run';
            if (dist < range && e.cool <= 0 && rig.byName.armFR && rig.byName.armFR.attached) { e.attacking = type.attackTime || 0.62; e.struck = false; if (typeof GameAudio !== 'undefined') GameAudio.swing(false); return; }
            if (dist > range * 0.7) this._chase(e, dt, dx, dz, dist, type.speed || 3.5);
            else { e.wishX = e.wishZ = 0; this._face(rig, dx, dz, dt); }
        },
        shooter(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type, range = type.range || 15;
            const arm = rig.byName.armFR && rig.byName.armFR.attached;
            if (!arm) { this.BEHAVIORS.melee.call(this, e, dt, p, dx, dz, dist); return; }
            if (e.los && dist < range) {
                rig.upper = 'aim';
                this._face(rig, dx, dz, dt, 9);
                const keep = type.keep || 8;
                if (dist < keep * 0.6) { const s = (type.speed || 3) * 0.7; e.wishX = -dx / dist * s; e.wishZ = -dz / dist * s; }
                else { const st = Math.sin(rig.time * 0.9 + e.id.length) * (type.speed || 3) * 0.35; e.wishX = -dz / (dist || 1) * st; e.wishZ = dx / (dist || 1) * st; }
                if (e.cool <= 0) {
                    this._fireBolt(e, p, type.bolt || {});
                    const burst = type.burst || 1;
                    e.burstLeft = (e.burstLeft == null ? burst : e.burstLeft) - 1;
                    if (e.burstLeft > 0) e.cool = type.burstGap || 0.14;
                    else { e.burstLeft = burst; e.cool = (type.rate || 1.4) * (0.8 + Math.random() * 0.5); }
                    rig.flinch = Math.min(1, rig.flinch + 0.25); rig.flx = -rig.fx; rig.flz = -rig.fz;
                }
            } else { rig.upper = 'run'; this._chase(e, dt, dx, dz, dist, type.speed || 3); }
        },
        lobber(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type, range = type.range || 15;
            if (e.attacking > 0) {
                e.attacking -= dt;
                rig.attackT = 1 - e.attacking / 0.7; rig.upper = 'throw';
                e.wishX = e.wishZ = 0;
                this._face(rig, dx, dz, dt);
                if (!e.struck && rig.attackT > 0.55) { e.struck = true; this._lob(e, p, type.bolt || {}); }
                if (e.attacking <= 0) { rig.attackT = -1; rig.upper = 'run'; e.cool = (type.rate || 2.6) * (0.8 + Math.random() * 0.5); }
                return;
            }
            rig.upper = 'run';
            if (dist < range && e.los && e.cool <= 0 && rig.byName.armFR && rig.byName.armFR.attached) { e.attacking = 0.7; e.struck = false; return; }
            if (dist > range * 0.75) this._chase(e, dt, dx, dz, dist, type.speed || 3);
            else if (dist < 5) { const s = (type.speed || 3) * 0.8; e.wishX = -dx / dist * s; e.wishZ = -dz / dist * s; this._face(rig, dx, dz, dt); }
            else { e.wishX = e.wishZ = 0; this._face(rig, dx, dz, dt); }
        },
        kamikaze(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type;
            rig.upper = 'panic';
            if (e.fuse >= 0) {
                e.fuse -= dt;
                if (Math.floor(e.fuse * 8) !== Math.floor((e.fuse + dt) * 8)) {
                    const c = VoxFolk._v; rig.center(c);
                    VoxRender.flash(c[0], c[1] + 0.3, c[2], [1, 0.25, 0.1], 7, 5, 0.1);
                    if (typeof GameAudio !== 'undefined') GameAudio.ui('click');
                }
                if (e.fuse <= 0) { this._selfDestruct(e); return; }
            } else if (dist < (type.range || 2.4)) e.fuse = type.fuse || 0.7;
            this._chase(e, dt, dx, dz, dist, type.speed || 6);
        },
        charger(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type, R = rig.root;
            if (e.charge > 0) {
                // таран: разгон по прямой, ломает лёгкие стены, бьёт игрока, об твёрдое — падает
                e.charge -= dt;
                const sp = type.chargeSpeed || 11;
                e.wishX = e.chargeX * sp; e.wishZ = e.chargeZ * sp;
                rig.upper = 'run';
                const c = VoxFolk._v; rig.center(c);
                const fx = c[0] + e.chargeX * (rig.r + 0.3), fz = c[2] + e.chargeZ * (rig.r + 0.3);
                const res = VoxDestruction.carve(fx, c[1] + 0.1, fz, 0.72 * rig.scale, { power: 2, jitter: 0.4, speed: 4, burst: 40 });
                if (res.count) VoxDestruction.detach(null);
                if (dist < rig.r + 1.2 && !e.struck) { e.struck = true; this._hitPlayer(e, type.dmg || 25, e.chargeX, e.chargeZ, 13); }
                if (Math.hypot(R.vx, R.vz) < 1.2 && e.chargeAge > 0.35) { e.charge = 0; rig.fall(1.6); rig.kickAll(-e.chargeX * 4, 3, -e.chargeZ * 4, 0.8); VoxRender.flash(c[0], c[1], c[2], [1, 0.9, 0.6], 6, 6, 0.15); if (typeof GameAudio !== 'undefined') GameAudio.impact('metal', 0.9, c[0], c[1], c[2]); }
                e.chargeAge += dt;
                if (e.charge <= 0) e.cool = type.rate || 3;
                return;
            }
            if (e.aimT > 0) {
                e.aimT -= dt;
                rig.upper = 'flail';
                e.wishX = e.wishZ = 0;
                this._face(rig, dx, dz, dt, 5);
                if (e.aimT <= 0) { const l = dist || 1; e.chargeX = dx / l; e.chargeZ = dz / l; e.charge = 1.5; e.chargeAge = 0; e.struck = false; }
                return;
            }
            rig.upper = 'run';
            if (dist < 16 && dist > 2.5 && e.los && e.cool <= 0) { e.aimT = 0.8; return; }
            this.BEHAVIORS.melee.call(this, e, dt, p, dx, dz, dist);
        },
        sniper(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type;
            const arm = rig.byName.armFR && rig.byName.armFR.attached;
            if (!arm) { this.BEHAVIORS.melee.call(this, e, dt, p, dx, dz, dist); return; }
            if (e.los && dist < (type.range || 34)) {
                rig.upper = 'aim';
                e.wishX = e.wishZ = 0;
                this._face(rig, dx, dz, dt, 5);
                if (e.cool <= 0) {
                    if (e.aimT <= 0) e.aimT = type.aim || 1.4;
                    e.aimT -= dt;
                    this._laser(e, p, e.aimT);
                    if (e.aimT <= 0) {
                        // выстрел: по линии от ружья туда, где игрок был за миг до конца прицеливания
                        this._laserOff(e);
                        this._sniperShot(e, p);
                        e.cool = type.rate || 3;
                    }
                }
            } else { this._laserOff(e); rig.upper = 'run'; this._chase(e, dt, dx, dz, dist, type.speed || 3); }
        },
        flyer(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type;
            rig.upper = 'run';
            const hold = (type.range || 12) * 0.5;
            const s = type.speed || 4;
            if (dist > hold) { e.wishX = dx / dist * s; e.wishZ = dz / dist * s; }
            else { const st = s * 0.5; e.wishX = -dz / (dist || 1) * st; e.wishZ = dx / (dist || 1) * st; }
            this._face(rig, dx, dz, dt, 3);
            if (e.cool <= 0 && dist < (type.range || 12)) {
                if (type.bolt && type.bolt.lob) this._lob(e, p, type.bolt); else this._fireBolt(e, p, type.bolt || {});
                const burst = type.burst || 1;
                e.burstLeft = (e.burstLeft == null ? burst : e.burstLeft) - 1;
                if (e.burstLeft > 0) e.cool = type.burstGap || 0.16;
                else { e.burstLeft = burst; e.cool = (type.rate || 2) * (0.8 + Math.random() * 0.5); }
            }
        },
        boss(e, dt, p, dx, dz, dist) {
            const rig = e.rig, type = e.type;
            // удар о землю: прыжок и волна; призыв свиты; между ними — как ближний бой
            e.slam = (e.slam == null ? 4 : e.slam) - dt;
            e.calls = (e.calls == null ? 9 : e.calls) - dt;
            if (e.calls <= 0 && type.minions && this.aliveCount() < 22) {
                e.calls = type.callEvery || 14;
                for (let i = 0; i < (type.minionCount || 3); i++) {
                    const a = Math.random() * 6.28;
                    const q = this.spawn(type.minions[i % type.minions.length], rig.root.x + Math.cos(a) * 2.6, rig.root.y + 0.2, rig.root.z + Math.sin(a) * 2.6, a, { alerted: true });
                    if (q) q.reward = 1;
                }
                VoxFX.sparks(rig.root.x, rig.root.y + 1, rig.root.z, 0, 1, 0, 30, 1.2);
            }
            if (e.slam <= 0 && dist < 11 && rig.root.onGround && rig.state === 'active') {
                e.slam = type.slamEvery || 6.5;
                rig.root.vy = 7.5;
                e.slamming = true;
                rig.upper = 'flail';
            }
            if (e.slamming && rig.root.onGround && rig.root.vy <= 0.01) {
                e.slamming = false;
                this._slam(e, p, dist);
                rig.upper = 'run';
            }
            this.BEHAVIORS.melee.call(this, e, dt, p, dx, dz, dist);
        },
    },

    /** Удар о землю босса: волна урона и толчок, воронка, тряска. */
    _slam(e, p, dist) {
        const rig = e.rig, R = rig.root, rad = (e.type.slamR || 7);
        this.enemyBlast = true;
        VoxDestruction.carve(R.x, R.y - 0.1, R.z, 1.8, { power: 2, jitter: 0.5, speed: 8, burst: 220 });
        VoxDestruction.detach(null);
        this.enemyBlast = false;
        VoxFX.explosion(R.x, R.y + 0.1, R.z, 1.5);
        if (typeof GameAudio !== 'undefined') GameAudio.explosion(1.4, R.x, R.y, R.z);
        if (dist < rad && p.onGround) {
            const f = 1 - dist / rad;
            this._hitPlayer(e, (e.type.dmg || 30) * (0.5 + f * 0.8), p.pos.x - R.x, p.pos.z - R.z, 10 * f + 4);
            p.push(0, 5 * f + 1.5, 0);
        }
        p.addTrauma(0.7);
        for (const b of VoxPhysics.bodies) {
            if (b.dead) continue;
            const d = Math.hypot(b.x[0] - R.x, b.x[2] - R.z);
            if (d > rad) continue;
            VoxPhysics.applyImpulse(b, b.x[0], b.x[1], b.x[2], 0, Math.min(b.mass * 7, 900) * (1 - d / rad), 0);
        }
    },

    _selfDestruct(e) {
        const c = VoxFolk._v; e.rig.center(c);
        const R = e.type.blast || 2.6;
        this.kill(e, true);
        this.enemyBlast = true;
        VoxDestruction.explode(c[0], c[1], c[2], R);
        this.enemyBlast = false;
    },

    _hitPlayer(e, dmg, dx, dz, push = 5) {
        const p = this.game.player, l = Math.hypot(dx, dz) || 1;
        p.push(dx / l * push, 1.8, dz / l * push);
        p.addTrauma(0.35);
        if (this.onHurtPlayer) this.onHurtPlayer(dmg * e.dmgMul, e.rig.root.x, e.rig.root.z, e.id);
    },

    // =================================================================== снаряды врагов

    _boltMesh(color) {
        const key = color || 'red';
        const base = (this._boltBase || (this._boltBase = {}));
        if (!base[key]) {
            const m = BABYLON.MeshBuilder.CreateBox('bolt-' + key, { size: 1 }, VoxRender.scene);
            const mat = new BABYLON.StandardMaterial('bolt-' + key, VoxRender.scene);
            const C = { red: [1, 0.25, 0.15], green: [0.3, 1, 0.3], orange: [1, 0.6, 0.1], cyan: [0.2, 0.9, 1], purple: [0.75, 0.3, 1], yellow: [1, 0.9, 0.2] }[key] || [1, 0.3, 0.2];
            mat.disableLighting = true;
            mat.emissiveColor = new BABYLON.Color3(C[0] * 1.6, C[1] * 1.6, C[2] * 1.6);
            m.material = mat; m.isPickable = false; m.setEnabled(false);
            base[key] = m;
        }
        const inst = base[key].createInstance('b');
        inst.isPickable = false;
        return inst;
    },

    /** Точка выстрела: кисть оружейной руки, иначе грудь. */
    _muzzle(e, out) {
        const rig = e.rig, ids = rig.type.skeleton.ids;
        const i = ids.haR != null ? ids.haR : (ids.pelvis != null ? ids.pelvis : 0);
        out[0] = rig.P[i * 3]; out[1] = rig.P[i * 3 + 1] + 0.05; out[2] = rig.P[i * 3 + 2];
        return out;
    },

    /** Светящийся снаряд по прямой с упреждением и разбросом. */
    _fireBolt(e, p, o) {
        const m = this._muzzle(e, [0, 0, 0]), eye = p.eye, sp = o.speed || 17;
        const dist0 = Math.hypot(eye.x - m[0], eye.y - m[1], eye.z - m[2]);
        const t = dist0 / sp * (o.lead != null ? o.lead : 0.6);
        const spr = o.spread != null ? o.spread : 0.035;
        let dx = eye.x + p.vel.x * t - m[0], dy = eye.y - 0.35 + p.vel.y * t * 0.3 - m[1], dz = eye.z + p.vel.z * t - m[2];
        const l = Math.hypot(dx, dy, dz) || 1;
        dx = dx / l + (Math.random() - 0.5) * spr * 2; dy = dy / l + (Math.random() - 0.5) * spr * 2; dz = dz / l + (Math.random() - 0.5) * spr * 2;
        const mesh = this._boltMesh(o.color || 'red');
        const size = o.size || 0.13;
        mesh.scaling.set(size, size, size * 1.8);
        this.bolts.push({ x: m[0], y: m[1], z: m[2], vx: dx * sp, vy: dy * sp, vz: dz * sp, g: 0, t: 0, mesh, dmg: (o.dmg || e.type.dmg || 6) * e.dmgMul, r: 0.5, blast: o.blast || 0, chip: o.chip != null ? o.chip : 0.14, from: e });
        VoxFX.muzzle(m[0], m[1], m[2], dx, dy, dz, 0.5);
        if (typeof GameAudio !== 'undefined') GameAudio.shot(o.sound || 'rifle');
    },

    /** Брошенный по дуге снаряд: взрывается при касании. */
    _lob(e, p, o) {
        const m = this._muzzle(e, [0, 0, 0]);
        const tx = p.pos.x + p.vel.x * 0.5 - m[0], tz = p.pos.z + p.vel.z * 0.5 - m[2], ty = p.pos.y + 0.3 - m[1];
        const hd = Math.hypot(tx, tz) || 1, T = Math.max(0.6, hd / (o.speed || 11));
        const g = 12;
        const vy = ty / T + 0.5 * g * T;
        const mesh = this._boltMesh(o.color || 'orange');
        const size = o.size || 0.3;
        mesh.scaling.setAll(size);
        this.bolts.push({ x: m[0], y: m[1], z: m[2], vx: tx / T, vy, vz: tz / T, g, t: 0, mesh, dmg: (o.dmg || e.type.dmg || 15) * e.dmgMul, r: 0.6, blast: o.blast || 2, chip: 0, from: e });
        if (typeof GameAudio !== 'undefined') GameAudio.grab('throw');
    },

    _updateBolts(dt) {
        const p = this.game.player, w = this.game.world, eye = p.eye;
        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const b = this.bolts[i];
            b.t += dt;
            b.vy -= b.g * dt;
            const sp = Math.hypot(b.vx, b.vy, b.vz) || 1, st = sp * dt;
            const dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
            const hw = w.raycast(b.x, b.y, b.z, dx, dy, dz, st + 0.02);
            const hb = VoxPhysics.raycastBodies(b.x, b.y, b.z, dx, dy, dz, st + 0.02);
            const tw = hw ? hw.t : 1e9, tb = hb ? hb.t : 1e9;
            // игрок: ближайшая точка луча к его оси
            const cx = p.pos.x - b.x, cz = p.pos.z - b.z;
            const px = b.x + dx * Math.min(st, Math.max(0, cx * dx + cz * dz)), pz = b.z + dz * Math.min(st, Math.max(0, cx * dx + cz * dz));
            const py = b.y + dy * Math.min(st, Math.max(0, cx * dx + cz * dz));
            const hitPlayer = Math.hypot(px - p.pos.x, pz - p.pos.z) < 0.55 && py > p.pos.y - 0.1 && py < eye.y + 0.25;
            const hit = Math.min(tw, tb);
            if (hit < 1e9 || hitPlayer || b.t > 5) {
                const hx = b.x + dx * Math.min(hit, st), hy = b.y + dy * Math.min(hit, st), hz = b.z + dz * Math.min(hit, st);
                if (b.blast) {
                    this.enemyBlast = true;
                    VoxDestruction.explode(hx, hy, hz, b.blast);
                    this.enemyBlast = false;
                } else if (hitPlayer) {
                    if (this.onHurtPlayer) this.onHurtPlayer(b.dmg, b.x, b.z, b.from && b.from.id);
                    p.addTrauma(0.14);
                } else if (b.chip > 0) {
                    const res = VoxDestruction.carve(hx, hy, hz, b.chip, { power: 2, jitter: 0.5, speed: 3, burst: 6 });
                    if (res.count) VoxDestruction.detach(null);
                    VoxFX.sparks(hx, hy, hz, -dx, -dy, -dz, 4, 0.9);
                }
                b.mesh.dispose();
                this.bolts.splice(i, 1);
                continue;
            }
            b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
            b.mesh.position.set(b.x, b.y, b.z);
            b.mesh.lookAt(new BABYLON.Vector3(b.x + dx, b.y + dy, b.z + dz));
        }
    },

    _laser(e, p, left) {
        if (!e.laser) {
            const m = e.laser = BABYLON.MeshBuilder.CreateCylinder('laser', { height: 1, diameter: 0.025, tessellation: 5 }, VoxRender.scene);
            const mat = new BABYLON.StandardMaterial('laser', VoxRender.scene);
            mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(2.2, 0.15, 0.1); mat.alpha = 0.75;
            m.material = mat; m.isPickable = false;
        }
        const a = this._muzzle(e, [0, 0, 0]), eye = p.eye;
        // луч прицела запаздывает — от него можно уйти
        e.lx = e.lx == null ? eye.x : e.lx + (eye.x - e.lx) * 0.05;
        e.ly = e.ly == null ? eye.y - 0.2 : e.ly + (eye.y - 0.2 - e.ly) * 0.05;
        e.lz = e.lz == null ? eye.z : e.lz + (eye.z - e.lz) * 0.05;
        const dx = e.lx - a[0], dy = e.ly - a[1], dz = e.lz - a[2], L = Math.hypot(dx, dy, dz) || 1;
        const m = e.laser;
        m.setEnabled(true);
        m.position.set(a[0] + dx * 0.5, a[1] + dy * 0.5, a[2] + dz * 0.5);
        m.scaling.set(1 + (1 - Math.min(1, left)) * 1.6, L, 1 + (1 - Math.min(1, left)) * 1.6);
        const q = m.rotationQuaternion || (m.rotationQuaternion = new BABYLON.Quaternion());
        // ось цилиндра Y -> направление луча
        const ux = dx / L, uy = dy / L, uz = dz / L;
        const ax = uz, az = -ux, an = Math.acos(Math.max(-1, Math.min(1, uy)));
        const al = Math.hypot(ax, az) || 1, s = Math.sin(an / 2);
        q.set(ax / al * s, 0, az / al * s, Math.cos(an / 2));
    },
    _laserOff(e) { if (e.laser) e.laser.setEnabled(false); },
    _sniperShot(e, p) {
        const a = this._muzzle(e, [0, 0, 0]);
        const tx = e.lx, ty = e.ly, tz = e.lz;
        e.lx = e.ly = e.lz = null;
        const dx = tx - a[0], dy = ty - a[1], dz = tz - a[2], L = Math.hypot(dx, dy, dz) || 1;
        VoxFX.muzzle(a[0], a[1], a[2], dx / L, dy / L, dz / L, 1.2);
        const hw = this.game.world.raycast(a[0], a[1], a[2], dx / L, dy / L, dz / L, 60);
        const end = hw ? hw.t : 60;
        VoxFX.tracer(a[0], a[1], a[2], a[0] + dx / L * end, a[1] + dy / L * end, a[2] + dz / L * end);
        // игрок на линии?
        const eye = p.eye, cx = eye.x - a[0], cy = eye.y - 0.4 - a[1], cz = eye.z - a[2];
        const t = cx * dx / L + cy * dy / L + cz * dz / L;
        if (t > 0 && t < end) {
            const qx = a[0] + dx / L * t - eye.x, qy = a[1] + dy / L * t - (eye.y - 0.4), qz = a[2] + dz / L * t - eye.z;
            if (Math.hypot(qx, qz) < 0.5 && Math.abs(qy) < 1) this._hitPlayer(e, e.type.dmg || 35, dx, dz, 5);
        }
        if (hw) { const res = VoxDestruction.carve(a[0] + dx / L * end, a[1] + dy / L * end, a[2] + dz / L * end, 0.22, { power: 3, jitter: 0.5, speed: 4, burst: 14 }); if (res.count) VoxDestruction.detach(null); }
        if (typeof GameAudio !== 'undefined') GameAudio.shot('rifle');
    },

    // =================================================================== движение корня

    _hits(x, y, z, r, h) {
        const w = this.game.world, k = 1 / w.vs, e = 1e-4;
        const x0 = Math.floor((x - r) * k), x1 = Math.floor((x + r - e) * k), y0 = Math.floor((y + e) * k), y1 = Math.floor((y + h - e) * k), z0 = Math.floor((z - r) * k), z1 = Math.floor((z + r - e) * k);
        if (x0 < 0 || z0 < 0 || x1 >= w.sx || z1 >= w.sz) return true;
        if (!w.regionHasSolid(x0, y0, z0, x1, y1, z1)) return false;
        for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) if (w.get(xx, yy, zz)) return true;
        return false;
    },

    _moveRoot(e, dt) {
        const rig = e.rig, R = rig.root, type = e.type;
        const flying = type.behavior === 'flyer' && rig.state !== 'down';
        // разгон к желаемой скорости + отдача попаданий
        const accel = rig.state === 'stumble' ? 2 : (R.onGround || flying ? 16 : 3);
        let wishX = e.wishX, wishZ = e.wishZ;
        if (rig.crawl) { const s = 0.8; const l = Math.hypot(wishX, wishZ) || 1; wishX = wishX / l * Math.min(l, s); wishZ = wishZ / l * Math.min(l, s); }
        if (rig.state === 'down' && !rig.crawl) { wishX = wishZ = 0; }
        if (e.burnT > 0 && !e.dead) { e.panicA = (e.panicA || Math.random() * 6.28) + (Math.random() - 0.5) * dt * 6; wishX = Math.cos(e.panicA) * (type.speed || 3); wishZ = Math.sin(e.panicA) * (type.speed || 3); this._face(rig, wishX, wishZ, dt, 5); }
        if (rig.headless) { const a = rig.time * 2.3; wishX = Math.cos(a) * 2.4; wishZ = Math.sin(a) * 2.4; }
        const ax = wishX - R.vx, az = wishX === 0 && wishZ === 0 ? -R.vz : wishZ - R.vz;
        const al = Math.hypot(ax, az), mx = accel * dt;
        if (al > mx) { R.vx += ax / al * mx; R.vz += az / al * mx; } else { R.vx += ax; R.vz += az; }
        R.kx *= Math.exp(-dt * 6); R.kz *= Math.exp(-dt * 6);
        if (flying) {
            const floor = this._floorAt(R.x, R.z, R.y + 2);
            const want = floor + e.flyH + Math.sin(rig.time * 1.3) * 0.5;
            R.vy += ((want - R.y) * 3 - R.vy) * Math.min(1, dt * 3);
        } else R.vy = Math.max(-30, R.vy - 14 * dt);
        if (rig.state === 'down' && !rig.crawl) return;
        const vx = R.vx + R.kx, vz = R.vz + R.kz;
        const step = 0.09;
        const total = Math.max(Math.abs(vx), Math.abs(R.vy), Math.abs(vz)) * dt;
        const n = Math.max(1, Math.min(6, Math.ceil(total / step))), h = dt / n;
        const r = rig.r, H = rig.crawl ? 0.5 : rig.h, stepUp = 0.56 * rig.scale;
        R.onGround = false;
        for (let i = 0; i < n; i++) {
            // y
            const dy = R.vy * h;
            if (!this._hits(R.x, R.y + dy, R.z, r, H)) R.y += dy;
            else { if (dy < 0) { R.onGround = true; const k = this.game.world.vs; R.y = Math.max(R.y + dy, Math.floor((R.y + dy) / k + 1) * k); while (this._hits(R.x, R.y, R.z, r, 0.05) && R.y < 40) R.y += k * 0.25; } R.vy = 0; }
            // x, z со ступенькой
            for (const axis of [0, 1]) {
                const d = (axis === 0 ? vx : vz) * h;
                if (!d) continue;
                const dx = axis === 0 ? d : 0, dz = axis === 1 ? d : 0;
                if (!this._hits(R.x + dx, R.y, R.z + dz, r, H)) { R.x += dx; R.z += dz; continue; }
                let done = false;
                if (R.onGround || flying || R.vy > -2) {
                    for (let s = 1; s <= 6 && !done; s++) {
                        const up = s * 0.1;
                        if (up > stepUp) break;
                        if (!this._hits(R.x, R.y + up, R.z, r, H) && !this._hits(R.x + dx, R.y + up, R.z + dz, r, H)) {
                            R.x += dx; R.z += dz; R.y += up; done = true;
                        }
                    }
                }
                if (!done) {
                    if (axis === 0) { R.vx *= 0.2; R.kx = 0; } else { R.vz *= 0.2; R.kz = 0; }
                    e.blocked = 0.25;
                }
            }
        }
        // тело толкает лежащие обломки, стоит на них
        const pl = e._pl || (e._pl = { r, h: H, pos: R, vel: { get x() { return R.vx; }, set x(v) { R.vx = v; }, get y() { return R.vy; }, set y(v) { R.vy = v; }, get z() { return R.vz; }, set z(v) { R.vz = v; } }, onGround: false, groundBody: null, eyeLift: 0 });
        pl.onGround = R.onGround;
        VoxPhysics.playerContacts(pl, dt);
        if (pl.onGround) R.onGround = true;
        // застрял у стены: прыжок через препятствие, крупные и тараны проламывают
        if (e.blocked > 0) {
            e.blocked -= dt;
            e.stuck += dt;
            if (e.stuck > 0.9 && R.onGround && e.alerted) {
                e.stuck = 0;
                if (type.breaker) {
                    const c = VoxFolk._v; rig.center(c);
                    const f = 0.6 + rig.r;
                    const res = VoxDestruction.carve(c[0] + rig.fx * f, c[1], c[2] + rig.fz * f, 0.85 * rig.scale, { power: 2, jitter: 0.5, speed: 3.5, burst: 40 });
                    if (res.count) { VoxDestruction.detach(null); rig.upper = 'melee'; rig.attackT = 0.5; }
                } else R.vy = 5.6;
            }
        } else e.stuck = Math.max(0, e.stuck - dt);
    },

    // =================================================================== попадания

    /** Ближайшее попадание по живым и трупам. { t, x, y, z, nx, ny, nz, v, part, gx, gy, gz, enemy } | null */
    raycast(ox, oy, oz, dx, dy, dz, max) {
        let best = null;
        for (const e of this.list) {
            const h = e.rig.raycast(ox, oy, oz, dx, dy, dz, best ? best.t : max);
            if (h && (!best || h.t < best.t)) { best = h; best.enemy = e; }
        }
        return best;
    },

    PART_MUL: { head: 1.75, core: 1, arm: 0.65, leg: 0.7, other: 0.8 },

    /**
     * Попадание пули или удара. hit — из raycast; o: { dmg, radius — вырез, м; impulse — м/с; dx, dy, dz; cause, shake,
     * pixels — скорость кубиков, fall — обязательно уронить }.
     */
    damage(hit, o) {
        const e = hit.enemy, rig = e.rig, p = hit.part;
        const dx = o.dx || 0, dy = o.dy || 0, dz = o.dz || 0, power = o.impulse || 4, massK = e.type.mass || 1;
        // продавец: только вздрагивает и падает, частей не теряет
        if (e.npc) {
            rig.impulseAt(hit.x, hit.y, hit.z, dx, dy, dz, power);
            this._stagger(e, power * 0.09 + (o.fall ? 2 : 0));
            return 0;
        }
        if (rig.frozen > 0) { this._shatterFrozen(e, o); return; }
        const n = rig.carve(p, hit.gx + 0.5, hit.gy + 0.5, hit.gz + 0.5, o.radius || 0.09, o.pixels || 3.4, dx, dy, dz);
        rig.impulseAt(hit.x, hit.y, hit.z, dx, dy, dz, power / massK);
        rig.root.kx += dx * power * 0.13 / massK; rig.root.kz += dz * power * 0.13 / massK;
        if (p.role === 'core' && rig.upper !== 'aim' && rig.clutchT <= 0 && Math.random() < 0.5) { rig.clutchT = 0.7; rig.clutchPart = p; rig.clutchG = [hit.gx, hit.gy, hit.gz]; }
        const mul = this.PART_MUL[p.role] || 1;
        const crit = p.role === 'head';
        const dmg = (o.dmg || 10) * mul;
        const wasDead = e.dead;
        if (!e.dead) {
            this.hurt(e, dmg, hit.x, hit.y, hit.z, crit);
            this._stagger(e, power / massK * 0.11 + (o.fall ? 2 : 0));
        } else {
            // по трупу: только физика
            rig.kickAll(dx * power * 0.08, 0.2, dz * power * 0.08);
        }
        if (!wasDead) e.alerted = true;
        this.alert(e);
        this._checkVital(e);
        return n;
    },

    /** Прибавить потрясение: споткнулся или упал. */
    _stagger(e, v) {
        const rig = e.rig;
        if (e.dead) return;
        rig.stagger += v;
        const res = e.type.stagger || 1;
        if (rig.stagger > 1.3 * res) { rig.stagger = 0; rig.fall(1.6 + Math.random() * 1.2); }
        else if (rig.stagger > 0.55 * res && rig.state === 'active') { rig.stumble(0.35 + Math.random() * 0.5); rig.upper = 'flail'; }
    },

    /** Снять HP; 0 — смерть. */
    hurt(e, dmg, x, y, z, crit) {
        if (e.dead || e.npc) return;
        dmg *= this.powerMul;
        e.hp -= dmg;
        const killed = e.hp <= 0;
        if (this.onDamage) this.onDamage(e, dmg, x, y, z, !!crit, killed);
        if (killed) this.kill(e);
    },

    kill(e, silent) {
        if (e.dead) return;
        e.dead = true; e.hp = 0;
        this._laserOff(e);
        if (e.laser) { e.laser.dispose(); e.laser = null; }
        const rig = e.rig;
        rig.die();
        rig.upper = 'idle';
        if (!silent && typeof GameAudio !== 'undefined') { const c = VoxFolk._v; rig.center(c); GameAudio.impact('plaster', 0.7, c[0], c[1], c[2]); }
        if (this.onKill) this.onKill(e);
    },

    /** Важные части разбиты — смерть (голова, корпус). */
    _checkVital(e) {
        if (e.dead) return;
        const rig = e.rig;
        if (!e.type.noHeadDeath && rig.byName.head && rig.roleHealth('head') < 0.3 && !rig.headless) { const c = VoxFolk._v; rig.center(c); this.hurt(e, e.hp + 1, c[0], c[1] + 0.8, c[2], true); return; }
        if (rig.roleHealth('core') < 0.3) { const c = VoxFolk._v; rig.center(c); this.hurt(e, e.hp + 1, c[0], c[1], c[2], false); }
    },

    /** Часть оторвана. */
    _severed(e, part) {
        const rig = e.rig;
        const c = part.c;
        VoxFX.dust(c[0], c[1], c[2], M.toy_foam, 0.7);
        if (typeof GameAudio !== 'undefined') GameAudio.impact('plaster', 0.8, c[0], c[1], c[2]);
        if (this.onSever) this.onSever(e, part);
        if (e.dead) return;
        if (part.role === 'head') {
            if (e.type.noHeadDeath) { this.hurt(e, e.hpMax * 0.2, c[0], c[1], c[2], true); return; }
            // без головы бежит ещё секунду-другую
            rig.headless = true;
            e.alerted = true;
            this.hurt(e, e.hpMax * 0.5, c[0], c[1], c[2], true);
        } else if (part.role === 'leg') {
            this.hurt(e, e.hpMax * 0.14, c[0], c[1], c[2], false);
            if (!e.dead) { rig.fall(1.2); }
        } else if (part.role === 'arm') {
            this.hurt(e, e.hpMax * 0.1, c[0], c[1], c[2], false);
            if (!e.dead) { rig.stumble(0.5); rig.upper = 'flail'; }
        } else if (part.role === 'core') {
            this.hurt(e, e.hp + 1, c[0], c[1], c[2], false);
        }
    },

    /**
     * Взрыв: толчок всем в радиусе, мышцы гаснут, близких режет на пиксели. Взрывы мира (бочки, ракеты) идут сюда сами.
     * Урон — dmg у эпицентра (по умолчанию от радиуса).
     */
    blast(x, y, z, R, o = {}) {
        const reach = R * 2.1;
        const v = VoxFolk._v2;
        VoxFolk.pushGibs(x, y, z, R, 11);
        this.noise(x, z, 24);
        for (const e of this.list.slice()) {
            const rig = e.rig;
            rig.center(v);
            const dx = v[0] - x, dy = v[1] - y, dz = v[2] - z, d = Math.hypot(dx, dy, dz) || 0.01;
            if (d > reach + rig.radius) continue;
            const f = Math.max(0, 1 - Math.max(0, d - rig.radius * 0.5) / reach);
            if (f <= 0) continue;
            const massK = e.type.mass || 1;
            const sp = Math.min(24, 17 * f * (R / 2.4)) / massK;
            const nx = dx / d, ny = dy / d * 0.6 + 0.65, nz = dz / d;
            rig.kickAll(nx * sp, ny * sp, nz * sp, Math.min(0.95, f * 1.2));
            rig.root.kx += nx * sp * 0.4; rig.root.kz += nz * sp * 0.4;
            rig.flinch = 1; rig.flx = nx; rig.flz = nz;
            if (e.npc) { if (f > 0.14) rig.fall(1.2 + f * 2); continue; }
            if (rig.frozen > 0 && f > 0.1) { this._shatterFrozen(e, { dx: nx, dy: ny, dz: nz }); continue; }
            // части рядом: у эпицентра — вынесен кусок сферой, вокруг — сколы; конечности отлетают целиком
            for (const p of rig.parts.slice()) {
                if (!p.count) continue;
                const pd = Math.hypot(p.c[0] - x, p.c[1] - y, p.c[2] - z);
                const cutR = R * 0.24 * Math.min(1, (e.type.mass || 1) > 1.5 ? 0.7 : 1);
                const L = rig.worldVox(p, x, y, z, [0, 0, 0]);
                if (pd < cutR + rig.vox * Math.max(p.sx, p.sy, p.sz) * 0.6) rig.carve(p, L[0], L[1], L[2], cutR, 6 + 8 * f, nx, ny * 0.5, nz, 0.9);
                if (pd < R * 0.95 && p.count > 12) {
                    const holes = Math.ceil(f * 3 * Math.random());
                    for (let k = 0; k < holes; k++) {
                        const gx = Math.random() * p.sx, gy = Math.random() * p.sy, gz = Math.random() * p.sz;
                        rig.carve(p, gx, gy, gz, 0.09 + Math.random() * 0.1 * f, 5 + 6 * f, nx, ny * 0.5, nz, 0.8);
                    }
                }
                if (p.attached && p.prox && (p.role === 'arm' || p.role === 'leg' || p.role === 'head') && pd < R && !e.type.boss) {
                    const q = (f - 0.3) * (p.role === 'head' ? 0.32 : 0.7);
                    if (Math.random() < q) rig._sever(p);
                }
            }
            if (!e.dead) {
                const dmg = (o.dmg != null ? o.dmg : 42 * R) * f;
                this.hurt(e, dmg, v[0], v[1], v[2], false);
                e.alerted = true;
                if (!e.dead && f > 0.16 / (e.type.stagger || 1)) rig.fall(1.5 + f * 2);
                this._checkVital(e);
            }
        }
    },

    /** Притяжение к точке (чёрная дыра): кадр; у центра воксели отрываются. */
    pull(x, y, z, R, power, dt) {
        const v = VoxFolk._v2;
        for (const e of this.list) {
            const rig = e.rig;
            rig.center(v);
            const dx = x - v[0], dy = y - v[1], dz = z - v[2], d = Math.hypot(dx, dy, dz) || 0.01;
            if (d > R) continue;
            const f = 1 - d / R;
            const massK = e.type.mass || 1;
            const a = power * (0.3 + f) * dt / massK;
            rig.kickAll(dx / d * a, dy / d * a + 0.02 * a, dz / d * a, 0.7);
            if (!e.dead && f > 0.2) { if (rig.state !== 'down') rig.fall(1 + f); e.alerted = true; }
            if (d < 2 && !e.npc) {
                for (const p of rig.parts) {
                    if (!p.count || Math.random() > 0.4) continue;
                    const L = rig.worldVox(p, x, y, z, VoxFolk._v3.slice());
                    const pd = Math.hypot(p.c[0] - x, p.c[1] - y, p.c[2] - z);
                    rig.carve(p, L[0], L[1], L[2], Math.max(0.12, pd * 0.7), 2, dx / d, dy / d, dz / d, 0.4);
                }
                if (!e.dead) { this.hurt(e, 60 * dt, v[0], v[1], v[2], false); this._checkVital(e); }
            }
        }
    },

    /** Заморозка: враг застывает льдом, любое попадание разбивает его. */
    freeze(e, sec) {
        const rig = e.rig;
        if (e.npc) return;
        if (e.type.boss) { e.wishX *= 0.3; e.wishZ *= 0.3; return; }
        rig.setFrozen(sec);
        e.wishX = e.wishZ = 0;
    },
    _shatterFrozen(e, o) {
        const rig = e.rig;
        if (!e.dead) { const c = VoxFolk._v; rig.center(c); this.hurt(e, e.hp + 1, c[0], c[1], c[2], true); }
        const c = VoxFolk._v; rig.center(c);
        VoxFX.sparks(c[0], c[1], c[2], 0, 1, 0, 18, 0.5);
        if (typeof GameAudio !== 'undefined') GameAudio.breakVoxels('glass', 200, c[0], c[1], c[2]);
        rig.setFrozen(0);
        rig.shatter(5, 2);
        const i = this.list.indexOf(e);
        if (i >= 0) this.list.splice(i, 1);
    },

    /** Удар током: мышцы бьёт судорогой, тело трясёт. */
    shock(e, sec) {
        const rig = e.rig;
        rig.shock = Math.max(rig.shock, sec);
        for (let i = 0; i < rig.n; i++) rig.kick(i, (Math.random() - 0.5) * 4, Math.random() * 2.2, (Math.random() - 0.5) * 4);
        if (rig.state === 'active' && !e.type.boss) { rig.stumble(sec); rig.upper = 'flail'; }
    },

    /** Поджог: урон со временем, чернеет, бежит в панике. */
    ignite(e, sec) { e.burnT = Math.max(e.burnT, sec); e.alerted = true; },
    _burn(e, dt) {
        if (e.burnT <= 0) return;
        e.burnT -= dt;
        const rig = e.rig, c = VoxFolk._v;
        rig.center(c);
        if (Math.random() < dt * 12) VoxFX.fire(c[0] + (Math.random() - 0.5) * 0.5, c[1] + Math.random() * 0.8 - 0.3, c[2] + (Math.random() - 0.5) * 0.5, 0.8);
        if (Math.random() < dt * 3) rig.char(0.04);
        if (!e.dead) this.hurt(e, 14 * dt, c[0], c[1] + 0.6, c[2], false);
    },

    /** Тяжёлые обломки, летящие в живых. */
    _bodyHits(dt) {
        this._bhT = (this._bhT || 0) - dt;
        if (this._bhT > 0) return;
        this._bhT = 0.05;
        for (const b of VoxPhysics.bodies) {
            if (b.dead || b.sleeping) continue;
            const sp = Math.hypot(b.v[0], b.v[1], b.v[2]);
            if (sp < 3.2 || b.mass < 6) continue;
            for (const e of this.list) {
                const R = e.rig.root, a = b.aabb;
                if (R.x + e.rig.r < a[0] || R.x - e.rig.r > a[3] || R.z + e.rig.r < a[2] || R.z - e.rig.r > a[5] || R.y + e.rig.h < a[1] || R.y > a[4]) continue;
                const pw = Math.min(14, sp * Math.sqrt(b.mass) * 0.12);
                const massK = e.type.mass || 1;
                const lx = b.v[0] / sp, ly = b.v[1] / sp, lz = b.v[2] / sp;
                e.rig.kickAll(lx * pw / massK, (ly + 0.3) * pw / massK, lz * pw / massK, 0.6);
                if (!e.dead) {
                    this.hurt(e, pw * 4, R.x, R.y + 1, R.z, false);
                    this._stagger(e, pw * 0.2 / massK);
                }
            }
        }
    },
};
