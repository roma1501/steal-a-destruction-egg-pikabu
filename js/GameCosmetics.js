// GameCosmetics.js — подключает Shop, DailyGift и Wheel к сохранению игры (валюта — те же деньги) и показывает надетую
// косметику в самой игре: скин оружия, трассеры и вспышка выстрела, прицел, портал, эффект разрушения, салют победы.

/** @satisfies {Record<string, any>} */
const GameCosmetics = {
    /** @type {any} */
    game: null,
    /** @type {any} */
    tracerItem: null,
    /** @type {any} */
    boomItem: null,
    /** @type {any} */
    winItem: null,
    _hue: 0,
    _boomAt: 0,

    init(game) {
        this.game = game;
        const st = game.state, save = () => game.persist();
        // валюта игры — доллары, а не «монеты» из текстов движка
        Object.assign(LANG_STRINGS.ru, { 'reward.coins': '${n}', 'reward.big': 'Крупная награда: ${n}', 'reward.dup': 'Такой предмет уже есть: ${n}', 'shop.noCoins': 'Не хватает ${n}' });
        Object.assign(LANG_STRINGS.en, { 'reward.coins': '${n}', 'reward.big': 'Big reward: ${n}', 'reward.dup': 'Already owned: ${n}', 'shop.noCoins': 'Need ${n} more' });
        const cat = GameShopData.build();
        Shop.init({ tabs: cat.tabs, items: cat.items, state: st.shop, persist: save, onChange: e => this._onShop(e) });
        st.shop = Shop.state;
        // одна валюта на всю игру: «монеты» магазина — это деньги игрока
        Object.defineProperty(Shop.state, 'coins', { configurable: true, enumerable: true, get: () => game.state.money, set: v => { game.state.money = v; } });
        // награды растут вместе с игроком (пересчёт при запуске)
        const k = 1 + Math.min(60, (st.raidOpen || 1) - 1) * 0.35, cash = v => Math.round(v * k / 50) * 50;
        DailyGift.init({
            rewards: [{ coins: cash(200) }, { coins: cash(350) }, { coins: cash(500) }, { coins: cash(800), randomItems: 1, maxRarity: 'uncommon' }, { coins: cash(1200) }, { coins: cash(2000), randomItems: 1, maxRarity: 'rare' }],
            exclusive: Shop.exclusiveIds('daily'), fallbackCoins: cash(6000), dupCoins: cash(300), rewardsSink: Shop, state: st.daily, persist: save,
        });
        st.daily = DailyGift.state;
        Wheel.init({
            sectors: [
                { coins: cash(100), weight: 24, col: '#ff3d3d' }, { coins: cash(250), weight: 20, col: '#2f95ff' }, { coins: cash(500), weight: 14, col: '#ffcb1f' }, { randomItem: true, maxRarity: 'uncommon', weight: 10, col: '#a24cf0' },
                { coins: cash(800), weight: 10, col: '#16c23c' }, { coins: cash(1500), weight: 5, col: '#ff8c22' }, { randomItem: true, maxRarity: 'rare', weight: 4, col: '#e0328c' }, { coins: cash(3000), weight: 2, col: '#22d3d3' },
            ],
            dupCoins: cash(200), rewardsSink: Shop, state: st.wheel, persist: save,
        });
        st.wheel = Wheel.state;
        // разрушение: эффект поверх обломков
        const burst = VoxFX.voxelsBurst;
        VoxFX.voxelsBurst = function (list, cx, cy, cz, speed, max) {
            burst.call(this, list, cx, cy, cz, speed, max);
            if (list && list.length > 3) GameCosmetics.boom(cx, cy, cz, list.length);
        };
        this.apply();
    },

    _onShop(e) { if (e.type === 'equip' || e.type === 'unequip' || e.type === 'preview') this.apply(); },

    /** Надетое и примерка — в игру. */
    apply() {
        const L = Shop.look(), it = s => (L[s] ? Shop.item(L[s]) : null), rgb = this.rgb;
        const sk = it('skin');
        GameWeapons.skin = sk && sk.mode ? { mode: sk.mode, a: rgb(sk.a), b: rgb(sk.b) } : null;
        this.tracerItem = it('tracer');
        if (this.tracerItem && this.tracerItem.fx === 'std') this.tracerItem = null;
        this.boomItem = it('boom');
        if (this.boomItem && this.boomItem.type === 'none') this.boomItem = null;
        this.winItem = it('win');
        if (this.winItem && !this.winItem.cols) this.winItem = null;
        GamePortal.setSkin(this.portalOpts(it('portal')));
        GameHud.setXhair(it('xhair'));
    },

    portalOpts(p) {
        return p ? { colA: this.rgb(p.a), colB: this.rgb(p.b), arms: p.arms, twist: p.twist, stars: p.stars, rainbow: p.rainbow, speed: p.speed } : null;
    },

    /** '#rrggbb' -> [r, g, b] 0..1. */
    rgb(hex) {
        const n = parseInt(String(hex).slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    },
    hue(h) {
        const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
        return [f(5), f(3), f(1)];
    },

    // ------------------------------------------------------------------ выстрел игрока

    tracer(ax, ay, az, bx, by, bz) {
        const it = this.tracerItem;
        if (!it) { VoxFX.tracer(ax, ay, az, bx, by, bz); return; }
        const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
        if (L < 0.5) return;
        const ux = dx / L, uy = dy / L, uz = dz / L;
        // поперечные оси для двойных линий и спирали
        let px = -uz, py = 0, pz = ux;
        const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
        const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
        let c = this.rgb(it.color);
        if (it.fx === 'rainbow' || it.fx === 'rspiral') { this._hue = (this._hue + 0.07) % 1; c = this.hue(this._hue); }
        const mid = 0.55, w = it.w || 1;
        const line = (t, stretch, off, col) => VoxFX.puff(ax + dx * t + px * off, ay + dy * t + py * off, az + dz * t + pz * off, { add: true, mode: 1, size: 0.014 * w, stretch, life: 0.06, vx: ux * 0.001, vy: uy * 0.001, vz: uz * 0.001, r: col[0] * 5, g: col[1] * 5, b: col[2] * 5, drag: 0, fadeIn: 0.004 });
        const dot = (x, y, z, s, life, vx, vy, vz, col) => VoxFX.puff(x, y, z, { add: true, mode: 5, size: s, life, alpha: 1, vx, vy, vz, drag: 1.2, r: col[0] * 4, g: col[1] * 4, b: col[2] * 4, fadeOut: 0.6 });
        const far = Math.min(L * 0.45, 6);
        switch (it.fx) {
            case 'double': line(mid, far, 0.035, c); line(mid, far, -0.035, c); break;
            case 'dash': for (let i = 0; i < 4; i++) line(0.15 + i * 0.22, Math.min(L * 0.07, 1), 0, c); break;
            case 'spark': {
                line(mid, far, 0, c);
                const n = Math.min(10, Math.ceil(L * 1.2));
                for (let i = 0; i < n; i++) { const t = Math.random(); dot(ax + dx * t, ay + dy * t, az + dz * t, 0.03, 0.35, (Math.random() - 0.5) * 1.2, Math.random() * 1.2, (Math.random() - 0.5) * 1.2, c); }
                break;
            }
            case 'comet': {
                line(mid, far, 0, c);
                VoxFX.puff(bx, by, bz, { add: true, mode: 4, size: 0.26 * w, life: 0.16, alpha: 1, fadeOut: 0.5, r: c[0] * 5, g: c[1] * 5, b: c[2] * 5 });
                for (let i = 0; i < 5; i++) { const t = 1 - i * 0.08; dot(ax + dx * t, ay + dy * t, az + dz * t, 0.07 - i * 0.008, 0.2, 0, 0, 0, c); }
                break;
            }
            case 'spiral': case 'rspiral': {
                line(mid, far, 0, c);
                const n = Math.min(26, Math.ceil(L * 3));
                for (let i = 0; i < n; i++) {
                    const t = i / n, a = t * L * 5, r = 0.05 + 0.03 * Math.sin(t * 9), o = Math.cos(a) * r, s = Math.sin(a) * r;
                    const col = it.fx === 'rspiral' ? this.hue((this._hue + t) % 1) : c;
                    dot(ax + dx * t + px * o + qx * s, ay + dy * t + py * o + qy * s, az + dz * t + pz * o + qz * s, 0.028, 0.22, 0, 0, 0, col);
                }
                break;
            }
            case 'rainbow': {
                for (let i = 0; i < 4; i++) line(0.15 + i * 0.23, Math.min(L * 0.12, 1.6), 0, this.hue((this._hue + i * 0.17) % 1));
                break;
            }
            default: line(mid, far, 0, c);
        }
    },

    muzzle(x, y, z, dx, dy, dz, big = 1) {
        const it = this.tracerItem;
        if (!it) { VoxFX.muzzle(x, y, z, dx, dy, dz, big); return; }
        const c = it.fx === 'rainbow' || it.fx === 'rspiral' ? this.hue(this._hue) : this.rgb(it.color);
        VoxFX.puff(x, y, z, { add: true, mode: 4, size: 0.42 * big, life: 0.06, alpha: 1, fadeIn: 0.004, fadeOut: 0.1, r: c[0] * 8, g: c[1] * 8, b: c[2] * 8, drag: 0 });
        VoxFX.puff(x + dx * 0.15, y + dy * 0.15, z + dz * 0.15, { add: true, mode: 1, size: 0.14 * big, stretch: 0.6 * big, life: 0.05, vx: dx, vy: dy, vz: dz, r: c[0] * 7, g: c[1] * 7, b: c[2] * 7, drag: 0 });
        VoxRender.flash(x, y, z, c, 4 * big, 7, 0.07);
    },

    // ------------------------------------------------------------------ разрушение

    boom(x, y, z, n) {
        const it = this.boomItem;
        if (!it) return;
        const now = performance.now();
        if (now < this._boomAt) return;
        this._boomAt = now + 110;
        const q = VoxRender.quality === 'low' ? 0.45 : 1, N = Math.max(4, Math.round(Math.min(26, 6 + n * 0.25) * q));
        const cols = it.cols.map(this.rgb), pick = () => cols[Math.floor(Math.random() * cols.length)];
        const P = (o) => { const c = o.c || pick(); o.add = true; o.alpha = 1; o.r = c[0] * (o.k || 3.2); o.g = c[1] * (o.k || 3.2); o.b = c[2] * (o.k || 3.2); VoxFX.puff(x, y, z, o); };
        const rnd = (s) => (Math.random() - 0.5) * 2 * s;
        switch (it.type) {
            case 'sparks': for (let i = 0; i < N; i++) P({ mode: 5, size: 0.05, life: 0.5 + Math.random() * 0.4, vx: rnd(5), vy: 1 + Math.random() * 5, vz: rnd(5), gravity: 9, drag: 0.6, fadeOut: 0.5 }); break;
            case 'smoke': for (let i = 0; i < 6; i++) VoxFX.puff(x, y, z, { size: 0.35, grow: 1, life: 1.4, alpha: 0.5, vx: rnd(1), vy: 0.6 + Math.random(), vz: rnd(1), drag: 2, buoy: 0.5, turb: 0.5, ...(c => ({ r: c[0], g: c[1], b: c[2] }))(pick()) }); break;
            case 'confetti': for (let i = 0; i < N; i++) P({ mode: 5, size: 0.075, life: 1.3 + Math.random() * 0.7, vx: rnd(4), vy: 3 + Math.random() * 4, vz: rnd(4), gravity: 5, drag: 1.6, turb: 1, k: 2.2, fadeOut: 0.3 }); break;
            case 'ring': for (let i = 0; i < N; i++) { const a = i / N * 6.283; P({ mode: 5, size: 0.07, life: 0.5, vx: Math.cos(a) * 6, vy: 0.2, vz: Math.sin(a) * 6, drag: 2.2, fadeOut: 0.5 }); } break;
            case 'bubbles': for (let i = 0; i < N; i++) P({ mode: 4, size: 0.08 + Math.random() * 0.1, life: 1.2 + Math.random(), vx: rnd(1), vy: 0.8 + Math.random() * 1.4, vz: rnd(1), drag: 0.8, buoy: 0.6, turb: 1, k: 1.6, fadeOut: 0.4 }); break;
            case 'fountain': for (let i = 0; i < N; i++) P({ mode: 5, size: 0.06, life: 0.9 + Math.random() * 0.5, vx: rnd(1.4), vy: 6 + Math.random() * 4, vz: rnd(1.4), gravity: 12, drag: 0.2, fadeOut: 0.5 }); break;
            case 'coins': for (let i = 0; i < N; i++) P({ mode: 5, size: 0.09, life: 1 + Math.random() * 0.5, vx: rnd(3), vy: 4 + Math.random() * 3, vz: rnd(3), gravity: 14, drag: 0.3, k: 3.6, fadeOut: 0.3 }); break;
            case 'stars': for (let i = 0; i < N; i++) P({ mode: 5, size: 0.04 + Math.random() * 0.05, life: 1.2 + Math.random(), vx: rnd(2.4), vy: rnd(2.4), vz: rnd(2.4), drag: 2.4, turb: 0.8, k: 4, fadeOut: 0.6 }); break;
            case 'rays': for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283, vy = rnd(0.7); P({ mode: 1, size: 0.05, stretch: 1.1, life: 0.28, vx: Math.cos(a) * 3, vy: vy * 3, vz: Math.sin(a) * 3, drag: 0, k: 4 }); } break;
            case 'spiral': for (let i = 0; i < N; i++) { const a = i / N * 12.56, s = 1.5 + i / N * 4; P({ mode: 5, size: 0.06, life: 0.7, vx: Math.cos(a) * s, vy: 2 + i / N * 3, vz: Math.sin(a) * s, drag: 1, delay: i * 0.012, fadeOut: 0.5 }); } break;
            case 'nova': {
                P({ mode: 4, size: 1.1, life: 0.26, fadeOut: 0.8, k: 3 });
                for (let i = 0; i < N * 1.5; i++) { const a = Math.random() * 6.283, u = rnd(1), r = Math.sqrt(1 - u * u), s = 5 + Math.random() * 4; P({ mode: 5, size: 0.07, life: 0.6 + Math.random() * 0.3, vx: Math.cos(a) * r * s, vy: u * s, vz: Math.sin(a) * r * s, drag: 1.8, fadeOut: 0.5, k: 4 }); }
                break;
            }
            case 'implode': for (let i = 0; i < N; i++) { const a = Math.random() * 6.283, u = rnd(1), r = Math.sqrt(1 - u * u), R = 1.4; VoxFX.puff(x + Math.cos(a) * r * R, y + u * R, z + Math.sin(a) * r * R, ((c) => ({ add: true, mode: 5, size: 0.06, life: 0.42, alpha: 1, vx: -Math.cos(a) * r * 3.4, vy: -u * 3.4, vz: -Math.sin(a) * r * 3.4, drag: 0, r: c[0] * 4, g: c[1] * 4, b: c[2] * 4, fadeOut: 0.3 }))(pick())); } break;
        }
    },

    // ------------------------------------------------------------------ салют (2D, окно итогов и превью магазина)

    /** Вспышка салюта: частицы в parts. item — предмет вкладки win (без него — по цвету яйца). */
    burst(parts, x, y, color, item) {
        const it = item || this.winItem, pat = it ? it.pat : 'ball', cols = it && it.cols ? it.cols : [color, '#ffffff', '#ffd91a', color];
        const n = 46, sp = 150 + Math.random() * 110;
        const push = (vx, vy, i, o) => { if (parts.length < 460) parts.push(Object.assign({ x, y, vx, vy, life: 0, max: 0.9 + Math.random() * 0.7, c: cols[i % cols.length], s: 1.6 + Math.random() * 1.8, g: 1 }, o)); };
        for (let i = 0; i < n; i++) {
            const a = i / n * 6.2832;
            switch (pat) {
                case 'ring': push(Math.cos(a) * sp, Math.sin(a) * sp, i, { g: 0.5 }); break;
                case 'double': push(Math.cos(a) * sp, Math.sin(a) * sp, 0, { g: 0.5 }); push(Math.cos(a) * sp * 0.55, Math.sin(a) * sp * 0.55, 1, { g: 0.5 }); break;
                case 'heart': { const X = 16 * Math.pow(Math.sin(a), 3), Y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)); push(X * sp * 0.065, Y * sp * 0.065, i, { g: 0.25, max: 1.3 }); break; }
                case 'star': { const R = (i % 10 < 5 ? (i % 10) / 5 : (10 - i % 10) / 5) * 0.65 + 0.35; push(Math.cos(a) * sp * R, Math.sin(a) * sp * R, i, { g: 0.3, max: 1.2 }); break; }
                case 'flower': { const R = Math.abs(Math.cos(a * 2.5)) * 0.8 + 0.2; push(Math.cos(a) * sp * R, Math.sin(a) * sp * R, i, { g: 0.3, max: 1.2 }); break; }
                case 'spiral': { const R = 0.25 + (i / n) * 0.85, b = a * 2; push(Math.cos(b) * sp * R, Math.sin(b) * sp * R, i, { g: 0.3, max: 1.2 }); break; }
                case 'willow': push(Math.cos(a) * sp * (0.4 + Math.random() * 0.4), Math.sin(a) * sp * (0.4 + Math.random() * 0.4), i, { g: 0.55, max: 2 + Math.random(), s: 1.3 }); break;
                case 'pix': push(Math.cos(a) * sp * (0.4 + Math.random() * 0.6), Math.sin(a) * sp * (0.4 + Math.random() * 0.6), i, { sq: true, s: 3 + Math.random() * 2 }); break;
                case 'rain': if (i % 2 === 0) parts.push({ x: x + (Math.random() - 0.5) * 260, y: y - 50 - Math.random() * 80, vx: (Math.random() - 0.5) * 22, vy: 60 + Math.random() * 90, life: 0, max: 1.7 + Math.random(), c: cols[i % cols.length], s: 3 + Math.random() * 2, g: 0.7, sq: true }); break;
                default: { const v = sp * (0.5 + Math.random() * 0.6), b = a + Math.random() * 0.2; push(Math.cos(b) * v, Math.sin(b) * v, i, {}); }
            }
        }
    },

    /** Шаг и рисование частиц салюта. d — масштаб холста. */
    stepParts(cx, parts, dt, d) {
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.life += dt;
            if (p.life >= p.max) { parts.splice(i, 1); continue; }
            p.vy += 260 * dt * (p.g == null ? 1 : p.g); p.vx *= 1 - dt * 0.9; p.vy *= 1 - dt * 0.6;
            p.x += p.vx * dt; p.y += p.vy * dt;
            const k = 1 - p.life / p.max, r = p.s * d * k + 0.5;
            cx.globalAlpha = Math.min(1, k * 1.6);
            if (p.sq) {
                cx.fillStyle = '#000'; cx.fillRect(p.x * d - r - 1, p.y * d - r - 1, r * 2 + 2, r * 2 + 2);
                cx.fillStyle = p.c; cx.fillRect(p.x * d - r, p.y * d - r, r * 2, r * 2);
            } else {
                cx.fillStyle = '#000'; cx.beginPath(); cx.arc(p.x * d, p.y * d, (p.s + 1.2) * d * k + 1, 0, 6.2832); cx.fill();
                cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x * d, p.y * d, r, 0, 6.2832); cx.fill();
            }
        }
        cx.globalAlpha = 1;
    },

    /** Счёт в таблице рекордов: всего заработано на вылазках. */
    addScore(total) {
        const st = this.game.state;
        st.stats.score = (st.stats.score || 0) + Math.max(0, Math.round(total));
        if (Platform.name !== 'playgama') Platform.submitScore(st.stats.score);
    },
};
