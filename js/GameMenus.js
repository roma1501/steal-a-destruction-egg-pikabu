// GameMenus.js — окна «Steal a Destruction Egg»: титульный экран, пауза и настройки, «Вылазки», «Арсенал», «Улучшения»,
// окно гнезда, итоги вылазки (с фейерверком), «Пока тебя не было». Вызывает логику: GameBase (покупки, equip, продажа),
// GameRaid.start, Game.backToBase. Пока окно открыто — Pause.set('manual', true), курсор отпущен, экранные кнопки скрыты;
// при закрытии пауза снимается и курсор захватывается снова (жест — клик по кнопке окна). Стили и значки — GameMenusStyle.js.

/** @satisfies {Record<string, any>} */
const GameMenus = {
    /** @type {any} */
    game: null,
    /** @type {any} */
    hud: null,
    /** id открытого окна: '' | 'raids' | 'arsenal' | 'upgrades' | 'nest' | 'results' | 'offline' | 'pause'. */
    cur: '',
    /** @type {HTMLElement | null} */
    ov: null,
    /** @type {HTMLElement | null} */
    win: null,
    /** @type {HTMLElement | null} */
    body: null,
    /** @type {HTMLElement | null} */
    title: null,
    titleOn: false,
    _returnTitle: false,
    _view: 'main',
    _orbit: 0,
    _offlinePending: 0,
    _arTab: 'rifle',
    _arSlot: 0,
    /** @type {any} */
    _raidCache: null,
    _sellT: 0,
    _adT: 0,
    _openedAt: 0,
    _titleLang: '',
    _leaveT: 0,
    /** @type {{ set: (v: number) => void } | null} */
    _mchip: null,
    /** @type {{ el: HTMLElement, to: number, t: number, fmt: (n: number) => string }[]} */
    _counts: [],
    fw: { cv: /** @type {HTMLCanvasElement | null} */ (null), cx: /** @type {CanvasRenderingContext2D | null} */ (null), parts: /** @type {any[]} */ ([]), t: 0, next: 0, color: '#ffd91a', on: false },

    init(game, hud) {
        this.game = game;
        this.hud = hud;
    },

    t(key, params) { return Lang.t(key, params); },
    isOpen() { return !!this.cur || this.titleOn; },
    get st() { return this.game.state; },

    // =====================================================================================
    // Общее: открыть / закрыть окно
    // =====================================================================================

    /**
     * Открыть окно. o: { title, icon, cls, grad: [верх, низ] шапки, ww (ширина), close: false — без крестика, money: чип денег }.
     * fill(body, foot, win) наполняет содержимое.
     */
    _open(id, o, fill) {
        const h = SdeUi.h.bind(SdeUi);
        if (this.cur) this._drop();
        const ov = this.ov = h('div', 'sde-ov');
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        const win = this.win = h('div', 'sde-win' + (o.cls ? ' ' + o.cls : ''));
        if (o.ww) win.style.setProperty('--ww', o.ww + 'px');
        if (o.grad) { win.style.setProperty('--h1', o.grad[0]); win.style.setProperty('--h2', o.grad[1]); }
        const head = h('div', 'sde-head');
        if (o.icon) head.appendChild(SdeUi.icon(o.icon));
        const ttl = h('div', 'sde-title-t', o.titleText || this.t(o.title, o.params));
        head.appendChild(ttl);
        this._mchip = null;
        if (o.money) head.appendChild(this._moneyChip());
        if (o.close !== false) {
            const x = h('button', 'sde-btn w sde-x');
            x.type = 'button';
            x.setAttribute('aria-label', this.t('sde.close'));
            x.appendChild(SdeUi.icon('cross'));
            x.addEventListener('click', () => this.close());
            head.appendChild(x);
        }
        const body = this.body = h('div', 'sde-body');
        const foot = h('div', 'sde-foot');
        foot.hidden = true;
        win.append(head, body, foot);
        ov.appendChild(win);
        document.body.appendChild(ov);
        this.cur = id;
        document.documentElement.classList.add('sde-menu');
        this._lock();
        fill.call(this, body, foot, win, ttl);
        if (!foot.childNodes.length) foot.remove(); else foot.hidden = false;
        this._openedAt = performance.now();
        if (id === 'pause') {
            const first = /** @type {HTMLElement | null} */ (win.querySelector('.sde-body .sde-btn'));
            if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* нет фокуса */ } }
        }
    },

    // Пауза, курсор, экранные кнопки: общее для любого окна.
    _lock() {
        Pause.set('manual', true);
        Input.configure({ controls: false });
        Input.releaseAll();
        Input.release();
        Input.clearContext('sde-use');
    },

    _drop() {
        if (this.cur === 'shop') GameShopUi.closed();
        if (this.ov) this.ov.remove();
        this.ov = this.win = this.body = null;
        this.cur = '';
        this._mchip = null;
        this._counts = [];
        this._stopFw();
    },

    /** Закрыть окно: игра продолжается (или возвращается титул). */
    close(silent) {
        if (!this.cur) return;
        const hud = this.hud;
        this._drop();
        document.documentElement.classList.remove('sde-menu');
        if (this._returnTitle) {
            this._returnTitle = false;
            this.showTitle(true);
            return;
        }
        Pause.set('manual', false);
        Input.configure({ controls: true });
        if (!silent) Input.capture();
        if (hud) { hud._hintSig = ''; }
        if (typeof Platform !== 'undefined' && typeof Platform.gameplay === 'function') Platform.gameplay(true);
    },

    onEsc(code) {
        const c = this.cur;
        if (c === 'pause') {
            if (this._view !== 'main') { this._pauseView('main'); return; }
            this.close();
        } else if (c === 'results') {
            /* итоги закрываются только кнопкой */
        } else if (c) this.close();
    },

    _moneyChip() {
        const h = SdeUi.h.bind(SdeUi);
        const chip = h('div', 'sde-mchip');
        chip.appendChild(SdeUi.icon('money'));
        const v = h('span', '', GameData.money(this.st.money));
        chip.appendChild(v);
        this._mchip = { set: n => { v.textContent = GameData.money(n); } };
        return chip;
    },
    _refreshMoney() { if (this._mchip) this._mchip.set(this.st.money); },

    /** Кнопка: _btn('текст', 'g' | 'b' | 'p' | 'y' | 'r' | 'o' | 'k', fn, { icon, cls }). */
    _btn(text, color, fn, o) {
        const h = SdeUi.h.bind(SdeUi);
        const b = h('button', 'sde-btn ' + (color || 'g') + (o && o.cls ? ' ' + o.cls : ''));
        b.type = 'button';
        if (o && o.icon) b.appendChild(SdeUi.icon(o.icon));
        if (text !== undefined && text !== null) b.appendChild(h('span', '', text));
        if (fn) b.addEventListener('click', e => { try { GameAudio.ui('click'); } catch (er) { /* тишина */ } fn(e, b); });
        return b;
    },

    /** Кнопка покупки за рекламу: просмотры копятся (2/5), между ними общая пауза площадки (16 с). Нет формата — null. */
    _adBuyBtn(kind, id, after) {
        if (!Platform.rewardedSupported()) return null;
        const g = GameBase.adGoal(kind, id);
        const b = this._btn('', 'p', (e, btn) => {
            if (!Platform.rewardedReady()) { this._shake(btn); return; }
            btn.disabled = true;
            GameBase.adStep(kind, id).then(res => {
                if (res === 'done') this.hud.toast('sde.ad.done');
                if (res) { after(); return; }
                btn.disabled = false;
                this._syncAdBuy(btn);
            });
        }, { cls: 'wide sm sd-ad sde-ad-btn', icon: 'play' });
        b.dataset.kind = kind;
        b.dataset.have = String(g.have);
        b.dataset.need = String(g.need);
        b.style.setProperty('--p', String(g.have / g.need));
        b.appendChild(SdeUi.h('i', ''));
        this._syncAdBuy(b);
        if (!this._adSub) {
            this._adSub = true;
            Platform.onRewardedCooldown(() => document.querySelectorAll('.sde-ad-btn').forEach(el => this._syncAdBuy(/** @type {HTMLButtonElement} */ (el))));
        }
        return b;
    },
    _syncAdBuy(b) {
        const wait = Platform.rewardedCooldownLabel();
        b.querySelector('span').textContent = wait || this.t('sde.ad.' + b.dataset.kind, { a: b.dataset.have, b: b.dataset.need });
        b.classList.toggle('off', !!wait);
        b.disabled = !!wait;
    },

    _shake(el) { el.classList.remove('sde-shake'); void el.offsetWidth; el.classList.add('sde-shake'); },

    langChanged() {
        if (this.titleOn && this.title) { this.title.remove(); this.title = null; this.titleOn = false; this.showTitle(); }
        if (this.cur === 'pause') this._pauseView(this._view);
        else if (this.cur === 'raids') this.openRaids();
        else if (this.cur === 'arsenal') this.openArsenal();
        else if (this.cur === 'upgrades') this.openUpgrades();
    },

    // =====================================================================================
    // Титульный экран
    // =====================================================================================

    showTitle(again) {
        const h = SdeUi.h.bind(SdeUi);
        if (this.title && this._titleLang !== Lang.code) { this.title.remove(); this.title = null; }
        if (this.title) { this.title.hidden = false; this.titleOn = true; this._titleKeys(); document.documentElement.classList.add('sde-title-on'); return; }
        this._titleLang = Lang.code;
        const s = this.title = h('section', 'sde-title');
        s.setAttribute('role', 'dialog');
        s.setAttribute('aria-modal', 'true');
        s.setAttribute('aria-label', typeof GAME_TITLE !== 'undefined' ? GAME_TITLE : 'Steal a Destruction Egg');
        s.appendChild(h('div', 'sde-rays'));
        const main = h('div', 'sde-tmain');
        const logo = h('div', 'sde-logo');
        const txt = h('div', 'sde-logo-txt');
        const w = (cls, t) => { const e = h('span', 'sde-lw ' + cls, t); e.dataset.txt = t; return e; };
        const ru = String(GAME_PLATFORM) === 'pikabu';   // Пикабу: название только по-русски
        txt.appendChild(w('a', ru ? 'УКРАДИ' : 'STEAL A'));
        txt.appendChild(w('b', ru ? 'ЯЙЦО' : 'DESTRUCTION'));
        const row = h('div', 'sde-lrow');
        row.appendChild(w('c', ru ? 'РАЗРУШЕНИЯ' : 'EGG'));
        row.appendChild(SdeUi.icon('egg', 'sde-logo-egg'));
        txt.appendChild(row);
        logo.append(txt);
        const btns = h('div', 'sde-tbtn');
        this._titlePlay = this._btn(this.t('sde.play'), 'g', () => this.hud.play(), { cls: 'big', icon: 'play' });
        const set = this._btn(this.t('sde.settings'), 'b', () => { this._returnTitle = true; s.hidden = true; this.titleOn = false; document.documentElement.classList.remove('sde-title-on'); this.openPause('settings', true); }, { cls: 'big' });
        this._titleSet = set;
        btns.append(this._titlePlay, set);
        this._titleKeysEl = h('div', 'sde-tkeys');
        main.append(logo, btns, this._titleKeysEl);
        s.appendChild(main);
        s.appendChild(h('div', 'sde-ver', 'v' + (typeof GAME_VERSION !== 'undefined' ? GAME_VERSION : '')));
        document.body.appendChild(s);
        this.titleOn = true;
        document.documentElement.classList.add('sde-title-on');
        this._titleKeys();
        try { this._titlePlay.focus({ preventScroll: true }); } catch (e) { /* нет фокуса */ }
    },

    _titleKeys() {
        const el = this._titleKeysEl;
        if (!el) return;
        el.textContent = '';
        el.hidden = !!(this.hud && this.hud.touch) || Input.device === 'touch';
        const item = (keys, key) => {
            const s = SdeUi.h('span');
            for (const k of keys) s.appendChild(SdeUi.h('kbd', 'sde-key', k));
            s.appendChild(SdeUi.h('span', '', this.t(key)));
            el.appendChild(s);
        };
        item(['W', 'A', 'S', 'D'], 'sde.k.move');
        item([Input.label('Mouse0')], 'sde.k.fire');
        item(['1', '2', '3'], 'sde.k.weapons');
        item([Input.labelOf('interact', 'keyboard') || 'E'], 'sde.k.act');
    },

    hideTitle() {
        if (this.title) this.title.hidden = true;
        this.titleOn = false;
        document.documentElement.classList.remove('sde-title-on');
    },

    /** «Играть» нажато: показать окна, которые ждали титул. */
    afterTitle() {
        if (this._offlinePending > 0) { const a = this._offlinePending; this._offlinePending = 0; this._openOffline(a); }
    },

    // Камера над базой на титуле: медленный облёт.
    _orbitCam(dt) {
        const cam = VoxRender.camera;
        if (!cam || !cam.rotationQuaternion) return;
        this._orbit += dt * 0.1;
        const g = this.game, vs = g.world.vs, top = (typeof BASE_GROUND !== 'undefined' ? BASE_GROUND : 20) * vs;
        const cx = 25.5, cz = 24.5, R = 24, a = this._orbit + 2.4;
        const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R * 0.92, y = top + 8.5;
        const dx = cx - x, dz = cz - z, dy = top + 1.5 - y;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
        cam.position.set(x, y, z);
        BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, GamePlayer.PITCH_SIGN * pitch, 0, cam.rotationQuaternion);
        cam.fov = 1.0;
    },

    // =====================================================================================
    // Кадр: облёт титула, фейерверк, счётчики итогов
    // =====================================================================================

    update(dt) {
        if (this.cur === 'shop') GameShopUi.step(dt);
        if (this.cur === 'nest') GamePetsUi.step();
        if (this.titleOn) this._orbitCam(dt);
        if (this._counts.length) this._tickCounts(dt);
        if (this.fw.on) this._stepFw(dt);
        if (this._sellT > 0) this._sellT -= dt;
        if (this.cur === 'results' || this.cur === 'nest') { this._adT -= dt; if (this._adT <= 0) { this._adT = 0.5; for (const b of /** @type {NodeListOf<HTMLElement>} */ (this.ov.querySelectorAll('.sd-ad'))) this._syncAdBtn(b); } }
        if (this._leaveT > 0) this._leaveT -= dt;
    },

    _tickCounts(dt) {
        for (const c of this._counts) {
            if (c.t >= 1) continue;
            c.t = Math.min(1, c.t + dt / 0.9);
            const k = 1 - Math.pow(1 - c.t, 3);
            c.el.textContent = c.fmt(Math.round(c.to * k));
        }
    },

    // =====================================================================================
    // Пауза и настройки
    // =====================================================================================

    openPause(view, fromTitle) {
        if (this.cur === 'pause') { this._pauseView(view || 'main'); return; }
        if (this.hud.state !== 'play' && !fromTitle) return;
        this._view = view || 'main';
        this._open('pause', { title: 'sde.pause', icon: 'gear', cls: 'small', grad: ['#b9c4e6', '#566077'], ww: 560 }, (body, foot, win, ttl) => {
            this._pauseFill(body, ttl);
        });
        if (this.hud.state === 'play' && typeof Platform !== 'undefined' && typeof Platform.gameplay === 'function') Platform.gameplay(false);
    },

    _pauseView(v) {
        this._view = v;
        if (!this.body) return;
        const ttl = /** @type {HTMLElement} */ (this.win.querySelector('.sde-title-t'));
        this._pauseFill(this.body, ttl);
    },

    _pauseFill(body, ttl) {
        const h = SdeUi.h.bind(SdeUi), raid = this.game.mode === 'raid', v = this._view;
        body.textContent = '';
        ttl.textContent = this.t(v === 'settings' ? 'sde.settings' : v === 'leave' ? 'sde.leave.title' : 'sde.pause');
        const play = this.hud.state === 'play';
        if (v === 'main') {
            const m = h('div', 'sde-menu');
            m.appendChild(this._btn(this.t('sde.continue'), 'g', () => this.close(), { cls: 'big', icon: 'play' }));
            m.appendChild(this._btn(this.t('sde.settings'), 'b', () => this._pauseView('settings'), { icon: 'gear' }));
            m.appendChild(this._btn(this.t('sde.howto'), 'y', () => { this.close(); this.hud._tutSkipBase = false; this.hud._tutPending = 'replay'; }, { icon: 'question' }));
            if (raid && play) m.appendChild(this._btn(this.t('sde.toBase'), 'r', () => this._pauseView('leave'), { icon: 'home' }));
            body.appendChild(m);
        } else if (v === 'leave') {
            body.appendChild(h('p', 'sde-confirm', this.t('sde.leave.text')));
            const m = h('div', 'sde-menu');
            m.appendChild(this._btn(this.t('sde.leave.stay'), 'g', () => this._pauseView('main'), { cls: 'big' }));
            m.appendChild(this._btn(this.t('sde.leave.go'), 'r', () => {
                this.close(true);
                if (typeof GameRaid !== 'undefined' && GameRaid.phase !== 'done') GameRaid.aborted = true, GameRaid.finish(false);
            }, { icon: 'skull' }));
            body.appendChild(m);
        } else this._settingsFill(body);
        if (v === 'settings') {
            const fromTitle = this._returnTitle;
            const back = this._btn(this.t(fromTitle ? 'sde.close' : 'sde.back'), 'k', () => { if (fromTitle) this.close(); else this._pauseView('main'); }, { cls: 'wide' });
            back.style.marginTop = '12px';
            body.appendChild(back);
        }
    },

    _settingsFill(body) {
        const h = SdeUi.h.bind(SdeUi), st = this.st;
        const wrap = h('div', 'sde-set');
        const row = (labelKey) => { const r = h('div', 'sde-sr'); r.appendChild(h('div', 'lb', this.t(labelKey))); wrap.appendChild(r); return r; };
        // звук
        const rs = row('sde.set.sound');
        const sound = this._btn('', 'g', () => { Sound.toggleMuted(); syncSound(); }, { cls: 'sm' });
        const syncSound = () => { const on = !Sound.muted; sound.className = 'sde-btn sm ' + (on ? 'g' : 'k'); sound.querySelector('span').textContent = this.t(on ? 'sde.on' : 'sde.off'); };
        syncSound();
        rs.appendChild(sound);
        // музыка: Game.state.musicOn (не задано = включена), GameAudio.setMusicOn(bool)
        const rm = row('sde.set.music');
        const music = this._btn('', 'g', () => {
            st.musicOn = st.musicOn === false;
            if (typeof GameAudio !== 'undefined' && typeof /** @type {any} */ (GameAudio).setMusicOn === 'function') /** @type {any} */ (GameAudio).setMusicOn(st.musicOn);
            this.game.persist();
            syncMusic();
        }, { cls: 'sm' });
        const syncMusic = () => { const on = st.musicOn !== false; music.className = 'sde-btn sm ' + (on ? 'g' : 'k'); music.querySelector('span').textContent = this.t(on ? 'sde.on' : 'sde.off'); };
        syncMusic();
        rm.appendChild(music);
        // графика
        const rq = row('sde.set.quality');
        const seg = h('div', 'sde-seg');
        const qNow = () => (typeof VoxRender !== 'undefined' && VoxRender.quality) || st.quality || 'high';
        const qb = {};
        const syncQ = () => { for (const k in qb) qb[k].classList.toggle('on', k === qNow()); };
        for (const q of ['low', 'medium', 'high']) {
            const b = qb[q] = this._btn(this.t('sde.q.' + q), 'g', () => {
                if (typeof VoxRender !== 'undefined' && VoxRender.setQuality) VoxRender.setQuality(q);
                st.quality = q;
                this.game.persist();
                syncQ();
            }, { cls: 'sm' });
            seg.appendChild(b);
        }
        syncQ();
        rq.appendChild(seg);
        // чувствительность
        const rv = row('sde.set.sens');
        const sw = h('div', 'sde-sens');
        const range = /** @type {HTMLInputElement} */ (h('input', 'sde-range'));
        range.type = 'range'; range.min = '0.3'; range.max = '2.5'; range.step = '0.05';
        range.setAttribute('aria-label', this.t('sde.set.sens'));
        const out = h('output');
        const syncS = () => { const v = st.sens || 1; range.value = String(v); range.style.setProperty('--p', ((v - 0.3) / 2.2 * 100).toFixed(1) + '%'); out.textContent = '×' + v.toFixed(2); };
        range.addEventListener('input', () => { st.sens = Math.round(parseFloat(range.value) * 100) / 100; syncS(); });
        range.addEventListener('change', () => this.game.persist());
        syncS();
        sw.append(range, out);
        rv.appendChild(sw);
        body.appendChild(wrap);
    },

    // =====================================================================================
    // Вылазки
    // =====================================================================================

    openRaids() {
        const h = SdeUi.h.bind(SdeUi), st = this.st;
        this._open('raids', { title: 'sde.raids.title', icon: 'radar', grad: ['#ff9a8a', '#d6232d'], ww: 1060, money: true }, (body) => {
            body.appendChild(h('p', 'sde-sub', this.t('sde.raids.sub')));
            body.appendChild(this._loadoutBar(true));
            const total = RAIDS.length, open = Math.min(total, st.raidOpen || 1);
            const info = h('div', 'sde-rinfo');
            info.appendChild(SdeUi.icon('radar'));
            info.appendChild(h('span', '', this.t('sde.raids.progress', { n: open, m: total })));
            const cur = this._btn(this.t('sde.raids.toCurrent'), 'y', () => this._scrollToRaid(true), { cls: 'sm' });
            info.appendChild(cur);
            body.appendChild(info);
            body.appendChild(this._raidGrid());
            this._scrollToRaid(false);
        });
    },

    // Прокрутить сетку к последней открытой вылазке (индекс raidOpen − 1).
    _scrollToRaid(smooth) {
        const C = this._raidCache, body = this.body;
        if (!C || !body) return;
        const i = Math.max(0, Math.min(C.cards.length - 1, (this.st.raidOpen || 1) - 1));
        const el = C.cards[i].card;
        const top = el.offsetTop - Math.max(0, (body.clientHeight - el.offsetHeight) / 2);
        if (smooth && body.scrollTo) body.scrollTo({ top, behavior: 'smooth' }); else body.scrollTop = top;
    },

    // Сетка карточек строится один раз (на язык): окно только обновляет замки и счётчики, без пересборки сотни карточек.
    _raidGrid() {
        const key = Lang.code + '|' + RAIDS.length;
        let C = this._raidCache;
        if (!C || C.key !== key) {
            const h = SdeUi.h.bind(SdeUi);
            const grid = h('div', 'sde-rgrid');
            const cards = [];
            RAIDS.forEach((r, i) => { const c = this._raidCard(r, i); grid.appendChild(c.card); cards.push(c); });
            grid.addEventListener('click', e => {
                const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.sde-btn[data-raid]'));
                if (b && !b.classList.contains('off')) { try { GameAudio.ui('click'); } catch (er) { /* тишина */ } this._startRaid(b.dataset.raid); }
            });
            C = this._raidCache = { key, grid, cards };
        }
        const st = this.st, open = st.raidOpen || 1;
        C.cards.forEach((c, i) => {
            const isOpen = i < open;
            if (c.open !== isOpen) {
                c.open = isOpen;
                c.card.classList.toggle('locked', !isOpen);
                c.go.classList.toggle('off', !isOpen);
                c.go.disabled = !isOpen;
                c.lock.hidden = isOpen;
            }
            const done = st.raidsDone[RAIDS[i].id] || 0;
            if (c.done !== done) { c.done = done; c.doneEl.hidden = !done; c.doneEl.textContent = '×' + done; }
            c.card.classList.toggle('cur', i === open - 1 && open < RAIDS.length + 1);
        });
        return C.grid;
    },

    // Полоса хотбара: что возьмёшь с собой (в окне вылазок — напоминание и кнопка «Арсенал»; в арсенале — выбор слота).
    _loadoutBar(remind) {
        const h = SdeUi.h.bind(SdeUi), G = this.game, st = this.st;
        const bar = h('div', 'sde-bar');
        bar.appendChild(h('div', 'lab', this.t(remind ? 'sde.bar.yours' : 'sde.bar.slots')));
        const n = GameBase.slots();
        for (let i = 0; i < n; i++) {
            const id = st.loadout[i], w = id ? GameData.weapon(id) : null;
            const b = h('button', 'sde-hb' + (!remind && i === this._arSlot ? ' sel' : ''));
            b.type = 'button';
            b.appendChild(h('span', 'n', String(i + 1)));
            if (w) b.appendChild(SdeUi.weaponTile(w)); else b.appendChild(h('span', 'plus', '+'));
            if (remind) b.style.cursor = 'default';
            else {
                b.addEventListener('click', () => { this._arSlot = i; this._renderArsenal(); });
                if (w && st.loadout.length > 1) {
                    const rm = h('span', 'rm', '×');
                    rm.setAttribute('role', 'button');
                    rm.addEventListener('click', e => { e.stopPropagation(); GameBase.equip(i, null); this._renderArsenal(); });
                    b.appendChild(rm);
                }
            }
            bar.appendChild(b);
        }
        if (remind) {
            const tip = h('div', 'sde-info', this.t('sde.raids.tip'));
            tip.style.flex = '1 1 160px';
            tip.style.minWidth = '140px';
            bar.appendChild(tip);
            bar.appendChild(this._btn(this.t('sde.btn.arsenal'), 'b', () => this.openArsenal(), { cls: 'sm', icon: 'shop' }));
        }
        void G;
        return bar;
    },

    _raidCard(r, i) {
        const h = SdeUi.h.bind(SdeUi);
        const card = h('div', 'sde-rc locked');
        const hd = h('div', 'hd');
        hd.appendChild(h('span', 'num', '№' + (r.n || i + 1)));
        hd.appendChild(h('div', 'nm', GameData.label(r)));
        const doneEl = h('b', 'dn', '');
        doneEl.hidden = true;
        hd.appendChild(doneEl);
        card.appendChild(hd);
        // сложность: до 10 звёзд (залитые — по полю stars)
        const stars = h('div', 'sde-st10');
        stars.style.setProperty('--n', String(Math.min(10, r.stars || 1)));
        stars.title = this.t('sde.raids.diff');
        stars.append(h('b'), h('i'));
        card.appendChild(stars);
        // время суток, погода, босс
        const chips = h('div', 'chips');
        if (r.sky) chips.appendChild(this._chip(r.sky, 'sde.sky.' + r.sky));
        if (r.weather && r.weather !== 'clear') chips.appendChild(this._chip(r.weather, 'sde.weather.' + r.weather));
        if (r.boss) chips.appendChild(this._chip('boss', 'sde.raids.boss'));
        card.appendChild(chips);
        // шансы редкости яйца
        const odds = h('div', 'sde-odds');
        const leg = h('div', 'sde-leg');
        r.odds.forEach((p, k) => {
            if (p <= 0) return;
            const seg = h('i');
            seg.style.width = p + '%';
            seg.style.background = RARITIES[k].color;
            odds.appendChild(seg);
            const l = h('span', '', GameData.label(RARITIES[k]) + ' ' + p + '%');
            l.style.setProperty('--rc', RARITIES[k].color);
            leg.appendChild(l);
        });
        card.append(odds, leg);
        const info = h('div', 'sde-info');
        info.appendChild(SdeUi.icon('bonus'));
        info.appendChild(h('span', '', this.t('sde.raids.bonus')));
        info.appendChild(h('b', '', GameData.money(r.bonus)));
        card.appendChild(info);
        const go = this._btn(this.t('sde.raids.go'), 'g', null, { cls: 'wide sm off', icon: 'play' });
        go.dataset.raid = r.id;
        go.disabled = true;
        card.appendChild(go);
        const lock = h('div', 'sde-lockov');
        lock.appendChild(SdeUi.icon('lock'));
        lock.appendChild(h('span', '', i > 0 ? this.t('sde.raids.locked', { name: GameData.raidTitle ? GameData.raidTitle(RAIDS[i - 1]) : GameData.label(RAIDS[i - 1]) }) : ''));
        card.appendChild(lock);
        return { card, go, lock, doneEl, open: false, done: -1 };
    },

    // Чип с глифом: время суток, погода, босс.
    _chip(kind, key) {
        const c = SdeUi.h('span', 'sde-ch ' + kind);
        c.innerHTML = SDE_GLYPH[kind] || '';
        c.appendChild(document.createTextNode(this.t(key)));
        return c;
    },

    _startRaid(id) {
        this.close();
        GameRaid.start(id);
    },

    // =====================================================================================
    // Арсенал
    // =====================================================================================

    openArsenal() {
        const st = this.st;
        if (this._arSlot >= GameBase.slots()) this._arSlot = 0;
        if (!this.cur || this.cur !== 'arsenal') {
            const cur = GameTools.current;
            this._arSlot = Math.min(cur, GameBase.slots() - 1);
        }
        this._open('arsenal', { title: 'sde.arsenal.title', icon: 'shop', grad: ['#8adcff', '#1f68d8'], ww: 1060, money: true }, () => {
            this._renderArsenal(true);
        });
        void st;
    },

    _renderArsenal(first) {
        if (!this.body || this.cur !== 'arsenal') return;
        const h = SdeUi.h.bind(SdeUi), st = this.st, body = this.body;
        const top = body.scrollTop;
        body.textContent = '';
        body.appendChild(this._loadoutBar(false));
        const tabs = h('div', 'sde-tabs');
        for (const c of WEAPON_CATS) {
            const b = this._btn(GameData.label(c), 'b', () => { this._arTab = c.id; this._renderArsenal(); }, { cls: 'sde-tab' + (c.id === this._arTab ? ' on' : '') });
            tabs.appendChild(b);
        }
        body.appendChild(tabs);
        const grid = h('div', 'sde-grid');
        grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(clamp(250px,30vw,320px),1fr))';
        for (const w of WEAPONS) if (w.cat === this._arTab) grid.appendChild(this._weaponCard(w));
        body.appendChild(grid);
        this._refreshMoney();
        if (!first) body.scrollTop = top;
        void st;
    },

    _stat(label, val, txt, cls) {
        const h = SdeUi.h.bind(SdeUi);
        const f = document.createDocumentFragment();
        f.appendChild(h('span', '', label));
        const tr = h('div', 'tr'), i = h('i', cls || '');
        i.style.width = Math.max(4, Math.min(100, val * 100)) + '%';
        tr.appendChild(i);
        f.appendChild(tr);
        f.appendChild(h('em', '', txt));
        return f;
    },

    // Цифры и полоски характеристик берутся из таблицы WEAPONS (урон за выстрел, выстрелов в секунду, магазин).
    _wstats(w) {
        const k = w.kind;
        let d = 0, dtxt = '—';
        if (k === 'pellets') { d = w.dmg * w.pellets; dtxt = w.dmg + '×' + w.pellets; }
        else if (k === 'proj' || k === 'bomb' || k === 'hole') {
            const b = w.blast || 2;
            d = w.saw ? w.dmg : b * b * 18 * (w.cluster ? 1.6 : 1);
            dtxt = w.saw ? String(w.dmg) : (w.cluster ? w.cluster + '× ' : '') + 'R' + (w.bomblet && w.cluster ? w.bomblet : b) + this.t('sde.m');
        } else if (k === 'tesla') { d = w.dmg * (1 + (w.chain || 0) * 0.5); dtxt = w.dmg + '×' + (1 + (w.chain || 0)); }
        else if (k === 'freeze') { d = 16; dtxt = this.t('sde.kind.freeze'); }
        else if (k === 'grab') { d = 0; dtxt = '—'; }
        else if (w.dmg) { d = w.dmg; dtxt = String(w.dmg); }
        const rate = w.rate ? (w.burst ? w.burst / w.rate : 1 / w.rate) : 0;
        const dv = d > 0 ? Math.sqrt(Math.min(1, d / 340)) : 0.04;
        const rv = Math.sqrt(Math.min(1, rate / 24));
        const mv = w.mag ? Math.sqrt(Math.min(1, w.mag / 220)) : 1;
        return { dv, dtxt, rv, rtxt: rate > 0 ? (rate >= 10 ? Math.round(rate) : rate.toFixed(1)) + this.t('sde.perSec') : '—', mv, mtxt: w.mag ? String(w.mag) : '∞' };
    },

    _weaponCard(w) {
        const h = SdeUi.h.bind(SdeUi), st = this.st, owned = GameBase.owns(w.id);
        const at = st.loadout.indexOf(w.id), slot = this._arSlot;
        const card = h('div', 'sde-wcard' + (at >= 0 ? ' eq' : ''));
        const ic = SdeUi.weaponTile(w, 'ic');
        card.appendChild(ic);
        const mid = h('div', 'mid');
        mid.appendChild(h('h3', '', GameData.label(w)));
        const tags = h('div', 'sde-tags');
        tags.appendChild(h('span', 'sde-tg', this.t('sde.kind.' + w.kind)));
        if (w.kind !== 'melee' && w.kind !== 'grab') tags.appendChild(h('span', 'sde-tg', this.t(w.auto ? 'sde.auto' : 'sde.semi')));
        if (w.burst) tags.appendChild(h('span', 'sde-tg', this.t('sde.burst', { n: w.burst })));
        mid.appendChild(tags);
        const s = this._wstats(w), grid = h('div', 'sde-st');
        grid.append(this._stat(this.t('sde.stat.dmg'), s.dv, s.dtxt), this._stat(this.t('sde.stat.rate'), s.rv, s.rtxt, 'b'), this._stat(this.t('sde.stat.mag'), s.mv, s.mtxt, 'g'));
        mid.appendChild(grid);
        card.appendChild(mid);
        const act = h('div', 'act');
        if (owned) {
            if (at === slot) {
                const b = this._btn(this.t('sde.inSlot', { n: slot + 1 }), 'g', null, { cls: 'wide sm', icon: 'check' });
                b.classList.add('off'); b.disabled = true;
                act.appendChild(b);
            } else {
                act.appendChild(this._btn(this.t(at >= 0 ? 'sde.moveSlot' : 'sde.takeSlot', { n: slot + 1 }), 'b', () => { this._equipTo(slot, w.id); this._renderArsenal(); }, { cls: 'wide sm' }));
            }
        } else {
            const can = st.money >= w.price;
            const b = this._btn(this.t('sde.buy') + ' ' + GameData.money(w.price), can ? 'g' : 'k', (e, btn) => {
                if (!GameBase.buyWeapon(w.id)) { this._shake(btn); this.hud.toast('sde.noMoney'); return; }
                this._renderArsenal();
            }, { cls: 'wide sm' + (can ? '' : ' off') });
            act.appendChild(b);
            if (!can) act.appendChild(h('span', 'sde-need', this.t('sde.need', { p: GameData.money(w.price - st.money) })));
            const ad = this._adBuyBtn('weapon', w.id, () => this._renderArsenal());
            if (ad) act.appendChild(ad);
        }
        card.appendChild(act);
        return card;
    },

    // «Взять в слот»: оружие встаёт ВМЕСТО того, что в слоте (GameBase.equip вставляет, поэтому старое сперва убираем).
    _equipTo(i, id) {
        const lo = this.st.loadout;
        if (lo[i] === id) return;
        if (lo.indexOf(id) >= 0) { GameBase.equip(i, id); return; }
        if (i >= lo.length) { GameBase.equip(lo.length, id); return; }
        if (lo.length > 1) { GameBase.equip(i, null); GameBase.equip(i, id); return; }
        GameBase.equip(0, id);              // единственное оружие заменяется: сперва новое, затем убираем прежнее
        GameBase.equip(1, null);
    },

    // =====================================================================================
    // Улучшения и покупка гнезда
    // =====================================================================================

    openUpgrades() {
        this._open('upgrades', { title: 'sde.up.title', icon: 'up', grad: ['#8bff8f', '#16a835'], ww: 880, money: true }, () => {
            this._renderUpgrades(true);
        });
    },

    _upVals(u) {
        const l = GameBase.upgradeLevel(u.id), n = Math.min(u.max, l + 1);
        const f = (lv) => {
            if (u.id === 'hp') return String(PLAYER_BASE.hp + lv * u.per);
            if (u.id === 'speed') return '+' + Math.round(lv * u.per * 100) + '%';
            if (u.id === 'armor') return '−' + Math.round(lv * u.per * 100) + '%';
            if (u.id === 'slots') return String(PLAYER_BASE.slots + lv * u.per);
            if (u.id === 'loot') return '+' + Math.round(lv * u.per * 100) + '%';
            return String(lv * u.per);
        };
        return [f(l), f(n)];
    },

    _renderUpgrades(first) {
        if (!this.body || this.cur !== 'upgrades') return;
        const h = SdeUi.h.bind(SdeUi), st = this.st, body = this.body, top = body.scrollTop;
        body.textContent = '';
        body.appendChild(h('p', 'sde-sub', this.t('sde.up.sub')));
        const grid = h('div', 'sde-grid');
        grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(clamp(250px,36vw,380px),1fr))';
        // новое гнездо
        const nn = st.nests.length, maxN = NESTS.max;
        const nc = h('div', 'sde-ucard nest');
        nc.appendChild(SdeUi.icon('nests', 'ic'));
        const nm = h('div', 'mid');
        nm.appendChild(h('h3', '', this.t('sde.nest.new')));
        nm.appendChild(h('div', 'ds', this.t('sde.nest.count', { n: nn, m: maxN })));
        const pips = h('div', 'sde-pips');
        const show = Math.min(maxN, 18);
        for (let i = 0; i < show; i++) pips.appendChild(h('i', i < nn ? 'on' : ''));
        nm.appendChild(pips);
        nc.appendChild(nm);
        const nact = h('div', 'act');
        if (nn >= maxN) {
            const b = this._btn(this.t('sde.max'), 'k', null, { cls: 'wide sm off' }); b.disabled = true; nact.appendChild(b);
        } else {
            const price = GameBase.nestPrice(), can = st.money >= price;
            nact.appendChild(this._btn(this.t('sde.buy') + ' ' + GameData.money(price), can ? 'y' : 'k', (e, btn) => {
                if (!GameBase.buyNest()) { this._shake(btn); this.hud.toast('sde.noMoney'); return; }
                this._settle();
                this._renderUpgrades();
            }, { cls: 'wide sm' + (can ? '' : ' off') }));
            if (!can) {
                nact.appendChild(h('span', 'sde-need', this.t('sde.need', { p: GameData.money(price - st.money) })));
                const ad = this._adBuyBtn('nest', '', () => { this._settle(); this._renderUpgrades(); });
                if (ad) nact.appendChild(ad);
            }
        }
        nc.appendChild(nact);
        grid.appendChild(nc);
        // улучшения игрока
        for (const u of UPGRADES) {
            const lvl = GameBase.upgradeLevel(u.id), maxed = lvl >= u.max;
            const c = h('div', 'sde-ucard');
            c.appendChild(SdeUi.icon(u.icon, 'ic'));
            const mid = h('div', 'mid');
            mid.appendChild(h('h3', '', GameData.label(u)));
            mid.appendChild(h('div', 'ds', this.t('sde.up.' + u.id)));
            const [a, b] = this._upVals(u);
            mid.appendChild(h('div', 'sde-info', maxed ? a : a + ' → ' + b));
            const pp = h('div', 'sde-pips');
            for (let i = 0; i < u.max; i++) pp.appendChild(h('i', i < lvl ? 'on' : ''));
            mid.appendChild(pp);
            c.appendChild(mid);
            const act = h('div', 'act');
            if (maxed) { const mb = this._btn(this.t('sde.max'), 'k', null, { cls: 'wide sm off' }); mb.disabled = true; act.appendChild(mb); }
            else {
                const price = GameBase.upgradePrice(u.id), can = st.money >= price;
                act.appendChild(this._btn(this.t('sde.buy') + ' ' + GameData.money(price), can ? 'g' : 'k', (e, btn) => {
                    if (!GameBase.buyUpgrade(u.id)) { this._shake(btn); this.hud.toast('sde.noMoney'); return; }
                    this._renderUpgrades();
                }, { cls: 'wide sm' + (can ? '' : ' off') }));
                if (!can) {
                    act.appendChild(h('span', 'sde-need', this.t('sde.need', { p: GameData.money(price - st.money) })));
                    const ad = this._adBuyBtn('upgrade', u.id, () => this._renderUpgrades());
                    if (ad) act.appendChild(ad);
                }
            }
            c.appendChild(act);
            grid.appendChild(c);
        }
        body.appendChild(grid);
        this._refreshMoney();
        if (!first) body.scrollTop = top;
    },

    // Принесённое яйцо без места встаёт в гнездо, как только оно появилось (покупка гнезда, продажа яйца).
    _settle() {
        const G = this.game, st = this.st;
        if (!st.pendingEgg || typeof G._settleEgg !== 'function') return;
        const had = st.pendingEgg;
        G._settleEgg();
        if (!st.pendingEgg && had) this.hud.toast('sde.eggPlaced');
    },

    // =====================================================================================
    // Гнездо
    // =====================================================================================

    openNest(i) {
        const h = SdeUi.h.bind(SdeUi), st = this.st, n = st.nests[i];
        if (!n || !n.egg) return;
        const def = GameData.egg(n.egg);
        if (!def) return;
        const r = RARITIES[def.rarity];
        this._sellT = 0;
        this._open('nest', { title: 'sde.nest.title', params: { n: i + 1 }, icon: 'nests', grad: ['#e19bff', '#7a2fd0'], ww: 560, money: true }, (body, foot, win) => {
            win.style.setProperty('--rc', r.color);
            const box = h('div', 'sde-nest');
            box.style.setProperty('--rc', r.color);
            const left = h('div', 'l'), right = h('div', 'r');
            const eg = h('div', 'eg');
            eg.appendChild(SdeUi.eggImg(def));
            left.appendChild(eg);
            const nm = h('div', 'nm sde-f', GameData.label(def));
            nm.style.cssText = 'font:400 clamp(18px,3.4vh,28px)/1.05 var(--sde-font);text-shadow:var(--ol3);text-transform:uppercase';
            left.appendChild(nm);
            const rb = h('div', 'sde-ribbon', GameData.label(r));
            rb.style.setProperty('--rc', r.color);
            left.appendChild(rb);
            box.appendChild(left);
            const rows = h('div', 'sde-rows');
            const row = (icon, key, val, cls) => { const w = h('div', 'sde-rw' + (cls ? ' ' + cls : '')); w.appendChild(SdeUi.icon(icon)); w.appendChild(h('span', '', this.t(key))); w.appendChild(h('b', '', val)); rows.appendChild(w); };
            row('bolt', 'sde.nest.income', '+' + GameData.money(def.income) + this.t('sde.perSec'));
            row('cash', 'sde.nest.stored', GameData.money(Math.floor(n.cash)));
            row('money', 'sde.nest.sell', GameData.money(GameBase.sellPrice(i) + Math.floor(n.cash)), 'tot');
            right.appendChild(rows);
            right.appendChild(h('p', 'sde-sub', this.t('sde.nest.tip')));
            box.appendChild(right);
            body.appendChild(box);
            const sell = this._btn(this.t('sde.sell'), 'o', (e, btn) => {
                if (this._sellT <= 0) { this._sellT = 3; btn.querySelector('span').textContent = this.t('sde.sell.sure'); btn.classList.add('r'); btn.classList.remove('o'); return; }
                const got = GameBase.sellPrice(i) + Math.floor(n.cash);
                if (GameBase.sellEgg(i)) { this.close(); this.hud.toast('sde.sold', { p: GameData.money(got) }); this._settle(); }
            }, { icon: 'money' });
            foot.append(sell, this._btn(this.t('sde.close'), 'k', () => this.close()));
        });
    },

    // =====================================================================================
    // Итоги вылазки
    // =====================================================================================

    showResults(res) {
        const h = SdeUi.h.bind(SdeUi), ok = !!res.ok;
        this._leaveT = 0;
        const total = res.loot + res.bonus + res.dmgBonus;
        const def = res.egg;
        this._open('results', { title: ok ? 'sde.res.win' : 'sde.res.lose', icon: ok ? 'trophy' : 'skull', cls: ok ? 'win' : 'lose', ww: 780, close: false, money: true }, (body, foot, win) => {
            const wrap = h('div', 'sde-res');
            const egg = h('div', 'egg' + (ok ? '' : ' lost'));
            const eg = h('div', 'eg');
            if (ok && def) {
                const r = RARITIES[def.rarity];
                egg.style.setProperty('--rc', r.color);
                eg.appendChild(SdeUi.eggImg(def));
                egg.appendChild(eg);
                egg.appendChild(h('div', 'nm', GameData.label(def)));
                const rb = h('div', 'sde-ribbon', GameData.label(r));
                rb.style.setProperty('--rc', r.color);
                egg.appendChild(rb);
                egg.appendChild(h('div', 'ic', '+' + GameData.money(def.income) + this.t('sde.perSec')));
                this._startFw(r.color);
            } else {
                egg.style.setProperty('--rc', '#ff3b3b');
                eg.appendChild(SdeUi.icon('skull', 'skull'));
                egg.appendChild(eg);
                egg.appendChild(h('div', 'nm', this.t('sde.res.eggLost')));
            }
            wrap.appendChild(egg);
            const stack = h('div', 'sde-stack');
            const rows = h('div', 'sde-rows');
            rows.style.width = '100%';
            const row = (icon, key, val, cls) => {
                const w = h('div', 'sde-rw' + (cls ? ' ' + cls : ''));
                w.appendChild(SdeUi.icon(icon));
                w.appendChild(h('span', '', this.t(key)));
                const b = h('b', '', '+' + GameData.money(0));
                w.appendChild(b);
                rows.appendChild(w);
                const cnt = { el: b, to: val, t: 0, fmt: n => '+' + GameData.money(n) };
                this._counts.push(cnt);
                return { w, b, cnt };
            };
            row('money', ok ? 'sde.res.loot' : 'sde.res.lootHalf', res.loot);
            if (ok) row('bonus', 'sde.res.bonus', res.bonus);
            row('fire', ok ? 'sde.res.damage' : 'sde.res.damageHalf', res.dmgBonus);
            const totRow = row('trophy', 'sde.res.total', total, 'tot');
            stack.appendChild(rows);
            const m = Math.floor(res.time / 60), s = Math.floor(res.time % 60);
            const meta = h('div', 'sde-info');
            meta.appendChild(SdeUi.icon('skull'));
            meta.appendChild(h('span', '', this.t('sde.res.kills', { n: res.kills })));
            const tm = h('span', '', ' · ' + this.t('sde.res.time') + ' ' + m + ':' + (s < 10 ? '0' : '') + s);
            meta.appendChild(SdeUi.icon('timer'));
            meta.appendChild(tm);
            stack.appendChild(meta);
            if (ok && res.unlocked) {
                const u = h('div', 'sde-unl');
                u.appendChild(SdeUi.icon('star'));
                u.appendChild(h('span', '', this.t('sde.res.unlocked', { name: GameData.label(res.unlocked) })));
                stack.appendChild(u);
            }
            if (ok && res.placed === false) {
                const wn = h('div', 'sde-warn');
                wn.appendChild(SdeUi.icon('nests'));
                wn.appendChild(h('span', '', this.t('sde.res.noNest')));
                stack.appendChild(wn);
            } else if (ok) {
                const info = h('div', 'sde-info');
                info.appendChild(SdeUi.icon('check'));
                info.appendChild(h('span', '', this.t('sde.res.placed')));
                stack.appendChild(info);
            } else {
                stack.appendChild(h('p', 'sde-sub', this.t('sde.res.loseText')));
            }
            wrap.appendChild(stack);
            body.appendChild(wrap);
            // «за рекламу»: воскрешение после гибели и удвоение награды после выноса (rewarded; нет формата — кнопок нет)
            const rewardedOk = typeof Platform !== 'undefined' && typeof Platform.rewardedSupported === 'function' && Platform.rewardedSupported();
            if (rewardedOk && !ok && res.canRevive) {
                foot.appendChild(this._adBtn('revive', 'sde.res.reviveBtn', 'sde.res.reviveSub', 'y', async (btn) => {
                    if (!GameRaid.reviveOffered || !GameRaid.reviveOffered()) return false;
                    if (!(await Platform.rewarded('revive'))) return false;
                    this.close();
                    GameRaid.revive();
                    return true;
                }));
            }
            if (rewardedOk && ok && res.canDouble) {
                foot.appendChild(this._adBtn('double', 'sde.res.doubleBtn', 'sde.res.doubleSub', 'y', async (btn) => {
                    if (!(await Platform.rewarded('double'))) return false;
                    const add = GameRaid.doubleReward(res);
                    if (!(add > 0)) return false;
                    // итог удваивается на глазах, значок рядом с суммой
                    totRow.cnt.to = total * 2; totRow.cnt.t = 0;
                    totRow.w.querySelector('span').textContent = this.t('sde.res.totalX2');
                    this._refreshMoney();
                    this.hud.toast('sde.res.doubled');
                    btn.classList.add('off'); btn.disabled = true;
                    btn.querySelector('span').textContent = this.t('sde.res.doubled');
                    const sub = btn.querySelector('small'); if (sub) sub.remove();
                    return true;
                }));
            }
            foot.appendChild(this._btn(this.t('sde.toBase'), 'g', () => this._toBase(), { cls: 'big', icon: 'home' }));
        });
    },

    // Кнопка «за рекламу»: класс sd-ad (Game._bindUiAds не вешает на неё свою рекламу), два слоя текста, «Через N с» на паузе
    // между rewarded. run(btn) -> Promise<bool>: true — награда выдана; false — реклама не показана, кнопка снова доступна.
    _adBtn(kind, titleKey, subKey, color, run) {
        const b = this._btn(this.t(titleKey), color, null, { cls: 'sd-ad sde-resad', icon: 'play' });
        b.appendChild(SdeUi.h('small', '', this.t(subKey)));
        b.dataset.ad = kind;
        b.dataset.sub = subKey;
        let busy = false;
        b.addEventListener('click', async () => {
            if (busy || b.disabled || b.classList.contains('off')) return;
            busy = true;
            b.classList.add('off');
            let done = false;
            try { done = await run(b); } catch (e) { console.warn('GameMenus.ad:', e); }
            busy = false;
            if (!done && b.isConnected) { b.classList.remove('off'); this.hud.toast('sde.res.adFail'); }
        });
        this._syncAdBtn(b);
        return b;
    },

    // Подпись кнопки рекламы: пока идёт пауза между rewarded — «Через N с» и кнопка неактивна.
    _syncAdBtn(b) {
        const left = typeof Platform.rewardedCooldownLeft === 'function' ? Platform.rewardedCooldownLeft() : 0;
        const sub = b.querySelector('small');
        if (left > 0) {
            b.classList.add('off');
            if (sub) sub.textContent = typeof Platform.rewardedCooldownLabel === 'function' ? Platform.rewardedCooldownLabel() : '';
            b.dataset.wait = '1';
        } else if (b.dataset.wait) {
            delete b.dataset.wait;
            if (!b.disabled) b.classList.remove('off');
            if (sub) sub.textContent = this.t(b.dataset.sub || '');
        }
    },

    _toBase() {
        if (performance.now() - this._openedAt < 900) return;   // случайные щелчки при гибели не пропускают итоги
        const G = this.game;
        try { G.backToBase(); } catch (e) { console.warn('GameMenus.backToBase:', e); }
        this.close(true);
    },

    // =====================================================================================
    // «Пока тебя не было»
    // =====================================================================================

    offline(amount) {
        if (!(amount > 0)) return;
        if (this.hud.state !== 'play') { this._offlinePending = amount; return; }
        this._openOffline(amount);
    },

    _openOffline(amount) {
        const h = SdeUi.h.bind(SdeUi);
        this._open('offline', { title: 'sde.off.title', icon: 'gift', grad: ['#ffe86a', '#f0a000'], ww: 560 }, (body, foot) => {
            const box = h('div', 'sde-nest');
            const eg = h('div', 'eg');
            eg.style.setProperty('--rc', '#ffd91a');
            eg.appendChild(SdeUi.icon('cash'));
            box.appendChild(eg);
            const v = h('div', 'nm', '+' + GameData.money(0));
            v.style.cssText = 'font:400 clamp(32px,7vh,56px)/1 var(--sde-font);color:#5dff6c;text-shadow:var(--ol4)';
            box.appendChild(v);
            this._counts.push({ el: v, to: Math.floor(amount), t: 0, fmt: n => '+' + GameData.money(n) });
            box.appendChild(h('p', 'sde-sub', this.t('sde.off.text')));
            body.appendChild(box);
            foot.appendChild(this._btn(this.t('sde.off.ok'), 'g', () => this.close(), { cls: 'big' }));
        });
    },

    // =====================================================================================
    // Фейерверк (итоги успеха)
    // =====================================================================================

    _startFw(color) {
        const F = this.fw;
        if (!this.ov) return;
        const cv = F.cv = /** @type {HTMLCanvasElement} */ (SdeUi.h('canvas', 'fw'));
        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        cv.width = Math.round(window.innerWidth * dpr);
        cv.height = Math.round(window.innerHeight * dpr);
        this.ov.appendChild(cv);
        F.cx = cv.getContext('2d');
        F.parts = []; F.t = 0; F.next = 0.1; F.color = color; F.on = true; F.dpr = dpr;
    },

    _stopFw() { const F = this.fw; F.on = false; F.parts = []; if (F.cv) { F.cv.remove(); F.cv = null; } },

    _burst(x, y, color) { GameCosmetics.burst(this.fw.parts, x, y, color); },

    _stepFw(dt) {
        const F = this.fw;
        if (!F.cv || !F.cx) return;
        F.t += dt;
        if (F.t < 5 && F.t >= F.next) {
            F.next = F.t + 0.28 + Math.random() * 0.3;
            this._burst(window.innerWidth * (0.12 + Math.random() * 0.76), window.innerHeight * (0.12 + Math.random() * 0.45), Math.random() < 0.6 ? F.color : '#ffd91a');
        }
        const cx = F.cx, d = F.dpr || 1;
        cx.clearRect(0, 0, F.cv.width, F.cv.height);
        GameCosmetics.stepParts(cx, F.parts, dt, d);
        if (F.t > 5 && !F.parts.length) F.on = false;
    },
};
