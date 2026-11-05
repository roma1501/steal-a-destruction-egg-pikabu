// GamePets.js — питомцы и кодекс: яйцо в гнезде высиживается и вылупляется, питомец в гнезде приносит вдвое больше денег,
// один питомец может ходить за игроком и прибавляет добычу. Лишние яйца лежат в рюкзаке, их ставят в пустое гнездо.
// Состояние в едином сохранении: eggBag { яйцо: n }, pets { питомец: n }, codex { eggs, pets } — что уже находил, companion — id.

/** @satisfies {Record<string, any>} */
const GamePets = {
    VOX: 0.05,
    /** Секунд высиживания по редкости яйца. */
    HATCH: [90, 180, 360, 720, 1500, 2700, 4500],
    /** Прибавка к добыче от питомца рядом, по редкости. */
    BONUS: [0.03, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35],
    /** Во сколько раз питомец в гнезде доходнее яйца. */
    INCOME_MUL: 2,
    /** @type {any} */
    game: null,
    /** @type {Record<string, any>} */
    _byId: {},
    /** @type {Record<string, any>} */
    _byEgg: {},
    /** @type {Record<string, any>} */
    _grids: {},
    /** @type {any} */
    comp: null,

    init(game) {
        this.game = game;
        for (const p of /** @type {any} */ (window).PETS) { this._byId[p.id] = p; this._byEgg[p.egg] = p; }
        const st = game.state;
        st.eggBag = st.eggBag || {};
        st.pets = st.pets || {};
        st.codex = st.codex || {};
        st.codex.eggs = st.codex.eggs || {};
        st.codex.pets = st.codex.pets || {};
        // старые сохранения: ждущее яйцо — в рюкзак, яйца в гнёздах — в кодекс
        if (st.pendingEgg) { st.eggBag[st.pendingEgg] = (st.eggBag[st.pendingEgg] || 0) + 1; st.pendingEgg = null; }
        for (const n of st.nests) if (n.egg && !st.codex.eggs[n.egg]) st.codex.eggs[n.egg] = 1;
    },
    get st() { return this.game.state; },
    list() { return /** @type {any} */ (window).PETS; },
    def(id) { return this._byId[id] || null; },
    byEgg(eggId) { return this._byEgg[eggId] || null; },
    eggOf(p) { return GameData.egg(p.egg); },
    rarityOf(p) { return this.eggOf(p).rarity; },

    // ------------------------------------------------------------------ гнёзда

    hatchTime(eggDef) { return this.HATCH[eggDef.rarity] || 90; },
    /** Состояние высиживания в гнезде: left — секунд осталось, k — доля 0..1, ready. */
    progress(n) {
        const def = n && n.egg ? GameData.egg(n.egg) : null;
        if (!def || n.pet) return { ready: false, left: 0, k: 0 };
        const T = this.hatchTime(def), t = n.t || 0;
        return { ready: t >= T, left: Math.max(0, Math.ceil(T - t)), k: Math.min(1, t / T) };
    },
    timeLabel(sec) {
        const s = Math.max(0, Math.ceil(sec));
        return s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : String(s) + Lang.t('sde.sec');
    },
    nestIncome(n) {
        const d = n && n.egg ? GameData.egg(n.egg) : null;
        return d ? d.income * (n.pet ? this.INCOME_MUL : 1) : 0;
    },
    /** Вылупить: через рекламу можно раньше срока. */
    hatch(i, early) {
        const st = this.st, n = st.nests[i];
        if (!n || !n.egg || n.pet) return null;
        if (!early && !this.progress(n).ready) return null;
        const p = this.byEgg(n.egg);
        if (!p) return null;
        n.pet = true;
        st.pets[p.id] = (st.pets[p.id] || 0) + 1;
        const first = !st.codex.pets[p.id];
        st.codex.pets[p.id] = (st.codex.pets[p.id] || 0) + 1;
        const reward = first ? this._discover(this.eggOf(p).income * 60) : 0;
        this.game.persist();
        GameBase.refreshViews();
        this._hatchFx(i, p);
        return { pet: p, first, reward };
    },
    _discover(amount) { this.st.money += amount; return amount; },
    _hatchFx(i, p) {
        const v = GameBase.views.find(q => q.i === i);
        if (!v) return;
        const c = GameEggs.rarityRgb(this.eggOf(p));
        VoxRender.flash(v.x, v.y + 1, v.z, c, 14, 10, 0.5);
        for (let k = 0; k < 42; k++) {
            const a = Math.random() * 6.28, u = Math.random() * 2 - 1, sp = 2 + Math.random() * 4, r = Math.sqrt(1 - u * u);
            VoxFX.puff(v.x, v.y + 0.6, v.z, { add: true, mode: 5, size: 0.06, life: 0.7 + Math.random() * 0.5, alpha: 1, vx: Math.cos(a) * r * sp, vy: Math.abs(u) * sp + 1, vz: Math.sin(a) * r * sp, gravity: 7, drag: 0.8, r: c[0] * 3.5, g: c[1] * 3.5, b: c[2] * 3.5, fadeOut: 0.5 });
        }
        if (typeof GameAudio !== 'undefined') { GameAudio.impact('glass', 1, v.x, v.y, v.z); GameAudio.ui('select'); }
    },
    /** Новое яйцо с вылазки: кодекс и деньги за первую находку. Возвращает награду. */
    gotEgg(id) {
        const cx = this.st.codex.eggs, first = !cx[id];
        cx[id] = (cx[id] || 0) + 1;
        const d = GameData.egg(id);
        return first && d ? this._discover(d.income * 30) : 0;
    },
    bagCount() { let s = 0; const b = this.st.eggBag; for (const k in b) s += b[k]; return s; },
    toBag(id) { const b = this.st.eggBag; b[id] = (b[id] || 0) + 1; },
    /** Поставить яйцо из рюкзака в гнездо i. */
    placeFromBag(i, id) {
        const st = this.st, n = st.nests[i];
        if (!n || n.egg || !st.eggBag[id]) return false;
        st.eggBag[id]--;
        if (st.eggBag[id] <= 0) delete st.eggBag[id];
        n.egg = id; n.cash = 0; n.t = 0; n.pet = false;
        this.game.persist();
        GameBase.refreshViews();
        return true;
    },
    /** Сколько питомцев вида не сидят в гнёздах. */
    free(id) {
        const st = this.st, p = this.def(id);
        if (!p) return 0;
        let used = 0;
        for (const n of st.nests) if (n.pet && n.egg === p.egg) used++;
        return Math.max(0, (st.pets[id] || 0) - used);
    },
    placePet(i, id) {
        const st = this.st, n = st.nests[i], p = this.def(id);
        if (!n || n.egg || !p || this.free(id) <= 0) return false;
        n.egg = p.egg; n.cash = 0; n.t = 0; n.pet = true;
        this.game.persist();
        GameBase.refreshViews();
        return true;
    },
    /** Убрать из гнезда: яйцо — в рюкзак с прогрессом с нуля, питомец — в коллекцию. Накопленные деньги выдаются. */
    takeOut(i) {
        const st = this.st, n = st.nests[i];
        if (!n || !n.egg) return false;
        if (!n.pet) this.toBag(n.egg);
        st.money += Math.floor(n.cash);
        n.egg = null; n.cash = 0; n.t = 0; n.pet = false;
        this.game.persist();
        GameBase.refreshViews();
        return true;
    },

    // ------------------------------------------------------------------ питомец рядом

    lootMul() {
        const p = this.st && this.st.companion ? this.def(this.st.companion) : null;
        return p ? 1 + this.BONUS[this.rarityOf(p)] : 1;
    },
    setCompanion(id) {
        this.st.companion = id || null;
        this._dropComp();
        this.game.persist();
    },
    _dropComp() { if (this.comp) { if (this.comp.mesh) this.comp.mesh.dispose(); this.comp = null; } },
    update(dt) {
        const st = this.st, id = st.companion;
        if (id && !st.pets[id]) { st.companion = null; this._dropComp(); return; }
        if (!id) return;
        const g = this.game, pl = g.player;
        let c = this.comp;
        if (!c || !c.mesh || c.mesh.isDisposed() || c.id !== id) {
            this._dropComp();
            const p = this.def(id);
            c = this.comp = { id, p, mesh: this.mesh(p, { scale: 0.8 }), x: pl.pos.x + 1.2, z: pl.pos.z + 1.2, y: pl.pos.y, t: Math.random() * 6, yaw: 0 };
        }
        const d = pl.dir(), l = Math.hypot(d.x, d.z) || 1;
        // позади и чуть сбоку от игрока
        const tx = pl.pos.x - d.x / l * 1.5 - d.z / l * 0.9, tz = pl.pos.z - d.z / l * 1.5 + d.x / l * 0.9;
        const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
        if (dist > 14) { c.x = tx; c.z = tz; c.y = pl.pos.y; }
        const moving = dist > 0.25;
        if (moving) {
            const sp = Math.min(dist * 3.2, 9) * dt;
            c.x += dx / dist * sp; c.z += dz / dist * sp;
            c.yaw = Math.atan2(dx, dz);
        } else c.yaw = Math.atan2(pl.pos.x - c.x, pl.pos.z - c.z);
        const ground = this._groundAt(c.x, c.z, pl.pos.y);
        c.y += (ground - c.y) * Math.min(1, dt * 12);
        c.t += dt * (moving ? 11 : 3);
        const m = c.mesh;
        const lift = c.p.fly ? 0.75 + Math.sin(c.t * 0.5) * 0.12 : (moving ? Math.abs(Math.sin(c.t)) * 0.28 : Math.abs(Math.sin(c.t)) * 0.05);
        m.position.set(c.x, c.y + lift, c.z);
        let dy = c.yaw - m.rotation.y;
        while (dy > Math.PI) dy -= 6.2832;
        while (dy < -Math.PI) dy += 6.2832;
        m.rotation.y += dy * Math.min(1, dt * 8);
    },
    /** Высота земли под точкой: первый сплошной воксель вниз от уровня игрока. */
    _groundAt(x, z, y0) {
        const w = this.game.world, k = 1 / w.vs, cx = Math.floor(x * k), cz = Math.floor(z * k);
        for (let y = Math.floor(y0 * k) + 12; y > Math.floor(y0 * k) - 30; y--) if (y >= 0 && w.get(cx, y, cz)) return (y + 1) * w.vs;
        return y0;
    },

    // ------------------------------------------------------------------ модель и значки

    grid(p) { if (!this._grids[p.id]) this._grids[p.id] = p.art(); return this._grids[p.id]; },
    /** Меш питомца: начало — низ по центру, перед — +Z. */
    mesh(p, opts = {}) {
        const g = this.grid(p), { sx, sy, sz } = g;
        const px = sx + 2, pz = sz + 2, pad = new Uint8Array(px * pz * (sy + 2));
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
            const src = sx * (z + sz * y);
            pad.set(g.data.subarray(src, src + sx), 1 + px * ((z + 1) + pz * (y + 1)));
        }
        const r = VoxMesher.build(pad, sx, sy, sz, -(sx >> 1), 0, -(sz >> 1), 0.1);
        const m = new BABYLON.Mesh('pet-' + p.id, VoxRender.scene);
        VoxRender.applyBuffers(m, r.opaque);
        m.material = VoxRender.mat;
        m.isPickable = false;
        m.receiveShadows = true;
        m.scaling.setAll(this.VOX / 0.1 * (opts.scale || 1));
        VoxRender._casters = [];
        return m;
    },
    /** Значок питомца data URL: изометрия по вокселям, рисуется один раз. locked — чёрный силуэт. */
    thumbUrl(p, locked) {
        const key = p.id + (locked ? '#' : '');
        if (!this._urls[key]) this._urls[key] = this._drawThumb(p, locked).toDataURL('image/png');
        return this._urls[key];
    },
    /** @type {Record<string, string>} */
    _urls: {},
    _drawThumb(p, locked) {
        const g = this.grid(p), { sx, sy, sz } = g, W = 160, H = 160;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const cx = cv.getContext('2d'), span = sx + sz;
        const a = Math.min((W - 8) / span, (H - 8) / (span * 0.5 + sy)), c = a * 0.5, d = a;
        const ox = (W - span * a) / 2 + sz * a, oy = (H - (span * c + sy * d)) / 2 + sy * d;
        const P = (x, y, z) => [ox + (x - z) * a, oy + (x + z) * c - y * d];
        const has = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && g.get(x, y, z);
        const col = (id, k) => {
            if (locked) return k > 1 ? '#23273f' : (k > 0.8 ? '#171a2c' : '#0e101d');
            const e = VoxMat.list[id], q = e ? e.color : [1, 1, 1];
            const f = v => Math.round(255 * Math.min(1, v * k));
            return 'rgb(' + f(q[0]) + ',' + f(q[1]) + ',' + f(q[2]) + ')';
        };
        const quad = (A, B, C, D, fill) => {
            cx.fillStyle = fill; cx.strokeStyle = fill; cx.lineWidth = 0.7;
            cx.beginPath(); cx.moveTo(A[0], A[1]); cx.lineTo(B[0], B[1]); cx.lineTo(C[0], C[1]); cx.lineTo(D[0], D[1]); cx.closePath();
            cx.fill(); cx.stroke();
        };
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
            const v = has(x, y, z);
            if (!v) continue;
            if (!has(x, y + 1, z)) quad(P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1), col(v, 1.08));
            if (!has(x, y, z + 1)) quad(P(x, y + 1, z + 1), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1), P(x, y, z + 1), col(v, 0.9));
            if (!has(x + 1, y, z)) quad(P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1), P(x + 1, y, z), col(v, 0.7));
        }
        return cv;
    },
};
