// GameHud.js — HUD «Steal a Destruction Egg» в стиле Roblox-brainrot: деньги и доход, колонка кнопок, хотбар с патронами,
// здоровье, прицел и хит-маркер, подсказка [E], цель и маяк вылазки, подписи над гнёздами и вывески, всплывающие числа,
// тосты, баннеры, красная вспышка урона, экранные кнопки для касаний, обучение (Tutorial.js).
// Окна (вылазки, арсенал, улучшения, гнездо, итоги, пауза, титул) — js/GameMenus.js; стили и значки — js/GameMenusStyle.js.
//
// Контракт с логикой (js/Game*.js): init(game), update(dt) — каждый кадр и на паузе, floatText(x, y, z, text, cls),
// toast(key, params), banner(key), onHurt(dmg, x, z), onMode(mode), blocksInput(), openNest(i), openUpgrades(),
// openArsenal(), openRaids(), showResults(res), offline(amount).
// Ввод: Input (мышь 'lock', касания), раскладка: HudLayout (блоки sde-*), паузы: Pause, тексты: Lang (ключи sde.*).

/** @satisfies {Record<string, any>} */
const GameHud = {
    /** @type {any} */
    game: null,
    ready: false,
    /** 'title' (титульный экран) | 'play'. */
    state: 'title',
    /** 'base' | 'raid'. */
    mode: 'base',
    touch: false,
    /** @type {Record<string, any>} */
    el: {},
    /** @type {{ b: HTMLElement, nm: HTMLElement | null }[]} */
    _slots: [],
    _slotSig: '',
    _toolSig: '',
    _ammoSig: '',
    _badgeAt: 0, _giftAsked: false, _tabFree: false,
    _ammoId: '', _ammoPrev: 0, _nameT: 0, _magT: 0, _showMag: false, _showName: false,
    _rlTotal: 1,
    _hitT: 0,
    _moneyShown: -1,
    _moneyT: 0,
    _popT: 0,
    _incT: 0,
    _incSig: '',
    _toastList: /** @type {{ el: HTMLElement, t: number }[]} */ ([]),
    _banT: 0,
    _hurtV: 0,
    _hdI: 0,
    _wasDead: false,
    _hpSig: '',
    _hpPrev: /** @type {number | null} */ (null),
    _bpm: 60,
    _beatT: 0,
    _objSig: '',
    _hintSig: '',
    _labT: 0,
    _labSig: /** @type {string[]} */ ([]),
    /** @type {{ el: HTMLElement, on: boolean, x: number, y: number, z: number, vy: number, t: number, life: number, kind: string }[]} */
    _fts: [],
    /** @type {{ el: HTMLElement, nm: HTMLElement, tag: HTMLElement, inc: HTMLElement, cash: HTMLElement, pr: HTMLElement, ln: HTMLElement }[]} */
    _labs: [],
    /** @type {{ el: HTMLElement, id: string }[]} */
    _signs: [],
    _sideSig: '',
    _tutPending: '',
    _tutSkipBase: false,
    _tutDelivered: false,
    _selfSelect: false,
    _P: { x: 0, y: 0, dist: 0, behind: false, vis: false },
    _vp: null,
    _vpt: null,
    _pv: null,
    _vec: null,
    _cam: { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, sx: 1, sy: 1, ok: false },

    // =====================================================================================
    // Запуск
    // =====================================================================================

    /** Game.init зовёт после Input, GameTools, GameBase и GameRaid. */
    init(game) {
        if (this.ready) return;
        this.game = game;
        SdeUi.inject();
        SdeUi.probeWeaponIcons();
        this._applyMusic();
        this._build();
        HudLayout.init({ app: game.app });
        this._blocks();
        this._bind();
        this._initTutorial();
        GameMenus.init(game, this);
        this.ready = true;
        const q = new URLSearchParams(location.search);
        // отладка: ?raid=<id> и ?gallery — сразу в игру, без титула (логика сама снимает паузу и стартует вылазку)
        if (q.has('raid') || q.has('gallery') || q.has('notitle')) {
            this.state = 'play';
            Input.configure({ controls: true });
        } else {
            this.state = 'title';
            Pause.set('menu', true);
            Input.configure({ controls: false });
            GameMenus.showTitle();
        }
        this._applyState();
        this._langApply();
        if (this.state === 'play') this._tutPending = 'auto';
    },

    t(key, params) { return Lang.t(key, params); },

    /** Музыка выключена в настройках (state.musicOn === false): сообщить звуку при запуске. */
    _applyMusic() {
        const st = this.game.state;
        const A = typeof GameAudio !== 'undefined' ? /** @type {any} */ (GameAudio) : null;
        if (st && st.musicOn === false && A && typeof A.setMusicOn === 'function') A.setMusicOn(false);
    },

    // =====================================================================================
    // Разметка
    // =====================================================================================

    _build() {
        const E = this.el, h = SdeUi.h.bind(SdeUi);
        const root = E.root = h('div');
        root.id = 'sde-root';
        const hud = E.hud = h('div');
        hud.id = 'sde-hud';
        root.appendChild(hud);
        const world = E.world = h('div');
        world.id = 'sde-world';
        root.insertBefore(world, hud);
        document.body.appendChild(root);

        // деньги и доход
        const money = E.money = h('div', 'sde-money');
        money.appendChild(SdeUi.icon('money'));
        const m = h('div', 'm');
        E.moneyV = h('div', 'v', '$0');
        E.moneyInc = h('div', 'inc', '');
        E.eggWait = h('div', 'sde-egg-wait');
        E.eggWait.hidden = true;
        E.eggWaitImg = SdeUi.icon('egg');
        E.eggWait.append(E.eggWaitImg, h('span', '', ''));
        m.append(E.moneyV, E.moneyInc, E.eggWait);
        money.appendChild(m);
        hud.appendChild(money);

        // колонка кнопок слева
        const side = E.side = h('div', 'sde-side');
        const mk = (action, color, icon, key) => {
            const b = h('button', 'sde-sq ' + color);
            b.type = 'button';
            b.tabIndex = -1;
            b.dataset.a = action;
            b.appendChild(SdeUi.icon(icon));
            const s = h('span');
            s.setAttribute('data-t', key);
            b.appendChild(s);
            b.addEventListener('click', () => this._sideClick(action));
            side.appendChild(b);
            E['b_' + action] = b;
            return b;
        };
        mk('arsenal', 'b', 'shop', 'sde.btn.arsenal');
        mk('raids', 'p', 'radar', 'sde.btn.raids');
        mk('upgrades', 'g', 'up', 'sde.btn.upgrades');
        mk('pets', 'o', 'egg', 'sde.btn.pets');
        mk('codex', 'r', 'star', 'sde.btn.codex');
        mk('shop', 'y', 'gift', 'sde.btn.shop');
        mk('settings', 'k', 'gear', 'sde.btn.settings');
        hud.appendChild(side);

        // здоровье: бьющееся сердце и капсула с красной жидкостью (волны справа, пузырьки), надпись «Мало ХП»
        const hp = E.hp = h('div', 'sde-hp');
        hp.hidden = true;
        E.hpLow = h('div', 'lowtxt');
        E.hpLow.setAttribute('data-t', 'sde.lowhp');
        const row = h('div', 'row');
        const heart = h('div', 'hrt');
        const hb = h('div', 'hb');
        hb.appendChild(SdeUi.icon('heart'));
        hb.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M17 4L13 12 19 16 12 23 16 30" fill="none" stroke="#000" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 4L13 12 19 16 12 23 16 30" fill="none" stroke="#ffe9e9" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
        heart.appendChild(hb);
        const bar = h('div', 'bar');
        const liq = E.hpLiq = h('div', 'liq');
        const waves = E.hpWaves = h('div', 'waves');
        // волны: два слоя разного цвета и скорости (фон-картинка слоя — волнистый край)
        waves.append(h('div', 'wv b'), h('div', 'wv a'));
        const body = h('div', 'body');
        liq.append(waves, body);
        for (let i = 0; i < 6; i++) {
            const b = h('i', 'bub');
            b.style.cssText = '--bs:' + (4 + (i * 7) % 4) + 'px;--br:' + (10 + i * 7) + 'px;--bd:' + (2.2 + (i * 0.55) % 1.6).toFixed(2) + 's;--bl:' + (i * 0.43).toFixed(2) + 's;--bx:' + ((i % 2 ? 6 : -6) + i) + 'px';
            liq.appendChild(b);
        }
        E.hpDark = h('div', 'dark');
        E.hpShine = h('div', 'shine');
        E.hpNum = h('div', 'n', '');
        bar.append(liq, h('div', 'shade'), E.hpDark, E.hpShine, h('div', 'glass'), E.hpNum);
        row.append(heart, bar);
        hp.append(E.hpLow, row);
        hud.appendChild(hp);
        E.lowrim = h('div', 'sde-lowrim');
        hud.appendChild(E.lowrim);

        // цель вылазки
        const obj = E.obj = h('div', 'sde-obj');
        obj.hidden = true;
        E.objT = h('div', 't');
        E.objC = h('div', 'c');
        obj.append(E.objT, E.objC);
        hud.appendChild(obj);

        // хотбар: патроны, полоса перезарядки, ячейки
        const tray = E.tray = h('div', 'sde-tray');
        const ammo = E.ammo = h('div', 'sde-ammo');
        E.ammoNm = h('span', 'nm');
        E.ammoMg = h('span', 'mg');
        ammo.append(E.ammoNm, E.ammoMg);
        const rl = E.rl = h('div', 'sde-rl');
        E.rlFill = h('i');
        rl.appendChild(E.rlFill);
        E.slots = h('div', 'sde-slots');
        E.slots.id = 'sde-slots';
        tray.append(ammo, rl, E.slots);
        hud.appendChild(tray);

        // прицел и попадание
        const xh = E.xh = h('div', 'sde-xh');
        xh.dataset.k = 'bullet';
        const pair = d => '<path class="o" d="' + d + '"/><path class="w" d="' + d + '"/>';
        xh.innerHTML = '<svg viewBox="-28 -28 56 56" aria-hidden="true">'
            + '<g class="tick">' + pair('M0-17V-8M0 17V8M-17 0H-8M17 0H8') + '</g>'
            + '<g class="ring"><circle class="o" r="15"/><circle class="w" r="15"/></g>'
            + '<g class="brk">' + pair('M-18-9V-18H-9M9-18H18V-9M18 9V18H9M-9 18H-18V9') + '</g>'
            + '<g class="dot"><circle class="dot o" r="2.6"/><circle class="dot w" r="2.6"/></g></svg>';
        hud.appendChild(xh);
        const hm = E.hm = h('div', 'sde-hm');
        const diag = 'M-18-18L-8-8M18-18L8-8M-18 18L-8 8M18 18L8 8';
        hm.innerHTML = '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path class="o" d="' + diag + '"/><path class="w" d="' + diag + '"/></svg>';
        hud.appendChild(hm);

        // подсказка у объекта
        const hint = E.hint = h('div', 'sde-hint');
        hint.hidden = true;
        hud.appendChild(hint);

        // тосты, баннер, «нажми, чтобы управлять»
        E.toasts = h('div', 'sde-toasts');
        hud.appendChild(E.toasts);
        E.banner = h('div', 'sde-banner');
        E.banner.hidden = true;
        hud.appendChild(E.banner);
        E.cap = h('div', 'sde-cap');
        E.cap.setAttribute('data-t', 'input.capture');
        E.cap.hidden = true;
        hud.appendChild(E.cap);

        // рамка тревоги и вспышка урона
        E.rim = h('div', 'sde-rim');
        hud.appendChild(E.rim);
        E.hurt = h('div', 'sde-hurt');
        hud.appendChild(E.hurt);
        E.hd = [];
        for (let i = 0; i < 4; i++) {
            const d = h('div', 'sde-hd');
            d.appendChild(h('i'));
            hud.appendChild(d);
            E.hd.push(d);
        }

        // маяк
        const bc = E.bc = h('div', 'sde-bc');
        bc.hidden = true;
        const inn = h('div', 'in');
        const ring = h('div', 'ring');
        E.bcImg = SdeUi.icon('egg');
        ring.appendChild(E.bcImg);
        E.bcD = h('div', 'd');
        inn.append(ring, E.bcD);
        const ar = E.bcAr = h('div', 'ar');
        ar.appendChild(h('i'));
        bc.append(inn, ar);
        hud.appendChild(bc);

        this._buildTouch(hud);
        this._buildWorld(world);
    },

    // Экранные кнопки: огонь (удерживать), прыжок, перезарядка. «E» — контекстная кнопка Input; смена оружия — тап по хотбару.
    _buildTouch(hud) {
        const E = this.el, h = SdeUi.h.bind(SdeUi);
        const pad = E.pad = h('div', 'sde-pad');
        pad.hidden = true;
        const mk = (cls, action, html, label, pulse) => {
            const b = h('button', 'sde-tb ' + cls);
            b.type = 'button';
            b.tabIndex = -1;
            b.innerHTML = html;
            b.setAttribute('aria-label', label);
            let pid = -1;
            b.addEventListener('pointerdown', e => {
                if (pid !== -1) return;
                pid = e.pointerId;
                e.preventDefault(); e.stopPropagation();
                try { b.setPointerCapture(pid); } catch (err) { /* синтетическое событие */ }
                b.classList.add('on');
                Input.setVirtual(action, true);
                if (pulse) setTimeout(() => Input.setVirtual(action, false), 60);
            });
            const up = e => {
                if (e.pointerId !== pid) return;
                pid = -1;
                b.classList.remove('on');
                if (!pulse) Input.setVirtual(action, false);
            };
            for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
            b.addEventListener('contextmenu', e => e.preventDefault());
            pad.appendChild(b);
            return b;
        };
        const aim = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9" fill="none" stroke="#fff" stroke-width="3.2"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="16" cy="16" r="2.4" fill="#fff"/></svg>';
        const reload = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M25 12a10 10 0 1 0 1.5 7" fill="none" stroke="#2a1a00" stroke-width="3.6" stroke-linecap="round"/><path d="M27 4v9h-9z" fill="#2a1a00"/></svg>';
        E.fire = mk('fire', 'attack', aim, 'Fire', false);
        E.fire.id = 'sde-fire';
        E.jump = mk('jump', 'jump', '<img src="' + SDE_ICON.up + '" alt="">', 'Jump', false);
        E.rel = mk('rel', 'reload', reload, 'Reload', true);
        hud.appendChild(pad);
    },

    // Слой мира: подписи над гнёздами, вывески, всплывающие числа.
    _buildWorld(world) {
        const h = SdeUi.h.bind(SdeUi);
        for (let i = 0; i < 10; i++) {
            const el = h('div', 'sde-lab');
            el.hidden = true;
            const nm = h('div', 'nm'), tag = h('div', 'tag'), ln = h('div', 'ln'), pr = h('div', 'pr');
            const inc = h('span', 'inc'), cash = h('span', 'cash');
            ln.append(inc, cash);
            el.append(nm, tag, ln, pr);
            world.appendChild(el);
            this._labs.push({ el, nm, tag, inc, cash, pr, ln });
            this._labSig.push('');
        }
        for (const id of ['raid', 'arsenal', 'upgrades', 'pets', 'codex', 'shop']) {
            const el = h('div', 'sde-sign ' + id);
            el.hidden = true;
            const b = h('b');
            b.setAttribute('data-t', 'sde.sign.' + id);
            el.append(b, h('i'));
            world.appendChild(el);
            this._signs.push({ el, id });
        }
        for (let i = 0; i < 26; i++) {
            const el = h('div', 'sde-ft');
            el.hidden = true;
            world.appendChild(el);
            this._fts.push({ el, on: false, x: 0, y: 0, z: 0, vy: 1, t: 0, life: 1, kind: '' });
        }
    },

    // =====================================================================================
    // Раскладка HUD (HudLayout)
    // =====================================================================================

    _blocks() {
        const E = this.el, HL = HudLayout;
        HL.block('sde-money', { dock: 'tl', w: 'auto', h: 'auto', el: E.money, order: -4 });
        HL.block('sde-side', { dock: 'ml', w: 80, h: 344, el: E.side, order: 0 });
        HL.block('sde-hp', { dock: 'tr', w: 210, h: 62, el: E.hp, order: -3 });
        HL.block('sde-obj', { dock: 'tc', w: 320, h: 'auto', el: E.obj, order: -3, fill: true, maxW: 300, minW: 200 });
        HL.block('sde-toasts', { dock: 'tc', w: 420, h: 'auto', el: E.toasts, order: 6, fill: true, maxW: 520, minW: 200 });
        // minW = полная ширина: хотбар и подсказки не сжимаются между стиком и кнопками, а уходят выше них
        HL.block('sde-tray', { dock: 'bc', w: 3 * 70, minW: 3 * 70, h: 136, el: E.tray, order: 0 });
        HL.block('sde-hint', { dock: 'bc', w: 'auto', minW: 999, h: 'auto', el: E.hint, order: 1, fill: false });
        HL.block('sde-cap', { dock: 'bc', w: 'auto', minW: 999, h: 'auto', el: E.cap, order: 2, fill: false });
        HL.block('sde-pad', { dock: 'br', w: 184, h: 184, min: 130, el: E.pad, order: -11, touchOnly: true });
        HL.onChange(() => this._onLayout());
    },

    // Колонка кнопок: по вертикали у левого края; на низком экране — рядом, под деньгами; в вылазке — одна кнопка настроек.
    _onLayout() {
        this._layoutSide();
        // обучение в портрете занимает всю ширину под деньгами, а не жмётся рядом с ними
        const d = HudLayout._defs.tutorial, want = HudLayout.mode === 'tall' ? 340 : 260;
        if (d && d.minW !== want) HudLayout.block('tutorial', { minW: want });
    },

    _layoutSide() {
        const E = this.el, HL = HudLayout, low = HL.mode === 'low', raid = this.mode === 'raid';
        const Hk = window.innerHeight / (HL.k || 1);
        // совсем низкий портрет: на время обучения кнопкам нет места, а нужны они только после него
        const tiny = !low && !raid && window.innerHeight < 640 && typeof Tutorial !== 'undefined' && !!Tutorial.active;
        const sig = (low ? 'r' : 'c') + (raid ? '1' : '7') + '|' + Math.round(Hk) + (tiny ? 't' : '');
        if (sig === this._sideSig) return;
        this._sideSig = sig;
        E.side.classList.toggle('row', low);
        E.side.hidden = tiny;
        HudLayout.schedule();
        for (const a of ['arsenal', 'raids', 'upgrades', 'pets', 'codex', 'shop']) E['b_' + a].hidden = raid;
        const n = raid ? 1 : 7, g = low ? 5 : 7;
        // на совсем низком портрете — две колонки
        const cols = !low && !raid && Hk < 700 ? 2 : 1, rows = Math.ceil(n / cols);
        const b = low ? (raid ? 50 : 40) : Math.max(46, Math.min(raid ? 80 : 72, Math.floor((Hk * 0.62 - (rows - 1) * g) / rows)));
        E.side.style.setProperty('--sq-fs', (b * 0.145).toFixed(1) + 'px');
        const span = low ? n * b + (n - 1) * g : rows * b + (rows - 1) * g, sw = cols * b + (cols - 1) * g;
        E.side.style.gridTemplateRows = low ? '1fr' : 'repeat(' + rows + ',1fr)';
        E.side.style.gridTemplateColumns = low ? 'repeat(' + n + ',1fr)' : 'repeat(' + cols + ',1fr)';
        HL.block('sde-side', low ? { dock: 'tl', w: span, h: b, order: -2 } : { dock: 'ml', w: sw, h: span, order: 0 });
    },

    _bind() {
        const E = this.el;
        GameTools.on(e => this._onTool(e));
        Input.on('unlock', () => {
            // дать окнам секунду: они сами отпускают курсор
            // курсор отпущен клавишей Tab: игра идёт дальше, без паузы
            if (this._tabFree) { this._tabFree = false; return; }
            setTimeout(() => { if (this.state === 'play' && !GameMenus.cur && !Input.locked && !LoadingScreen.busy) GameMenus.openPause('main'); }, 30);
        });
        window.addEventListener('keydown', e => this._onKey(e));
        window.addEventListener('lory-language', () => this._langApply());
        window.addEventListener('lory-input-device', () => { this._hintSig = ''; this._langApply(); });
        window.addEventListener('resize', () => { this._sideSig = ''; });
        // касание по хотбару — выбор оружия
        E.slots.addEventListener('pointerdown', e => {
            if (!this.touch) return;
            const b = /** @type {HTMLElement} */ (e.target).closest('.sde-slot');
            if (!b) return;
            e.preventDefault(); e.stopPropagation();
            GameTools.select(+(/** @type {HTMLElement} */ (b).dataset.i || 0));
        });
    },

    _sideClick(a) {
        if (this.state !== 'play' || GameMenus.cur) return;
        try { GameAudio.ui('click'); } catch (e) { /* тишина */ }
        if (a === 'arsenal') this.openArsenal();
        else if (a === 'raids') this.openRaids();
        else if (a === 'upgrades') this.openUpgrades();
        else if (a === 'pets') GamePetsUi.openPets();
        else if (a === 'codex') GamePetsUi.openCodex();
        else if (a === 'shop') GameShopUi.open('shop');
        else if (a === 'settings') GameMenus.openPause('settings');
    },

    _onKey(e) {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const code = e.code;
        if (code === 'Tab') {
            if (this.state !== 'play' || GameMenus.cur) return;
            e.preventDefault();
            GameInput.toggle(this);
            return;
        }
        if (code !== 'KeyP') return;
        if (GameMenus.cur) { GameMenus.onEsc(code); return; }
        if (this.state !== 'play') return;
        if (code === 'KeyP' || !Input.locked) GameMenus.openPause('main');
    },

    /** Что видно: HUD — только в игре; класс на <html> прячет HUD под окнами и титулом. */
    _applyState() {
        const play = this.state === 'play';
        document.documentElement.classList.toggle('sde-title-on', !play);
        this.el.hud.hidden = !play;
        HudLayout.refresh();
    },

    /** «Играть» на титуле (по жесту игрока: можно захватить курсор). */
    play() {
        if (this.state !== 'title') return;
        this.state = 'play';
        GameMenus.hideTitle();
        this._applyState();
        Pause.set('menu', false);
        Input.configure({ controls: true });
        Input.capture();
        if (typeof Platform !== 'undefined' && typeof Platform.gameplay === 'function') Platform.gameplay(true);
        this._tutPending = 'auto';
        GameMenus.afterTitle();
    },

    // =====================================================================================
    // Тексты
    // =====================================================================================

    _langApply() {
        Lang.apply(this.el.root);
        this._slotSig = ''; this._toolSig = ''; this._ammoSig = ''; this._hintSig = ''; this._objSig = ''; this._incSig = '';
        this._labSig = this._labSig.map(() => '');
        if (this.el.eggWait) this.el.eggWait.lastChild.textContent = this.t('sde.eggWait');
        GameMenus.langChanged();
    },

    // =====================================================================================
    // Контракт с логикой
    // =====================================================================================

    /** Короткое сообщение сверху по центру. */
    toast(key, params) {
        const E = this.el, text = Lang.t(key, params);
        const el = SdeUi.h('div', 'sde-toast' + (/noMoney|fail|no[A-Z]/.test(key) ? ' bad' : ''), text);
        E.toasts.appendChild(el);
        this._toastList.push({ el, t: 2.3 });
        while (this._toastList.length > 3) { const o = this._toastList.shift(); if (o) o.el.remove(); }
        HudLayout.schedule();
    },

    /** Большая надпись на пару секунд. */
    banner(key) {
        const E = this.el;
        E.banner.textContent = '';
        E.banner.className = 'sde-banner' + (key === 'sde.alarm' ? ' alarm' : '');
        E.banner.appendChild(SdeUi.h('b', '', Lang.t(key)));
        E.banner.hidden = false;
        this._banT = 2.7;
    },

    /** Красная вспышка и стрелка в сторону удара. */
    onHurt(dmg, x, z) {
        const E = this.el, g = this.game;
        this._hurtV = Math.min(1, 0.35 + (dmg || 10) / 55);
        E.hp.classList.remove('hit'); void E.hp.offsetWidth; E.hp.classList.add('hit');
        this._splash();
        if (typeof x === 'number' && typeof z === 'number' && g.player) {
            const p = g.player.pos, f = g.player.dir();
            const dx = x - p.x, dz = z - p.z, len = Math.hypot(dx, dz);
            if (len > 0.3) {
                const fl = Math.hypot(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl;
                const dot = (dx * fx + dz * fz) / len, side = (dx * -fz + dz * fx) / len;
                const ang = Math.atan2(side, dot) * 180 / Math.PI;
                const d = E.hd[this._hdI++ % E.hd.length];
                d.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
                d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
            }
        }
    },

    /** Режим сменился: 'base' | 'raid'. */
    onMode(mode) {
        this.mode = mode;
        const E = this.el;
        this._sideSig = '';
        this._objSig = ''; this._hintSig = '';
        for (const f of this._fts) { f.on = false; f.el.hidden = true; }
        E.rim.classList.remove('on');
        E.bc.hidden = true;
        E.banner.hidden = true;
        this._layoutSide();
        HudLayout.schedule();
        if (mode === 'raid') {
            this._tutDelivered = false;
            this.banner('sde.raidGo');
        } else {
            const st = this.game.state;
            if (st.pendingEgg) this.toast('sde.eggWaitToast');
            // обучение: вылазка закончилась без выноса — вернуться к шагу «портал»
            if (Tutorial.active && !this._tutDelivered && ['egg', 'take', 'deliver'].indexOf(Tutorial.step) >= 0) {
                const replay = Tutorial.replay;
                Tutorial.finish('abort');
                this._tutSkipBase = true;
                this._tutPending = replay ? 'replay' : 'auto';
            }
        }
    },

    blocksInput() { return this.state === 'title' || GameMenus.isOpen(); },

    openNest(i) { GamePetsUi.openNest(i); },
    openUpgrades() { GameMenus.openUpgrades(); },
    openArsenal() { GameMenus.openArsenal(); },
    openRaids() { Tutorial.complete('portal'); GameMenus.openRaids(); },
    /** Первая находка яйца: деньги сверх наград вылазки. */
    showResults(res) {
        if (res && res.found) this.toast('sde.cx.firstReward', { p: GameData.money(res.found) });
        if (res && res.ok) { this._tutDelivered = true; Tutorial.complete('deliver'); }
        GameMenus.showResults(res);
    },
    offline(amount) { GameMenus.offline(amount); },

    /** Всплывающий текст в мире. cls: 'dmg' | 'crit' | 'cash'. */
    floatText(x, y, z, text, cls) {
        if (this.state !== 'play') return;
        let f = null, old = null;
        for (const q of this._fts) { if (!q.on) { f = q; break; } if (!old || q.t > old.t) old = q; }
        if (!f) f = old;
        if (!f) return;
        f.on = true; f.x = x + (Math.random() - 0.5) * 0.3; f.y = y; f.z = z;
        f.t = 0; f.kind = cls || 'dmg';
        f.life = f.kind === 'cash' ? 1.5 : f.kind === 'crit' ? 1.05 : 0.8;
        f.vy = f.kind === 'cash' ? 1.1 : 1.6;
        f.el.className = 'sde-ft ' + f.kind;
        f.el.textContent = text;
        f.el.hidden = false;
        f.el.style.opacity = '0';
    },

    // =====================================================================================
    // События оружия
    // =====================================================================================

    _onTool(e) {
        if (e.type === 'hitEnemy') {
            const hm = this.el.hm;
            hm.className = 'sde-hm ' + (e.killed ? 'kill' : e.crit ? 'crit' : '');
            void hm.offsetWidth;
            hm.classList.add('show');
            if (this.game.mode === 'base') Tutorial.complete('shoot');
        } else if (e.type === 'select' || e.type === 'loadout') {
            this._toolSig = ''; this._ammoSig = '';
            if (e.type === 'loadout') this._slotSig = '';
        } else if (e.type === 'reload') {
            this._rlTotal = Math.max(0.1, e.time || 1);
        } else if (e.type === 'empty') {
            const a = this.el.ammoMg;
            a.classList.remove('sde-shake'); void a.offsetWidth; a.classList.add('sde-shake');
        }
    },

    // =====================================================================================
    // Касания
    // =====================================================================================

    _syncTouch() {
        const E = this.el;
        const touch = !!(Input.mouseTouch || (Input.touchSeen && Input.device === 'touch'));
        if (touch === this.touch) return;
        this.touch = touch;
        E.root.classList.toggle('sde-touch', touch);
        E.pad.hidden = !touch;
        this._hintSig = '';
        if (!touch) Input.clearContext('sde-use');
        HudLayout.refresh();
    },

    // =====================================================================================
    // Проекция точки мира на экран
    // =====================================================================================

    // Матрицы камеры считаются здесь же, на актуальной позе (сцена обновит свои только при отрисовке — кадр отставания).
    _camBegin() {
        const C = this._cam, cam = VoxRender.camera, eng = VoxRender.engine;
        C.ok = false;
        if (!cam || !eng || !this.game.player) return false;
        if (!this._vp) { this._vp = new BABYLON.Matrix(); this._pv = new BABYLON.Vector3(); this._vec = new BABYLON.Vector3(); }
        const rw = eng.getRenderWidth(), rh = eng.getRenderHeight();
        if (!rw || !rh) return false;
        const v = cam.getViewMatrix(true), p = cam.getProjectionMatrix(true);
        v.multiplyToRef(p, this._vp);
        this._vpt = cam.viewport.toGlobal(rw, rh);
        const f = this.game.player.dir();
        C.x = cam.position.x; C.y = cam.position.y; C.z = cam.position.z;
        C.fx = f.x; C.fy = f.y; C.fz = f.z;
        C.sx = window.innerWidth / rw; C.sy = window.innerHeight / rh;
        C.ok = true;
        return true;
    },

    /** Точка мира -> экран (CSS px). Результат — общий объект this._P. */
    _proj(x, y, z) {
        const C = this._cam, P = this._P;
        const dx = x - C.x, dy = y - C.y, dz = z - C.z;
        P.behind = (dx * C.fx + dy * C.fy + dz * C.fz) <= 0.05;
        P.dist = Math.hypot(dx, dy, dz);
        this._vec.set(x, y, z);
        BABYLON.Vector3.ProjectToRef(this._vec, BABYLON.Matrix.IdentityReadOnly, this._vp, this._vpt, this._pv);
        P.x = this._pv.x * C.sx; P.y = this._pv.y * C.sy;
        P.vis = !P.behind && P.x > -60 && P.y > -60 && P.x < window.innerWidth + 60 && P.y < window.innerHeight + 60;
        return P;
    },

    // Для стрелок обучения: (x, z, высота) -> { x, y, visible, behind }.
    _tutProject(x, z, y) {
        if (!this._cam.ok) return null;
        const p = this._proj(x, y, z);
        return { x: p.x, y: p.y, behind: p.behind, visible: p.vis };
    },

    // =====================================================================================
    // Кадр
    // =====================================================================================

    /** Game.frame зовёт каждый кадр (в том числе на паузе и под окнами). */
    update(dt) {
        if (!this.ready) return;
        GameMenus.update(dt);
        this._syncTouch();
        if (this.state !== 'play') return;
        const open = !!GameMenus.cur;
        // обучение стартует, когда игра пошла (титул и окна закрыты)
        if (this._tutPending && !open && !Pause.active && !LoadingScreen.busy) {
            const how = this._tutPending;
            this._tutPending = '';
            if (how === 'replay') Tutorial.start({ replay: true }); else Tutorial.autoStart();
        }
        this._tickToasts(dt);
        if (open) return;
        const g = this.game, raid = g.mode === 'raid';
        const cam = this._camBegin();
        this._syncMoney(dt);
        this._syncTools(dt);
        this._syncCross(dt);
        this._syncHint();
        this._syncRaid(dt, raid);
        this._syncFx(dt);
        if (cam) {
            this._syncFloats(dt);
            if (!raid) this._syncLabels(dt); else this._hideLabels();
            this._syncBeacon(raid);
        }
        const needCap = Input.needsCapture && !Pause.active;
        if (this.el.cap.hidden === needCap) this.el.cap.hidden = !needCap;
    },

    _tickToasts(dt) {
        const L = this._toastList;
        for (let i = L.length - 1; i >= 0; i--) {
            const o = L[i];
            o.t -= dt;
            if (o.t <= 0.25 && !o.el.classList.contains('out')) o.el.classList.add('out');
            if (o.t <= 0) { o.el.remove(); L.splice(i, 1); HudLayout.schedule(); }
        }
        if (this._banT > 0) { this._banT -= dt; if (this._banT <= 0) this.el.banner.hidden = true; }
    },

    // ---- деньги и доход ----
    _syncMoney(dt) {
        const E = this.el, g = this.game, st = g.state;
        const target = Math.floor(st.money);
        if (this._moneyShown < 0) this._moneyShown = target;
        let d = this._moneyShown;
        if (target > d) { d += Math.max(1, (target - d) * Math.min(1, dt * 7)); if (d > target) d = target; this._popT = 0.22; }
        else if (target < d) d = target;
        d = Math.floor(d);
        if (d !== this._moneyShown || !E.moneyV.textContent) {
            this._moneyShown = d;
            E.moneyV.textContent = GameData.money(d);
        }
        if (this._popT > 0) { this._popT -= dt; E.money.classList.toggle('pop', this._popT > 0); }
        this._incT -= dt;
        if (this._incT <= 0) {
            this._incT = 0.5;
            const inc = Math.floor(GameBase.incomePerSec());
            const sig = inc + '|' + Lang.code;
            if (sig !== this._incSig) { this._incSig = sig; E.moneyInc.textContent = '+' + GameData.money(inc) + this.t('sde.perSec'); }
            const wait = g.mode === 'base' && !!st.pendingEgg;
            if (E.eggWait.hidden === wait) {
                E.eggWait.hidden = !wait;
                if (wait) { const def = GameData.egg(st.pendingEgg); if (def) E.eggWaitImg.src = SDE_DIR.ui + 'eggs/' + def.icon + '.webp'; }
                HudLayout.schedule();
            }
        }
    },

    // ---- хотбар, патроны ----
    _rebuildSlots() {
        const E = this.el, T = GameTools;
        const sig = T.list.map(w => w.id).join(',') + '|' + Lang.code;
        if (sig === this._slotSig) return;
        this._slotSig = sig;
        E.slots.textContent = '';
        this._slots = [];
        T.list.forEach((w, i) => {
            const b = SdeUi.h('button', 'sde-slot');
            b.type = 'button';
            b.tabIndex = -1;
            b.dataset.i = String(i);
            b.setAttribute('aria-label', GameData.label(w));
            b.appendChild(SdeUi.h('span', 'n', String(i + 1)));
            b.appendChild(SdeUi.weaponTile(w));
            E.slots.appendChild(b);
            this._slots.push({ b, nm: null });
        });
        const n = T.list.length;
        E.slots.style.setProperty('--n', String(n));
        HudLayout.block('sde-tray', { w: n * 70, minW: n * 70 });
        this._toolSig = '';
    },

    /** Красные точки на кнопках и предложение подарка дня: только на базе, не поверх обучения и окон. */
    _syncBadges() {
        const E = this.el, g = this.game, dot = (b, on) => {
            let d = b.querySelector('.sde-dot');
            if (on && !d) { d = SdeUi.h('i', 'sde-dot'); b.appendChild(d); }
            if (!on && d) d.remove();
        };
        dot(E.b_pets, g.state.nests.some(n => GamePets.progress(n).ready));
        dot(E.b_shop, GameShopUi.badge());
        if (this._giftAsked || g.mode !== 'base' || this.state !== 'play' || GameMenus.cur || g._switching) return;
        if (Tutorial.active || !g.state.tutorialDone) return;
        this._giftAsked = true;
        if (DailyGift.shouldOffer()) { DailyGift.markOffered(); GameShopUi.open('gift'); }
    },

    /** Прицел из магазина: свой контур вместо прицела оружия. item.shape пустой — как у оружия. */
    setXhair(it) {
        const xh = this.el.xh, svg = xh && xh.querySelector('svg');
        if (!svg) return;
        const old = svg.querySelector('g.skin');
        if (old) old.remove();
        const on = !!(it && it.shape);
        xh.classList.toggle('skinned', on);
        xh.dataset.anim = on ? (it.anim || '') : '';
        if (!on) return;
        const d = GameShopData.XH[it.shape];
        xh.style.setProperty('--xh', it.color || '#fff');
        svg.insertAdjacentHTML('beforeend', '<g class="skin"><path class="o" d="' + d + '"/><path class="w" d="' + d + '"/></g>');
    },

    _syncTools() {
        const E = this.el, T = GameTools, t = T.tool;
        this._rebuildSlots();
        const cur = T.current;
        if (String(cur) !== this._toolSig) {
            this._toolSig = String(cur);
            this._slots.forEach((s, k) => { s.b.classList.toggle('cur', k === cur); s.b.setAttribute('aria-pressed', String(k === cur)); });
            E.xh.dataset.k = t.kind;
        }
        // патроны и полоса перезарядки
        const mag = T.mag;
        const sig = t.id + '|' + mag + '|' + Lang.code;
        if (sig !== this._ammoSig) {
            this._ammoSig = sig;
            E.ammoNm.textContent = GameData.label(t);
            E.ammoMg.textContent = '';
            if (t.mag) {
                E.ammoMg.appendChild(document.createTextNode(String(mag)));
                E.ammoMg.appendChild(SdeUi.h('small', '', ' / ' + t.mag));
            }
            E.ammoMg.classList.toggle('empty', !!t.mag && mag <= 0);
        }
        // название — 2 с после смены оружия; патроны — пока стреляешь и 2.5 с после, при перезарядке и когда пусто
        const now = performance.now();
        if (t.id !== this._ammoId) { this._ammoId = t.id; this._ammoPrev = mag; this._nameT = now + 2000; this._magT = 0; }
        if (mag < this._ammoPrev) this._magT = now + 2500;
        this._ammoPrev = mag;
        const showMag = !!t.mag && (now < this._magT || T.reloading > 0 || mag <= 0), showName = now < this._nameT;
        if (showMag !== this._showMag) { this._showMag = showMag; E.ammo.classList.toggle('am', showMag); }
        if (showName !== this._showName) { this._showName = showName; E.ammo.classList.toggle('nm-on', showName); }
        if (now > this._badgeAt) { this._badgeAt = now + 800; this._syncBadges(); this._layoutSide(); }
        let p = 0;
        if (T.reloading > 0) p = 1 - T.reloading / this._rlTotal;
        else if (t.kind === 'rail' && T.charge > 0) p = T.charge / t.charge;
        else if (t.spin && T.spinUp > 0 && T.spinUp < t.spin) p = T.spinUp / t.spin;
        const on = p > 0 && p < 1;
        if (E.rl.classList.contains('on') !== on) E.rl.classList.toggle('on', on);
        if (on) E.rlFill.style.width = (p * 100).toFixed(1) + '%';
    },

    // ---- прицел ----
    _syncCross(dt) {
        const E = this.el, T = GameTools, g = this.game;
        const dead = g.dead;
        if (E.xh.hidden !== dead) { E.xh.hidden = dead; E.hm.hidden = dead; }
        const on = !!(T.aim && T.aim.enemy);
        if (E.xh.classList.contains('on') !== on) E.xh.classList.toggle('on', on);
        // снайперка: прицел сужается вместе с зумом
        const sc = 1 - 0.3 * (T.zoomed || 0);
        const s = sc.toFixed(2);
        if (s !== this._xhS) { this._xhS = s; E.xh.style.transform = sc < 0.999 ? 'scale(' + s + ')' : ''; }
    },
    _xhS: '',

    // ---- подсказка у объекта ----
    _syncHint() {
        const E = this.el, g = this.game;
        const near = g.mode === 'base' ? GameBase.near : GameRaid.near;
        const id = near ? near.id : '';
        const nestN = id === 'nest' ? g.state.nests[near.nest] : null;
        const sig = (nestN ? (nestN.pet ? 'p' : (GamePets.progress(nestN).ready ? 'r' : 'e')) + near.nest : '') + id + '|' + (near && near.price != null ? (g.state.money >= near.price ? 'y' : 'n') : '') + '|' + (this.touch ? 't' : Input.labelOf('interact')) + '|' + Lang.code + '|' + (near && near.nest != null ? near.nest : '');
        if (sig === this._hintSig) return;
        this._hintSig = sig;
        if (!near || g.dead) {
            E.hint.hidden = true;
            Input.clearContext('sde-use');
            return;
        }
        E.hint.hidden = false;
        E.hint.dataset.id = id;
        E.hint.textContent = '';
        const key = SdeUi.h('span', 'key' + (this.touch ? ' ico' : ''));
        if (this.touch) key.appendChild(SdeUi.icon('hand')); else key.textContent = Input.labelOf('interact') || 'E';
        E.hint.appendChild(key);
        let label = this.t('sde.hint.' + id);
        if (id === 'nest') {
            const nn = g.state.nests[near.nest];
            if (nn && nn.pet) label = this.t('sde.hint.nestPet');
            else if (nn && GamePets.progress(nn).ready) label = this.t('sde.hint.nestReady');
        }
        E.hint.appendChild(SdeUi.h('span', '', label));
        if (id === 'buyNest') E.hint.appendChild(SdeUi.h('small', '', GameData.money(near.price)));
        else if (id === 'nest') {
            const n = g.state.nests[near.nest], def = n && n.egg ? GameData.egg(n.egg) : null;
            if (def) E.hint.appendChild(SdeUi.h('small', '', GameData.label(def)));
        }
        // сенсорная кнопка «E» — контекстная кнопка Input
        if (this.touch) Input.setContext({ id: 'sde-use', label: 'sde.ctx.' + id, icon: SDE_ICON.hand }, 1);
        else Input.clearContext('sde-use');
    },

    // ---- здоровье: уровень жидкости, пульс сердца, «мало ХП» ----
    // Пульс: 60 уд/мин при полном здоровье, 150 при 25 % и ниже; --beat (с на удар) читают сердце и красная рамка.
    // Анимации — только transform и opacity: уровень жидкости двигает translateX, волны и пузырьки — translateY.
    _syncHp(dt) {
        const E = this.el, g = this.game;
        const f = g.hpMax > 0 ? Math.max(0, Math.min(1, g.hp / g.hpMax)) : 0;
        const hp = Math.max(0, Math.ceil(g.hp)), mx = Math.round(g.hpMax);
        const sig = hp + '/' + mx;
        if (sig !== this._hpSig) {
            const prev = this._hpPrev;
            this._hpSig = sig;
            this._hpPrev = g.hp;
            E.hpLiq.style.transform = 'translateX(' + (-(1 - f) * 100).toFixed(1) + '%)';
            E.hpNum.textContent = sig;
            if (prev != null && g.hp < prev - 0.5) this._splash();
            else if (prev != null && g.hp > prev + g.hpMax * 0.06) { E.hpShine.classList.remove('go'); void E.hpShine.offsetWidth; E.hpShine.classList.add('go'); }
        }
        const alive = !g.dead && f > 0;
        const low = alive && f < 0.3, crit = alive && f <= 0.15;
        if (E.hp.classList.contains('low') !== low) E.hp.classList.toggle('low', low);
        if (E.lowrim.classList.contains('on') !== low) E.lowrim.classList.toggle('on', low);
        if (E.lowrim.classList.contains('crit') !== crit) E.lowrim.classList.toggle('crit', crit);
        const bpm = Math.min(170, 60 + (1 - f) * 120);
        if (Math.abs(bpm - this._bpm) >= 4) {
            this._bpm = bpm;
            E.root.style.setProperty('--beat', (60 / bpm).toFixed(3) + 's');
        }
        if (crit && !Pause.active) {
            this._beatT -= dt;
            if (this._beatT <= 0) { this._beatT = 60 / this._bpm; this._beat(); }
        } else this._beatT = 0;
    },

    // всплеск жидкости при уроне: волны на миг вздымаются
    _splash() {
        const w = this.el.hpWaves;
        w.classList.remove('splash'); void w.offsetWidth; w.classList.add('splash');
    },

    // Удар сердца при здоровье ≤ 15 %: звук делает GameAudio.heartbeat (если он есть).
    _beat() {
        const A = typeof GameAudio !== 'undefined' ? /** @type {any} */ (GameAudio) : null;
        if (A && typeof A.heartbeat === 'function') A.heartbeat();
    },

    // ---- цель, рамка тревоги ----
    _syncRaid(dt, raid) {
        const E = this.el, g = this.game, R = GameRaid;
        const showHp = raid;
        if (E.hp.hidden === showHp) { E.hp.hidden = !showHp; HudLayout.schedule(); }
        if (showHp) this._syncHp(dt);
        else if (E.lowrim.classList.contains('on')) { E.lowrim.classList.remove('on', 'crit'); E.hp.classList.remove('low'); }
        const phase = R.phase;
        const objOn = raid && (phase === 'fight' || phase === 'carry');
        if (E.obj.hidden === objOn) { E.obj.hidden = !objOn; HudLayout.schedule(); }
        const carry = phase === 'carry';
        if (E.rim.classList.contains('on') !== (raid && carry)) {
            E.rim.classList.toggle('on', raid && carry);
            if (carry && R.eggDef) E.rim.style.setProperty('--rc', RARITIES[R.eggDef.rarity].color);
        }
        if (!objOn) return;
        const dropped = !carry && !!(R.eggBody && !R.eggBody.dead);
        const loot = GameData.money(R.loot), alive = GameEnemies.aliveCount();
        const wave = carry ? Math.max(0, Math.ceil(R.waveT)) : -1;
        const rr = R.raid, sky = rr && rr.sky, wth = rr && rr.weather;
        const evac = R.evacOn && !R.gateOpen ? Math.max(0, Math.ceil(R.evacT)) : -1;
        const sig = phase + '|' + dropped + '|' + loot + '|' + R.kills + '|' + alive + '|' + wave + '|' + Lang.code + '|' + sky + '|' + wth + '|' + evac;
        if (sig === this._objSig) return;
        this._objSig = sig;
        E.obj.classList.toggle('alarm', carry);
        E.objT.textContent = '';
        const def = R.eggDef;
        if (carry) E.objT.appendChild(SdeUi.icon('home'));
        else if (def) E.objT.appendChild(SdeUi.eggImg(def));
        E.objT.appendChild(SdeUi.h('span', '', dropped ? this.t('sde.obj.dropped') : !carry ? this.t('sde.obj.find') : evac >= 0 ? this.t('sde.obj.wait', { t: GamePets.timeLabel(evac) }) : this.t('sde.obj.carry')));
        E.objC.textContent = '';
        const chip = (icon, text, cls) => { const c = SdeUi.h('span', 'sde-chip' + (cls ? ' ' + cls : '')); c.appendChild(SdeUi.icon(icon)); c.appendChild(document.createTextNode(text)); E.objC.appendChild(c); };
        chip('money', loot, 'g');
        chip('skull', String(R.kills));
        chip('sword', String(alive));
        if (carry) chip('timer', wave + this.t('sde.sec'));
        // время суток и погода одной короткой строкой
        const wx = [sky ? this.t('sde.sky.' + sky) : '', wth && wth !== 'clear' ? this.t('sde.weather.' + wth) : ''].filter(Boolean).join(' · ');
        const oldw = E.obj.querySelector('.w'); if (oldw) oldw.remove();
        if (wx) E.obj.appendChild(SdeUi.h('div', 'w', wx));
    },

    // ---- красная вспышка ----
    _syncFx(dt) {
        const E = this.el;
        if (this._hurtV > 0.01) {
            this._hurtV = Math.max(0, this._hurtV - dt * 1.6);
            E.hurt.style.opacity = String(this._hurtV.toFixed(2));
        } else if (E.hurt.style.opacity !== '0') E.hurt.style.opacity = '0';
    },

    // ---- всплывающие числа ----
    _syncFloats(dt) {
        const W = window.innerWidth, H = window.innerHeight;
        for (const f of this._fts) {
            if (!f.on) continue;
            f.t += dt;
            if (f.t >= f.life) { f.on = false; f.el.hidden = true; continue; }
            f.y += f.vy * dt;
            const P = this._proj(f.x, f.y, f.z);
            if (!P.vis || P.x < 0 || P.x > W || P.y < 0 || P.y > H) { f.el.style.opacity = '0'; continue; }
            const k = f.t / f.life;
            const pop = k < 0.14 ? 0.5 + (k / 0.14) * 0.85 : k < 0.26 ? 1.35 - (k - 0.14) / 0.12 * 0.35 : 1;
            const sc = pop * Math.max(0.6, Math.min(1.35, 9 / Math.max(3, P.dist) + 0.35));
            f.el.style.transform = 'translate3d(' + P.x.toFixed(1) + 'px,' + P.y.toFixed(1) + 'px,0) translate(-50%,-50%) scale(' + sc.toFixed(2) + ')';
            f.el.style.opacity = k > 0.65 ? String(((1 - k) / 0.35).toFixed(2)) : '1';
        }
    },

    // ---- подписи над гнёздами и вывески базы ----
    _hideLabels() {
        for (const l of this._labs) if (!l.el.hidden) l.el.hidden = true;
        for (const s of this._signs) if (!s.el.hidden) s.el.hidden = true;
    },

    _labelData(v) {
        const st = this.game.state, n = st.nests[v.i];
        if (n) {
            const def = n.egg ? GameData.egg(n.egg) : null;
            if (!def) return { type: 'empty' };
            const r = RARITIES[def.rarity], pet = n.pet ? GamePets.byEgg(n.egg) : null, pr = GamePets.progress(n);
            const rname = pet ? GameData.label(r) : (pr.ready ? this.t('sde.pets.readyShort') : this.t('sde.pet.leftShort', { t: GamePets.timeLabel(pr.left) }));
            return { type: 'egg', name: GameData.label(pet || def), color: r.color, rname, inc: GamePets.nestIncome(n), cash: Math.floor(n.cash) };
        }
        if (v.i === st.nests.length) { const price = GameBase.nestPrice(); return { type: 'buy', price, ok: st.money >= price }; }
        return null;
    },

    // Метки над гнёздами (до 10 в радиусе 18 м) и вывески базы. Все они лежат под HUD (слой мира ниже слоя HUD по z-index),
    // а кроме того: не заходят в зоны HUD (деньги, колонка кнопок, хотбар…) и не пересекаются между собой — дальняя скрывается.
    _syncLabels(dt) {
        const g = this.game, p = g.player, V = GameBase.views;
        this._labT -= dt;
        const refresh = this._labT <= 0;
        if (refresh) this._labT = 0.25;
        const vw = window.innerWidth;
        const nf = Math.max(0.5, Math.min(1, vw / 800));          // на узком экране мельче
        /** @type {{ el: HTMLElement, x: number, y: number, s: number, d: number }[]} */
        const cand = [];
        // ближайшие гнёзда в радиусе 18 м, не больше 10
        const near = [];
        for (const v of V) {
            const d = Math.hypot(v.x - p.pos.x, v.z - p.pos.z);
            if (d < 18) near.push({ v, d });
        }
        near.sort((a, b) => a.d - b.d);
        if (near.length > this._labs.length) near.length = this._labs.length;
        for (let i = 0; i < this._labs.length; i++) {
            const L = this._labs[i], q = near[i];
            const data = q ? this._labelData(q.v) : null;
            if (!q || !data) { if (!L.el.hidden) L.el.hidden = true; continue; }
            const P = this._proj(q.v.x, q.v.y + (data.type === 'egg' ? 2.6 : 1.4), q.v.z);
            if (!P.vis) { if (!L.el.hidden) L.el.hidden = true; continue; }
            if (refresh || L.el.hidden) this._fillLabel(i, L, data);
            L.el.hidden = false;
            cand.push({ el: L.el, x: P.x, y: P.y, s: Math.max(0.5, Math.min(1.1, 15 / Math.max(4, q.d))) * nf, d: q.d });
        }
        // вывески: портал, арсенал, улучшения
        const GB = /** @type {any} */ (GameBase), gate = GB.gate, ars = GB.arsenalAt, up = GB.upgradesAt;
        const top = (typeof BASE_GROUND !== 'undefined' ? BASE_GROUND : 20) * g.world.vs;
        const pts = { raid: gate ? { x: gate.x, y: gate.y + 5, z: gate.z } : null, arsenal: ars ? { x: ars.x, y: top + 4.4, z: ars.z } : null, upgrades: up ? { x: up.x, y: top + 4.4, z: up.z } : null };
        for (const [k, at] of [['pets', GB.petsAt], ['codex', GB.codexAt], ['shop', GB.shopAt]]) pts[k] = at ? { x: at.x, y: top + 4.4, z: at.z } : null;
        for (const S of this._signs) {
            const pt = pts[S.id];
            if (!pt) { if (!S.el.hidden) S.el.hidden = true; continue; }
            const P = this._proj(pt.x, pt.y, pt.z);
            if (!P.vis || P.dist > 70) { if (!S.el.hidden) S.el.hidden = true; continue; }
            S.el.hidden = false;
            cand.push({ el: S.el, x: P.x, y: P.y, s: Math.max(0.3, Math.min(0.95, 24 / Math.max(6, P.dist))) * nf, d: P.dist - 100 });   // вывески важнее меток
        }
        // зоны HUD: всё, что HudLayout разложил, + 6 px воздуха
        const zones = [];
        const R = HudLayout.rects;
        for (const id in R) { const r = R[id]; zones.push([r.x - 6, r.y - 6, r.x + r.w + 6, r.y + r.h + 6]); }
        cand.sort((a, b) => a.d - b.d);
        /** @type {number[][]} */
        const placed = [];
        for (const c of cand) {
            const el = c.el;
            const ex = /** @type {any} */ (el);
            if (refresh || !ex._w) { ex._w = el.offsetWidth; ex._h = el.offsetHeight; }
            const w = (ex._w || 120) * c.s, h = (ex._h || 40) * c.s;
            const r = [c.x - w / 2, c.y - h, c.x + w / 2, c.y];
            let ok = r[0] >= 2 && r[2] <= vw - 2 && r[1] >= 2;      // вывеска, вылезшая за край экрана, не нужна
            if (ok) for (const z of zones) if (r[0] < z[2] && r[2] > z[0] && r[1] < z[3] && r[3] > z[1]) { ok = false; break; }
            if (ok) for (const q of placed) if (r[0] < q[2] + 4 && r[2] > q[0] - 4 && r[1] < q[3] + 2 && r[3] > q[1] - 2) { ok = false; break; }
            const vis = ok ? '' : 'hidden';
            if (el.style.visibility !== vis) el.style.visibility = vis;
            if (ok) placed.push(r);
            el.style.transform = 'translate3d(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px,0) translate(-50%,-100%) scale(' + c.s.toFixed(2) + ')';
        }
    },

    _fillLabel(i, L, d) {
        const sig = (d.rname || '') + '|' + d.type + '|' + (d.name || '') + '|' + (d.inc || '') + '|' + (d.cash || 0) + '|' + (d.price || '') + '|' + (d.ok ? 1 : 0) + '|' + Lang.code;
        if (sig === this._labSig[i]) return;
        this._labSig[i] = sig;
        const el = L.el;
        el.className = 'sde-lab' + (d.type === 'buy' ? ' buy' : d.type === 'empty' ? ' empty' : '');
        if (d.color) el.style.setProperty('--rc', d.color); else el.style.removeProperty('--rc');
        L.tag.hidden = d.type !== 'egg';
        L.ln.hidden = d.type !== 'egg';
        L.pr.hidden = d.type !== 'buy';
        if (d.type === 'egg') {
            L.nm.textContent = d.name;
            L.tag.textContent = d.rname;
            L.inc.textContent = '+' + GameData.money(d.inc) + this.t('sde.perSec');
            L.cash.textContent = d.cash >= 1 ? GameData.money(d.cash) : '';
        } else if (d.type === 'buy') {
            L.nm.textContent = this.t('sde.nestBuy');
            L.pr.textContent = GameData.money(d.price);
            L.pr.classList.toggle('no', !d.ok);
        } else L.nm.textContent = this.t('sde.nestEmpty');
    },

    // ---- маяк к яйцу или порталу ----
    _syncBeacon(raid) {
        const E = this.el, R = GameRaid;
        const on = raid && (R.phase === 'fight' || R.phase === 'carry');
        let tgt = null, color = '#ffd91a', icon = '';
        if (on) {
            if (R.phase === 'carry' && R.gate) { tgt = { x: R.gate.x, y: R.gate.y + 1.8, z: R.gate.z }; color = '#3dff6a'; icon = SDE_ICON.home; }
            else if (R.egg) { tgt = { x: R.egg.x, y: R.egg.y + 1.2, z: R.egg.z }; color = R.eggDef ? RARITIES[R.eggDef.rarity].color : '#ffd91a'; icon = SDE_DIR.ui + 'eggs/' + (R.eggDef ? R.eggDef.icon : 'brown') + '.webp'; }
        }
        if (!tgt) { if (!E.bc.hidden) E.bc.hidden = true; return; }
        if (E.bc.hidden) E.bc.hidden = false;
        if (E.bcImg.getAttribute('src') !== icon) { E.bcImg.style.visibility = ''; E.bcImg.src = icon; }
        E.bc.style.setProperty('--bc', color);
        const P = this._proj(tgt.x, tgt.y, tgt.z);
        const W = window.innerWidth, H = window.innerHeight;
        // безопасная зона: свободное место между блоками HUD
        const fr = HudLayout.free, m = 26 * HudLayout.k;
        let L = 50, T = 70, Rr = W - 50, B = H - 70;
        if (fr && fr.r > fr.l && fr.b > fr.t) {
            L = fr.l + m; Rr = fr.r - m; T = fr.t + m; B = fr.b - m;
            if (Rr - L < 40) { L = (fr.l + fr.r) / 2 - 20; Rr = L + 40; }
            if (B - T < 20) { T = (fr.t + fr.b) / 2 - 10; B = T + 20; }
        }
        const inView = P.vis && P.x > L && P.x < Rr && P.y > T && P.y < B;
        E.bc.classList.toggle('in-view', inView);
        E.bc.classList.toggle('bob', inView);
        let x = P.x, y = P.y - (inView ? 46 : 0), ang = 0;
        if (!inView) {
            const cx = (L + Rr) / 2, cy = (T + B) / 2;
            let dx = P.x - cx, dy = P.y - cy;
            if (P.behind) { dx = -dx; dy = -dy; }
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
            let k = Infinity;
            if (dx > 0) k = Math.min(k, (Rr - cx) / dx); else if (dx < 0) k = Math.min(k, (L - cx) / dx);
            if (dy > 0) k = Math.min(k, (B - cy) / dy); else if (dy < 0) k = Math.min(k, (T - cy) / dy);
            x = cx + dx * k; y = cy + dy * k;
            ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
            E.bcAr.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
        }
        E.bc.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
        const meters = Math.round(P.dist);
        const txt = meters + this.t('sde.m');
        if (E.bcD.textContent !== txt) E.bcD.textContent = txt;
    },

    // =====================================================================================
    // Обучение (Tutorial.js)
    // =====================================================================================

    _initTutorial() {
        const T = Tutorial, self = this, g = this.game;
        const base = () => g.mode === 'base';
        const raid = () => g.mode === 'raid';
        const skipBase = () => raid() || self._tutSkipBase;
        T.init({
            app: g.app,
            state: () => g.state, field: 'tutorialDone',
            persist: () => g.persist(),
            project: (x, z, y) => self._tutProject(x, z, y),
            skipKey: 'Enter',
            steps: [
                T.preset('look', { skipIf: skipBase }),
                T.preset('move', { skipIf: skipBase }),
                {
                    id: 'shoot', title: 'sde.tut.shoot.t', skipIf: skipBase,
                    hint: { keyboard: 'sde.tut.shoot.k', mouse: 'sde.tut.shoot.k', touch: 'sde.tut.shoot.m', pad: 'sde.tut.shoot.k' },
                    keys: { keyboard: ['attack'], pad: ['attack'] },
                    icons: { touch: ['tap'] },
                    target: { touch: '#sde-fire' },
                    world: () => self._dummyTarget(),
                },
                {
                    id: 'portal', title: 'sde.tut.portal.t', skipIf: skipBase,
                    hint: { keyboard: 'sde.tut.portal.k', mouse: 'sde.tut.portal.k', touch: 'sde.tut.portal.m', pad: 'sde.tut.portal.k' },
                    keys: { keyboard: ['interact'], pad: ['interact'] },
                    target: { touch: '@context' },
                    world: () => self._gateTarget(),
                },
                {
                    id: 'go', title: 'sde.tut.go.t', skipIf: () => raid(),
                    hint: { keyboard: 'sde.tut.go.k', mouse: 'sde.tut.go.k', touch: 'sde.tut.go.m', pad: 'sde.tut.go.k' },
                    keys: { keyboard: ['interact'], pad: ['interact'] },
                    target: { touch: '@context' },
                    world: () => self._gateTarget(),
                    check: () => raid(),
                },
                {
                    id: 'egg', title: 'sde.tut.egg.t', skipIf: () => base() || GameRaid.phase === 'carry',
                    hint: { keyboard: 'sde.tut.egg.k', mouse: 'sde.tut.egg.k', touch: 'sde.tut.egg.k', pad: 'sde.tut.egg.k' },
                    world: () => self._eggTarget(),
                    check: () => raid() && (GameRaid.phase === 'carry' || (!!GameRaid.near && GameRaid.near.id === 'egg') || self._eggDist() < 5),
                },
                {
                    id: 'take', title: 'sde.tut.take.t', skipIf: () => base() || GameRaid.phase === 'carry',
                    hint: { keyboard: 'sde.tut.take.k', mouse: 'sde.tut.take.k', touch: 'sde.tut.take.m', pad: 'sde.tut.take.k' },
                    keys: { keyboard: ['interact'], pad: ['interact'] },
                    target: { touch: '@context' },
                    world: () => self._eggTarget(),
                    check: () => GameRaid.phase === 'carry',
                },
                {
                    id: 'deliver', title: 'sde.tut.deliver.t', skipIf: () => base(),
                    hint: { keyboard: 'sde.tut.deliver.k', mouse: 'sde.tut.deliver.k', touch: 'sde.tut.deliver.k', pad: 'sde.tut.deliver.k' },
                    world: () => (GameRaid.phase === 'carry' ? self._gateTarget() : self._eggTarget()),
                },
            ],
            onFinish: () => { this._tutSkipBase = false; this._tutPending = ''; },
        });
    },

    _dummyTarget() {
        const p = this.game.player.pos;
        let best = null, bd = Infinity;
        for (const d of GameBase.dummies) {
            if (!d.e || d.e.dead) continue;
            const dist = Math.hypot(d.x - p.x, d.z - p.z);
            if (dist < bd) { bd = dist; best = d; }
        }
        return best ? { x: best.x, y: best.z, h: best.y + 2.3 } : null;
    },
    _gateTarget() {
        const R = GameRaid, B = GameBase, gt = this.game.mode === 'raid' ? R.gate : /** @type {any} */ (B).gate;
        return gt ? { x: gt.x, y: gt.z, h: gt.y + (this.game.mode === 'raid' ? 3 : 4.8) } : null;
    },
    _eggTarget() { const e = GameRaid.egg; return e ? { x: e.x, y: e.z, h: e.y + 1.8 } : null; },
    _eggDist() {
        const e = GameRaid.egg, p = this.game.player.pos;
        return e ? Math.hypot(e.x - p.x, e.z - p.z) : 999;
    },
};
