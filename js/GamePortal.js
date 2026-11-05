// GamePortal.js — порталы. Вихрь с глубиной и звёздами, кромка, ореол, кружащие пиксели, искры, свет на полу.
//   spawn(x, y, z, o)  вихрь появления: схлопывается в точку прямо перед игроком, в конце вспышка и ударное кольцо
//   gate(x, y, z, o)   постоянный портал: арка базы и выход с вылазки. o: { R, cy, arch, colA, colB, yaw }
//   flash(color)       заливка экрана на миг (проход сквозь портал)

/** @satisfies {Record<string, any>} */
const GamePortal = {
    /** @type {any[]} */
    list: [],
    /** @type {any[]} */
    gates: [],
    _shader: false,
    /** @type {any} */
    skin: null,
    /** @type {HTMLElement | null} */
    _veil: null,

    _makeShaders() {
        if (this._shader) return;
        this._shader = true;
        BABYLON.Effect.ShadersStore['sdePortalVertexShader'] = `precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec2 vP;
void main(){ vP = position.xy; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
        // R — радиус (локально), cy — центр круга по y, arch — длина прямых сторон арки вниз (0 — круг)
        BABYLON.Effect.ShadersStore['sdePortalFragmentShader'] = `precision highp float;
varying vec2 vP; uniform float time; uniform float open; uniform float R; uniform float cy; uniform float arch; uniform float boost; uniform vec3 colA; uniform vec3 colB; uniform float arms; uniform float twist; uniform float rainbow; uniform float stars;
vec3 hueCol(float h){ return clamp(abs(fract(h + vec3(0., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 q = vP - vec2(0.0, cy);
  float d = (arch > 0.01 && q.y < 0.0) ? abs(q.x) : length(q);
  float e = 1.0 - d / R;
  if (e < 0.0 || (arch > 0.01 && q.y < -arch)) discard;
  float r = length(q) / R, a = atan(q.y, q.x);
  float tw = twist / (r + 0.22);
  vec3 cA = colA, cB = colB;
  if (rainbow > 0.01) { cA = mix(colA, hueCol(r * 0.8 - time * 0.15), rainbow); cB = mix(colB, hueCol(r * 0.8 - time * 0.15 + 0.33), rainbow); }
  float ribA = sin(a * arms + tw * 2.4 - time * 3.4);
  float ribB = sin(a * (arms + 2.0) - tw * 1.7 + time * 2.2 + ribA * 0.8);
  float m1 = smoothstep(-0.1, 0.95, ribA), m2 = smoothstep(0.2, 1.0, ribB);
  vec3 deep = mix(cA * 0.16, vec3(0.02, 0.0, 0.06), smoothstep(0.1, 0.7, r));
  vec3 c = mix(deep, cA * 1.35, m1);
  c = mix(c, cB * 1.5, m2 * 0.75);
  vec2 sg = vec2(a * 7.0, tw * 3.0 - time * 2.6), cell = floor(sg), f = fract(sg) - 0.5;
  float star = step(1.0 - 0.07 * stars, h21(cell)) * smoothstep(0.24, 0.0, length(f));
  c += vec3(1.0, 0.95, 1.0) * star * (0.7 + 1.6 * r);
  c += vec3(1.0, 0.92, 1.0) * exp(-r * r * 34.0) * (1.25 + boost * 1.2);
  c += cB * exp(-r * r * 7.0) * (0.22 + boost * 0.35);
  float rim = smoothstep(0.16, 0.0, e);
  c += mix(cB, vec3(1.0), 0.4) * rim * (1.3 + 0.55 * sin(a * 14.0 + time * 7.0));
  gl_FragColor = vec4(c, smoothstep(0.0, 0.025, e) * open);
}`;
        BABYLON.Effect.ShadersStore['sdePortalGlowVertexShader'] = BABYLON.Effect.ShadersStore['sdePortalVertexShader'];
        BABYLON.Effect.ShadersStore['sdePortalGlowFragmentShader'] = `precision highp float;
varying vec2 vP; uniform vec3 col; uniform float amt;
void main(){ float r = length(vP); float k = pow(max(0.0, 1.0 - r), 2.2) * amt; gl_FragColor = vec4(col * k, k); }`;
    },

    _discMat(o, R, cy, arch) {
        const scene = VoxRender.scene;
        const m = new BABYLON.ShaderMaterial('portalMat', scene, { vertex: 'sdePortal', fragment: 'sdePortal' }, {
            attributes: ['position'], uniforms: ['worldViewProjection', 'time', 'open', 'R', 'cy', 'arch', 'boost', 'colA', 'colB', 'arms', 'twist', 'rainbow', 'stars'], needAlphaBlending: !arch,
        });
        m.backFaceCulling = false;
        m.disableDepthWrite = !arch;
        const A = o.colA || [0.55, 0.1, 1.0], B = o.colB || [0.2, 0.85, 1.0];
        m.setColor3('colA', new BABYLON.Color3(A[0], A[1], A[2]));
        m.setColor3('colB', new BABYLON.Color3(B[0], B[1], B[2]));
        m.setFloat('time', 0); m.setFloat('open', 1); m.setFloat('R', R); m.setFloat('cy', cy); m.setFloat('arch', arch); m.setFloat('boost', 0);
        m.setFloat('arms', o.arms || 3); m.setFloat('twist', o.twist || 2.6); m.setFloat('rainbow', o.rainbow || 0); m.setFloat('stars', o.stars || 1);
        return m;
    },

    /** Мягкий ореол (сложение цвета). */
    _glow(col, size, amt) {
        const scene = VoxRender.scene;
        const mesh = BABYLON.MeshBuilder.CreatePlane('portalGlow', { size: 2, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        const m = new BABYLON.ShaderMaterial('portalGlow', scene, { vertex: 'sdePortalGlow', fragment: 'sdePortalGlow' }, {
            attributes: ['position'], uniforms: ['worldViewProjection', 'col', 'amt'], needAlphaBlending: true,
        });
        m.backFaceCulling = false; m.disableDepthWrite = true; m.alphaMode = BABYLON.Constants.ALPHA_ADD;
        m.setColor3('col', new BABYLON.Color3(col[0], col[1], col[2]));
        m.setFloat('amt', amt);
        mesh.material = m; mesh.isPickable = false;
        mesh.scaling.setAll(size);
        return mesh;
    },

    /** Кружащие пиксели — светящиеся кубики вокруг портала. */
    _orbit(n, col) {
        const scene = VoxRender.scene;
        const base = BABYLON.MeshBuilder.CreateBox('portalPix', { size: 1 }, scene);
        const m = new BABYLON.StandardMaterial('portalPix', scene);
        m.disableLighting = true;
        m.emissiveColor = new BABYLON.Color3(col[0] * 1.4 + 0.25, col[1] * 1.4 + 0.25, col[2] * 1.4 + 0.25);
        base.material = m; base.isPickable = false; base.setEnabled(false);
        const pix = [];
        for (let i = 0; i < n; i++) {
            const inst = base.createInstance('px');
            inst.isPickable = false;
            pix.push({ inst, a: i / n * 6.283 + Math.random() * 0.4, sp: 0.8 + Math.random() * 0.9, off: Math.random() * 6.28, s: 0.05 + Math.random() * 0.075, rad: 1 + Math.random() * 0.22 });
        }
        return { base, mat: m, pix };
    },

    /**
     * Вихрь появления перед игроком: распахивается, держится миг и схлопывается в точку.
     * o: { life, size, colA, colB }.
     */
    spawn(x, y, z, o = {}) {
        this._makeShaders();
        const scene = VoxRender.scene, R = o.size || 1.9;
        const A = o.colA || [0.55, 0.1, 1.0], B = o.colB || [0.2, 0.85, 1.0];
        const disc = BABYLON.MeshBuilder.CreatePlane('portal', { size: 2, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        disc.isPickable = false;
        disc.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        disc.position.set(x, y, z);
        const mat = this._discMat(o, 1, 0, 0);
        disc.material = mat;
        const halo = this._glow(B, R * 2, 0.75);
        halo.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        halo.position.set(x, y, z);
        const orb = this._orbit(18, B);
        const p = { disc, mat, halo, orb, x, y, z, R, t: 0, life: o.life || 1.5, A, B, ring: null };
        disc.scaling.setAll(R * 0.15);
        this.list.push(p);
        VoxRender.flash(x, y, z, [B[0], B[1], B[2]], 10, 10, 0.4);
        this.flash(o.veil || 'rgba(190,120,255,0.55)');
        if (typeof GameAudio !== 'undefined') GameAudio.debrisRumble(0.5, x, y, z);
        return p;
    },

    /**
     * Постоянный портал: плоскость с вихрем, ореол на полу и вокруг, кружащие пиксели, искры затягивает внутрь.
     * y — низ. o: { R — радиус; cy — высота центра круга над низом; arch — true: прямые стороны до низа (арка), иначе круг;
     * colA, colB; yaw — поворот плоскости вокруг вертикали }.
     */
    gate(x, y, z, o = {}) {
        this._makeShaders();
        const usesSkin = !!o.skin;
        if (usesSkin && this.skin) o = Object.assign({}, o, this.skin);
        const scene = VoxRender.scene, R = o.R || 2, cy = o.cy != null ? o.cy : R;
        const A = o.colA || [0.55, 0.1, 1.0], B = o.colB || [0.2, 0.85, 1.0];
        const h = cy + R + 0.02, cLocal = cy - h / 2;
        const plane = BABYLON.MeshBuilder.CreatePlane('portalGate', { width: R * 2 + 0.04, height: h, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        plane.isPickable = false;
        plane.position.set(x, y + h / 2, z);
        plane.rotation.y = o.yaw || 0;
        const mat = this._discMat(o, R, cLocal, o.arch ? cy : 0);
        plane.material = mat;
        const halo = this._glow(B, R * 1.75, 0.5);
        halo.position.set(x, y + cy, z);
        halo.rotation.y = o.yaw || 0;
        const floor = this._glow(A, R * 1.8, 0.7);
        floor.rotation.x = Math.PI / 2;
        floor.position.set(x, y + 0.04, z);
        const orb = this._orbit(o.pixels || 22, B);
        const g = { plane, mat, halo, floor, orb, x, y, z, R, cy, A, B, t: Math.random() * 10, boost: 0, yaw: o.yaw || 0, usesSkin, speed: o.speed || 1 };
        this.gates.push(g);
        return g;
    },

    /** Косметика: вид портала вылазок (арка базы, вихрь появления). null — как по умолчанию. */
    setSkin(s) {
        this.skin = s;
        const o = s || { colA: [0.55, 0.1, 1.0], colB: [0.2, 0.85, 1.0], arms: 3, twist: 2.6, rainbow: 0, stars: 1, speed: 1 };
        for (const g of this.gates) {
            if (!g.usesSkin) continue;
            const m = g.mat, A = o.colA, B = o.colB;
            m.setColor3('colA', new BABYLON.Color3(A[0], A[1], A[2]));
            m.setColor3('colB', new BABYLON.Color3(B[0], B[1], B[2]));
            m.setFloat('arms', o.arms); m.setFloat('twist', o.twist); m.setFloat('rainbow', o.rainbow); m.setFloat('stars', o.stars);
            g.A = A; g.B = B; g.speed = o.speed || 1;
            g.halo.material.setColor3('col', new BABYLON.Color3(B[0], B[1], B[2]));
            g.floor.material.setColor3('col', new BABYLON.Color3(A[0], A[1], A[2]));
            g.orb.mat.emissiveColor = new BABYLON.Color3(B[0] * 1.4 + 0.25, B[1] * 1.4 + 0.25, B[2] * 1.4 + 0.25);
        }
    },
    skinOpts() { return this.skin || {}; },

    /** Заливка экрана: проход через портал. */
    flash(color) {
        if (typeof document === 'undefined') return;
        if (!this._veil) {
            const v = this._veil = document.createElement('div');
            v.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;opacity:0;transition:opacity .55s ease-out';
            document.body.appendChild(v);
        }
        const v = this._veil;
        v.style.transition = 'none';
        v.style.background = 'radial-gradient(circle at 50% 50%, rgba(255,255,255,.75), ' + color + ' 55%, ' + color + ')';
        v.style.opacity = '1';
        requestAnimationFrame(() => requestAnimationFrame(() => { v.style.transition = 'opacity .55s ease-out'; v.style.opacity = '0'; }));
    },

    update(dt) {
        const cam = VoxRender.camera.position;
        // вихри появления
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i];
            p.t += dt;
            const u = p.t / p.life;
            const openK = Math.min(1, p.t / 0.16);
            const closeU = Math.max(0, (u - 0.34) / 0.66);
            const s = p.R * (0.15 + 0.85 * openK) * Math.pow(1 - closeU, 1.7) * (1 + Math.sin(p.t * 24) * 0.012);
            p.disc.scaling.setAll(Math.max(0.001, s));
            p.mat.setFloat('time', p.t * (1 + closeU * 2.6));
            p.mat.setFloat('open', Math.min(1, openK * 1.2));
            p.mat.setFloat('boost', closeU * 1.6);
            p.halo.scaling.setAll(Math.max(0.001, s * 2 + closeU * 0.6));
            this._orbitTick(p.orb, p.x, p.y, p.z, s * 1.15, p.t * (2.2 + closeU * 9), cam, null, 1 - closeU * 0.5);
            this._sparks(p.x, p.y, p.z, Math.max(p.R * (1 - closeU), 0.5), p.A, p.B, dt, 70, 2.4 + closeU * 6, cam, 0);
            if (p.t >= p.life) {
                VoxFX.sparks(p.x, p.y, p.z, 0, 0.3, 0, 54, 1.4);
                VoxRender.flash(p.x, p.y, p.z, [1, 0.9, 1], 14, 12, 0.3);
                for (let k = 0; k < 16; k++) {
                    const a = k / 16 * 6.283;
                    VoxFX.puff(p.x, p.y, p.z, { add: true, mode: 5, size: 0.09, life: 0.5, alpha: 1, vx: Math.cos(a) * 5.5, vy: Math.sin(a) * 5.5, vz: Math.sin(a * 2) * 1.5, drag: 1.6, r: p.B[0] * 3 + 0.8, g: p.B[1] * 3 + 0.8, b: p.B[2] * 3 + 0.8, fadeOut: 0.5 });
                }
                if (typeof GameAudio !== 'undefined') { GameAudio.impact('glass', 1, p.x, p.y, p.z); GameAudio.ui('select'); }
                if (typeof Game !== 'undefined' && Game.player) Game.player.addTrauma(0.3);
                this._disposeSpawn(p);
                this.list.splice(i, 1);
            }
        }
        // постоянные
        const pl = typeof Game !== 'undefined' ? Game.player : null;
        for (const g of this.gates) {
            g.t += dt;
            const near = pl ? Math.max(0, 1 - Math.hypot(pl.pos.x - g.x, pl.pos.z - g.z) / 7) : 0;
            g.boost += (near - g.boost) * Math.min(1, dt * 3);
            g.mat.setFloat('time', g.t * (1 + g.boost * 0.9) * g.speed);
            g.mat.setFloat('boost', g.boost + Math.sin(g.t * 2.2) * 0.12);
            const k = 1 + Math.sin(g.t * 2.2) * 0.05 + g.boost * 0.2;
            g.halo.scaling.setAll(g.R * 1.75 * k);
            g.floor.scaling.setAll(g.R * 1.8 * k);
            this._orbitTick(g.orb, g.x, g.y + g.cy, g.z, g.R * 1.08, g.t * (0.9 + g.boost * 1.4), null, g.yaw, 1);
            this._sparks(g.x, g.y + g.cy, g.z, g.R * 1.25, g.A, g.B, dt, 34 + g.boost * 60, 1.8 + g.boost * 2, null, g.yaw);
        }
    },

    /** Кубики по кругу в плоскости портала (cam — плоскость лицом к камере, иначе — по yaw). */
    _orbitTick(orb, x, y, z, rad, t, cam, yaw, size) {
        let ax = 1, az = 0;
        if (cam) { const fx = x - cam.x, fz = z - cam.z, fl = Math.hypot(fx, fz) || 1; ax = -fz / fl; az = fx / fl; }
        else if (yaw) { ax = Math.cos(yaw); az = -Math.sin(yaw); }
        for (const q of orb.pix) {
            const a = q.a + t * q.sp, r = rad * q.rad * (1 + Math.sin(t * 1.7 + q.off) * 0.05);
            const cx = Math.cos(a) * r;
            q.inst.position.set(x + ax * cx, y + Math.sin(a) * r, z + az * cx);
            q.inst.rotation.set(t * 3 + q.off, t * 2, 0);
            q.inst.scaling.setAll(Math.max(0.001, q.s * size * (0.8 + 0.3 * Math.sin(t * 5 + q.off))));
        }
    },

    /** Искры с края затягивает в центр. */
    _sparks(x, y, z, r0, A, B, dt, rate, sp, cam, yaw) {
        const k = VoxRender.quality === 'low' ? 0.3 : 1;
        if (Math.random() > dt * rate * k) return;
        let ax = 1, az = 0;
        if (cam) { const fx = x - cam.x, fz = z - cam.z, fl = Math.hypot(fx, fz) || 1; ax = -fz / fl; az = fx / fl; }
        else if (yaw) { ax = Math.cos(yaw); az = -Math.sin(yaw); }
        const a = Math.random() * 6.28, r = r0 * (0.9 + Math.random() * 0.6), q = Math.random() < 0.5 ? A : B;
        const ox = ax * Math.cos(a) * r, oy = Math.sin(a) * r, oz = az * Math.cos(a) * r;
        VoxFX.puff(x + ox, y + oy, z + oz, { add: true, mode: 5, size: 0.055, life: 0.55, alpha: 1, vx: -ox * sp * 0.55, vy: -oy * sp * 0.55, vz: -oz * sp * 0.55, drag: 0.2, r: q[0] * 3 + 0.6, g: q[1] * 3 + 0.6, b: q[2] * 3 + 0.6, fadeOut: 0.4 });
    },

    _disposeOrbit(orb) { for (const q of orb.pix) q.inst.dispose(); orb.base.dispose(); orb.mat.dispose(); },
    _disposeSpawn(p) { p.disc.dispose(); p.mat.dispose(); p.halo.material.dispose(); p.halo.dispose(); this._disposeOrbit(p.orb); },
    _disposeGate(g) { g.plane.dispose(); g.mat.dispose(); g.halo.material.dispose(); g.halo.dispose(); g.floor.material.dispose(); g.floor.dispose(); this._disposeOrbit(g.orb); },

    clear() {
        for (const p of this.list) this._disposeSpawn(p);
        for (const g of this.gates) this._disposeGate(g);
        this.list = []; this.gates = [];
    },
};
