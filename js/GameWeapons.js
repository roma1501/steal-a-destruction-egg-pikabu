// GameWeapons.js — модели инструментов в руках (GLB из Blender). Исходники, скрипт сборки и превью —
// в assets/models/weapons/src/ (build_weapons.py: модель -> запечённые AO, износ, блик и нормали -> GLB).
//
// load(scene): каждая модель — Model3D.load + Model3D.build, корень модели (см движка) вешается на узел
// в МЕТРАХ (× 0.01) со своим поворотом кадра (rot). Узел: начало — рукоять (кисть), ствол вдоль −Z,
// верх +Y, право +X — пространство камеры. GameTools вешает узел на камеру: position = base (+ качание,
// отдача), rotation — анимация (кувалда вращается вокруг начала узла по X).
// Материалы: StandardMaterial, блик по типу материала (имя материала из Blender: steel, paint, polymer,
// rubber, wood, glass, copper, brass, tape); карта блика <id>_s.jpg и нормалей <id>_n.jpg — если
// загрузились (на телефоне не грузятся). Части *_glow светятся: плагин прибавляет цвет текстуры × k поверх
// света (HDR -> bloom). Свет: 6 огней сцены + свой заполняющий свет «от камеры» только для моделей в руках
// (иначе теневая сторона инструмента — чёрный силуэт), поэтому у их материалов maxSimultaneousLights = 7.
// Нет файла или ошибка — инструмента нет в models: GameTools оставит воксельную заготовку.

class WeaponGlowPlugin extends BABYLON.MaterialPluginBase {
    /** @param {BABYLON.Material} material */
    constructor(material) {
        super(material, 'WeaponGlow', 310, { WPNGLOW: false });
        this.k = 1.5;
        this.base = 1.5;
        this.kind = '';
        this._enable(true);
    }
    prepareDefines(defines) { defines.WPNGLOW = true; }
    getClassName() { return 'WeaponGlowPlugin'; }
    getUniforms() {
        return { ubo: [{ name: 'wpnGlow', size: 1, type: 'float' }], fragment: 'uniform float wpnGlow;' };
    }
    bindForSubMesh(ubo) { ubo.updateFloat('wpnGlow', this.k); }
    getCustomCode(shaderType) {
        if (shaderType === 'fragment') return { CUSTOM_FRAGMENT_BEFORE_FOG: 'color.rgb += baseColor.rgb * wpnGlow;' };
        return null;
    }
}

