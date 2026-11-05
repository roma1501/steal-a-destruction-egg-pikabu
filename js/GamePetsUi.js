// GamePetsUi.js — окна питомцев: гнездо (высиживание, вылупление), пустое гнездо, «Питомцы и яйца», кодекс, показ нового питомца.
// Оформление — общие классы GameMenusStyle, своё — sde-pet-*, sde-cx-*.

/** @satisfies {Record<string, any>} */
const GamePetsUi = {
    _tab: 'pets',
    _cxTab: 'eggs',
    /** @type {string | null} */
    _cxSel: null,
    /** @type {any} */
    _live: null,

    get M() { return GameMenus; },
    t(k, p) { return Lang.t(k, p); },
    h(tag, cls, text) { return SdeUi.h(tag, cls, text); },
    img(src, cls) { const i = /** @type {HTMLImageElement} */ (this.h('img', cls || '')); i.src = src; i.alt = ''; i.draggable = false; return i; },
    ribbon(rarity) { const r = RARITIES[rarity], b = this.h('div', 'sde-ribbon', GameData.label(r)); b.style.setProperty('--rc', r.color); return b; },

    /** Кадр: живой отсчёт в окне гнезда. */
    step() {
        const L = this._live;
        if (!L || this.M.cur !== 'nest') return;
        const n = GameBase.state.nests[L.i], pr = GamePets.progress(n);
        if (pr.ready && !L.ready) { this.openNest(L.i); return; }
        if (L.bar) L.bar.style.width = (pr.k * 100).toFixed(1) + '%';
        if (L.txt) L.txt.textContent = this.t('sde.pet.left', { t: GamePets.timeLabel(pr.left) });
        if (L.cash) L.cash.textContent = GameData.money(Math.floor(n.cash));
    },

    // ------------------------------------------------------------------ гнездо

    openNest(i) {
        const st = GameBase.state, n = st.nests[i];
        if (!n || !n.egg) { this.openEmptyNest(i); return; }
        const def = GameData.egg(n.egg), pet = n.pet ? GamePets.byEgg(n.egg) : null, r = RARITIES[def.rarity], M = this.M, h = this.h.bind(this);
        if (!def) return;
        M._sellT = 0;
        M._open('nest', { title: 'sde.nest.title', params: { n: i + 1 }, icon: 'nests', grad: ['#e19bff', '#7a2fd0'], ww: 860, money: true }, (body, foot, win) => {
            win.style.setProperty('--rc', r.color);
            const box = h('div', 'sde-nest');
            box.style.setProperty('--rc', r.color);
            const left = h('div', 'l'), right = h('div', 'r');
            const eg = h('div', 'eg');
            eg.appendChild(pet ? this.img(GamePets.thumbUrl(pet)) : SdeUi.eggImg(def));
            left.appendChild(eg);
            const nm = h('div', 'nm sde-f', GameData.label(pet || def));
            nm.style.cssText = 'font:400 clamp(18px,3.4vh,28px)/1.05 var(--sde-font);text-shadow:var(--ol3);text-transform:uppercase';
            left.appendChild(nm);
            left.appendChild(this.ribbon(def.rarity));
            box.appendChild(left);
            const rows = h('div', 'sde-rows');
            const row = (icon, key, val, cls) => {
                const w = h('div', 'sde-rw' + (cls ? ' ' + cls : ''));
                w.appendChild(SdeUi.icon(icon));
                w.appendChild(h('span', 'k', this.t(key)));
                const v = h('b', 'v', val);
                w.appendChild(v);
                rows.appendChild(w);
                return v;
            };
            row('bolt', 'sde.nest.income', '+' + GameData.money(GamePets.nestIncome(n)) + this.t('sde.perSec'));
            const cash = row('cash', 'sde.nest.stored', GameData.money(Math.floor(n.cash)));
            row('money', 'sde.nest.sell', GameData.money(GameBase.sellPrice(i) + Math.floor(n.cash)), 'tot');
            right.appendChild(rows);
            const acts = h('div', 'sde-menu sde-pet-acts');
            this._live = { i, cash, bar: null, txt: null, ready: false };
            if (pet) {
                right.appendChild(h('p', 'sde-sub', this.t('sde.pet.nestTip', { b: Math.round(GamePets.BONUS[def.rarity] * 100) })));
                acts.appendChild(this._companionBtn(pet, () => this.openNest(i)));
                acts.appendChild(M._btn(this.t('sde.pet.toCollection'), 'b', () => { GamePets.takeOut(i); M.close(); this.M.hud.toast('sde.pet.collected'); }, { icon: 'home' }));
            } else {
                const pr = GamePets.progress(n);
                this._live.ready = pr.ready;
                const hb = h('div', 'sde-pet-hatch');
                if (pr.ready) hb.appendChild(h('div', 'txt rdy', this.t('sde.pet.ready', { name: GameData.label(def) })));
                else {
                    const tr = h('div', 'bar'), fill = /** @type {HTMLElement} */ (h('i'));
                    fill.style.width = (pr.k * 100).toFixed(1) + '%';
                    tr.appendChild(fill);
                    const tx = h('div', 'txt', this.t('sde.pet.left', { t: GamePets.timeLabel(pr.left) }));
                    hb.append(tx, tr);
                    this._live.bar = fill; this._live.txt = tx;
                }
                right.appendChild(hb);
                if (pr.ready) acts.appendChild(M._btn(this.t('sde.pet.hatch'), 'g', () => this._doHatch(i, false), { cls: 'big', icon: 'play' }));
                else if (Platform.rewardedSupported()) {
                    acts.appendChild(M._adBtn('hatch', 'sde.pet.hatchAd', 'sde.pet.hatchAdSub', 'y', async () => {
                        const ok = await Platform.rewarded('pet-hatch');
                        if (ok) this._doHatch(i, true);
                        return ok;
                    }));
                }
                acts.appendChild(M._btn(this.t('sde.pet.toBag'), 'b', () => { GamePets.takeOut(i); M.close(); M.hud.toast('sde.eggBagged'); }, { icon: 'home' }));
            }
            const sell = M._btn(this.t('sde.sell'), 'o', (e, btn) => {
                if (M._sellT <= 0) { M._sellT = 3; btn.querySelector('span').textContent = this.t('sde.sell.sure'); btn.classList.add('r'); return; }
                const got = GameBase.sellPrice(i) + Math.floor(n.cash);
                if (GameBase.sellEgg(i)) { M.close(); M.hud.toast('sde.sold', { p: GameData.money(got) }); M._settle(); }
            }, { icon: 'money' });
            acts.appendChild(sell);
            right.appendChild(acts);
            box.appendChild(right);
            body.appendChild(box);
        });
    },

    _doHatch(i, early) {
        const res = GamePets.hatch(i, early);
        if (!res) return;
        this.M.close(true);
        this.reveal(res);
    },

    /** Кнопка «взять с собой» / «уже с тобой». */
    _companionBtn(pet, after) {
        const st = GameBase.state, on = st.companion === pet.id, b = Math.round(GamePets.BONUS[GamePets.rarityOf(pet)] * 100);
        return this.M._btn(this.t(on ? 'sde.pet.leave' : 'sde.pet.take', { b }), on ? 'k' : 'p', () => {
            GamePets.setCompanion(on ? null : pet.id);
            after();
        }, { icon: 'star' });
    },

    /** Показ нового питомца. */
    reveal(res) {
        const M = this.M, p = res.pet, def = GamePets.eggOf(p), r = RARITIES[def.rarity], h = this.h.bind(this);
        M._open('nest', { title: 'sde.pet.newTitle', icon: 'egg', grad: ['#fff58a', '#ff9d1f'], ww: 520, money: true }, (body) => {
            const w = h('div', 'sde-pet-new');
            w.style.setProperty('--rc', r.color);
            const pic = h('div', 'pic');
            pic.appendChild(this.img(GamePets.thumbUrl(p)));
            w.appendChild(pic);
            w.appendChild(h('div', 'nm', GameData.label(p)));
            w.appendChild(this.ribbon(def.rarity));
            w.appendChild(h('div', 'inf', this.t('sde.pet.newInfo', { i: GameData.money(def.income * GamePets.INCOME_MUL) + this.t('sde.perSec'), b: Math.round(GamePets.BONUS[def.rarity] * 100) })));
            if (res.reward) w.appendChild(h('div', 'rew', this.t('sde.cx.firstReward', { p: GameData.money(res.reward) })));
            body.appendChild(w);
            const acts = h('div', 'sde-menu');
            acts.appendChild(this._companionBtn(p, () => M.close()));
            acts.appendChild(M._btn(this.t('sde.close'), 'g', () => M.close(), { cls: 'big' }));
            body.appendChild(acts);
            M._startFw(r.color);
        });
    },

    /** Пустое гнездо: что поставить. */
    openEmptyNest(i) {
        const M = this.M, h = this.h.bind(this), st = GameBase.state;
        M._open('nest', { title: 'sde.nest.title', params: { n: i + 1 }, icon: 'nests', grad: ['#e19bff', '#7a2fd0'], ww: 760, money: true }, (body) => {
            this._live = null;
            body.appendChild(h('p', 'sde-sub', this.t('sde.pet.emptyTip')));
            const grid = h('div', 'sde-pet-grid');
            for (const id in st.eggBag) {
                const d = GameData.egg(id);
                if (!d) continue;
                grid.appendChild(this._card(SdeUi.eggImg(d), GameData.label(d), d.rarity, '×' + st.eggBag[id], M._btn(this.t('sde.pet.place'), 'g', () => { GamePets.placeFromBag(i, id); M.close(); }, { cls: 'wide sm' })));
            }
            for (const p of GamePets.list()) {
                const free = GamePets.free(p.id);
                if (free <= 0) continue;
                grid.appendChild(this._card(this.img(GamePets.thumbUrl(p)), GameData.label(p), GamePets.rarityOf(p), '×' + free, M._btn(this.t('sde.pet.place'), 'g', () => { GamePets.placePet(i, p.id); M.close(); }, { cls: 'wide sm' })));
            }
            if (!grid.childNodes.length) body.appendChild(h('p', 'sde-sub', this.t('sde.pet.nothing')));
            else body.appendChild(grid);
        });
    },

    _card(pic, name, rarity, extra, btn) {
        const h = this.h.bind(this), c = h('div', 'sde-pet-card');
        c.style.setProperty('--rc', RARITIES[rarity].color);
        const ph = h('div', 'pic');
        ph.appendChild(pic);
        c.appendChild(ph);
        c.appendChild(h('div', 'nm', name));
        c.appendChild(this.ribbon(rarity));
        if (extra) c.appendChild(h('div', 'ex', extra));
        if (btn) c.appendChild(btn);
        return c;
    },

    // ------------------------------------------------------------------ питомцы и яйца

    openPets(tab) {
        if (tab) this._tab = tab;
        this.M._open('petsw', { title: 'sde.pets.title', icon: 'egg', grad: ['#9bff7a', '#1fa83e'], ww: 980, money: true }, () => this._renderPets());
    },

    _renderPets() {
        const M = this.M, h = this.h.bind(this), st = GameBase.state, body = M.body;
        if (!body || M.cur !== 'petsw') return;
        const top = body.scrollTop;
        body.textContent = '';
        const tabs = h('div', 'sde-tabs');
        for (const k of ['pets', 'eggs']) tabs.appendChild(M._btn(this.t('sde.pets.tab.' + k), 'b', () => { this._tab = k; this._renderPets(); }, { cls: 'sde-tab' + (k === this._tab ? ' on' : '') }));
        body.appendChild(tabs);
        const grid = h('div', 'sde-pet-grid');
        const freeNest = st.nests.findIndex(n => !n.egg);
        if (this._tab === 'pets') {
            for (const p of GamePets.list()) {
                const cnt = st.pets[p.id] || 0;
                if (!cnt) continue;
                const free = GamePets.free(p.id), c = this._card(this.img(GamePets.thumbUrl(p)), GameData.label(p), GamePets.rarityOf(p), this.t('sde.pets.count', { n: cnt, f: free }), null);
                if (st.companion === p.id) c.classList.add('on');
                const btn = this._companionBtn(p, () => this._renderPets());
                btn.classList.add('wide', 'sm');
                c.appendChild(btn);
                if (free > 0 && freeNest >= 0) c.appendChild(M._btn(this.t('sde.pet.place'), 'g', () => { GamePets.placePet(freeNest, p.id); this._renderPets(); }, { cls: 'wide sm' }));
                grid.appendChild(c);
            }
            if (!grid.childNodes.length) body.appendChild(h('p', 'sde-sub', this.t('sde.pets.none')));
        } else {
            for (const id in st.eggBag) {
                const d = GameData.egg(id);
                if (!d) continue;
                const btn = freeNest >= 0 ? M._btn(this.t('sde.pet.place'), 'g', () => { GamePets.placeFromBag(freeNest, id); this._renderPets(); }, { cls: 'wide sm' }) : h('div', 'sde-need', this.t('sde.pets.noNest'));
                grid.appendChild(this._card(SdeUi.eggImg(d), GameData.label(d), d.rarity, '×' + st.eggBag[id], btn));
            }
            st.nests.forEach((n, i) => {
                if (!n.egg || n.pet) return;
                const d = GameData.egg(n.egg), pr = GamePets.progress(n);
                const c = this._card(SdeUi.eggImg(d), GameData.label(d), d.rarity, pr.ready ? this.t('sde.pets.readyShort') : this.t('sde.pet.left', { t: GamePets.timeLabel(pr.left) }), null);
                c.appendChild(M._btn(this.t(pr.ready ? 'sde.pet.hatch' : 'sde.pets.toNest', { n: i + 1 }), pr.ready ? 'g' : 'b', () => { M.close(true); this.openNest(i); }, { cls: 'wide sm' }));
                grid.appendChild(c);
            });
            if (!grid.childNodes.length) body.appendChild(h('p', 'sde-sub', this.t('sde.pets.noEggs')));
        }
        body.appendChild(grid);
        body.scrollTop = top;
    },

    // ------------------------------------------------------------------ кодекс

    /** С какой вылазки встречается редкость. */
    _firstRaid(rarity) {
        const r = RAIDS.find(q => q.odds[rarity] > 0);
        return r ? r.n : 1;
    },

    openCodex(tab) {
        if (tab) this._cxTab = tab;
        this._cxSel = null;
        this.M._open('codexw', { title: 'sde.cx.title', icon: 'star', grad: ['#ff9a8a', '#c7121f'], ww: 1060, money: true }, () => this._renderCodex());
    },

    _renderCodex() {
        const M = this.M, h = this.h.bind(this), st = GameBase.state, body = M.body, cx = st.codex, eggs = this._cxTab === 'eggs';
        if (!body || M.cur !== 'codexw') return;
        const top = body.scrollTop;
        body.textContent = '';
        const tabs = h('div', 'sde-tabs');
        for (const k of ['eggs', 'pets']) tabs.appendChild(M._btn(this.t('sde.cx.tab.' + k), 'b', () => { this._cxTab = k; this._cxSel = null; this._renderCodex(); }, { cls: 'sde-tab' + (k === this._cxTab ? ' on' : '') }));
        body.appendChild(tabs);
        const items = eggs ? EGGS : GamePets.list();
        const seen = id => (eggs ? cx.eggs[id] : cx.pets[id]) || 0;
        const have = items.filter(it => seen(it.id)).length;
        const bar = h('div', 'sde-cx-prog');
        bar.appendChild(h('b', '', this.t('sde.cx.found', { a: have, b: items.length })));
        const tr = h('div', 'bar'), fill = /** @type {HTMLElement} */ (h('i'));
        fill.style.width = (have / items.length * 100).toFixed(1) + '%';
        tr.appendChild(fill);
        bar.appendChild(tr);
        body.appendChild(bar);
        if (this._cxSel) body.appendChild(this._cxDetail(this._cxSel, eggs, seen));
        const grid = h('div', 'sde-cx-grid');
        for (const it of items) {
            const n = seen(it.id), rar = eggs ? it.rarity : GamePets.rarityOf(it);
            const c = h('button', 'sde-cx-card' + (n ? '' : ' lock') + (this._cxSel === it.id ? ' sel' : ''));
            /** @type {HTMLButtonElement} */ (c).type = 'button';
            c.style.setProperty('--rc', RARITIES[rar].color);
            c.appendChild(eggs ? SdeUi.eggImg(it) : this.img(GamePets.thumbUrl(it, !n)));
            c.appendChild(h('span', 'nm', n ? GameData.label(it) : '???'));
            if (n) c.appendChild(h('span', 'cnt', '×' + n));
            c.addEventListener('click', () => { this._cxSel = it.id; this._renderCodex(); });
            grid.appendChild(c);
        }
        body.appendChild(grid);
        body.scrollTop = this._cxSel ? 0 : top;
    },

    _cxDetail(id, eggs, seen) {
        const h = this.h.bind(this), it = eggs ? GameData.egg(id) : GamePets.def(id), n = seen(id);
        const def = eggs ? it : GamePets.eggOf(it), rar = def.rarity;
        const d = h('div', 'sde-cx-det');
        d.style.setProperty('--rc', RARITIES[rar].color);
        const ph = h('div', 'pic' + (n ? '' : ' lock'));
        ph.appendChild(eggs ? SdeUi.eggImg(it) : this.img(GamePets.thumbUrl(it, !n)));
        d.appendChild(ph);
        const inf = h('div', 'inf');
        inf.appendChild(h('div', 'nm', n ? GameData.label(it) : '???'));
        inf.appendChild(this.ribbon(rar));
        const line = (k, v) => { const w = h('div', 'ln'); w.appendChild(h('span', '', this.t(k))); w.appendChild(h('b', '', v)); inf.appendChild(w); };
        if (eggs) {
            line('sde.cx.income', '+' + GameData.money(def.income) + this.t('sde.perSec'));
            line('sde.cx.hatch', GamePets.timeLabel(GamePets.hatchTime(def)));
            line('sde.cx.hatchesTo', n ? GameData.label(GamePets.byEgg(id)) : '???');
        } else {
            line('sde.cx.income', '+' + GameData.money(def.income * GamePets.INCOME_MUL) + this.t('sde.perSec'));
            line('sde.cx.bonus', '+' + Math.round(GamePets.BONUS[rar] * 100) + '%');
            line('sde.cx.fromEgg', n ? GameData.label(def) : '???');
        }
        line('sde.cx.where', this.t('sde.cx.whereVal', { n: this._firstRaid(rar) }));
        d.appendChild(inf);
        return d;
    },

    /** CSS окон питомцев и кодекса. */
    css() {
        return `
.sde-pet-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(170px,46%),1fr));gap:10px}
.sde-pet-card{display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px;border:4px solid #000;border-radius:18px;background:linear-gradient(#2c3f91,#1a2764);box-shadow:inset 0 0 0 2px var(--rc,#fff),0 4px 0 rgba(0,0,0,.4);min-width:0}
.sde-pet-card.on{background:linear-gradient(#2f8f55,#17582f)}
.sde-pet-card .pic{width:clamp(70px,14vh,108px);aspect-ratio:1;display:flex;align-items:center;justify-content:center}
.sde-pet-card .pic img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 3px 0 rgba(0,0,0,.45))}
.sde-pet-card .nm{font:400 clamp(13px,2.2vh,17px)/1.08 var(--sde-font);text-align:center;text-transform:uppercase;text-shadow:var(--ol2);overflow-wrap:anywhere}
.sde-pet-card .sde-btn{white-space:normal;line-height:1.05;min-height:38px;padding:3px 6px;font-size:clamp(11.5px,1.8vh,13.5px)}
.sde-pet-card .ex{font:700 12px/1.2 var(--sde-sans);color:#d6e2ff;text-align:center}
.sde-pet-acts{margin-top:10px}
.sde-pet-acts .sde-btn,.sde-pet-new~.sde-menu .sde-btn{white-space:normal;line-height:1.05;min-width:0}
.sde-nest .r{min-width:0;max-width:100%}
.sde-nest .sde-rows{width:100%}
.sde-pet-hatch{margin:8px 0}
.sde-pet-hatch .txt{font:700 13px/1.2 var(--sde-sans);text-align:center;margin-bottom:4px;text-shadow:0 1px 0 #000}
.sde-pet-hatch .txt.rdy{font:400 16px/1.15 var(--sde-font);color:#8bff8f;text-shadow:var(--ol2);text-transform:uppercase}
.sde-pet-hatch .bar,.sde-cx-prog .bar{height:14px;border:3px solid #000;border-radius:99px;background:#0a0f2b;overflow:hidden}
.sde-pet-hatch .bar i,.sde-cx-prog .bar i{display:block;height:100%;background:linear-gradient(#8bff8f,#2fd851)}
.sde-pet-new{display:flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:12px;text-align:center}
.sde-pet-new .pic{width:clamp(70px,26vh,210px);aspect-ratio:1;background:radial-gradient(circle,color-mix(in srgb,var(--rc) 55%,transparent),transparent 70%)}
.sde-pet-new .pic img{width:100%;height:100%;object-fit:contain;animation:sde-pet-bob .9s ease-in-out infinite alternate}
.sde-pet-new .nm{font:400 clamp(20px,4vh,32px)/1.05 var(--sde-font);text-transform:uppercase;text-shadow:var(--ol3)}
.sde-pet-new .inf{font:700 13px/1.3 var(--sde-sans);color:#d6e2ff}
.sde-pet-new .rew{font:400 16px/1.1 var(--sde-font);color:#ffe03a;text-shadow:var(--ol2)}
@keyframes sde-pet-bob{from{transform:translateY(4px)}to{transform:translateY(-6px)}}
.sde-cx-prog{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.sde-cx-prog b{flex:none;font:400 clamp(14px,2.4vh,18px)/1 var(--sde-font);color:#ffe03a;text-shadow:var(--ol2);text-transform:uppercase}
.sde-cx-prog .bar{flex:1;min-width:40px}
.sde-cx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(128px,30%),1fr));gap:8px}
.sde-cx-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 4px;border:4px solid #000;border-radius:16px;background:linear-gradient(#2c3f91,#1a2764);box-shadow:inset 0 0 0 2px var(--rc,#fff);cursor:pointer;color:#fff;min-width:0}
.sde-cx-card.sel{outline:3px solid #fff;outline-offset:1px}
.sde-cx-card img{width:clamp(52px,10vh,78px);aspect-ratio:1;object-fit:contain;filter:drop-shadow(0 2px 0 rgba(0,0,0,.45))}
.sde-cx-card.lock{background:linear-gradient(#20254a,#141832)}
.sde-cx-card.lock img{filter:brightness(0) drop-shadow(0 0 3px rgba(255,255,255,.25))}
.sde-cx-card .nm{font:400 clamp(10px,1.6vh,13px)/1.05 var(--sde-font);text-align:center;text-transform:uppercase;text-shadow:var(--ol1);overflow-wrap:anywhere}
.sde-cx-card .cnt{position:absolute;top:3px;right:6px;font:400 13px/1 var(--sde-font);color:#ffe03a;text-shadow:var(--ol1)}
.sde-cx-det{display:flex;gap:12px;align-items:center;margin-bottom:10px;padding:8px 12px;border:4px solid #000;border-radius:18px;background:linear-gradient(#18285f,#0f1a45);box-shadow:inset 0 0 0 2px var(--rc,#fff)}
.sde-cx-det .pic{flex:none;width:clamp(70px,16vh,120px);aspect-ratio:1}
.sde-cx-det .pic img{width:100%;height:100%;object-fit:contain}
.sde-cx-det .pic.lock img{filter:brightness(0) drop-shadow(0 0 3px rgba(255,255,255,.25))}
.sde-cx-det .inf{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;align-items:flex-start}
.sde-cx-det .nm{font:400 clamp(16px,3vh,24px)/1.05 var(--sde-font);text-transform:uppercase;text-shadow:var(--ol2)}
.sde-cx-det .ln{display:flex;justify-content:space-between;gap:10px;width:100%;font:700 12.5px/1.25 var(--sde-sans);color:#d6e2ff}
.sde-cx-det .ln b{color:#fff;text-align:right}
`;
    },
};
