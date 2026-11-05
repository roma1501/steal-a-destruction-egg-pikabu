// GameMenusStyle.js — общий слой интерфейса «Steal a Destruction Egg»: список значков (пути литералами для сборщика),
// помощники разметки и весь CSS (HUD, окна, титул). Стиль — Roblox-brainrot: толстые чёрные обводки, насыщенные градиенты,
// глянцевая полоса на кнопках, «нажатие» вниз, шашечный фон панелей, пружинная анимация. Шрифт — Russo One (кириллица,
// @font-face в index.html), мелкий текст — Rubik. Используют GameHud.js (HUD) и GameMenus.js (окна, титул, пауза).

/** Значки интерфейса. Пути — литералы: сборщик (tools/asset-scan.mjs) видит их и кладёт файлы в архив. */
const SDE_ICON = {
    money: 'assets/ui/money-bag.webp', cash: 'assets/ui/banknotes.webp', bonus: 'assets/ui/cash-bonus.webp',
    heart: 'assets/ui/heart.webp', shield: 'assets/ui/shield.webp', lock: 'assets/ui/lock.webp', gift: 'assets/ui/gift.webp',
    shop: 'assets/ui/shop.webp', trophy: 'assets/ui/trophy.webp', star: 'assets/ui/star.webp', sparkles: 'assets/ui/sparkles.webp',
    gear: 'assets/ui/gear.webp', bolt: 'assets/ui/lightning.webp', question: 'assets/ui/question.webp', timer: 'assets/ui/timer.webp',
    shoe: 'assets/ui/shoe.webp', up: 'assets/ui/jump-arrow.webp', hand: 'assets/ui/interact-hand.webp',
    egg: 'assets/ui/egg-cracked.webp', skull: 'assets/ui/skull.webp', backpack: 'assets/ui/backpack.webp', nests: 'assets/ui/nests.webp',
    check: 'assets/ui/check.webp', cross: 'assets/ui/cross.webp', play: 'assets/ui/play.webp', fire: 'assets/ui/fire.webp',
    sword: 'assets/ui/sword.webp', radar: 'assets/ui/radar.webp', home: 'assets/ui/home.webp', dollar: 'assets/ui/dollar.webp',
};

/** Глифы времени суток, погоды и босса (SVG 24×24, без файлов). */
const SDE_GLYPH = {
    day: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="#ffe03a" stroke="#000" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="#000" stroke-width="2.4" stroke-linecap="round"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="#ffe03a" stroke-width="1" stroke-linecap="round"/></svg>',
    dawn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17a8 8 0 0 1 16 0z" fill="#ffb4d6" stroke="#000" stroke-width="2" stroke-linejoin="round"/><path d="M2 20h20" stroke="#000" stroke-width="2.4" stroke-linecap="round"/><path d="M12 4v3M4 9l2 2M20 9l-2 2" stroke="#ffe9a0" stroke-width="2" stroke-linecap="round"/></svg>',
    sunset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17a8 8 0 0 1 16 0z" fill="#ff8a3c" stroke="#000" stroke-width="2" stroke-linejoin="round"/><path d="M2 20h20" stroke="#000" stroke-width="2.4" stroke-linecap="round"/><path d="M8 10l1.5 1.5M16 10l-1.5 1.5" stroke="#ffd0a0" stroke-width="2" stroke-linecap="round"/></svg>',
    night: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3a9 9 0 1 0 5 15A7.5 7.5 0 0 1 16 3z" fill="#dfe6ff" stroke="#000" stroke-width="2" stroke-linejoin="round"/></svg>',
    rain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 19 7a3.8 3.8 0 0 1-1 7z" fill="#cfe0ff" stroke="#000" stroke-width="2" stroke-linejoin="round"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" stroke="#3aa0ff" stroke-width="2.4" stroke-linecap="round"/></svg>',
    snow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" stroke="#000" stroke-width="4" stroke-linecap="round"/><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" stroke="#e8f6ff" stroke-width="2" stroke-linecap="round"/></svg>',
    storm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 13a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 19 6a3.8 3.8 0 0 1-1 7z" fill="#9a8fc0" stroke="#000" stroke-width="2" stroke-linejoin="round"/><path d="M13 12l-3 5h3l-2 5 5-7h-3l2-3z" fill="#ffe03a" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    boss: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z" fill="#f4f4ff" stroke="#000" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="11" r="2" fill="#000"/><circle cx="15" cy="11" r="2" fill="#000"/><path d="M10 17v2M14 17v2" stroke="#000" stroke-width="1.6"/></svg>',
};

/** Значки яиц (поле icon записи EGGS = имя файла без расширения). Список литералов — чтобы сборщик включил все файлы. */
const SDE_EGG_FILES = [
    'assets/ui/eggs/brown.webp', 'assets/ui/eggs/stone.webp', 'assets/ui/eggs/cracked.webp', 'assets/ui/eggs/slime.webp',
    'assets/ui/eggs/ice.webp', 'assets/ui/eggs/leaf.webp', 'assets/ui/eggs/soul.webp', 'assets/ui/eggs/skull.webp',
    'assets/ui/eggs/crystal.webp', 'assets/ui/eggs/golden.webp', 'assets/ui/eggs/flaming.webp', 'assets/ui/eggs/diamond.webp',
    'assets/ui/eggs/volcanic.webp', 'assets/ui/eggs/aurora.webp', 'assets/ui/eggs/asteroid.webp', 'assets/ui/eggs/solaris.webp',
    'assets/ui/eggs/galaxy.webp', 'assets/ui/eggs/egg-giant.webp', 'assets/ui/eggs/blackhole.webp', 'assets/ui/eggs/egg-dragon.webp',
];

/** Значки оружия: файл на оружие (id из WEAPONS в GameData.js). Литералы — чтобы сборщик включил их в архив. */
const SDE_WEAPON_FILES = [
    'assets/ui/weapons/hammer.webp', 'assets/ui/weapons/ar_ginger.webp', 'assets/ui/weapons/sg_granny.webp', 'assets/ui/weapons/bomb.webp',
    'assets/ui/weapons/gl_thumper.webp', 'assets/ui/weapons/grab.webp', 'assets/ui/weapons/carbine_sigma.webp', 'assets/ui/weapons/torch.webp',
    'assets/ui/weapons/launcher.webp', 'assets/ui/weapons/gl_drum.webp', 'assets/ui/weapons/sg_autodrum.webp', 'assets/ui/weapons/minigun_brrt.webp',
    'assets/ui/weapons/gl_sticky.webp', 'assets/ui/weapons/sawgun.webp', 'assets/ui/weapons/sniper_giga.webp', 'assets/ui/weapons/tesla.webp',
    'assets/ui/weapons/gl_cluster.webp', 'assets/ui/weapons/freezer.webp', 'assets/ui/weapons/railgun.webp', 'assets/ui/weapons/minigun_vulcan.webp',
    'assets/ui/weapons/sharkgun.webp', 'assets/ui/weapons/blackhole.webp',
];

/** Папки ассетов, из которых пути собираются из частей (бренд — логотип и обложка меню появятся позже: см. docs/CODEX-IMAGEGEN-PROMPT.md). */
const SDE_DIR = { ui: 'assets/ui/', brand: 'assets/branding/' };