/** Скин оружия в руках: режим и цвета берёт из GameWeapons.skin (GameCosmetics), рисунок — по координатам модели. */
class WeaponSkinPlugin extends BABYLON.MaterialPluginBase {
    /** @param {BABYLON.Material} material @param {number} amt */
    constructor(material, amt) {
        super(material, 'WeaponSkin', 300, { WPNSKIN: false });
        this.amt = amt;
        this._enable(true);
    }
    prepareDefines(defines) { defines.WPNSKIN = true; }
    getClassName() { return 'WeaponSkinPlugin'; }
    getUniforms() {
        return {
            ubo: [{ name: 'skinA', size: 3, type: 'vec3' }, { name: 'skinB', size: 3, type: 'vec3' }, { name: 'skinP', size: 3, type: 'vec3' }],
            fragment: 'uniform vec3 skinA; uniform vec3 skinB; uniform vec3 skinP;',
        };
    }
    bindForSubMesh(ubo) {
        const s = GameWeapons.skin;
        if (s) {
            ubo.updateFloat3('skinA', s.a[0], s.a[1], s.a[2]);
            ubo.updateFloat3('skinB', s.b[0], s.b[1], s.b[2]);
            ubo.updateFloat3('skinP', s.mode, this.amt, performance.now() / 1000 % 1000);
        } else ubo.updateFloat3('skinP', 0, 0, 0);
    }
    getCustomCode(shaderType) {
        if (shaderType === 'vertex') return { CUSTOM_VERTEX_DEFINITIONS: 'varying vec3 vSkinP;', CUSTOM_VERTEX_MAIN_END: 'vSkinP = position;' };
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `varying vec3 vSkinP;
float skH(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float skN(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(skH(i), skH(i + vec3(1., 0., 0.)), f.x), mix(skH(i + vec3(0., 1., 0.)), skH(i + vec3(1., 1., 0.)), f.x), f.y),
        mix(mix(skH(i + vec3(0., 0., 1.)), skH(i + vec3(1., 0., 1.)), f.x), mix(skH(i + vec3(0., 1., 1.)), skH(i + vec3(1., 1., 1.)), f.x), f.y), f.z);
}
vec3 skHue(float h) { return clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); }`,
            CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `vec3 skE = vec3(0.);
if (skinP.x > 0.5 && skinP.y > 0.001) {
    float skM = skinP.x, skT = skinP.z;
    vec3 skQ = vSkinP, skC = skinA;
    if (skM < 1.5) skC = skinA;
    else if (skM < 2.5) skC = mix(skinA, skinB, step(0., skQ.y + sin(skQ.z * .1) * 2.));
    else if (skM < 3.5) skC = mix(skinA, skinB, step(.5, fract((skQ.z + skQ.y) * .09)));
    else if (skM < 4.5) { vec3 c4 = floor(skQ * .22); skC = mix(skinA, skinB, mod(c4.x + c4.y + c4.z, 2.)); }
    else if (skM < 5.5) { float n5 = skN(skQ * .09) + .5 * skN(skQ * .21); skC = n5 > .82 ? skinB : (n5 > .62 ? mix(skinA, skinB, .5) : skinA); }
    else if (skM < 6.5) { vec3 g6 = fract(skQ * .16) - .5; skC = mix(skinB, skinA, smoothstep(.2, .26, length(g6))); }
    else if (skM < 7.5) skC = mix(skinA, skinB, clamp(.5 + skQ.z * .012, 0., 1.));
    else if (skM < 8.5) { float l8 = abs(fract((skQ.z + skQ.y * .5) * .08 + skT * .35) - .5), w8 = smoothstep(.06, .0, l8); skC = skinB + skinA * w8 * .3; skE = skinA * w8 * 1.3; }
    else if (skM < 9.5) { float h9 = fract((skQ.z + skQ.y) * .018 + skT * .18); skC = skHue(h9) * .9 + .1; skE = skHue(fract(h9 + .1)) * .2 * (.6 + .4 * sin(skT * 3. + skQ.z * .2)); }
    else if (skM < 10.5) { float n10 = skN(skQ * .12 + vec3(0., skT * .35, 0.)), c10 = smoothstep(.45, .68, n10); skC = mix(skinB, skinA, c10); skE = skinA * c10 * c10 * 1.2; }
    else if (skM < 11.5) { vec3 c11 = floor(skQ * .5); float st = step(.965, skH(c11)), tw = .5 + .5 * sin(skT * 4. + skH(c11 + 3.) * 30.), n11 = skN(skQ * .05); skC = mix(skinB, skinA, n11 * n11) * .55; skE = vec3(1., .95, 1.) * st * tw * 1.5 + skinA * n11 * n11 * .25; }
    else if (skM < 12.5) { float sw = smoothstep(.12, .0, abs(fract((skQ.z - skQ.y) * .012 - skT * .22) - .5)); skC = skinA * (.95 + .25 * sin(skQ.z * .25)); skE = skinB * sw * .8; }
    else if (skM < 13.5) { vec2 w13 = fract(skQ.zy * .6 + skQ.x * .6); skC = step(.5, w13.x) == step(.5, w13.y) ? skinB : skinA; }
    else { float n14 = sin((skQ.z + skN(skQ * .13) * 22.) * .38); skC = mix(skinA, skinB, step(0., n14)); }
    float skL = dot(baseColor.rgb, vec3(.3, .59, .11));
    baseColor.rgb = mix(baseColor.rgb, skC * (.42 + skL), skinP.y);
    skE *= skinP.y;
}`,
            CUSTOM_FRAGMENT_BEFORE_FOG: 'color.rgb += skE;',
        };
    }
}

/**
 * @typedef {{ node: BABYLON.TransformNode, base: number[], scale?: number, muzzle?: number[],
 *   parts?: Record<string, BABYLON.AbstractMesh>, glow?: WeaponGlowPlugin[] }} WeaponModel
 */

