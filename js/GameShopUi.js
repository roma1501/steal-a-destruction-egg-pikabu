// GameShopUi.js — окно «Магазин»: косметика с примеркой, подарок дня, колесо фортуны, рекорды (только Яндекс).
// Примерка настоящая: окно прижато к краю, за ним видно оружие в руках со скином; остальное показывает холст превью.

/** @satisfies {Record<string, any>} */
const GameShopUi = {
    sec: 'shop',
    tab: 'skin',
    /** @type {string | null} */
    sel: null,
    /** @type {HTMLCanvasElement | null} */
    pv: null,
    /** @type {HTMLElement | null} */
    pvName: null,
    _t: 0,
    /** @type {any[]} */
    _parts: [],
    _next: 0,
    /** @type {Record<string, string>} */
    _thumbs: {},
    /** @type {HTMLImageElement | null} */
    _gun: null,
    _spinning: false,
    _sub: false,
    /** @type {any} */
    _board: null,
    _boardAt: 0,

    get M() { return GameMenus; },
    t(k, p) { return Lang.t(k, p); },
    h(tag, cls, text) { return SdeUi.h(tag, cls, text); },
    hasBoard() { return Platform.name === 'yandex' || /[?&]mockboard/.test(location.search); },
    /** Красная точка на кнопке: можно забрать подарок или покрутить бесплатно. */
    badge() { return DailyGift.canClaim() || !!Wheel.badge(); },

    open(sec, tab) {
        if (sec) this.sec = sec;
        if (tab) this.tab = tab;
        this.sel = null;
        const M = this.M;
        M._open('shop', { title: 'sde.shop.title', icon: 'gift', grad: ['#ffd36b', '#e8821c'], ww: 1060, money: true, cls: 'hubw' }, () => {
            const pv = this.pv = /** @type {HTMLCanvasElement} */ (this.h('canvas', 'sde-pv'));
            pv.width = 360; pv.height = 300;
            const nm = this.pvName = this.h('div', 'sde-pv-nm');
            M.ov.append(pv, nm);
            this._render();
        });
        if (!this._sub) {
            this._sub = true;
            Platform.onRewardedCooldown(() => { if (this.M.cur === 'shop' && !this._spinning) this._render(); });
        }
    },

    closed() { Shop.clearPreview(); this.pv = null; this.pvName = null; this._parts = []; },

    _render() {
        const M = this.M, h = this.h.bind(this), body = M.body;
        if (!body || M.cur !== 'shop') return;
        const top = body.scrollTop;
        body.textContent = '';
        M.ov.classList.toggle('shopv', this.sec === 'shop');
        const nav = h('div', 'sde-tabs sde-tabs6 sde-hubnav');
        const secs = ['shop', 'gift', 'wheel'];
        if (this.hasBoard()) secs.push('board');
        for (const s of secs) {
            const b = M._btn(this.t('sde.hub.' + s), 'y', () => { if (this._spinning) return; this.sec = s; this._render(); }, { cls: 'sde-tab' + (s === this.sec ? ' on' : '') });
            if ((s === 'gift' && DailyGift.canClaim()) || (s === 'wheel' && Wheel.badge())) b.appendChild(h('i', 'sde-dot'));
            nav.appendChild(b);
        }
        body.appendChild(nav);
        if (this.pv) this.pv.style.display = this.sec === 'shop' ? '' : 'none';
        if (this.pvName) this.pvName.style.display = this.sec === 'shop' ? '' : 'none';
        if (this.sec === 'shop') this._renderShop(body);
        else if (this.sec === 'gift') this._renderGift(body);
        else if (this.sec === 'wheel') this._renderWheel(body);
        else this._renderBoard(body);
        M._refreshMoney();
        body.scrollTop = top;
    },

    // ------------------------------------------------------------------ косметика

    _renderShop(body) {
        const M = this.M, h = this.h.bind(this);
        const tabs = h('div', 'sde-tabs sde-tabs6');
        for (const t of Shop.tabs()) tabs.appendChild(M._btn(t.name, 'b', () => { Shop.clearPreview(); this.tab = t.id; this.sel = null; this._render(); }, { cls: 'sde-tab' + (t.id === this.tab ? ' on' : '') }));
        body.appendChild(tabs);
        const grid = h('div', 'sde-sgrid');
        for (const c of Shop.cards(this.tab)) grid.appendChild(this._card(c));
        body.appendChild(grid);
        if (!this.sel) { const eq = Shop.equippedId(this.tab); this.sel = eq; }
        this._updatePv();
    },

    _card(c) {
        const M = this.M, h = this.h.bind(this), it = c.item;
        const el = h('div', 'sde-scard' + (c.equipped ? ' eq' : '') + (this.sel === c.id ? ' sel' : '') + (c.owned ? '' : ' lk'));
        el.style.setProperty('--rc', GameShopData.RAR[it.rarity] || '#fff');
        el.dataset.r = it.rarity;
        const pic = /** @type {HTMLImageElement} */ (h('img', 'th'));
        pic.src = this.thumb(it);
        pic.alt = '';
        pic.draggable = false;
        el.appendChild(pic);
        el.appendChild(h('div', 'nm', c.name));
        el.appendChild(h('div', 'rr', c.rarityLabel));
        el.addEventListener('click', e => {
            if (/** @type {HTMLElement} */ (e.target).closest('button')) return;
            this.sel = c.id;
            Shop.preview(c.id);
            this._updatePv();
            document.querySelectorAll('.sde-scard.sel').forEach(n => n.classList.remove('sel'));
            el.classList.add('sel');
        });
        el.appendChild(this._action(c));
        return el;
    },

    _action(c) {
        const M = this.M;
        const after = () => this._render();
        if (c.action === 'watch') {
            if (!Platform.rewardedSupported()) { const b = M._btn(this.t('sde.shop.noAd'), 'k', null, { cls: 'wide sm off' }); b.disabled = true; return b; }
            const wait = Platform.rewardedCooldownLabel();
            const b = M._btn(wait || this.t('sde.shop.ad', { a: c.progress, b: c.need }), 'p', async () => {
                b.disabled = true;
                const r = await Shop.watchAd(c.id);
                if (r.ok && r.unlocked) this.M.hud.toast('sde.ad.done');
                else if (!r.ok && r.reason === 'adFailed') this.M.hud.toast('sde.res.adFail');
                after();
            }, { cls: 'wide sm sd-ad sde-ad-btn', icon: 'play' });
            b.style.setProperty('--p', String(c.progress / c.need));
            b.appendChild(this.h('i'));
            if (wait) { b.disabled = true; b.classList.add('off'); }
            return b;
        }
        if (c.action === 'buy') return M._btn(this.t('sde.buy') + ' ' + GameData.money(c.price), c.enabled ? 'g' : 'k', (e, btn) => {
            const r = Shop.buy(c.id);
            if (!r.ok) { M._shake(btn); M.hud.toast('sde.noMoney'); return; }
            after();
        }, { cls: 'wide sm' + (c.enabled ? '' : ' off') });
        if (c.action === 'equip') return M._btn(this.t('sde.shop.equip'), 'b', () => { Shop.equip(c.id); after(); }, { cls: 'wide sm' });
        if (c.action === 'unequip') return M._btn(this.t('sde.shop.unequip'), 'k', () => { Shop.unequip(c.slot); after(); }, { cls: 'wide sm' });
        const b = M._btn(c.kind === 'exclusive' && !c.owned ? this.t('sde.shop.daily') : this.t('sde.shop.equipped'), 'k', null, { cls: 'wide sm off' });
        b.disabled = true;
        return b;
    },

    _updatePv() {
        const it = this.sel ? Shop.item(this.sel) : null;
        if (this.pvName) this.pvName.textContent = it ? Shop.name(it.id) : '';
        this._parts = [];
        this._next = 0;
        this._t = 0;
    },

    /** Кадр: живое превью выбранного предмета. */
    step(dt) {
        if (!this.pv || this.sec !== 'shop') return;
        const it = this.sel ? Shop.item(this.sel) : null, cx = this.pv.getContext('2d'), W = this.pv.width, H = this.pv.height;
        this._t += dt;
        cx.clearRect(0, 0, W, H);
        if (!it || this.tab === 'skin') return;
        if (it.tab === 'win') {
            this._next -= dt;
            if (this._next <= 0) { this._next = 0.75; GameCosmetics.burst(this._parts, 60 + Math.random() * (W - 120), 60 + Math.random() * (H - 150), '#ffd91a', it.cols ? it : null); }
            GameCosmetics.stepParts(cx, this._parts, dt, 1);
            return;
        }
        this.drawItem(cx, W, H, it, this._t);
    },

    /** Значок предмета (data URL, рисуется один раз). */
    thumb(it) {
        if (this._thumbs[it.id]) return this._thumbs[it.id];
        const cv = document.createElement('canvas');
        cv.width = 180; cv.height = 120;
        const cx = cv.getContext('2d');
        if (it.tab === 'skin') {
            if (!this._gun) { const g = this._gun = new Image(); g.onload = () => { this._thumbs = {}; if (this.M.cur === 'shop' && this.sec === 'shop' && this.tab === 'skin') this._render(); }; g.src = 'assets/ui/weapons/ar_ginger.webp'; }
            this._drawSkin(cx, 180, 120, it);
            if (!this._gun.complete || !this._gun.naturalWidth) return cv.toDataURL('image/png');
        } else if (it.tab === 'win') {
            const parts = [];
            GameCosmetics.burst(parts, 90, 58, '#ffd91a', it.cols ? it : null);
            for (let k = 0; k < 7; k++) { cx.clearRect(0, 0, 180, 120); GameCosmetics.stepParts(cx, parts, 0.05, 1); }
        } else this.drawItem(cx, 180, 120, it, 0.55);
        return (this._thumbs[it.id] = cv.toDataURL('image/png'));
    },

    /** Рисунок скина на силуэте автомата: те же формулы, что в шейдере WeaponSkinPlugin. */
    _drawSkin(cx, W, H, it) {
        const S = GameShopData, rgb = GameCosmetics.rgb, m = it.mode;
        const a = it.a ? rgb(it.a) : [0.55, 0.57, 0.62], b = it.b ? rgb(it.b) : a;
        const tmp = document.createElement('canvas');
        tmp.width = W; tmp.height = H;
        const tc = tmp.getContext('2d'), im = tc.createImageData(W, H), d = im.data;
        const n2 = (x, y) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, h = (p, q) => VoxFolk.hash(p, q, 7), u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g); return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; };
        const hue = GameCosmetics.hue;
        for (let y = 0, o = 0; y < H; y++) for (let x = 0; x < W; x++, o += 4) {
            const U = x / W * 70, V = y / H * 46;
            let c = a;
            if (m === S.SPLIT) c = V + Math.sin(U * 0.1) * 2 > 23 ? b : a;
            else if (m === S.STRIPES) c = ((U + V) * 0.09) % 1 > 0.5 ? b : a;
            else if (m === S.PIXELS) c = (Math.floor(U * 0.22) + Math.floor(V * 0.22)) % 2 ? b : a;
            else if (m === S.CAMO) { const n = n2(U * 0.09, V * 0.09) + 0.5 * n2(U * 0.21, V * 0.21); c = n > 0.82 ? b : (n > 0.62 ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : a); }
            else if (m === S.DOTS) { const p = (U * 0.16) % 1 - 0.5, q = (V * 0.16) % 1 - 0.5; c = Math.hypot(p, q) < 0.23 ? b : a; }
            else if (m === S.GRAD) { const k = U / 70; c = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
            else if (m === S.NEON) { const l = Math.abs(((U + V * 0.5) * 0.08) % 1 - 0.5); c = l < 0.07 ? a : b; }
            else if (m === S.HOLO) c = hue(((U + V) * 0.018) % 1);
            else if (m === S.LAVA) { const n = n2(U * 0.12, V * 0.12); c = n > 0.55 ? a : b; }
            else if (m === S.GALAXY) { const r = VoxFolk.hash(Math.floor(U * 2), Math.floor(V * 2), 3), n = n2(U * 0.05, V * 0.05); c = r > 0.95 ? [1, 1, 1] : [b[0] + (a[0] - b[0]) * n * n, b[1] + (a[1] - b[1]) * n * n, b[2] + (a[2] - b[2]) * n * n]; }
            else if (m === S.GOLD) { const s = 0.92 + 0.22 * Math.sin(U * 0.25 + V * 0.2); c = Math.abs(((U - V) * 0.012) % 1 - 0.5) < 0.05 ? b : [a[0] * s, a[1] * s, a[2] * s]; }
            else if (m === S.CARBON) c = (Math.floor(U * 0.6) + Math.floor(V * 0.6)) % 2 ? b : a;
            else if (m === S.ZEBRA) c = Math.sin((U + n2(U * 0.13, V * 0.13) * 22) * 0.38) > 0 ? b : a;
            d[o] = c[0] * 255; d[o + 1] = c[1] * 255; d[o + 2] = c[2] * 255; d[o + 3] = 255;
        }
        tc.putImageData(im, 0, 0);
        const g = this._gun;
        if (g && g.complete && g.naturalWidth) {
            const k = Math.min(W / g.naturalWidth, H / g.naturalHeight), w = g.naturalWidth * k, hh = g.naturalHeight * k, x = (W - w) / 2, y = (H - hh) / 2;
            if (m) { tc.globalCompositeOperation = 'multiply'; tc.drawImage(g, x, y, w, hh); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(g, x, y, w, hh); tc.globalCompositeOperation = 'source-over'; cx.drawImage(tmp, 0, 0); }
            else cx.drawImage(g, x, y, w, hh);
        } else cx.drawImage(tmp, 0, 0);
    },

    /** Рисунок предмета в момент t: для значка и для живого превью. */
    drawItem(cx, W, H, it, t) {
        const rgb = GameCosmetics.rgb, css = c => 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
        if (it.tab === 'xhair') {
            const k = Math.min(W, H) / 62, sh = it.shape;
            cx.save();
            cx.translate(W / 2, H / 2);
            if (it.anim === 'spin') cx.rotate(t * 2);
            const s = it.anim === 'pulse' ? k * (1 + Math.sin(t * 5) * 0.08) : k;
            cx.scale(s, s);
            const col = it.anim === 'rainbow' ? css(GameCosmetics.hue((t * 0.3) % 1)) : (it.color || '#ffffff');
            const paths = sh ? [GameShopData.XH[sh]] : [GameShopData.XH.gap];
            cx.lineCap = 'round'; cx.lineJoin = 'round';
            for (const d of paths) {
                const P = new Path2D(d);
                cx.strokeStyle = '#000'; cx.lineWidth = 6.5; cx.stroke(P);
                cx.strokeStyle = col; cx.lineWidth = 3; cx.stroke(P);
            }
            cx.restore();
            return;
        }
        if (it.tab === 'portal') {
            const R = Math.min(W, H) * 0.44, A = rgb(it.a), B = rgb(it.b), arms = it.arms || 3;
            cx.save();
            cx.translate(W / 2, H / 2);
            cx.beginPath(); cx.arc(0, 0, R, 0, 6.2832); cx.clip();
            cx.fillStyle = css([A[0] * 0.25, A[1] * 0.25, A[2] * 0.25]);
            cx.fillRect(-R, -R, R * 2, R * 2);
            const rot = t * (it.speed || 1) * 1.6;
            for (let r = R; r > 2; r -= R / 15) {
                const tw = (it.twist || 2.6) * (R / (r + R * 0.22));
                cx.save();
                cx.rotate(rot + tw * 0.9);
                for (let i = 0; i < arms; i++) {
                    cx.rotate(6.2832 / arms);
                    const u = (r / R + t * 0.1) % 1;
                    cx.fillStyle = it.rainbow > 0.3 ? css(GameCosmetics.hue((u + i / arms) % 1)) : (i % 2 ? css(B) : css(A));
                    cx.beginPath(); cx.moveTo(0, 0); cx.arc(0, 0, r, 0, 6.2832 / arms * 0.5); cx.closePath(); cx.fill();
                }
                cx.restore();
            }
            const g = cx.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
            g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            cx.fillStyle = g; cx.fillRect(-R, -R, R * 2, R * 2);
            for (let i = 0; i < 14 * (it.stars || 1); i++) {
                const a = VoxFolk.hash(i, 3, 9) * 6.2832 + t * 0.6, r = R * ((VoxFolk.hash(i, 5, 9) + t * 0.25) % 1);
                cx.fillStyle = '#fff'; cx.fillRect(Math.cos(a) * r - 1, Math.sin(a) * r - 1, 2.4, 2.4);
            }
            cx.restore();
            cx.lineWidth = 4; cx.strokeStyle = css(B);
            cx.beginPath(); cx.arc(W / 2, H / 2, R, 0, 6.2832); cx.stroke();
            return;
        }
        if (it.tab === 'tracer') {
            const p = (t * 2.2) % 1, x0 = W * 0.94, y0 = H * 0.86, x1 = W * 0.08, y1 = H * 0.14;
            const c = it.color ? rgb(it.color) : [1, 0.85, 0.5], w = (it.w || 1) * 3.2;
            const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), px = -dy / L, py = dx / L;
            const fade = 1 - Math.max(0, p - 0.6) / 0.4;
            cx.globalAlpha = fade;
            cx.lineCap = 'round';
            const seg = (a, b, off, col, wd) => { cx.strokeStyle = col; cx.lineWidth = wd; cx.beginPath(); cx.moveTo(x0 + dx * a + px * off, y0 + dy * a + py * off); cx.lineTo(x0 + dx * b + px * off, y0 + dy * b + py * off); cx.stroke(); };
            const col = css(c), fx = it.fx || 'std', hd = Math.min(1, p * 2.4), tl = Math.max(0, hd - 0.55);
            cx.shadowColor = col; cx.shadowBlur = 10;
            if (fx === 'double') { seg(tl, hd, 6, col, w); seg(tl, hd, -6, col, w); }
            else if (fx === 'dash') for (let i = 0; i < 5; i++) { const a = tl + i * 0.12; if (a < hd) seg(a, Math.min(hd, a + 0.07), 0, col, w); }
            else if (fx === 'rainbow') for (let i = 0; i < 6; i++) { const a = tl + (hd - tl) * i / 6; seg(a, a + (hd - tl) / 6, 0, css(GameCosmetics.hue((i / 6 + t) % 1)), w); }
            else seg(tl, hd, 0, col, w);
            if (fx === 'spark') for (let i = 0; i < 14; i++) { const a = tl + (hd - tl) * VoxFolk.hash(i, 1, 2), o = (VoxFolk.hash(i, 2, 2) - 0.5) * 22; cx.fillStyle = col; cx.fillRect(x0 + dx * a + px * o, y0 + dy * a + py * o, 3, 3); }
            if (fx === 'spiral' || fx === 'rspiral') for (let i = 0; i < 28; i++) { const a = tl + (hd - tl) * i / 28, o = Math.sin(i * 0.9 + t * 10) * 10; cx.fillStyle = fx === 'rspiral' ? css(GameCosmetics.hue(i / 28)) : col; cx.fillRect(x0 + dx * a + px * o - 1.5, y0 + dy * a + py * o - 1.5, 3, 3); }
            if (fx === 'comet') { cx.fillStyle = col; cx.beginPath(); cx.arc(x0 + dx * hd, y0 + dy * hd, w * 2.4, 0, 6.2832); cx.fill(); }
            cx.shadowBlur = 0;
            cx.globalAlpha = 1;
            return;
        }
        if (it.tab === 'boom') {
            const cols = (it.cols || ['#fff']), type = it.type || 'none', cxx = W / 2, cy = H * 0.56, p = (t * 0.8) % 1;
            for (let i = 0; i < 6; i++) { const a = VoxFolk.hash(i, 8, 1) * 6.2832, s = p * 26 * (0.5 + VoxFolk.hash(i, 9, 1)); cx.fillStyle = '#8a7a6a'; cx.fillRect(cxx + Math.cos(a) * s - 4, cy + Math.sin(a) * s + p * p * 30 - 4, 8, 8); }
            if (type === 'none') return;
            const n = 34;
            for (let i = 0; i < n; i++) {
                const h1 = VoxFolk.hash(i, 1, 4), h2 = VoxFolk.hash(i, 2, 4), a = h1 * 6.2832;
                let x = cxx, y = cy, sz = 3.4;
                const R = Math.min(W, H) * 0.44;
                switch (type) {
                    case 'ring': x += Math.cos(i / n * 6.2832) * p * R; y += Math.sin(i / n * 6.2832) * p * R * 0.5; break;
                    case 'fountain': x += (h1 - 0.5) * 40 * p; y -= (0.5 + h2) * R * 1.8 * p - p * p * R * 1.4; break;
                    case 'bubbles': x += (h1 - 0.5) * 70 + Math.sin(p * 6 + i) * 6; y -= h2 * R * p * 1.3; sz = 5; break;
                    case 'rays': x += Math.cos(i / n * 6.2832 * 3) * p * R; y += Math.sin(i / n * 6.2832 * 3) * p * R; sz = 3; break;
                    case 'spiral': { const b = i / n * 12 + p * 2; x += Math.cos(b) * (i / n) * R * p * 1.5; y += Math.sin(b) * (i / n) * R * p * 1.1; break; }
                    case 'implode': x += Math.cos(a) * (1 - p) * R; y += Math.sin(a) * (1 - p) * R; break;
                    case 'smoke': x += (h1 - 0.5) * 80 * p; y -= h2 * 60 * p; sz = 8 + p * 12; break;
                    case 'coins': x += Math.cos(a) * h2 * R * p; y += -h2 * R * 0.9 * p + p * p * R * 1.4; sz = 4.6; break;
                    default: x += Math.cos(a) * h2 * R * p * 1.2; y += Math.sin(a) * h2 * R * p * 1.2 + (type === 'confetti' ? p * p * 34 : 0);
                }
                cx.globalAlpha = (1 - p) * (type === 'smoke' ? 0.4 : 1);
                cx.fillStyle = cols[i % cols.length];
                if (type === 'smoke' || type === 'bubbles') { cx.beginPath(); cx.arc(x, y, sz, 0, 6.2832); cx.fill(); }
                else cx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
            }
            if (type === 'nova') { const g = cx.createRadialGradient(cxx, cy, 0, cxx, cy, 70 * (0.3 + p)); g.addColorStop(0, 'rgba(255,255,255,' + (1 - p) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); cx.globalAlpha = 1; cx.fillStyle = g; cx.fillRect(0, 0, W, H); }
            cx.globalAlpha = 1;
        }
    },

    // ------------------------------------------------------------------ подарок дня

    _renderGift(body) {
        const M = this.M, h = this.h.bind(this), v = DailyGift.view();
        const grid = h('div', 'sde-gift');
        for (const d of v.days) {
            const c = h('div', 'sde-gday ' + d.state + (d.exclusive ? ' ex' : ''));
            c.appendChild(h('b', 'dn', d.dayLabel));
            if (d.exclusive && d.skin && Shop.item(d.skin)) {
                const img = /** @type {HTMLImageElement} */ (h('img', 'th'));
                img.src = this.thumb(Shop.item(d.skin));
                img.alt = '';
                c.appendChild(img);
            } else c.appendChild(SdeUi.icon(d.reward && d.reward.randomItems ? 'gift' : 'money', 'ic'));
            c.appendChild(h('div', 'lb', d.label));
            c.appendChild(h('div', 'st', d.stateLabel));
            grid.appendChild(c);
        }
        body.appendChild(grid);
        const acts = h('div', 'sde-menu sde-gift-act');
        if (v.claim.enabled) {
            acts.appendChild(M._btn(v.claim.label, 'g', () => { const r = DailyGift.claim(); if (r.ok) this._gotGift(r); this._render(); }, { cls: 'big', icon: 'gift' }));
            if (v.x2.available && Platform.rewardedSupported()) {
                const b = M._btn(v.x2.label + (v.x2.rewardLabel ? ': ' + v.x2.rewardLabel : ''), 'p', async () => {
                    b.disabled = true;
                    const r = await DailyGift.claimX2();
                    if (r.ok) this._gotGift(r); else if (r.reason === 'adFailed') M.hud.toast('sde.res.adFail');
                    this._render();
                }, { cls: 'sd-ad', icon: 'play' });
                if (!v.x2.enabled) { b.disabled = true; b.classList.add('off'); }
                acts.appendChild(b);
            }
            if (v.x2.hint) acts.appendChild(h('p', 'sde-sub', v.x2.hint));
        } else acts.appendChild(h('p', 'sde-sub', v.nextLabel));
        body.appendChild(acts);
    },

    _gotGift(r) {
        try { GameAudio.ui('select'); } catch (e) { /* тишина */ }
        const lb = DailyGift.rewardLabel(r.reward, r.mult);
        this.M.hud.toast('sde.gift.got', { p: lb });
    },

    // ------------------------------------------------------------------ колесо

    _renderWheel(body) {
        const M = this.M, h = this.h.bind(this);
        if (Wheel.state.pending && !this._spinning) { const r = Wheel.finish(); if (r.ok) M.hud.toast('sde.gift.got', { p: r.label }); }
        const secs = Wheel.sectors(), step = 360 / secs.length, st = Wheel.status();
        const wrap = h('div', 'sde-wheel-wrap');
        const disc = h('div', 'sde-wheel');
        // сектор 0 — под стрелкой сверху: сдвиг на половину сектора
        disc.style.background = 'conic-gradient(from ' + (-step / 2) + 'deg,' + secs.map((s, i) => s.data.col + ' ' + (i * step) + 'deg ' + ((i + 1) * step) + 'deg').join(',') + ')';
        secs.forEach((s, i) => {
            const lb = h('div', 'lb');
            lb.style.transform = 'rotate(' + (i * step) + 'deg)';
            const inner = h('span', '');
            inner.textContent = s.kind === 'item' ? '' : GameData.money(s.coins);
            if (s.kind === 'item') inner.appendChild(SdeUi.icon('gift'));
            lb.appendChild(inner);
            disc.appendChild(lb);
        });
        wrap.append(disc, h('div', 'ptr'), h('div', 'hub'));
        body.appendChild(wrap);
        const acts = h('div', 'sde-menu sde-gift-act');
        const spin = (res) => {
            if (!res || !res.ok) { if (res && res.reason === 'adFailed') M.hud.toast('sde.res.adFail'); this._render(); return; }
            this._spinning = true;
            acts.querySelectorAll('button').forEach(b => { /** @type {HTMLButtonElement} */ (b).disabled = true; });
            disc.style.transition = 'transform ' + res.durationMs + 'ms cubic-bezier(.12,.72,.08,1)';
            disc.style.transform = 'rotate(' + res.angle + 'deg)';
            setTimeout(() => {
                this._spinning = false;
                const r = Wheel.finish();
                if (r.ok) { M.hud.toast('sde.gift.got', { p: r.label }); try { GameAudio.ui('select'); } catch (e) { /* тишина */ } }
                this._render();
            }, res.durationMs + 120);
        };
        const free = M._btn(st.freeLabel, st.canSpinFree ? 'g' : 'k', () => spin(Wheel.spinFree()), { cls: 'big' + (st.canSpinFree ? '' : ' off'), icon: 'play' });
        free.disabled = !st.canSpinFree;
        acts.appendChild(free);
        if (Platform.rewardedSupported() && (st.adLeft > 0 || st.banked > 0)) {
            const ad = M._btn(st.adLabel, 'p', async () => { ad.disabled = true; spin(await Wheel.spinAd()); }, { cls: 'sd-ad', icon: 'play' });
            ad.disabled = !st.canSpinAd;
            ad.classList.toggle('off', !st.canSpinAd);
            acts.appendChild(ad);
        }
        if (st.hint) acts.appendChild(h('p', 'sde-sub', st.hint));
        body.appendChild(acts);
    },

    // ------------------------------------------------------------------ рекорды

    _renderBoard(body) {
        const M = this.M, h = this.h.bind(this);
        const box = h('div', 'sde-board');
        body.appendChild(box);
        const my = M.game.state.stats.score || 0;
        box.appendChild(h('div', 'mine', this.t('sde.board.mine', { p: GameData.money(my) })));
        if (Platform.canLogin()) box.appendChild(M._btn(this.t('sde.board.login'), 'b', async () => { if (await Platform.login()) location.reload(); }, { cls: 'wide' }));
        const list = h('div', 'lst');
        box.appendChild(list);
        const fill = (rows) => {
            list.textContent = '';
            if (!rows || !rows.length) { list.appendChild(h('p', 'sde-sub', this.t('sde.board.empty'))); return; }
            for (const r of rows) {
                const row = h('div', 'rw' + (r.me ? ' me' : ''));
                row.appendChild(h('b', 'rk', String(r.rank)));
                if (r.avatar) { const a = /** @type {HTMLImageElement} */ (h('img', 'av')); a.src = r.avatar; a.alt = ''; row.appendChild(a); }
                row.appendChild(h('span', 'nm', r.name || '—'));
                row.appendChild(h('b', 'sc', GameData.money(r.score)));
                list.appendChild(row);
            }
        };
        // лимит площадки: не чаще раза в минуту
        if (this._board && performance.now() - this._boardAt < 60000) { fill(this._board); return; }
        list.appendChild(h('p', 'sde-sub', this.t('sde.board.loading')));
        Platform.leaderboard({ quantityTop: 10, includeUser: true, quantityAround: 3, avatarSize: 'small' }).then(rows => {
            this._board = rows; this._boardAt = performance.now();
            if (list.isConnected) fill(rows);
        });
    },

    css() {
        return `
.sde-sq.y{--c1:#fff58a;--c2:#ffcb1f;--c3:#ea9500}
.sde-sq.r{--c1:#ff9a8a;--c2:#ff3d3d;--c3:#c7121f}
.sde-sq.o{--c1:#ffc673;--c2:#ff8c22;--c3:#da6000}
.sde-sq .sde-dot,.sde-tab .sde-dot{position:absolute;right:3px;top:3px;width:14px;height:14px;border:2.5px solid #000;border-radius:50%;background:#ff2a2a;animation:sde-blink .7s linear infinite;z-index:2}
.sde-tab{position:relative}
.sde-tabs6{grid-template-columns:repeat(auto-fit,minmax(min(108px,30%),1fr));margin-bottom:7px}
.sde-hubnav{grid-template-columns:repeat(auto-fit,minmax(min(92px,30%),1fr))}
.sde-tabs6 .sde-tab{font-size:clamp(10.5px,min(1.7vh,2.6vw),13.5px);padding:2px;white-space:normal;line-height:1;letter-spacing:-.01em}
.sde-side .sde-sq span{font-size:calc(var(--sq-fs,11px)*var(--hl-k,1));letter-spacing:-.02em}
.sde-xh.skinned g:not(.skin){display:none!important}
.sde-xh.skinned g.skin{display:block!important}
.sde-xh.skinned .w{stroke:var(--xh,#fff)}
.sde-xh.skinned.on .w{stroke:#ff3a3a}
.sde-xh[data-anim=spin] g.skin{animation:sde-xh-spin 2.6s linear infinite}
.sde-xh[data-anim=pulse] g.skin{animation:sde-xh-pulse .9s ease-in-out infinite alternate}
.sde-xh[data-anim=rainbow] g.skin{animation:sde-xh-hue 2.2s linear infinite}
@keyframes sde-xh-spin{to{transform:rotate(360deg)}}
@keyframes sde-xh-pulse{from{transform:scale(.92)}to{transform:scale(1.1)}}
@keyframes sde-xh-hue{to{filter:hue-rotate(360deg)}}
.sde-ov.shopv{justify-content:flex-start;align-items:stretch}
.sde-ov.shopv::before{background:linear-gradient(90deg,rgba(4,2,22,.9) 0,rgba(4,2,22,.7) 58%,rgba(4,2,22,0) 70%)}
.sde-ov.shopv .sde-win{width:min(64%,var(--ww))}
.sde-pv{position:absolute;right:1.5vw;top:3vh;width:32vw;max-width:440px;height:auto;aspect-ratio:6/5;z-index:1;pointer-events:none}
.sde-pv-nm{position:absolute;right:1.5vw;top:calc(3vh + min(26.6vw,366px));width:32vw;max-width:440px;text-align:center;z-index:1;font:400 clamp(15px,2.8vh,24px)/1.05 var(--sde-font);color:#fff;text-shadow:var(--ol3);text-transform:uppercase;pointer-events:none}
.sde-sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(138px,46%),1fr));gap:8px}
.sde-scard{--rc:#fff;position:relative;display:flex;flex-direction:column;align-items:stretch;gap:3px;padding:6px;border:4px solid #000;border-radius:16px;background:linear-gradient(#2c3f91,#1a2764);box-shadow:inset 0 0 0 2px var(--rc);cursor:pointer;min-width:0}
.sde-scard.eq{background:linear-gradient(#2f8f55,#17582f)}
.sde-scard.sel{outline:3px solid #fff;outline-offset:1px}
.sde-scard[data-r=epic],.sde-scard[data-r=legendary]{animation:sde-rar 1.6s ease-in-out infinite alternate}
@keyframes sde-rar{from{box-shadow:inset 0 0 0 2px var(--rc),0 0 2px var(--rc)}to{box-shadow:inset 0 0 0 2px var(--rc),0 0 12px var(--rc)}}
.sde-scard .th{width:100%;aspect-ratio:3/2;object-fit:contain;border-radius:9px;background:rgba(6,10,40,.55)}
.sde-scard .nm{font:400 clamp(12px,1.9vh,15px)/1.05 var(--sde-font);text-align:center;text-transform:uppercase;text-shadow:var(--ol1);overflow-wrap:anywhere;min-height:2.1em}
.sde-scard .rr{font:800 10.5px/1.1 var(--sde-sans);text-align:center;color:var(--rc);text-shadow:0 1px 0 #000}
.sde-scard .sde-btn.sm{min-height:34px;padding:2px 4px;font-size:clamp(11px,1.7vh,13.5px);white-space:normal;line-height:1.02}
.sde-scard .sde-btn.sde-ad-btn{margin-top:0}
.sde-gift{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
.sde-gday{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 5px;border:4px solid #000;border-radius:16px;background:linear-gradient(#2c3f91,#1a2764);min-width:0;text-align:center}
.sde-gday.ex{grid-column:span 2}
.sde-gday.today{background:linear-gradient(#ffcb1f,#ea7a00);box-shadow:0 0 12px #ffcb1f}
.sde-gday.claimed{background:linear-gradient(#2f8f55,#17582f);opacity:.75}
.sde-gday.locked,.sde-gday.tomorrow{filter:saturate(.75)}
.sde-gday .dn{font:400 clamp(12px,2vh,16px)/1 var(--sde-font);text-transform:uppercase;text-shadow:var(--ol1)}
.sde-gday .ic{width:clamp(28px,5.4vh,46px);height:clamp(28px,5.4vh,46px);object-fit:contain}
.sde-gday .th{height:clamp(44px,9vh,76px);object-fit:contain}
.sde-gday .lb{font:800 11.5px/1.15 var(--sde-sans);text-shadow:0 1px 0 #000;overflow-wrap:anywhere}
.sde-gday .st{font:700 10.5px/1.1 var(--sde-sans);color:#ffe9a0;text-shadow:0 1px 0 #000}
.sde-gift-act{max-width:440px;margin:0 auto}
.sde-gift-act .sde-btn{white-space:normal;line-height:1.05}
.sde-wheel-wrap{position:relative;width:min(100%,clamp(210px,50vh,380px));aspect-ratio:1;margin:0 auto 12px}
.sde-wheel{position:absolute;inset:0;border:6px solid #000;border-radius:50%;box-shadow:0 0 0 4px #ffd21f,0 6px 0 4px #000;overflow:hidden}
.sde-wheel .lb{position:absolute;left:50%;top:0;width:0;height:50%;transform-origin:50% 100%}
.sde-wheel .lb span{position:absolute;left:0;top:7%;transform:translateX(-50%);font:400 clamp(11px,2.1vh,16px)/1 var(--sde-font);color:#fff;text-shadow:var(--ol2);white-space:nowrap}
.sde-wheel .lb img{width:clamp(22px,4.4vh,34px);height:clamp(22px,4.4vh,34px);object-fit:contain}
.sde-wheel-wrap .ptr{position:absolute;left:50%;top:-8px;width:0;height:0;margin-left:-13px;border:13px solid transparent;border-top:24px solid #fff;border-bottom:0;filter:drop-shadow(0 3px 0 #000);z-index:2}
.sde-wheel-wrap .hub{position:absolute;left:50%;top:50%;width:14%;height:14%;transform:translate(-50%,-50%);border:5px solid #000;border-radius:50%;background:linear-gradient(#fff58a,#ea9500);z-index:2}
.sde-board{display:flex;flex-direction:column;gap:8px;max-width:560px;margin:0 auto}
.sde-board .mine{font:400 clamp(14px,2.4vh,18px)/1.1 var(--sde-font);color:#ffe03a;text-align:center;text-shadow:var(--ol2)}
.sde-board .lst{display:flex;flex-direction:column;gap:5px}
.sde-board .rw{display:flex;align-items:center;gap:8px;padding:5px 10px;border:3.5px solid #000;border-radius:13px;background:linear-gradient(#2c3f91,#1a2764)}
.sde-board .rw.me{background:linear-gradient(#2f8f55,#17582f)}
.sde-board .rk{flex:none;width:2em;font:400 15px/1 var(--sde-font);text-align:center;text-shadow:var(--ol1)}
.sde-board .av{flex:none;width:28px;height:28px;border-radius:50%;border:2px solid #000;object-fit:cover}
.sde-board .nm{flex:1;min-width:0;font:700 13px/1.2 var(--sde-sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sde-board .sc{flex:none;font:400 15px/1 var(--sde-font);color:#5dff6c;text-shadow:var(--ol1)}
@media (max-aspect-ratio:1/1){
.sde-ov.shopv{flex-direction:column;justify-content:flex-start;align-items:stretch}
.sde-ov.shopv::before{background:linear-gradient(180deg,rgba(4,2,22,.9) 0,rgba(4,2,22,.7) 58%,rgba(4,2,22,0) 72%)}
.sde-ov.shopv .sde-win{width:100%;max-height:76%}
.sde-ov.shopv .sde-tab{min-height:32px}
.sde-pv{left:2vw;right:auto;top:auto;bottom:calc(3vh + 22px);width:44vw;max-width:none}
.sde-pv-nm{left:2vw;right:auto;top:auto;bottom:1vh;width:44vw;max-width:none}
}
@media (max-width:520px){.sde-gift{grid-template-columns:repeat(3,minmax(0,1fr))}.sde-gday.ex{grid-column:span 3}}
@media (max-height:440px){.sde-ov.shopv .sde-win{width:min(72%,var(--ww))}.sde-tabs6 .sde-tab{min-height:29px}.sde-pv{width:26vw;top:1vh}.sde-pv-nm{width:26vw;top:calc(1vh + 21.6vw)}.sde-gift{grid-template-columns:repeat(7,minmax(0,1fr));margin-bottom:6px}.sde-gday.ex{grid-column:auto}.sde-gday .lb{font-size:10px}.sde-wheel-wrap{width:min(100%,210px)}}
`;
    },
};