/** @satisfies {Record<string, any>} */
const SdeUi = {
    ICON: SDE_ICON,
    /** Есть ли значки оружия на диске: null — ещё не проверено, true / false — проба первого файла. */
    weaponIcons: /** @type {boolean | null} */ (null),
    logoOk: false,

    /** Элемент: h('div', 'класс', 'текст'). */
    h(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
    },

    /** Кольцо теней-обводки: радиус px, n направлений — круглая обводка текста без зазоров на диагоналях. */
    ol(px, n, col) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            out.push((Math.cos(a) * px).toFixed(2) + 'px ' + (Math.sin(a) * px).toFixed(2) + 'px 0 ' + (col || '#000'));
        }
        return out.join(',');
    },

    /** Картинка-значок. Нет файла — картинка скрыта, ошибки нет. */
    img(src, cls) {
        const i = /** @type {HTMLImageElement} */ (document.createElement('img'));
        i.className = cls || '';
        i.alt = '';
        i.draggable = false;
        i.decoding = 'async';
        i.addEventListener('error', () => { i.style.visibility = 'hidden'; }, { once: true });
        i.src = src;
        return i;
    },
    icon(name, cls) { return this.img(SDE_ICON[name] || '', cls); },

    /** Значок яйца по записи EGGS. */
    eggImg(def, cls) { return this.img(SDE_DIR.ui + 'eggs/' + (def && def.icon ? def.icon : 'brown') + '.webp', cls); },

    /** Значок оружия assets/ui/weapons/<id>.webp; пока файла нет — плитка с названием. Возвращает контейнер. */
    weaponTile(w, cls) {
        const box = this.h('div', 'sde-wt ' + (cls || ''));
        box.dataset.cat = w.cat || '';
        const nm = this.h('span', 'sde-wt-name', GameData.label(w));
        box.appendChild(nm);
        if (this.weaponIcons !== false) {
            const i = /** @type {HTMLImageElement} */ (document.createElement('img'));
            i.alt = '';
            i.draggable = false;
            // файлы есть — название прячем сразу (без мигания), нет файла — название остаётся
            if (this.weaponIcons === true) nm.style.visibility = 'hidden';
            i.addEventListener('load', () => { nm.style.display = 'none'; });
            i.addEventListener('error', () => { i.remove(); nm.style.visibility = ''; if (this.weaponIcons === null) this.weaponIcons = false; }, { once: true });
            i.src = SDE_DIR.ui + 'weapons/' + w.id + '.webp';
            box.appendChild(i);
        }
        return box;
    },

    /** Проба: лежат ли значки оружия (один запрос; нет — остальные не просим). */
    probeWeaponIcons() {
        const i = new Image();
        i.onload = () => { this.weaponIcons = true; };
        i.onerror = () => { this.weaponIcons = false; };
        i.src = SDE_DIR.ui + 'weapons/' + (typeof WEAPONS !== 'undefined' && WEAPONS[0] ? WEAPONS[0].id : 'hammer') + '.webp';
    },

    inject() {
        if (document.getElementById('sde-style')) return;
        const st = document.createElement('style');
        st.id = 'sde-style';
        st.textContent = this.css() + GamePetsUi.css() + GameShopUi.css();
        document.head.appendChild(st);
    },

    css() {
        const O1 = this.ol(1.4, 10), O2 = this.ol(2.4, 14), O3 = this.ol(3.4, 16), O4 = this.ol(5, 20);
        return `
:root{
--sde-font:'Russo One','Arial Black','Impact',system-ui,sans-serif;
--sde-sans:'Rubik','Segoe UI',system-ui,sans-serif;
--ink:#07050f;
--ol1:${O1},0 2px 0 #000;
--ol2:${O2},0 3px 0 #000;
--ol3:${O3},0 4px 0 #000;
--ol4:${O4},0 6px 0 #000;
--navy:#16224f;--navy2:#1f3270;--chk1:#2c4c96;--chk2:#243f82;
--tut-bg:#16224f;--tut-fg:#fff;--tut-accent:#ffd91a;--tut-border:#000;--tut-font:var(--sde-sans);--tut-radius:16px;
--lory-input-fg:#fff;--lory-input-bg:rgba(8,10,40,.32);--lory-input-accent:linear-gradient(#ffe86a,#ffb400);
}
#sde-root{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:var(--sde-sans);color:#fff;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;overflow:hidden}
#sde-root *,.sde-ov *,.sde-title *{box-sizing:border-box}
#sde-root [hidden],.sde-ov [hidden],.sde-title [hidden],.sde-title[hidden],.sde-ov[hidden]{display:none!important}
html.sde-menu #sde-hud,html.sde-menu #sde-world{visibility:hidden}
html.sde-title-on #sde-hud,html.sde-title-on #sde-world{display:none}
.sde-f{font-family:var(--sde-font);font-weight:400}

/* ---------- кнопки ---------- */
.sde-btn{--c1:#7dff86;--c2:#2fd851;--c3:#14a935;--tx:#fff;position:relative;appearance:none;-webkit-appearance:none;margin:0;display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:46px;padding:0 22px;border:3.5px solid #000;border-radius:15px;font:400 clamp(16px,2.5vh,22px)/1 var(--sde-font);color:var(--tx);text-transform:uppercase;letter-spacing:.02em;text-shadow:var(--ol2);white-space:nowrap;background:linear-gradient(var(--c1) 0,var(--c2) 48%,var(--c3) 52%,var(--c3) 100%);box-shadow:inset 0 -5px 0 rgba(0,0,0,.26),0 5px 0 #000,0 8px 0 rgba(0,0,0,.28);cursor:pointer;overflow:hidden;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .06s,box-shadow .06s,filter .12s}
.sde-btn::before{content:'';position:absolute;left:7px;right:7px;top:3px;height:36%;border-radius:12px 12px 40px 40px/12px 12px 18px 18px;background:linear-gradient(rgba(255,255,255,.7),rgba(255,255,255,.1));pointer-events:none}
.sde-btn>*{position:relative}
.sde-btn:hover{filter:brightness(1.08) saturate(1.1)}
.sde-btn:active,.sde-btn.down{transform:translateY(4px);box-shadow:inset 0 -3px 0 rgba(0,0,0,.26),0 1px 0 #000}
.sde-btn:focus-visible{outline:4px solid #fff;outline-offset:3px}
.sde-btn img{width:1.5em;height:1.5em;object-fit:contain;filter:drop-shadow(0 2px 0 rgba(0,0,0,.5))}
.sde-btn.b{--c1:#8adcff;--c2:#2f95ff;--c3:#1560d0}
.sde-btn.p{--c1:#e19bff;--c2:#a24cf0;--c3:#6b23be}
.sde-btn.y{--c1:#fff58a;--c2:#ffcb1f;--c3:#ea9500;--tx:#fff}
.sde-btn.r{--c1:#ff9a8a;--c2:#ff3d3d;--c3:#c7121f}
.sde-btn.o{--c1:#ffc673;--c2:#ff8c22;--c3:#da6000}
.sde-btn.k{--c1:#96a0b8;--c2:#5b6580;--c3:#394258}
.sde-btn.w{--c1:#ffffff;--c2:#e4eaff;--c3:#aab6dd}
.sde-btn.off{--c1:#8f95a8;--c2:#666d84;--c3:#454b60;filter:saturate(.55)}
.sde-btn.big{min-height:clamp(54px,9vh,78px);padding:0 clamp(12px,3vw,52px);font-size:clamp(18px,min(4.2vh,6vw),36px);border-radius:20px;border-width:4.5px}
.sde-btn.sm{min-height:38px;padding:0 14px;font-size:15px;border-radius:12px;border-width:3px}
.sde-btn.wide{width:100%}
.sde-shake{animation:sde-shake .35s}
@keyframes sde-shake{0%,100%{transform:none}20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(4px)}}

/* ---------- значки оружия: плитка с названием, пока файла нет ---------- */
.sde-wt{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:12px;background:linear-gradient(160deg,#5d78c8,#2c3f86)}
.sde-wt[data-cat=rifle]{background:linear-gradient(160deg,#58a8ff,#2a55c0)}
.sde-wt[data-cat=minigun]{background:linear-gradient(160deg,#ff8a6a,#c22a2a)}
.sde-wt[data-cat=launcher]{background:linear-gradient(160deg,#ffb24a,#d0661a)}
.sde-wt[data-cat=shotgun]{background:linear-gradient(160deg,#5fe28a,#1e9a4a)}
.sde-wt[data-cat=special]{background:linear-gradient(160deg,#c88aff,#6a2fc4)}
.sde-wt[data-cat=melee]{background:linear-gradient(160deg,#e9d86a,#b08a10)}
.sde-wt img{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;filter:drop-shadow(0 3px 0 rgba(0,0,0,.45))}
.sde-wt-name{position:relative;padding:2px 4px;text-align:center;font:400 var(--wt-fs,12px)/1.05 var(--sde-font);color:#fff;text-shadow:var(--ol1);overflow-wrap:anywhere;hyphens:auto}

/* ---------- HUD: деньги ---------- */
#sde-hud{position:absolute;inset:0;pointer-events:none}
.sde-money{display:flex;align-items:center;gap:calc(8px*var(--hl-k,1));min-width:0;pointer-events:none}
.sde-money img{flex:none;width:calc(58px*var(--hl-k,1));height:calc(58px*var(--hl-k,1));object-fit:contain;filter:drop-shadow(0 3px 0 rgba(0,0,0,.5));transition:transform .12s}
.sde-money.pop img{transform:scale(1.2) rotate(-8deg)}
.sde-money .m{display:flex;flex-direction:column;gap:calc(3px*var(--hl-k,1));min-width:0}
.sde-money .v{font:400 calc(46px*var(--hl-k,1))/.95 var(--sde-font);color:#5dff6c;text-shadow:var(--ol3);letter-spacing:.01em;white-space:nowrap;transition:transform .12s}
.sde-money.pop .v{transform:scale(1.1);transform-origin:0 50%}
.sde-money .inc{font:400 calc(21px*var(--hl-k,1))/1 var(--sde-font);color:#fff35e;text-shadow:var(--ol2);white-space:nowrap}
.sde-egg-wait{display:inline-flex;align-items:center;gap:6px;margin-top:calc(4px*var(--hl-k,1));padding:2px 10px 2px 4px;border:3px solid #000;border-radius:12px;background:linear-gradient(#ff9a52,#e0591a);font:400 calc(14px*var(--hl-k,1))/1.1 var(--sde-font);color:#fff;text-shadow:var(--ol1);animation:sde-blink 1.2s ease-in-out infinite}
.sde-egg-wait img{width:calc(26px*var(--hl-k,1));height:calc(26px*var(--hl-k,1));object-fit:contain;filter:none}
@keyframes sde-blink{50%{filter:brightness(1.3)}}

/* ---------- HUD: колонка кнопок ---------- */
.sde-side{display:grid;grid-template-columns:1fr;grid-template-rows:repeat(4,1fr);gap:calc(9px*var(--hl-k,1));pointer-events:none}
.sde-side.row{grid-template-columns:repeat(4,1fr);grid-template-rows:1fr;gap:calc(7px*var(--hl-k,1))}
.sde-sq{--c1:#8adcff;--c2:#2f95ff;--c3:#1560d0;position:relative;appearance:none;-webkit-appearance:none;margin:0;padding:0;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;border:calc(4px*var(--hl-k,1)) solid #000;border-radius:calc(18px*var(--hl-k,1));background:linear-gradient(var(--c1) 0,var(--c2) 46%,var(--c3) 54%,var(--c3) 100%);box-shadow:inset 0 calc(-6px*var(--hl-k,1)) 0 rgba(0,0,0,.25),0 calc(5px*var(--hl-k,1)) 0 #000;overflow:hidden;cursor:pointer;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .06s,box-shadow .06s,filter .12s;font-family:var(--sde-font)}
.sde-sq::before{content:'';position:absolute;left:8%;right:8%;top:4%;height:34%;border-radius:40% 40% 60% 60%/60% 60% 40% 40%;background:linear-gradient(rgba(255,255,255,.65),rgba(255,255,255,.08));pointer-events:none}
.sde-sq:hover{filter:brightness(1.1)}
.sde-sq:active{transform:translateY(calc(4px*var(--hl-k,1)));box-shadow:inset 0 calc(-4px*var(--hl-k,1)) 0 rgba(0,0,0,.25),0 calc(1px*var(--hl-k,1)) 0 #000}
.sde-sq img{position:absolute;left:50%;top:8%;width:62%;height:62%;transform:translateX(-50%);object-fit:contain;filter:drop-shadow(0 3px 0 rgba(0,0,0,.45))}
.sde-sq span{position:relative;z-index:1;padding-bottom:calc(5px*var(--hl-k,1));font-size:calc(11px*var(--hl-k,1));letter-spacing:-.01em;line-height:1;color:#fff;text-shadow:var(--ol1);text-transform:uppercase;white-space:nowrap;max-width:100%}
.sde-side.row .sde-sq span{display:none}
.sde-side.row .sde-sq img{top:50%;width:72%;height:72%;transform:translate(-50%,-50%)}
.sde-sq.g{--c1:#8bff8f;--c2:#2fd851;--c3:#14a935}
.sde-sq.r{--c1:#ff9a8a;--c2:#ff3d3d;--c3:#c7121f}
.sde-sq.o{--c1:#ffc673;--c2:#ff8c22;--c3:#da6000}
.sde-sq.p{--c1:#e19bff;--c2:#a24cf0;--c3:#6b23be}
.sde-sq.k{--c1:#a5aec4;--c2:#6a7490;--c3:#444c66}
.sde-sq.attn::after{content:'!';position:absolute;right:calc(3px*var(--hl-k,1));top:calc(2px*var(--hl-k,1));width:calc(22px*var(--hl-k,1));height:calc(22px*var(--hl-k,1));border:2.5px solid #000;border-radius:50%;background:#ffe03a;color:#000;font:400 calc(15px*var(--hl-k,1))/calc(17px*var(--hl-k,1)) var(--sde-font);text-align:center;animation:sde-bob .7s ease-in-out infinite alternate}
@keyframes sde-bob{to{transform:translateY(-4px)}}

/* ---------- HUD: здоровье (сердце бьётся, красная жидкость в капсуле) ---------- */
.sde-hp{display:flex;flex-direction:column;justify-content:flex-end;gap:calc(2px*var(--hl-k,1));pointer-events:none}
.sde-hp .lowtxt{height:calc(16px*var(--hl-k,1));padding-left:calc(40px*var(--hl-k,1));font:400 calc(14px*var(--hl-k,1))/calc(16px*var(--hl-k,1)) var(--sde-font);color:#ff5050;text-shadow:var(--ol1);text-transform:uppercase;white-space:nowrap;opacity:0}
.sde-hp.low .lowtxt{animation:sde-lowblink .5s steps(1) infinite}
@keyframes sde-lowblink{0%{opacity:1}50%{opacity:.15}}
.sde-hp .row{display:flex;align-items:center;flex:1;min-height:0}
.sde-hp .hrt{position:relative;z-index:3;flex:none;width:calc(54px*var(--hl-k,1));height:calc(54px*var(--hl-k,1));margin:calc(-6px*var(--hl-k,1)) calc(-18px*var(--hl-k,1)) calc(-6px*var(--hl-k,1)) 0}
.sde-hp .hb{position:absolute;inset:0;transform-origin:50% 58%;animation:sde-beat var(--beat,1s) ease-out infinite}
.sde-hp .hb img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 3px 0 rgba(0,0,0,.5))}
.sde-hp .hb svg{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity .2s}
.sde-hp.low .hb svg{opacity:1}
.sde-hp.low .hrt{animation:sde-tremble .09s linear infinite alternate}
@keyframes sde-beat{0%{transform:scale(1)}9%{transform:scale(1.26)}20%{transform:scale(1.02)}31%{transform:scale(1.16)}46%,100%{transform:scale(1)}}
@keyframes sde-tremble{from{transform:translate(-1.2px,0) rotate(-4deg)}to{transform:translate(1.2px,1px) rotate(4deg)}}
.sde-hp .bar{position:relative;flex:1;height:calc(32px*var(--hl-k,1));border:calc(4px*var(--hl-k,1)) solid #000;border-radius:99px;background:#2a0b12;overflow:hidden;box-shadow:0 calc(4px*var(--hl-k,1)) 0 rgba(0,0,0,.4)}
.sde-hp.low .bar{animation:sde-barblink .5s ease-in-out infinite}
@keyframes sde-barblink{50%{opacity:.55}}
.sde-hp .liq{position:absolute;inset:0;will-change:transform;transition:transform .6s cubic-bezier(.3,.9,.3,1)}
.sde-hp .body{position:absolute;left:0;top:0;bottom:0;right:calc(14px*var(--hl-k,1));background:#e8303a}
.sde-hp .waves{position:absolute;top:0;bottom:0;right:0;width:calc(22px*var(--hl-k,1));transform-origin:100% 50%}
.sde-hp .waves.splash{animation:sde-splash .6s ease-out}
@keyframes sde-splash{0%{transform:scaleX(1)}22%{transform:scaleX(2.4)}58%{transform:scaleX(.9)}100%{transform:scaleX(1)}}
.sde-hp .wv{position:absolute;right:0;top:0;width:100%;height:calc(100% + 28px*var(--hl-k,1));background-repeat:repeat-y;background-size:100% calc(28px*var(--hl-k,1))}
.sde-hp .wv.a{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28' preserveAspectRatio='none'%3E%3Cpath d='M0 0H11C20 7 2 21 11 28H0Z' fill='%23f2434d'/%3E%3C/svg%3E");animation:sde-wv 1.3s linear infinite}
.sde-hp .wv.b{right:calc(-4px*var(--hl-k,1));background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28' preserveAspectRatio='none'%3E%3Cpath d='M0 0H11C20 7 2 21 11 28H0Z' fill='%23a81826'/%3E%3C/svg%3E");animation:sde-wv 2.2s linear infinite reverse}
@keyframes sde-wv{from{transform:translateY(0)}to{transform:translateY(calc(-28px*var(--hl-k,1)))}}
.sde-hp.low .wv.a{animation-duration:.55s}
.sde-hp.low .wv.b{animation-duration:.95s}
.sde-hp .bub{position:absolute;bottom:0;width:calc(var(--bs)*var(--hl-k,1));height:calc(var(--bs)*var(--hl-k,1));right:calc(var(--br)*var(--hl-k,1));border-radius:50%;background:rgba(255,255,255,.55);box-shadow:inset 0 0 0 calc(1.5px*var(--hl-k,1)) rgba(255,255,255,.85);opacity:0;animation:sde-bubble var(--bd) ease-in var(--bl) infinite}
@keyframes sde-bubble{0%{opacity:0;transform:translate(0,calc(8px*var(--hl-k,1))) scale(.5)}15%{opacity:.9}100%{opacity:0;transform:translate(calc(var(--bx)*var(--hl-k,1)),calc(-26px*var(--hl-k,1))) scale(1)}}
.sde-hp.low .bub{animation-duration:calc(var(--bd)*.4)}
.sde-hp .dark{position:absolute;inset:0;background:rgba(48,0,14,.55);opacity:0;transition:opacity .5s}
.sde-hp.low .dark{opacity:1}
.sde-hp .shade{position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(rgba(60,0,10,0),rgba(60,0,10,.42))}
.sde-hp .glass{position:absolute;left:5%;right:5%;top:7%;height:34%;border-radius:99px;background:linear-gradient(rgba(255,255,255,.72),rgba(255,255,255,.1))}
.sde-hp .shine{position:absolute;inset:0;background:#fff;opacity:0}
.sde-hp .shine.go{animation:sde-shine .8s ease-out}
@keyframes sde-shine{0%{opacity:.7}100%{opacity:0}}
.sde-hp .n{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-left:calc(14px*var(--hl-k,1));font:400 calc(17px*var(--hl-k,1))/1 var(--sde-font);color:#fff;text-shadow:var(--ol1)}
.sde-hp.hit{animation:sde-shake .3s}
.sde-lowrim{position:absolute;inset:0;pointer-events:none;opacity:0;box-shadow:inset 0 0 0 6px rgba(170,8,24,.95),inset 0 0 80px 14px rgba(190,10,28,.75)}
.sde-lowrim.on{animation:sde-lowbeat var(--beat,1s) ease-out infinite}
.sde-lowrim.crit{box-shadow:inset 0 0 0 10px rgba(185,6,24,1),inset 0 0 130px 30px rgba(205,8,28,.9)}
@keyframes sde-lowbeat{0%{opacity:.2}9%{opacity:1}20%{opacity:.3}31%{opacity:.85}46%,100%{opacity:.2}}

/* ---------- HUD: цель вылазки ---------- */
.sde-obj{display:flex;flex-direction:column;align-items:stretch;gap:calc(5px*var(--hl-k,1));padding:calc(8px*var(--hl-k,1)) calc(14px*var(--hl-k,1)) calc(9px*var(--hl-k,1));border:calc(4px*var(--hl-k,1)) solid #000;border-radius:calc(18px*var(--hl-k,1));background:linear-gradient(#2f4fa8,#1b2f72);box-shadow:inset 0 0 0 calc(2px*var(--hl-k,1)) rgba(255,255,255,.2),0 calc(5px*var(--hl-k,1)) 0 rgba(0,0,0,.4);pointer-events:none}
.sde-obj .t{display:flex;align-items:center;justify-content:center;gap:calc(8px*var(--hl-k,1));font:400 calc(21px*var(--hl-k,1))/1.05 var(--sde-font);text-transform:uppercase;text-align:center;color:#ffe03a;text-shadow:var(--ol2)}
.sde-obj .t img{width:calc(30px*var(--hl-k,1));height:calc(30px*var(--hl-k,1));object-fit:contain;flex:none}
.sde-obj .c{display:flex;justify-content:center;gap:calc(14px*var(--hl-k,1));flex-wrap:wrap}
.sde-obj .w{text-align:center;font:700 calc(12.5px*var(--hl-k,1))/1.1 var(--sde-sans);color:#d6e2ff;text-shadow:0 1px 0 #000;text-transform:uppercase;letter-spacing:.04em}
.sde-chip{display:inline-flex;align-items:center;gap:calc(5px*var(--hl-k,1));font:400 calc(18px*var(--hl-k,1))/1 var(--sde-font);color:#fff;text-shadow:var(--ol1)}
.sde-chip img{width:calc(26px*var(--hl-k,1));height:calc(26px*var(--hl-k,1));object-fit:contain}
.sde-chip.g{color:#5dff6c}
.sde-obj.alarm{background:linear-gradient(#e83a3a,#9d1218);animation:sde-alarm .55s ease-in-out infinite alternate}
.sde-obj.alarm .t{color:#fff}
@keyframes sde-alarm{to{filter:brightness(1.3);transform:scale(1.025)}}

/* ---------- HUD: хотбар и патроны ---------- */
.sde-tray{display:flex;flex-direction:column;align-items:stretch;gap:calc(6px*var(--hl-k,1));padding-top:calc(12px*var(--hl-k,1));pointer-events:none}
.sde-ammo{position:relative;min-height:calc(34px*var(--hl-k,1))}
.sde-ammo .nm{position:absolute;left:50%;bottom:0;transform:translateX(-50%);font:400 calc(19px*var(--hl-k,1))/1 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase;white-space:nowrap;opacity:0;transition:opacity .35s,bottom .12s;pointer-events:none}
.sde-ammo.nm-on .nm{opacity:1}
.sde-ammo.am .nm{bottom:calc(36px*var(--hl-k,1))}
.sde-ammo .mg{position:absolute;left:0;right:0;bottom:0;text-align:center;font:400 calc(34px*var(--hl-k,1))/1 var(--sde-font);color:#ffe03a;text-shadow:var(--ol3);white-space:nowrap;opacity:0;transition:opacity .25s;pointer-events:none}
.sde-ammo.am .mg{opacity:1;transition:opacity .08s}
.sde-ammo .mg small{font-size:.6em;color:#fff}
.sde-ammo .mg.empty{color:#ff5555;animation:sde-blink .4s linear infinite}
.sde-rl{position:relative;height:calc(14px*var(--hl-k,1));margin:0 calc(6px*var(--hl-k,1));border:calc(3px*var(--hl-k,1)) solid #000;border-radius:99px;background:#101636;overflow:hidden;opacity:0;transition:opacity .12s}
.sde-rl.on{opacity:1}
.sde-rl i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(#fff6a0,#ffc81c 55%,#e89400)}
.sde-slots{display:grid;grid-template-columns:repeat(var(--n,3),1fr);gap:calc(7px*var(--hl-k,1));align-items:end}
.sde-slot{--c1:#6e86d0;--c2:#34469a;position:relative;appearance:none;-webkit-appearance:none;margin:0;padding:0;min-width:0;aspect-ratio:1;border:calc(3.5px*var(--hl-k,1)) solid #000;border-radius:calc(14px*var(--hl-k,1));background:linear-gradient(var(--c1),var(--c2));box-shadow:inset 0 calc(-4px*var(--hl-k,1)) 0 rgba(0,0,0,.28),0 calc(4px*var(--hl-k,1)) 0 rgba(0,0,0,.55);overflow:hidden;pointer-events:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .12s cubic-bezier(.2,1.6,.4,1)}
.sde-slot::before{content:'';position:absolute;left:8%;right:8%;top:3%;height:30%;border-radius:40% 40% 60% 60%/60% 60% 40% 40%;background:linear-gradient(rgba(255,255,255,.5),rgba(255,255,255,0));pointer-events:none;z-index:2}
.sde-slot .n{position:absolute;left:calc(5px*var(--hl-k,1));top:calc(2px*var(--hl-k,1));z-index:3;font:400 calc(17px*var(--hl-k,1))/1 var(--sde-font);color:#fff;text-shadow:var(--ol1)}
.sde-slot .sde-wt{position:absolute;inset:calc(12px*var(--hl-k,1)) calc(4px*var(--hl-k,1)) calc(4px*var(--hl-k,1));border-radius:calc(8px*var(--hl-k,1));background:none!important;--wt-fs:calc(11px*var(--hl-k,1))}
.sde-slot.cur{--c1:#fff27a;--c2:#ffb400;border-color:#000;transform:translateY(calc(-8px*var(--hl-k,1))) scale(1.1);box-shadow:inset 0 calc(-4px*var(--hl-k,1)) 0 rgba(0,0,0,.25),0 0 0 calc(3px*var(--hl-k,1)) #fff,0 0 calc(22px*var(--hl-k,1)) #ffd91a,0 calc(4px*var(--hl-k,1)) 0 rgba(0,0,0,.55);z-index:2}
.sde-slot.cur .sde-wt-name{color:#fff}
.sde-touch .sde-slot{pointer-events:auto}
.sde-nudge{outline:4px solid #ffd91a;outline-offset:3px;animation:sde-glow .75s ease-in-out infinite alternate}
@keyframes sde-glow{from{outline-color:#ffd91a}to{outline-color:#fff}}

/* ---------- HUD: прицел и попадание ---------- */
.sde-xh{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;pointer-events:none}
.sde-xh svg{display:block;width:100%;height:100%;overflow:visible}
.sde-xh .o{fill:none;stroke:#000;stroke-width:6.5;stroke-linecap:round;stroke-linejoin:round}
.sde-xh .w{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.sde-xh .dot.o{fill:#000;stroke:#000;stroke-width:4}
.sde-xh .dot.w{fill:#fff;stroke:none}
.sde-xh g{display:none}
.sde-xh g.tick,.sde-xh g.dot{display:block}
.sde-xh[data-k=pellets] g.ring,.sde-xh[data-k=flame] g.ring,.sde-xh[data-k=freeze] g.ring{display:block}
.sde-xh[data-k=pellets] g.tick,.sde-xh[data-k=flame] g.tick,.sde-xh[data-k=freeze] g.tick{display:none}
.sde-xh[data-k=proj] g.brk,.sde-xh[data-k=hole] g.brk,.sde-xh[data-k=bomb] g.brk,.sde-xh[data-k=grab] g.brk{display:block}
.sde-xh[data-k=proj] g.tick,.sde-xh[data-k=hole] g.tick,.sde-xh[data-k=bomb] g.tick,.sde-xh[data-k=grab] g.tick{display:none}
.sde-xh[data-k=melee] g.ring{display:block}
.sde-xh[data-k=melee] g.tick{display:none}
.sde-xh[data-k=rail] g.tick{transform:scale(1.35)}
.sde-xh[data-k=tesla] g.ring{display:block;opacity:.8}
.sde-xh.on .w{stroke:#ffe03a}
.sde-xh.on .dot.w{fill:#ffe03a}
.sde-hm{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;pointer-events:none;opacity:0}
.sde-hm svg{display:block;width:100%;height:100%;overflow:visible}
.sde-hm .o{fill:none;stroke:#000;stroke-width:8;stroke-linecap:round}
.sde-hm .w{fill:none;stroke:#fff;stroke-width:4;stroke-linecap:round}
.sde-hm.show{animation:sde-hm .24s ease-out}
.sde-hm.crit .w{stroke:#ffe03a}
.sde-hm.crit{width:84px;height:84px;margin:-42px 0 0 -42px}
.sde-hm.kill .w{stroke:#ff3b3b}
.sde-hm.kill{width:96px;height:96px;margin:-48px 0 0 -48px}
.sde-hm.kill.show{animation:sde-hmk .42s ease-out}
@keyframes sde-hm{0%{opacity:1;transform:scale(1.5)}100%{opacity:0;transform:scale(.9)}}
@keyframes sde-hmk{0%{opacity:1;transform:scale(1.7) rotate(0)}40%{opacity:1;transform:scale(1) rotate(20deg)}100%{opacity:0;transform:scale(1.2) rotate(45deg)}}

/* ---------- HUD: подсказка у объекта, тосты, баннер ---------- */
.sde-hint{display:flex;align-items:center;justify-content:center;gap:calc(10px*var(--hl-k,1));padding:calc(5px*var(--hl-k,1)) calc(16px*var(--hl-k,1)) calc(5px*var(--hl-k,1)) calc(6px*var(--hl-k,1));border:calc(4px*var(--hl-k,1)) solid #000;border-radius:calc(18px*var(--hl-k,1));background:linear-gradient(#2d3f8f,#16224f);box-shadow:inset 0 0 0 2px var(--hc,#7aa8ff),0 5px 0 rgba(0,0,0,.45);font:400 calc(23px*var(--hl-k,1))/1 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase;white-space:nowrap;pointer-events:none;animation:sde-pop-s .22s cubic-bezier(.2,1.6,.4,1) both}
.sde-hint .key{display:flex;align-items:center;justify-content:center;flex:none;min-width:1.7em;height:1.7em;padding:0 .3em;border:3.5px solid #000;border-radius:.4em;background:linear-gradient(#fff58a,#ffc81c 55%,#ea9500);color:#2a1a00;text-shadow:none;font-size:1em;box-shadow:inset 0 -3px 0 rgba(0,0,0,.2),0 3px 0 rgba(0,0,0,.5)}
.sde-hint .key.ico{background:none;border:0;box-shadow:none;min-width:0}
.sde-hint .key img{width:1.7em;height:1.7em;object-fit:contain}
.sde-hint small{font:600 .58em/1 var(--sde-sans);text-transform:none;color:#ffe9a0;text-shadow:var(--ol1);margin-left:2px}
.sde-hint[data-id=raid]{--hc:#d98bff}.sde-hint[data-id=arsenal]{--hc:#59b6ff}.sde-hint[data-id=upgrades]{--hc:#5dff6c}.sde-hint[data-id=nest]{--hc:#ffd91a}.sde-hint[data-id=buyNest]{--hc:#ff9a52}.sde-hint[data-id=egg]{--hc:#ffd91a}
@keyframes sde-pop-s{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
.sde-toasts{display:flex;flex-direction:column;align-items:center;gap:calc(6px*var(--hl-k,1));pointer-events:none}
.sde-toast{padding:calc(8px*var(--hl-k,1)) calc(18px*var(--hl-k,1));border:calc(3.5px*var(--hl-k,1)) solid #000;border-radius:calc(16px*var(--hl-k,1));background:linear-gradient(#ffe86a,#ffb400);box-shadow:inset 0 calc(-4px*var(--hl-k,1)) 0 rgba(0,0,0,.2),0 calc(4px*var(--hl-k,1)) 0 rgba(0,0,0,.45);font:400 calc(19px*var(--hl-k,1))/1.15 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-align:center;text-transform:uppercase;animation:sde-toast .3s cubic-bezier(.2,1.6,.4,1) both}
.sde-toast.bad{background:linear-gradient(#ff8a7a,#e02222)}
.sde-toast.out{animation:sde-toast-out .25s ease-in both}
@keyframes sde-toast{0%{opacity:0;transform:translateY(-14px) scale(.7)}100%{opacity:1;transform:none}}
@keyframes sde-toast-out{to{opacity:0;transform:translateY(-10px) scale(.9)}}
.sde-cap{display:flex;align-items:center;justify-content:center;padding:6px 16px;border:4px solid #000;border-radius:16px;background:linear-gradient(#ffe86a,#ffb400);font:400 calc(18px*var(--hl-k,1))/1.1 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase;text-align:center;white-space:nowrap;animation:sde-blink 1.1s ease-in-out infinite}
.sde-banner{position:absolute;left:0;right:0;top:24%;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;pointer-events:none}
.sde-banner b{display:block;max-width:92%;font:400 clamp(26px,min(11vh,10vw),92px)/1 var(--sde-font);color:#ffe03a;text-shadow:var(--ol4);text-transform:uppercase;animation:sde-ban 2.6s cubic-bezier(.2,1.5,.4,1) both}
.sde-banner.alarm b{color:#ff4545;animation:sde-ban 2.6s cubic-bezier(.2,1.5,.4,1) both,sde-shake .4s .1s 3}
@keyframes sde-ban{0%{opacity:0;transform:scale(.2) rotate(-8deg)}14%{opacity:1;transform:scale(1.18) rotate(2deg)}24%{transform:scale(1) rotate(0)}84%{opacity:1}100%{opacity:0;transform:scale(1.15) translateY(-20px)}}
.sde-rim{position:absolute;inset:0;pointer-events:none;opacity:0;box-shadow:inset 0 0 0 7px var(--rc,#fff),inset 0 0 70px 10px var(--rc,#fff)}
.sde-rim.on{opacity:1;animation:sde-rim .8s ease-in-out infinite alternate}
@keyframes sde-rim{from{opacity:.55}to{opacity:1}}
.sde-hurt{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(255,0,0,0) 38%,rgba(230,10,20,.62) 100%)}
.sde-hd{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;pointer-events:none}
.sde-hd i{position:absolute;left:-34px;top:calc(-1*min(30vh,250px) - 10px);width:68px;height:34px;background:radial-gradient(ellipse at 50% 100%,rgba(255,40,40,.95),rgba(255,40,40,0) 70%);border-radius:50% 50% 0 0}
.sde-hd.show{animation:sde-hd 1s ease-out}
@keyframes sde-hd{0%{opacity:1}60%{opacity:.85}100%{opacity:0}}

/* ---------- метка-маяк ---------- */
.sde-bc{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;will-change:transform}
.sde-bc .in{position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px}
.sde-bc .ring{position:relative;width:calc(58px*var(--hl-k,1));height:calc(58px*var(--hl-k,1));border:4px solid #000;border-radius:50%;background:radial-gradient(circle at 40% 30%,#fff,var(--bc,#fff) 70%);box-shadow:0 0 0 3px var(--bc,#fff),0 0 24px var(--bc,#fff);display:flex;align-items:center;justify-content:center}
.sde-bc .ring img{width:72%;height:72%;object-fit:contain}
.sde-bc .d{font:400 calc(21px*var(--hl-k,1))/1 var(--sde-font);color:#fff;text-shadow:var(--ol2);white-space:nowrap}
.sde-bc .ar{position:absolute;left:0;top:0;width:0;height:0}
.sde-bc .ar i{position:absolute;left:calc(-17px*var(--hl-k,1));top:calc(-62px*var(--hl-k,1));width:0;height:0;border-left:calc(17px*var(--hl-k,1)) solid transparent;border-right:calc(17px*var(--hl-k,1)) solid transparent;border-bottom:calc(26px*var(--hl-k,1)) solid var(--bc,#fff);filter:drop-shadow(0 0 0 #000) drop-shadow(0 3px 0 #000) drop-shadow(2px 0 0 #000) drop-shadow(-2px 0 0 #000)}
.sde-bc.in-view .ar{display:none}
.sde-bc.bob .ring{animation:sde-bob .6s ease-in-out infinite alternate}

/* ---------- метки в мире ---------- */
#sde-world{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.sde-lab{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:2px;white-space:nowrap;text-align:center;pointer-events:none;will-change:transform;transform-origin:50% 100%}
.sde-lab .nm{font:400 20px/1 var(--sde-font);color:var(--rc,#fff);text-shadow:var(--ol2);text-transform:uppercase}
.sde-lab .tag{display:inline-block;padding:2px 9px;border:3px solid #000;border-radius:10px;background:var(--rc,#888);font:400 12px/1 var(--sde-font);color:#fff;text-shadow:var(--ol1);text-transform:uppercase}
.sde-lab .ln{display:flex;gap:10px;justify-content:center;font:400 17px/1 var(--sde-font);text-shadow:var(--ol2)}
.sde-lab .inc{color:#fff35e}
.sde-lab .cash{color:#5dff6c}
.sde-lab.buy .nm{color:#ff9a52;font-size:19px}
.sde-lab.buy .pr{font:400 22px/1 var(--sde-font);color:#5dff6c;text-shadow:var(--ol2)}
.sde-lab.buy .pr.no{color:#ff6a5a}
.sde-lab.empty .nm{color:#c9d3ff;font-size:16px}
.sde-sign{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;pointer-events:none;will-change:transform;transform-origin:50% 100%}
.sde-sign b{display:block;padding:7px 18px 9px;border:4px solid #000;border-radius:15px;background:linear-gradient(var(--s1),var(--s2) 50%,var(--s3) 52%,var(--s3));box-shadow:inset 0 -6px 0 rgba(0,0,0,.25),0 7px 0 rgba(0,0,0,.4);font:400 30px/1 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase;letter-spacing:.03em;position:relative;overflow:hidden}
.sde-sign b::before{content:'';position:absolute;left:8px;right:8px;top:4px;height:34%;border-radius:12px 12px 40px 40px/12px 12px 20px 20px;background:linear-gradient(rgba(255,255,255,.55),rgba(255,255,255,.05))}
.sde-sign i{width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-top:15px solid #000;margin-top:2px}
.sde-sign.raid{--s1:#e6a0ff;--s2:#a24cf0;--s3:#6b23be}
.sde-sign.arsenal{--s1:#8adcff;--s2:#2f95ff;--s3:#1560d0}
.sde-sign.upgrades{--s1:#8bff8f;--s2:#2fd851;--s3:#14a935}
.sde-ft{position:absolute;left:0;top:0;font:400 24px/1 var(--sde-font);color:#fff;text-shadow:var(--ol2);white-space:nowrap;pointer-events:none;will-change:transform,opacity}
.sde-ft.crit{color:#ffe03a;font-size:36px;text-shadow:var(--ol3)}
.sde-ft.cash{color:#5dff6c;font-size:30px;text-shadow:var(--ol3)}

/* ---------- экранные кнопки касания ---------- */
.sde-pad{pointer-events:none}
.sde-tb{position:absolute;margin:0;padding:0;display:flex;align-items:center;justify-content:center;border:calc(4px*var(--hl-k,1)) solid #000;border-radius:50%;background:linear-gradient(var(--c1),var(--c2) 50%,var(--c3) 52%);box-shadow:inset 0 calc(-6px*var(--hl-k,1)) 0 rgba(0,0,0,.25),0 calc(5px*var(--hl-k,1)) 0 rgba(0,0,0,.5);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;appearance:none;-webkit-appearance:none;outline:none;overflow:hidden;transition:transform .05s}
.sde-tb::before{content:'';position:absolute;left:12%;right:12%;top:5%;height:36%;border-radius:50%;background:linear-gradient(rgba(255,255,255,.6),rgba(255,255,255,.05))}
.sde-tb svg,.sde-tb img{position:relative;width:54%;height:54%;object-fit:contain;filter:drop-shadow(0 2px 0 rgba(0,0,0,.45))}
.sde-tb.on{transform:scale(.9);filter:brightness(1.2)}
.sde-tb.fire{--c1:#ff9a8a;--c2:#ff3d3d;--c3:#c7121f;right:0;bottom:0;width:58%;height:auto;aspect-ratio:1}
.sde-tb.jump{--c1:#8adcff;--c2:#2f95ff;--c3:#1560d0;right:63%;bottom:2%;width:38%;aspect-ratio:1}
.sde-tb.rel{--c1:#ffe86a;--c2:#ffb400;--c3:#e89400;right:8%;bottom:63%;width:32%;aspect-ratio:1}
.sde-tb.fire svg{width:58%;height:58%}

/* ---------- окна ---------- */
.sde-ov{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:clamp(6px,2.2vh,22px) clamp(6px,2vw,22px);pointer-events:auto;font-family:var(--sde-sans);color:#fff;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;overscroll-behavior:contain}
.sde-ov::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,rgba(40,30,120,.5),rgba(4,2,22,.88));pointer-events:none}
.sde-ov canvas.fw{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2}
.sde-win{--h1:#ffc873;--h2:#ff8a1f;--ww:980px;position:relative;z-index:1;display:flex;flex-direction:column;width:min(100%,var(--ww));max-height:100%;border:5px solid #000;border-radius:26px;background:repeating-conic-gradient(var(--chk1) 0 25%,var(--chk2) 0 50%) 0 0/54px 54px;box-shadow:inset 0 0 0 4px rgba(150,190,255,.5),0 9px 0 rgba(0,0,0,.45);overflow:hidden;animation:sde-pop .42s cubic-bezier(.2,1.5,.4,1) both}
.sde-win.out{animation:sde-pop-out .16s ease-in both}
@keyframes sde-pop{0%{opacity:0;transform:scale(.55) translateY(40px)}100%{opacity:1;transform:none}}
@keyframes sde-pop-out{to{opacity:0;transform:scale(.85) translateY(10px)}}
.sde-head{position:relative;flex:none;display:flex;align-items:center;gap:12px;min-height:60px;padding:8px 12px 8px 18px;border-bottom:5px solid #000;background:repeating-linear-gradient(-45deg,rgba(255,255,255,.16) 0 14px,rgba(255,255,255,0) 14px 28px),linear-gradient(var(--h1),var(--h2))}
.sde-head>img{flex:none;width:clamp(30px,5vh,46px);height:clamp(30px,5vh,46px);object-fit:contain;filter:drop-shadow(0 3px 0 rgba(0,0,0,.45))}
.sde-title-t{flex:1;min-width:0;font:400 clamp(15px,min(4.4vh,5vw),40px)/1.05 var(--sde-font);text-transform:uppercase;letter-spacing:.02em;color:#fff;text-shadow:var(--ol3)}
.sde-mchip{flex:none;display:inline-flex;align-items:center;gap:6px;padding:2px 14px 2px 6px;border:4px solid #000;border-radius:16px;background:linear-gradient(#10321a,#0a2412);font:400 clamp(18px,3.2vh,26px)/1 var(--sde-font);color:#5dff6c;text-shadow:var(--ol2)}
.sde-mchip img{width:clamp(26px,4.2vh,36px);height:clamp(26px,4.2vh,36px);object-fit:contain}
.sde-btn.sde-x{flex:none;width:clamp(40px,6vh,52px);height:clamp(40px,6vh,52px);padding:0;min-height:0;border-radius:14px}
.sde-btn.sde-x img{width:70%;height:70%}
.sde-body{position:relative;flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;padding:clamp(10px,2vh,18px);scrollbar-width:thin;scrollbar-color:#ffc81c #101636}
.sde-body::-webkit-scrollbar{width:12px}.sde-body::-webkit-scrollbar-thumb{background:#ffc81c;border:3px solid #000;border-radius:8px}.sde-body::-webkit-scrollbar-track{background:#101636}
.sde-foot{flex:none;display:flex;justify-content:center;gap:12px;flex-wrap:wrap;padding:10px 14px 14px;border-top:5px solid #000;background:linear-gradient(#1b2a63,#101a46)}
.sde-sub{margin:0 0 10px;font:600 clamp(13px,2vh,16px)/1.3 var(--sde-sans);color:#d6e2ff;text-shadow:0 1px 0 #000;text-align:center}
.sde-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(clamp(190px,24vw,250px),1fr));gap:clamp(8px,1.6vh,14px)}
.sde-card{position:relative;display:flex;flex-direction:column;gap:8px;padding:10px;border:4px solid #000;border-radius:20px;background:linear-gradient(#2c3f91,#1a2764);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14),0 5px 0 rgba(0,0,0,.4);overflow:hidden}
.sde-card.locked{filter:saturate(.35) brightness(.78)}
.sde-card h3{margin:0;font:400 clamp(17px,2.8vh,22px)/1.05 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase}
.sde-card .row{display:flex;align-items:center;gap:8px;min-width:0}
.sde-card .sp{flex:1}
.sde-stars{display:flex;gap:1px;align-items:center}
.sde-stars img{width:18px;height:18px;object-fit:contain}
.sde-stars img.dim{filter:grayscale(1) brightness(.5);opacity:.55}
.sde-odds{display:flex;height:16px;border:3px solid #000;border-radius:8px;overflow:hidden;background:#0a0f2b}
.sde-odds i{display:block;height:100%;min-width:3px}
.sde-leg{display:flex;flex-wrap:wrap;gap:3px 9px;font:700 12px/1.1 var(--sde-sans);color:#e8eeff}
.sde-leg span{display:inline-flex;align-items:center;gap:4px;text-shadow:0 1px 0 #000}
.sde-leg span::before{content:'';width:11px;height:11px;border:2px solid #000;border-radius:3px;background:var(--rc)}
.sde-info{display:flex;align-items:center;gap:6px;font:700 13px/1.15 var(--sde-sans);color:#fff;text-shadow:0 1px 0 #000}
.sde-info img{width:24px;height:24px;object-fit:contain;flex:none}
.sde-info b{font:400 16px/1 var(--sde-font);color:#5dff6c;text-shadow:var(--ol1)}
.sde-lockov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:rgba(6,8,30,.8);text-align:center;padding:12px;font:400 15px/1.2 var(--sde-font);text-shadow:var(--ol1)}
.sde-lockov img{width:54px;height:54px;object-fit:contain;filter:drop-shadow(0 3px 0 #000)}
.sde-bar{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px;padding:8px 10px;border:4px solid #000;border-radius:18px;background:linear-gradient(#18285f,#0f1a45)}
.sde-bar .lab{flex:none;font:400 clamp(13px,2vh,16px)/1.05 var(--sde-font);color:#ffe03a;text-shadow:var(--ol1);text-transform:uppercase;max-width:110px}
.sde-hb{flex:none;position:relative;width:clamp(46px,min(9vh,14vw),72px);aspect-ratio:1;padding:0;border:4px solid #000;border-radius:14px;background:linear-gradient(#6e86d0,#34469a);box-shadow:inset 0 -4px 0 rgba(0,0,0,.28),0 4px 0 rgba(0,0,0,.5);cursor:pointer;overflow:hidden;appearance:none;-webkit-appearance:none;touch-action:manipulation;transition:transform .1s cubic-bezier(.2,1.6,.4,1);--wt-fs:11px}
.sde-hb .n{position:absolute;left:4px;top:1px;z-index:3;font:400 15px/1 var(--sde-font);color:#fff;text-shadow:var(--ol1)}
.sde-hb .sde-wt{position:absolute;inset:14px 3px 3px;background:none!important}
.sde-hb .rm::after{content:'';position:absolute;inset:-8px}
.sde-hb .plus{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:400 28px/1 var(--sde-font);color:#9fb0ef;text-shadow:var(--ol1)}
.sde-hb.sel{background:linear-gradient(#fff27a,#ffb400);transform:translateY(-3px) scale(1.06);box-shadow:inset 0 -4px 0 rgba(0,0,0,.25),0 0 0 3px #fff,0 0 16px #ffd91a}
.sde-hb .rm{position:absolute;right:1px;top:1px;z-index:4;width:20px;height:20px;border:2.5px solid #000;border-radius:50%;background:#ff3d3d;color:#fff;font:400 12px/15px var(--sde-font);text-align:center;padding:0}
.sde-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(148px,46%),1fr));gap:7px;margin-bottom:12px;padding:0 2px 6px}
.sde-tab{min-height:42px;padding:0 6px;font-size:clamp(13px,min(2.1vh,3.6vw),17px);border-radius:13px}
.sde-tab.on{filter:none}
.sde-tab:not(.on){--c1:#7b88ae;--c2:#4a5679;--c3:#313a58;filter:saturate(.7) brightness(.92)}

/* ---------- вылазки: сетка из сотни карточек ---------- */
.sde-rinfo{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:6px 10px;border:4px solid #000;border-radius:16px;background:linear-gradient(#18285f,#0f1a45);font:400 clamp(13px,2.2vh,17px)/1.1 var(--sde-font);color:#ffe03a;text-shadow:var(--ol1);text-transform:uppercase}
.sde-rinfo img{width:28px;height:28px;object-fit:contain}
.sde-rinfo span{flex:1;min-width:0}
.sde-rgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(clamp(180px,22vw,235px),1fr));gap:clamp(7px,1.4vh,12px)}
.sde-rc{position:relative;display:flex;flex-direction:column;gap:6px;padding:8px 9px 9px;border:4px solid #000;border-radius:18px;background:linear-gradient(#2c3f91,#1a2764);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14),0 5px 0 rgba(0,0,0,.4);overflow:hidden}
.sde-rc.cur{background:linear-gradient(#2f8f55,#17582f);box-shadow:inset 0 0 0 2px rgba(255,255,255,.3),0 0 0 3px #ffd91a,0 5px 0 rgba(0,0,0,.4)}
.sde-rc.locked{filter:saturate(.4) brightness(.8)}
.sde-rc .hd{display:flex;align-items:center;gap:8px;min-width:0}
.sde-rc .num{flex:none;min-width:38px;padding:2px 7px;border:3px solid #000;border-radius:10px;background:linear-gradient(#fff58a,#ffb400);font:400 15px/1.15 var(--sde-font);color:#2a1a00;text-align:center}
.sde-rc .nm{flex:1;min-width:0;font:400 clamp(14px,2.3vh,18px)/1.05 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase;overflow-wrap:anywhere}
.sde-rc .dn{flex:none;font:400 15px/1 var(--sde-font);color:#5dff6c;text-shadow:var(--ol1)}
.sde-st10{position:relative;width:160px;height:16px;flex:none}
.sde-st10 b,.sde-st10 i{position:absolute;left:0;top:0;height:16px;background:url(${SDE_ICON.star}) 0 0/16px 16px repeat-x}
.sde-st10 b{width:160px;filter:grayscale(1) brightness(.45);opacity:.6}
.sde-st10 i{width:calc(var(--n)*16px)}
.sde-rc .chips{display:flex;flex-wrap:wrap;gap:4px;min-height:22px}
.sde-ch{display:inline-flex;align-items:center;gap:4px;padding:1px 8px 1px 3px;border:2.5px solid #000;border-radius:9px;background:#0d1540;font:800 10.5px/1.25 var(--sde-sans);text-transform:uppercase;color:#fff;text-shadow:0 1px 0 #000}
.sde-ch svg{width:16px;height:16px;flex:none}
.sde-ch.day{background:#2f7be0}.sde-ch.dawn{background:#b0539c}.sde-ch.sunset{background:#d4601c}.sde-ch.night{background:#2b2f78}
.sde-ch.rain{background:#3f6fa8}.sde-ch.snow{background:#5aa0c8}.sde-ch.storm{background:#5a3d86}.sde-ch.boss{background:#b01630}

/* ---------- карточка оружия ---------- */
.sde-wcard{display:grid;grid-template-columns:clamp(70px,12vh,92px) minmax(0,1fr);grid-template-rows:auto auto;gap:6px 10px;padding:10px;border:4px solid #000;border-radius:20px;background:linear-gradient(#2c3f91,#1a2764);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14),0 5px 0 rgba(0,0,0,.4)}
.sde-wcard.eq{background:linear-gradient(#2f8f55,#17582f)}
.sde-wcard .ic{grid-row:1;align-self:start;aspect-ratio:1;border:4px solid #000;border-radius:16px;--wt-fs:14px}
.sde-wcard .ic.sde-wt{border-radius:14px}
.sde-wcard .mid{grid-column:2;grid-row:1;display:flex;flex-direction:column;gap:5px;min-width:0}
.sde-wcard .act{grid-column:1/-1;grid-row:2}
.sde-wcard h3{margin:0;font:400 clamp(16px,2.6vh,20px)/1.05 var(--sde-font);text-shadow:var(--ol2);text-transform:uppercase;overflow-wrap:anywhere}
.sde-tags{display:flex;gap:4px;flex-wrap:wrap}
.sde-tg{padding:2px 7px;border:2.5px solid #000;border-radius:8px;background:#0d1540;font:800 10.5px/1.1 var(--sde-sans);text-transform:uppercase;color:#ffe03a}
.sde-st{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:2px 6px;font:800 11px/1 var(--sde-sans);text-transform:uppercase;color:#d6e2ff;text-shadow:0 1px 0 #000}
.sde-st .tr{height:11px;border:2.5px solid #000;border-radius:6px;background:#0a0f2b;overflow:hidden}
.sde-st .tr i{display:block;height:100%;background:linear-gradient(#ffe86a,#ffa800)}
.sde-st .tr i.b{background:linear-gradient(#8adcff,#2f95ff)}
.sde-st .tr i.g{background:linear-gradient(#8bff8f,#2fd851)}
.sde-st em{font-style:normal;font:400 12px/1 var(--sde-font);color:#fff;text-shadow:var(--ol1);min-width:2.4em;text-align:right}
.sde-btn.sde-ad-btn{margin-top:6px;overflow:hidden;white-space:normal;line-height:1.05;text-align:center}
.sde-btn.sde-ad-btn>i{position:absolute;left:0;bottom:0;height:5px;width:calc(100% * var(--p,0));background:#fff36b;box-shadow:0 0 6px #fff36b}
.sde-need{display:block;margin-top:3px;text-align:center;font:700 12px/1.1 var(--sde-sans);color:#ffb0a0;text-shadow:0 1px 0 #000}

/* ---------- улучшения ---------- */
.sde-ucard{display:grid;grid-template-columns:clamp(54px,9vh,70px) minmax(0,1fr);gap:6px 12px;padding:10px;border:4px solid #000;border-radius:20px;background:linear-gradient(#2c3f91,#1a2764);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14),0 5px 0 rgba(0,0,0,.4)}
.sde-ucard .ic{grid-row:1/3;align-self:start;width:100%;aspect-ratio:1;border:4px solid #000;border-radius:16px;background:linear-gradient(#ffe86a,#ffb400);padding:6px;object-fit:contain}
.sde-ucard .mid{display:flex;flex-direction:column;gap:4px;min-width:0}
.sde-ucard h3{margin:0;font:400 clamp(16px,2.6vh,20px)/1.05 var(--sde-font);text-shadow:var(--ol2);text-transform:uppercase}
.sde-ucard .ds{font:700 12.5px/1.2 var(--sde-sans);color:#d6e2ff;text-shadow:0 1px 0 #000}
.sde-pips{display:flex;gap:3px;flex-wrap:wrap}
.sde-pips i{flex:1 1 0;min-width:8px;max-width:20px;height:12px;border:2.5px solid #000;border-radius:4px;background:#0a0f2b}
.sde-pips i.on{background:linear-gradient(#8bff8f,#2fd851)}
.sde-ucard .act{grid-column:2}
.sde-ucard.nest{background:linear-gradient(#a24cf0,#5a1fa8)}
.sde-ucard.nest .ic{background:linear-gradient(#e19bff,#a24cf0)}

/* ---------- окно гнезда ---------- */
.sde-nest{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.sde-nest .l,.sde-nest .r{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0}
.sde-nest .eg{position:relative;width:clamp(120px,26vh,190px);aspect-ratio:1;display:flex;align-items:center;justify-content:center}
.sde-nest .eg::before{content:'';position:absolute;inset:-10%;border-radius:50%;background:radial-gradient(circle,var(--rc),transparent 68%);opacity:.75;animation:sde-spin-pulse 2.4s ease-in-out infinite alternate}
.sde-nest .eg img{position:relative;width:86%;height:86%;object-fit:contain;filter:drop-shadow(0 6px 0 rgba(0,0,0,.45));animation:sde-float 2.2s ease-in-out infinite alternate}
@keyframes sde-float{to{transform:translateY(-8px) rotate(3deg)}}
@keyframes sde-spin-pulse{to{transform:scale(1.15);opacity:1}}
.sde-ribbon{display:inline-block;padding:4px 18px;border:4px solid #000;border-radius:12px;background:var(--rc);font:400 clamp(15px,2.4vh,20px)/1 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase}
.sde-rows{display:flex;flex-direction:column;gap:7px;width:min(100%,430px)}
.sde-rw{display:flex;align-items:center;gap:10px;padding:7px 12px;border:4px solid #000;border-radius:16px;background:linear-gradient(#233585,#17224f);font:700 clamp(13px,2.2vh,16px)/1.1 var(--sde-sans);text-shadow:0 1px 0 #000}
.sde-rw img{width:34px;height:34px;object-fit:contain;flex:none}
.sde-rw span{flex:1;text-align:left}
.sde-rw b{font:400 clamp(18px,3vh,24px)/1 var(--sde-font);color:#5dff6c;text-shadow:var(--ol2);white-space:nowrap}
.sde-rw.tot{background:linear-gradient(#2f8f55,#17582f)}
.sde-rw.tot b{font-size:clamp(24px,4.4vh,34px);color:#fff35e}
.sde-rw.bad b{color:#ff8a7a}

/* ---------- итоги вылазки ---------- */
.sde-win.win{--h1:#9bff7a;--h2:#1fb83e}
.sde-win.lose{--h1:#ff8a7a;--h2:#c2121f}
.sde-res{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:14px;align-items:center}
.sde-res .egg{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
.sde-res .egg .eg{position:relative;width:clamp(100px,24vh,170px);aspect-ratio:1;display:flex;align-items:center;justify-content:center}
.sde-res .egg .eg::before{content:'';position:absolute;inset:-14%;border-radius:50%;background:radial-gradient(circle,var(--rc),transparent 66%);animation:sde-spin-pulse 1.6s ease-in-out infinite alternate}
.sde-res .egg .eg img{position:relative;width:86%;height:86%;object-fit:contain;animation:sde-egg-in .8s cubic-bezier(.2,1.6,.4,1) both,sde-float 2.2s .8s ease-in-out infinite alternate;filter:drop-shadow(0 6px 0 rgba(0,0,0,.45))}
@keyframes sde-egg-in{0%{opacity:0;transform:scale(.1) rotate(-30deg)}100%{opacity:1;transform:none}}
.sde-res .egg .nm{font:400 clamp(18px,3.2vh,26px)/1.05 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase}
.sde-res .egg .ic{font:400 clamp(15px,2.6vh,20px)/1 var(--sde-font);color:#fff35e;text-shadow:var(--ol2)}
.sde-res .egg.lost img{filter:grayscale(1) brightness(.6);animation:none}
.sde-res .egg.lost .eg::before{background:radial-gradient(circle,#ff3b3b,transparent 66%)}
.sde-res .egg .skull{width:70%;height:70%;position:relative;object-fit:contain;animation:sde-egg-in .6s cubic-bezier(.2,1.6,.4,1) both}
.sde-unl{display:flex;align-items:center;gap:10px;padding:8px 14px;border:4px solid #000;border-radius:16px;background:linear-gradient(#ffe86a,#ffb400);font:400 clamp(15px,2.6vh,19px)/1.1 var(--sde-font);color:#fff;text-shadow:var(--ol2);text-transform:uppercase;animation:sde-pop-s2 .5s .5s cubic-bezier(.2,1.6,.4,1) both}
.sde-unl img{width:36px;height:36px;object-fit:contain}
@keyframes sde-pop-s2{0%{opacity:0;transform:scale(.3)}100%{opacity:1;transform:none}}
.sde-warn{display:flex;align-items:center;gap:10px;padding:8px 12px;border:4px solid #000;border-radius:16px;background:linear-gradient(#ff9a52,#d4500e);font:700 clamp(12.5px,2vh,15px)/1.25 var(--sde-sans);color:#fff;text-shadow:0 1px 0 #000;text-align:left}
.sde-warn img{width:38px;height:38px;object-fit:contain;flex:none}
.sde-stack{display:flex;flex-direction:column;gap:9px;min-width:0}
.sde-btn.sde-resad{flex-direction:column;gap:1px;padding:5px 18px 6px;min-height:52px;white-space:normal;text-align:center;line-height:1.05}
.sde-btn.sde-resad img{position:absolute;left:10px;top:50%;width:26px;height:26px;transform:translateY(-50%);margin:0}
.sde-btn.sde-resad span{padding-left:22px}
.sde-btn.sde-resad small{font:800 11px/1.15 var(--sde-sans);text-transform:none;letter-spacing:0;text-shadow:0 1px 0 #000;padding-left:22px;max-width:260px}

/* ---------- пауза и настройки ---------- */
.sde-win.small{--ww:520px}
.sde-win.mid{--ww:640px}
.sde-menu{display:flex;flex-direction:column;gap:12px;align-items:stretch}
.sde-set{display:flex;flex-direction:column;gap:12px}
.sde-sr{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);align-items:center;gap:10px;padding:8px 12px;border:4px solid #000;border-radius:16px;background:linear-gradient(#233585,#17224f)}
.sde-sr .lb{font:400 clamp(14px,2.3vh,18px)/1.05 var(--sde-font);color:#fff;text-shadow:var(--ol1);text-transform:uppercase}
.sde-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}
.sde-seg .sde-btn{min-height:40px;padding:0 3px;font-size:clamp(11px,min(2vh,3.4vw),15px);letter-spacing:0}
.sde-seg .sde-btn:not(.on){--c1:#7b88ae;--c2:#4a5679;--c3:#313a58;filter:saturate(.7) brightness(.92)}
.sde-sens{display:flex;align-items:center;gap:10px}
.sde-sens output{min-width:3.4em;text-align:right;font:400 17px/1 var(--sde-font);color:#ffe03a;text-shadow:var(--ol1)}
.sde-range{-webkit-appearance:none;appearance:none;flex:1;min-width:90px;height:34px;margin:0;background:transparent;cursor:pointer;pointer-events:auto;touch-action:pan-y}
.sde-range::-webkit-slider-runnable-track{height:16px;background:linear-gradient(90deg,#ffc81c var(--p,50%),#0a0f2b var(--p,50%));border:3.5px solid #000;border-radius:10px}
.sde-range::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:34px;margin-top:-11px;background:linear-gradient(#fff,#cfd8ff);border:3.5px solid #000;border-radius:10px;box-shadow:0 3px 0 rgba(0,0,0,.5)}
.sde-range::-moz-range-track{height:10px;background:linear-gradient(90deg,#ffc81c var(--p,50%),#0a0f2b var(--p,50%));border:3.5px solid #000;border-radius:10px}
.sde-range::-moz-range-thumb{width:20px;height:28px;background:linear-gradient(#fff,#cfd8ff);border:3.5px solid #000;border-radius:10px}
.sde-list{margin:0;padding:0;list-style:none;display:grid;gap:8px;font:600 clamp(13px,2.1vh,16px)/1.3 var(--sde-sans);color:#e8eeff;text-shadow:0 1px 0 #000}
.sde-list li{display:flex;align-items:center;gap:10px}
.sde-key{display:inline-flex;align-items:center;justify-content:center;min-width:1.9em;height:1.7em;padding:0 .45em;border:3px solid #000;border-radius:.4em;background:linear-gradient(#fff58a,#ffc81c 55%,#ea9500);font:400 14px/1 var(--sde-font);color:#2a1a00;text-shadow:none;box-shadow:0 2px 0 rgba(0,0,0,.5);white-space:nowrap}
.sde-confirm{text-align:center;font:600 clamp(14px,2.4vh,18px)/1.35 var(--sde-sans);color:#fff;text-shadow:0 1px 0 #000;margin:4px 0 8px}

/* ---------- титул ---------- */
.sde-title{position:fixed;inset:0;z-index:95;display:flex;align-items:center;justify-content:flex-start;padding:clamp(14px,4vh,48px) clamp(16px,5vw,80px);overflow:hidden;pointer-events:auto;font-family:var(--sde-sans);-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
.sde-title::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,16,60,.82) 0,rgba(14,30,110,.55) 46%,rgba(14,30,110,.05) 78%),linear-gradient(0deg,rgba(0,0,0,.35),rgba(0,0,0,0) 30%);pointer-events:none}
.sde-rays{position:absolute;left:-30%;top:50%;width:150vmax;height:150vmax;margin-top:-75vmax;background:repeating-conic-gradient(rgba(255,235,120,.16) 0 7deg,rgba(255,235,120,0) 7deg 20deg);animation:sde-rot 60s linear infinite;pointer-events:none;-webkit-mask-image:radial-gradient(circle,#000 0,transparent 60%);mask-image:radial-gradient(circle,#000 0,transparent 60%)}
@keyframes sde-rot{to{transform:rotate(360deg)}}
.sde-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}
.sde-tmain{position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-start;gap:clamp(14px,3.6vh,34px);max-width:100%}
.sde-logo{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:0;transform:rotate(-4deg);transform-origin:0 100%;isolation:isolate;animation:sde-logo-in .8s cubic-bezier(.2,1.5,.4,1) both}
@keyframes sde-logo-in{0%{opacity:0;transform:rotate(-14deg) scale(.4)}100%{opacity:1;transform:rotate(-4deg)}}
.sde-logo-img{display:none;width:min(88vw,560px,calc(52vh*2));height:auto;filter:drop-shadow(0 8px 0 rgba(0,0,0,.4))}
.sde-logo.img .sde-logo-img{display:block}
.sde-logo.img .sde-logo-txt{display:none}
.sde-logo-txt{position:relative;display:flex;flex-direction:column;align-items:flex-start;line-height:.9}
.sde-lw{position:relative;display:inline-block;font:400 var(--fs)/.95 var(--sde-font);text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;color:transparent;background:linear-gradient(var(--g1),var(--g2));-webkit-background-clip:text;background-clip:text;padding:0 .04em}
.sde-lw::before{content:attr(data-txt);position:absolute;left:0;top:0;padding:0 .04em;z-index:-1;color:#000;background:none;text-shadow:${this.ol(7, 18)},0 .12em 0 #000,0 .18em 0 rgba(0,0,0,.35);-webkit-text-stroke:0}
.sde-lw.a{--fs:clamp(22px,min(7.2vh,9vw),58px);--g1:#ffffff;--g2:#ffe9a0;margin-left:.2em}
.sde-lw.b{--fs:clamp(28px,min(11.4vh,10.4vw),96px);--g1:#ff9a52;--g2:#ff2a2a}
.sde-lw.c{--fs:clamp(44px,min(17vh,17vw),140px);--g1:#fff58a;--g2:#ffb400}
.sde-lrow{display:flex;align-items:center;gap:.2em}
.sde-logo-egg{width:clamp(44px,min(17vh,17vw),140px);height:clamp(44px,min(17vh,17vw),140px);object-fit:contain;filter:drop-shadow(0 6px 0 rgba(0,0,0,.45));animation:sde-egg-wob 1.6s ease-in-out infinite alternate}
@keyframes sde-egg-wob{0%{transform:rotate(-8deg) translateY(0)}100%{transform:rotate(8deg) translateY(-8px)}}
.sde-tbtn{display:flex;flex-wrap:wrap;gap:clamp(12px,2.4vh,20px) 18px;align-items:center}
.sde-tkeys{display:flex;flex-wrap:wrap;gap:6px 16px;font:700 clamp(11px,1.9vh,14px)/1.2 var(--sde-sans);color:#fff;text-shadow:0 1px 0 #000,1px 0 0 #000,-1px 0 0 #000}
.sde-tkeys span{display:inline-flex;align-items:center;gap:6px}
.sde-tkeys .sde-key{font-size:13px}
.sde-ver{position:absolute;right:14px;bottom:8px;font:700 11px/1 var(--sde-sans);color:rgba(255,255,255,.7);text-shadow:0 1px 0 #000}

/* ---------- обучение (Tutorial.js): поверх его вида ---------- */
.lory-tut .lory-tut-card{padding:10px 14px;background:repeating-conic-gradient(#2c4c96 0 25%,#243f82 0 50%) 0 0/36px 36px;border:4.5px solid #000;border-radius:20px;box-shadow:inset 0 0 0 3px rgba(150,190,255,.5),0 6px 0 rgba(0,0,0,.45);animation:sde-pop-t .35s cubic-bezier(.2,1.5,.4,1) both}
@keyframes sde-pop-t{0%{opacity:0;transform:translateX(-50%) scale(.6)}100%{opacity:1;transform:translateX(-50%) scale(1)}}
.lory-tut .lory-tut-card[data-hl]{animation:none}
.lory-tut .lory-tut-title{color:#ffe03a;font-family:var(--sde-font);font-weight:400;text-transform:uppercase;letter-spacing:.02em;text-shadow:var(--ol2)}
.lory-tut .lory-tut-hint{color:#fff;font-weight:700;text-shadow:0 1px 0 #000}
.lory-tut .lory-tut-key{background:linear-gradient(#fff58a,#ffc81c 55%,#ea9500);color:#2a1a00;border:3px solid #000;border-radius:.4em;font-family:var(--sde-font);font-weight:400}
.lory-tut .lory-tut-skip{background:linear-gradient(#ff9a8a,#ff3d3d 50%,#c7121f 52%);color:#fff;border:3.5px solid #000;border-radius:13px;box-shadow:0 4px 0 #000;font-family:var(--sde-font);font-weight:400;font-size:15px;text-transform:uppercase;text-shadow:var(--ol1)}
.lory-tut .lory-tut-skip kbd{background:#fff;color:#14183a;font-family:var(--sde-font);text-shadow:none;border:2px solid #000;border-radius:6px;padding:1px 6px;text-transform:none}
.lory-tut-touch .lory-tut-skip kbd{display:none}
.lory-tut .lory-tut-bar{height:12px;border:3px solid #000;border-radius:99px;background:#0a0f2b}
.lory-tut .lory-tut-bar i{background:linear-gradient(#8bff8f,#2fd851)}
.lory-tut .lory-tut-dots i.done{background:#5dff6c}
.hl-low .lory-tut .lory-tut-card{display:block;padding:5px 9px 7px;border-width:4px;border-radius:15px}
.hl-low .lory-tut .lory-tut-main{display:block;min-width:0}
.hl-low .lory-tut .lory-tut-title{font-size:14px;line-height:26px;min-height:26px;padding-right:104px}
.hl-low .lory-tut .lory-tut-side{position:absolute;right:6px;top:4px;gap:0}
.hl-low .lory-tut .lory-tut-skip,.hl-low .lory-tut-touch .lory-tut-skip{min-height:30px;padding:3px 10px;font-size:12px;border-width:3px;border-radius:11px}
.hl-low .lory-tut .lory-tut-hint{font-size:12.5px;line-height:1.4}
.hl-low .lory-tut .lory-tut-hint svg{width:1.4em;height:1.4em;margin-right:.2em}
.hl-low .lory-tut .lory-tut-key{min-width:1.5em;height:1.5em}
.hl-low .lory-tut .lory-tut-dots{display:none}
.hl-low .lory-tut .lory-tut-bar{height:9px;margin-top:3px}
.hl-low .sde-obj{padding:4px 10px 5px;gap:3px}
.lory-tut .lory-tut-final{border:4px solid #000;border-radius:16px;color:#5dff6c;font-family:var(--sde-font);font-weight:400;text-transform:uppercase;text-shadow:var(--ol2);background:#16224f}
.lory-tut-hl{outline-color:#ffd91a}

/* ---------- экранные кнопки Input (контекстная «E») ---------- */
.lory-ctx{border:4px solid #000!important;background:var(--lory-input-accent)!important;color:#fff!important;box-shadow:inset 0 -6px 0 rgba(0,0,0,.22),0 5px 0 rgba(0,0,0,.5);font-family:var(--sde-font)!important;font-weight:400!important}
.lory-ctx-label{text-shadow:var(--ol1)!important;text-transform:uppercase}
.lory-stick{border-color:#fff!important}

/* ---------- компактный экран ---------- */
@media (max-height:440px){
.sde-win{border-width:4px;border-radius:20px}
.sde-head{min-height:48px;padding:5px 8px 5px 12px;border-bottom-width:4px;gap:8px}
.sde-body{padding:8px}
.sde-btn{min-height:40px;padding:0 14px;font-size:15px}
.sde-btn.big{min-height:46px;font-size:22px}
.sde-card,.sde-wcard,.sde-ucard{padding:7px;gap:5px 8px;border-width:3px;border-radius:15px}
.sde-sub{margin-bottom:6px}
.sde-bar{margin-bottom:8px;padding:5px 8px}
.sde-tabs{margin-bottom:8px}
.sde-tab{min-height:36px}
.sde-sr{padding:5px 9px}
.sde-foot{padding:7px 10px 9px}
}
@media (max-width:520px){
.sde-head{gap:8px;padding-left:12px}
.sde-head>img{display:none}
.sde-mchip{font-size:17px;padding-right:9px}
.sde-mchip img{width:24px;height:24px}
.sde-res{grid-template-columns:1fr}
.sde-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}
.sde-sr{grid-template-columns:1fr}
}
@media (max-height:440px){
.sde-foot{gap:8px;flex-wrap:nowrap}
.sde-foot .sde-btn.big{min-height:42px;padding:0 20px;font-size:20px}
.sde-btn.sde-resad{min-height:42px;padding:2px 10px 3px;flex:1 1 auto}
.sde-btn.sde-resad small{font-size:10px;max-width:none;white-space:normal}
.sde-btn.sde-resad span{font-size:15px}
.sde-rows{gap:4px}
.sde-rw{padding:3px 10px;gap:8px;border-width:3px;border-radius:12px;font-size:12.5px}
.sde-rw img{width:26px;height:26px}
.sde-rw b{font-size:19px}
.sde-rw.tot b{font-size:24px}
.sde-res{gap:8px}
.sde-res .egg{gap:4px}
.sde-res .egg .eg{width:84px}
.sde-res .egg .nm{font-size:16px}
.sde-stack{gap:5px}
.sde-unl,.sde-warn{padding:4px 10px;border-width:3px;font-size:12px;gap:8px}
.sde-unl img,.sde-warn img{width:28px;height:28px}
.sde-sr{padding:4px 10px}
.sde-set{gap:6px}
.sde-menu{gap:8px}
.sde-confirm{margin:0 0 4px}
.sde-sub{font-size:12px;margin-bottom:6px}
.sde-nest{flex-direction:row;align-items:center;justify-content:center;gap:14px;text-align:left}
.sde-nest .eg{width:96px}
.sde-nest .l{flex:0 0 auto;max-width:42%}
.sde-nest .r{flex:1}
.sde-nest .sde-rows{width:100%}
.sde-nest .sde-sub{margin:0}
}
@media (max-height:440px) and (max-width:520px){.sde-nest{flex-direction:column}.sde-nest .l,.sde-nest .r{max-width:none}}
@media (prefers-reduced-motion:reduce){.sde-rays,.sde-logo-egg,.sde-hint,.sde-win,.sde-obj.alarm,.sde-rim.on,.sde-egg-wait{animation:none}}
`;
    },
};