/** @satisfies {Record<string, any>} */
const GameWeapons = {
    /** Надетый скин: { mode, a, b } или null. @type {any} */
    skin: null,
    /** Сколько скин перекрашивает материал. */
    SKIN_AMT: { paint: 1, polymer: 0.95, wood: 0.85, tape: 0.6, steel: 0.55, copper: 0.6, brass: 0.6, rubber: 0.3 },
    /** @type {Record<string, WeaponModel>} */
    models: {},
    /** Новый экземпляр ракеты: нос в начале узла, корпус вдоль +Z (летит вдоль −Z), метры, длина ≈ 0.68 с факелом;
     * группа рендера 0, без теней. Снять — node.dispose() (материалы общие). null — модель не загрузилась.
     * @type {((scene?: BABYLON.Scene) => BABYLON.TransformNode) | null} */
    rocket: null,
    /** @type {WeaponGlowPlugin[]} */
    _glow: [],
    /** @type {any} */
    _obs: null,
    /** @type {BABYLON.DirectionalLight | null} */
    fill: null,
    // заполняющий свет в пространстве камеры: сверху-слева-сзади на инструмент; сила, цвет
    FILL_DIR: [0.75, -0.5, -0.45],
    FILL: 0.85,

    // url — модель, n / s — карты нормалей и блика; base — место узла в пространстве камеры;
    // rot — поворот модели внутри узла (кадр), off — её сдвиг в узле (метры: где ось вращения GameTools);
    // muzzle — срез ствола в координатах модели (метры, из meta-<id>.json).
    DEFS: {
        hammer: { url: 'assets/models/weapons/hammer.glb', n: 'assets/models/weapons/hammer_n.jpg', s: 'assets/models/weapons/hammer_s.jpg',
            base: [0.27, -0.36, -0.42], rot: [0, 0.35, -0.2], off: [0, -0.3, 0], muzzle: [0, 0.745, -0.124] },
        launcher: { url: 'assets/models/weapons/launcher.glb', n: 'assets/models/weapons/launcher_n.jpg', s: 'assets/models/weapons/launcher_s.jpg',
            base: [0.25, -0.285, -0.42], rot: [0, 0.08, 0], muzzle: [0, 0.118, -0.738] },
        bomb: { url: 'assets/models/weapons/bomb.glb', n: 'assets/models/weapons/bomb_n.jpg', s: 'assets/models/weapons/bomb_s.jpg',
            base: [0.2, -0.17, -0.42], rot: [0.15, 1.1, 0.1], muzzle: null },
        grab: { url: 'assets/models/weapons/grab.glb', n: 'assets/models/weapons/grab_n.jpg', s: 'assets/models/weapons/grab_s.jpg',
            base: [0.2, -0.2, -0.46], rot: [-0.06, 0.2, 0], muzzle: [0, 0.078, -0.214] },
        torch: { url: 'assets/models/weapons/torch.glb', n: 'assets/models/weapons/torch_n.jpg', s: 'assets/models/weapons/torch_s.jpg',
            base: [0.24, -0.24, -0.5], rot: [0, 0.18, 0], muzzle: [0, 0.08, -0.56] },
        ar_ginger: { url: 'assets/models/weapons/ar_ginger.glb', n: 'assets/models/weapons/ar_ginger_n.jpg', s: 'assets/models/weapons/ar_ginger_s.jpg',
            base: [0.22, -0.25, -0.46], rot: [0.0, 0.14, 0.0], muzzle: [0, 0.088, -0.648] },
        carbine_sigma: { url: 'assets/models/weapons/carbine_sigma.glb', n: 'assets/models/weapons/carbine_sigma_n.jpg', s: 'assets/models/weapons/carbine_sigma_s.jpg',
            base: [0.22, -0.26, -0.48], rot: [0.0, 0.14, 0.0], muzzle: [0, 0.086, -0.7] },
        sniper_giga: { url: 'assets/models/weapons/sniper_giga.glb', n: 'assets/models/weapons/sniper_giga_n.jpg', s: 'assets/models/weapons/sniper_giga_s.jpg',
            base: [0.27, -0.33, -0.6], rot: [0.01, 0.07, 0.0], muzzle: [0, 0.098, -1.345] },
        minigun_brrt: { url: 'assets/models/weapons/minigun_brrt.glb', n: 'assets/models/weapons/minigun_brrt_n.jpg', s: 'assets/models/weapons/minigun_brrt_s.jpg',
            base: [0.24, -0.39, -0.62], rot: [0.09, 0.165, 0.0], muzzle: [0, 0.105, -0.905] },
        minigun_vulcan: { url: 'assets/models/weapons/minigun_vulcan.glb', n: 'assets/models/weapons/minigun_vulcan_n.jpg', s: 'assets/models/weapons/minigun_vulcan_s.jpg',
            base: [0.24, -0.39, -0.6], rot: [0.09, 0.165, 0.0], muzzle: [0, 0.105, -0.745] },
        gl_thumper: { url: 'assets/models/weapons/gl_thumper.glb', n: 'assets/models/weapons/gl_thumper_n.jpg', s: 'assets/models/weapons/gl_thumper_s.jpg',
            base: [0.23, -0.27, -0.46], rot: [0.04, 0.2, 0.0], muzzle: [0, 0.082, -0.445] },
        gl_drum: { url: 'assets/models/weapons/gl_drum.glb', n: 'assets/models/weapons/gl_drum_n.jpg', s: 'assets/models/weapons/gl_drum_s.jpg',
            base: [0.23, -0.28, -0.48], rot: [0.02, 0.14, 0.0], muzzle: [0, 0.12, -0.555] },
        gl_sticky: { url: 'assets/models/weapons/gl_sticky.glb', n: 'assets/models/weapons/gl_sticky_n.jpg', s: 'assets/models/weapons/gl_sticky_s.jpg',
            base: [0.25, -0.33, -0.46], rot: [0.02, 0.28, 0.0], muzzle: [0, 0.075, -0.505] },
        gl_cluster: { url: 'assets/models/weapons/gl_cluster.glb', n: 'assets/models/weapons/gl_cluster_n.jpg', s: 'assets/models/weapons/gl_cluster_s.jpg',
            base: [0.26, -0.31, -0.5], rot: [0.08, 0.3, 0.0], muzzle: [0, 0.102, -0.435] },
        sg_granny: { url: 'assets/models/weapons/sg_granny.glb', n: 'assets/models/weapons/sg_granny_n.jpg', s: 'assets/models/weapons/sg_granny_s.jpg',
            base: [0.21, -0.25, -0.4], rot: [0.05, 0.18, 0.0], muzzle: [0, 0.086, -0.6] },
        sg_autodrum: { url: 'assets/models/weapons/sg_autodrum.glb', n: 'assets/models/weapons/sg_autodrum_n.jpg', s: 'assets/models/weapons/sg_autodrum_s.jpg',
            base: [0.22, -0.26, -0.46], rot: [0.02, 0.14, 0.0], muzzle: [0, 0.092, -0.585] },
        blackhole: { url: 'assets/models/weapons/blackhole.glb', n: 'assets/models/weapons/blackhole_n.jpg', s: 'assets/models/weapons/blackhole_s.jpg',
            base: [0.27, -0.32, -0.48], rot: [0.16, 0.3, 0.0], muzzle: [0, 0.088, -0.35] },
        railgun: { url: 'assets/models/weapons/railgun.glb', n: 'assets/models/weapons/railgun_n.jpg', s: 'assets/models/weapons/railgun_s.jpg',
            base: [0.275, -0.34, -0.54], rot: [0.04, 0.09, 0.0], muzzle: [0, 0.125, -1.16] },
        sawgun: { url: 'assets/models/weapons/sawgun.glb', n: 'assets/models/weapons/sawgun_n.jpg', s: 'assets/models/weapons/sawgun_s.jpg',
            base: [0.25, -0.385, -0.47], rot: [0.36, 0.16, 0.0], muzzle: [0, 0.17, -0.343] },
        tesla: { url: 'assets/models/weapons/tesla.glb', n: 'assets/models/weapons/tesla_n.jpg', s: 'assets/models/weapons/tesla_s.jpg',
            base: [0.25, -0.27, -0.46], rot: [0.08, 0.28, 0.0], muzzle: [0, 0.09, -0.585] },
        freezer: { url: 'assets/models/weapons/freezer.glb', n: 'assets/models/weapons/freezer_n.jpg', s: 'assets/models/weapons/freezer_s.jpg',
            base: [0.24, -0.33, -0.5], rot: [0.02, 0.16, 0.0], muzzle: [0, 0.08, -0.53] },
        sharkgun: { url: 'assets/models/weapons/sharkgun.glb', n: 'assets/models/weapons/sharkgun_n.jpg', s: 'assets/models/weapons/sharkgun_s.jpg',
            base: [0.31, -0.32, -0.58], rot: [0.08, 0.44, 0.0], muzzle: [0, 0.095, -0.595] },
    },
    ROCKET: { url: 'assets/models/weapons/rocket.glb', n: 'assets/models/weapons/rocket_n.jpg', s: 'assets/models/weapons/rocket_s.jpg' },
    /** Снаряды (GameTools._launch): нос в начале узла, корпус вдоль +Z; у пилы начало — центр диска. @type {Record<string, any>} */
    PROJ: {
        proj_grenade: { url: 'assets/models/weapons/proj_grenade.glb' },
        proj_sticky: { url: 'assets/models/weapons/proj_sticky.glb' },
        proj_cluster: { url: 'assets/models/weapons/proj_cluster.glb' },
        proj_saw: { url: 'assets/models/weapons/proj_saw.glb' },
        proj_shark: { url: 'assets/models/weapons/proj_shark.glb' },
    },
    /** Запущенные загрузки моделей по id. @type {Record<string, Promise<any>>} */
    _pending: {},
    /** Шаблоны снарядов. @type {Record<string, BABYLON.TransformNode | null>} */
    _proj: {},

    // Блик по типу материала: [цвет, сила без карты, степень]. С картой блика сила — из карты.
    SPEC: {
        steel: [[0.95, 0.97, 1.0], 0.55, 60], paint: [[1, 1, 1], 0.32, 30], polymer: [[1, 1, 1], 0.16, 18],
        rubber: [[1, 1, 1], 0.06, 10], wood: [[1, 0.95, 0.88], 0.22, 22], glass: [[1, 1, 1], 1.0, 140],
        copper: [[1.0, 0.72, 0.5], 0.8, 70], brass: [[1.0, 0.85, 0.55], 0.8, 70], tape: [[1, 1, 1], 0.25, 20],
    },

    /** Общая подготовка: свет, ракета и бомба. Сами стволы грузятся по требованию (ensure) — их много. */
    async load(scene) {
        const extras = typeof IS_MOBILE === 'undefined' || !IS_MOBILE;
        this._extras = extras;
        try { await this._loadRocket(scene, extras); } catch (e) { console.warn('GameWeapons: rocket — ' + ((e && e.message) || e)); }
        await this.ensure(scene, 'bomb');
        this._makeFill(scene);
        if (!this._obs) this._obs = scene.onBeforeRenderObservable.add(() => this._tick(scene));
        return this.models;
    },

    /** Модель оружия (загрузить, если ещё нет). @returns {Promise<any>} */
    ensure(scene, id) {
        if (this.models[id]) return Promise.resolve(this.models[id]);
        if (this._pending[id]) return this._pending[id];
        const def = this.DEFS[id];
        if (!def) return Promise.resolve(null);
        const pr = this._make(scene, id, def, this._extras !== false).then(m => {
            if (m) {
                this.models[id] = m;
                if (this.fill) this.fill.includedOnlyMeshes = this.fill.includedOnlyMeshes.concat(m.node.getChildMeshes(false));
            }
            return m;
        }).catch(e => { console.warn('GameWeapons: ' + id + ' — ' + ((e && e.message) || e)); return null; });
        this._pending[id] = pr;
        return pr;
    },

    /** Новый экземпляр снаряда по id (rocket, proj_*): узел в метрах; null — нет модели, GameTools возьмёт заглушку. */
    projectile(id) {
        if (id === 'rocket') return this.rocket ? this.rocket(VoxRender.scene) : null;
        const tpl = this._proj[id];
        if (tpl === undefined) { this._loadProj(VoxRender.scene, id); return null; }
        if (!tpl) return null;
        const node = new BABYLON.TransformNode(id, VoxRender.scene);
        const root = tpl.clone(id + '-model', node, false);
        root.setEnabled(true);
        for (const m of root.getChildMeshes(false)) { m.isPickable = false; m.receiveShadows = false; m.renderingGroupId = 0; m.setEnabled(true); }
        return node;
    },
    async _loadProj(scene, id) {
        this._proj[id] = null;
        const def = this.PROJ[id];
        if (!def) return;
        try {
            const model = await Model3D.load(def.url);
            const tpl = Model3D.build(model, scene, { name: id + '-model' });
            tpl.scaling.setAll(0.01);
            this._setup(tpl, { n: null, s: null }, 0);
            tpl.setEnabled(false);
            this._proj[id] = tpl;
        } catch (e) { console.warn('GameWeapons: ' + id + ' — ' + ((e && e.message) || e)); }
    },

    /** @returns {Promise<WeaponModel | null>} */
    async _make(scene, id, def, extras) {
        const model = await Model3D.load(def.url);
        const maps = extras ? await this._maps(scene, def) : { n: null, s: null };
        const node = new BABYLON.TransformNode('wpn-' + id, scene);
        const root = Model3D.build(model, scene, { name: 'wpn-' + id + '-model' });
        root.parent = node;
        root.scaling.setAll(0.01);
        root.rotation.set(def.rot[0], def.rot[1], def.rot[2]);
        const off = def.off || [0, 0, 0];
        root.position.set(off[0], off[1], off[2]);
        const glow = this._setup(root, maps, 2);
        /** @type {Record<string, BABYLON.AbstractMesh>} */
        const parts = {};
        for (const m of root.getChildMeshes(false)) parts[(m.metadata && m.metadata.part) || m.name] = m;
        // вращающиеся части крутятся вокруг своей опоры из GLB, а не вокруг рукояти
        for (const k of ['spin', 'drum', 'disc', 'core']) {
            const pm = parts[k];
            if (pm && pm.metadata && pm.metadata.pivot) pm.setPivotPoint(BABYLON.Vector3.FromArray(pm.metadata.pivot));
        }
        let muzzle = null;
        if (def.muzzle) {
            const M = BABYLON.Matrix.Compose(new BABYLON.Vector3(0.01, 0.01, 0.01),
                BABYLON.Quaternion.FromEulerAngles(def.rot[0], def.rot[1], def.rot[2]), new BABYLON.Vector3(off[0], off[1], off[2]));
            const v = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(def.muzzle[0] * 100, def.muzzle[1] * 100, def.muzzle[2] * 100), M);
            muzzle = [v.x, v.y, v.z];
        }
        node.setEnabled(false);
        return { node, base: def.base.slice(), muzzle, parts, glow };
    },

    // Ракета: один шаблон (материалы и свечение — раз), экземпляры — клоны с общей геометрией и материалами,
    // поэтому node.dispose() ничего не теряет и не копит.
    async _loadRocket(scene, extras) {
        const def = this.ROCKET;
        const model = await Model3D.load(def.url);
        const maps = extras ? await this._maps(scene, def) : { n: null, s: null };
        const tpl = Model3D.build(model, scene, { name: 'rocket-model' });
        tpl.scaling.setAll(0.01);
        this._setup(tpl, maps, 0);
        tpl.setEnabled(false);
        let n = 0;
        this.rocket = () => {
            const node = new BABYLON.TransformNode('rocket' + (n++), scene);
            const root = tpl.clone('rocket-model', node, false);
            root.setEnabled(true);
            for (const m of root.getChildMeshes(false)) { m.isPickable = false; m.receiveShadows = false; m.renderingGroupId = 0; m.setEnabled(true); }
            return node;
        };
    },

    /** Карты нормалей и блика модели: { n, s } (null — нет файла или не прочиталась). */
    async _maps(scene, def) {
        const load = (url) => new Promise((resolve) => {
            if (!url) { resolve(null); return; }
            let done = false;
            const fin = (t) => { if (!done) { done = true; resolve(t); } };
            const t = new BABYLON.Texture(url, scene, {
                invertY: true, samplingMode: BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                onLoad: () => fin(t), onError: () => { t.dispose(); fin(null); },
            });
            setTimeout(() => { if (!done) { t.dispose(); fin(null); } }, 15000);
        });
        const [n, s] = await Promise.all([load(def.n), load(def.s)]);
        if (n) n.anisotropicFilteringLevel = 4;
        return { n, s };
    },

    /** Меши и материалы модели: группа рендера, блик, карты, свечение. Возвращает плагины свечения. */
    _setup(root, maps, group) {
        /** @type {WeaponGlowPlugin[]} */
        const glow = [];
        /** @type {BABYLON.BaseTexture | null} */
        let tex = null;
        const seen = new Set();
        for (const mesh of root.getChildMeshes(false)) {
            mesh.renderingGroupId = group;
            if (group === 2) mesh.layerMask = VoxRender.VM_LAYER;
            mesh.isPickable = false;
            mesh.receiveShadows = false;
            if (group === 2) mesh.alwaysSelectAsActiveMesh = true;
            const mm = mesh.material;
            const list = mm ? (/** @type {any} */ (mm).subMaterials || [mm]) : [];
            for (const mat of list) {
                if (!mat || seen.has(mat)) continue;
                seen.add(mat);
                const sm = /** @type {BABYLON.StandardMaterial} */ (mat);
                // одна картинка на модель: копии из разных материалов GLB — в одну текстуру
                if (sm.diffuseTexture) {
                    if (!tex) tex = sm.diffuseTexture;
                    else if (sm.diffuseTexture !== tex) { const old = sm.diffuseTexture; sm.diffuseTexture = tex; old.dispose(); }
                }
                sm.maxSimultaneousLights = group === 2 ? 7 : 6;
                if (group === 2) sm.imageProcessingConfiguration = VoxRender.vmImage;
                const name = String(sm.name).split('/').pop();
                const key = Object.keys(this.SPEC).find(k => name.startsWith(k)) || 'paint';
                const [sc, amt, pow] = this.SPEC[key];
                if (group === 2 && !name.includes('_glow') && key !== 'glass') new WeaponSkinPlugin(sm, this.SKIN_AMT[key] != null ? this.SKIN_AMT[key] : 0.9);
                if (maps.s) { sm.specularTexture = maps.s; sm.specularColor = new BABYLON.Color3(sc[0], sc[1], sc[2]); }
                else sm.specularColor = new BABYLON.Color3(sc[0] * amt, sc[1] * amt, sc[2] * amt);
                sm.specularPower = pow;
                if (maps.n) sm.bumpTexture = maps.n;
                if (name.includes('_glow')) {
                    sm.emissiveColor = new BABYLON.Color3(1, 1, 1);
                    sm.specularColor = new BABYLON.Color3(0, 0, 0);
                    sm.specularTexture = null;
                    sm.bumpTexture = null;
                    const p = new WeaponGlowPlugin(sm);
                    p.kind = name;
                    p.base = name.startsWith('screen') ? 0.8 : 1.6;
                    glow.push(p);
                    this._glow.push(p);
                }
            }
        }
        return glow;
    },

    /** Заполняющий свет только для моделей в руках (в кадре всегда видна их теневая сторона). */
    _makeFill(scene) {
        /** @type {BABYLON.AbstractMesh[]} */
        const meshes = [];
        for (const id in this.models) meshes.push(...this.models[id].node.getChildMeshes(false));
        const L = this.fill = new BABYLON.DirectionalLight('wpnFill', new BABYLON.Vector3(0, -1, 0), scene);
        L.intensity = this.FILL;
        L.diffuse = new BABYLON.Color3(1.0, 0.96, 0.9);
        L.specular = new BABYLON.Color3(0.9, 0.9, 0.9);
        L.shadowEnabled = false;
        L.includedOnlyMeshes = meshes;
    },

    _tick(scene) {
        const cam = scene.activeCamera;
        if (this.fill && cam) {
            const d = this.FILL_DIR;
            this.fill.direction = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(d[0], d[1], d[2]), cam.getWorldMatrix()).normalize();
        }
        // живое свечение: катушка захвата пульсирует (быстрее с грузом), запал и пилот мерцают, светодиоды мигают
        const t = performance.now() / 1000;
        const held = typeof GameTools !== 'undefined' && GameTools.held ? 1 : 0;
        if (this.fill) this.fill.setEnabled(true);
        for (const p of this._glow) {
            const kind = p.kind;
            let k = p.base;
            if (kind.startsWith('coil') || kind.startsWith('emitter')) k = p.base * (0.75 + 0.25 * Math.sin(t * (held ? 14 : 4))) + held * 0.8;
            else if (kind.startsWith('pilot') || kind.startsWith('fuse') || kind.startsWith('flame')) k = p.base * (0.8 + 0.2 * Math.sin(t * 31) * Math.sin(t * 17.3));
            else if (kind.startsWith('led')) k = p.base * (Math.sin(t * 3.1) > -0.3 ? 1 : 0.25);
            p.k = k;
        }
    },
};
