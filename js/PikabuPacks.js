// @ts-nocheck
// PikabuPacks.js — наборы за рубли в сборке Пикабу Игр (js/PikabuShop.js). Цены и названия товаров — в Студии
// (каталог CSV: coins_s 19 ₽, coins_m 49 ₽, coins_l 99 ₽, starter 29 ₽, no_ads 59 ₽), здесь — что игрок получает.
// Деньги — state.money (это и монеты Shop), оружие набора — через GameBase._giveWeapon.
PikabuShop.setup({
    colors: ['#ffb020', '#e53935'],
    ready: () => !!(typeof GameBase !== 'undefined' && GameBase.state && Array.isArray(GameBase.state.owned) && typeof Shop !== 'undefined' && Shop.state),
    visible: () => Game.mode === 'base' && !(typeof GameMenus !== 'undefined' && GameMenus.isOpen()),
    persist: () => Game.persist(true),
    button: { corner: 'tr', x: 12, y: 74 },
    packs: [
        { id: 'coins_s', type: 'consumable', icon: '💵', name: 'Пачка денег', desc: '3 000 на оружие, гнёзда и улучшения', grant: () => Shop.addCoins(3000) },
        { id: 'coins_m', type: 'consumable', icon: '💰', name: 'Мешок денег', desc: '10 000 денег', grant: () => Shop.addCoins(10000) },
        { id: 'coins_l', type: 'consumable', icon: '🏦', name: 'Сейф с деньгами', desc: '30 000 денег — хватит на самое мощное оружие', best: true, grant: () => Shop.addCoins(30000) },
        {
            id: 'starter', type: 'non_consumable', icon: '🧨', name: 'Набор подрывника', best: 'Один раз',
            desc: '5 000 денег, огнемёт и РПГ «Бум»',
            grant: () => Shop.addCoins(5000),
            apply: () => ['torch', 'launcher'].forEach((id) => { if (!GameBase.owns(id)) GameBase._giveWeapon(id); }),
        },
        { id: 'no_ads', type: 'non_consumable', icon: '🚫', name: 'Без рекламы', desc: 'Убирает рекламу между набегами навсегда. Награды за рекламу остаются', noAds: true },
    ],
});
