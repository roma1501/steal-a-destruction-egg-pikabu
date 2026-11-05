// VoxFX.js — эффекты Rubble Lab на своём Babylon-виде:
//  • обломки — кубики-воксели (thin instances одного куба: цвет материала, свет, тени, фаска; размеры и
//    мелкая крошка), летят по баллистике, отскакивают от вокселей мира, ложатся и тают; блеск стекла и металла;
//  • билборды — дым, пыль, огонь, вспышки, искры, угольки, кольца ударной волны: два меша с thin
//    instances и одним шейдером (VoxRender.env даёт солнце, небо и высотный туман).
//    Дым и пыль — смешивание по предумноженной альфе: текстура-атлас клубов (нормаль + плотность + деталь),
//    свет от солнца по нормали, тёмное ядро, просвечивание на краях к солнцу, «эрозия» плотности по
//    возрасту (дым рассыпается на клочья), мягкое пересечение с геометрией (глубина G-буфера, high).
//    Огонь, искры, угольки, вспышки — сложение (HDR > 1 даёт bloom); языки пламени рисует шейдер:
//    форма «капля», дрожь по шуму, цвет по температуре.
// Составные эффекты: explosion, dust, sparks, muzzle, tracer, fire, trail, impactDust, voxelsBurst.
// Плотность частиц масштабируется уровнем качества (VoxRender.fxScale).

/** @satisfies {Record<string, any>} */
const VoxFX = {
    /** @type {BABYLON.Scene | null} */
    scene: null,
    /** @type {VoxWorld | null} */
    world: null,
    vs: 0.1,
    // --- обломки
    /** @type {BABYLON.Mesh | null} */
    _cube: null,
    MAX_DEBRIS: 12000,        // буфер; обычный предел 6000, после ядерного взрыва (_boost) — весь
    /** @type {any[]} */
    debris: [],
    _debrisWas: false,
    _dm: new Float32Array(0),
    _dc: new Float32Array(0),
    // --- билборды
    MAX_PUFFS: 2400,
    MAX_ADD: 3000,
    /** @type {{ mesh: BABYLON.Mesh, mat: BABYLON.ShaderMaterial, list: any[], buf: Float32Array, add: boolean, max: number } | null} */
    alphaSys: null,
    /** @type {{ mesh: BABYLON.Mesh, mat: BABYLON.ShaderMaterial, list: any[], buf: Float32Array, add: boolean, max: number } | null} */
    addSys: null,
    /** ветер (м/с) — сносит дым и пыль */
    wind: { x: 0.55, z: 0.22 },
    _dt: 0.016,
    _rr: 0,
    _gc: new Float32Array(3),
    /** секунд повышенного предела обломков (ядерный взрыв) */
    _boost: 0,
    /** эмиттеры ядерных взрывов (гриб) @type {any[]} */
    _nukes: [],
    _invRes: new BABYLON.Vector2(1, 1),
    /** @type {BABYLON.BaseTexture | null} */
    _depthNow: null,
    _sortCmp: (a, b) => b.dd - a.dd,

    /** @param {BABYLON.Scene} scene @param {VoxWorld} world */
    init(scene, world) {
        this.scene = scene; this.world = world; this.vs = world.vs;
        this.debris = [];
        // кубик обломка: свет и тень как у вокселей (плагин VoxMatPlugin, режим debris)
        const cube = this._cube = BABYLON.MeshBuilder.CreateBox('debris', { size: 1 }, scene);
        const cm = new BABYLON.StandardMaterial('debrisMat', scene);
        cm.diffuseColor = new BABYLON.Color3(1, 1, 1);
        cm.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        cm.specularPower = 60;
        cm.maxSimultaneousLights = 6;
        new VoxMatPlugin(cm, 'debris');
        cube.material = cm;
        cube.isPickable = false;
        cube.receiveShadows = true;
        cube.alwaysSelectAsActiveMesh = true;
        this._dm = new Float32Array(this.MAX_DEBRIS * 16);
        this._dc = new Float32Array(this.MAX_DEBRIS * 4);
        cube.thinInstanceSetBuffer('matrix', this._dm, 16, false);
        cube.thinInstanceSetBuffer('instanceColor', this._dc, 4, false);
        // всегда хотя бы один экземпляр (нулевого размера): иначе шейдер соберётся без цвета экземпляров и обломки будут белыми
        cube.thinInstanceCount = 1;
        this._puffTex = this._makePuffTexture(scene);
        this._noiseTex = this._makeNoiseTexture(scene);
        this._dummyDepth = BABYLON.RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
        this.alphaSys = this._makeSys('puffA', false);
        this.addSys = this._makeSys('puffAdd', true);
        this.alphaSys.mesh.alphaIndex = 1;
        this.addSys.mesh.alphaIndex = 2;
    },

    // ------------------------------------------------------------------ текстуры

    /**
     * Атлас 2×2 клубов дыма 256²: R,G — нормаль (x,y), B — яркость мелких деталей, A — плотность.
     * Клуб — кучевая масса из 18–22 шаров, края изъедены шумом, к краю клетки плотность гаснет.
     */
    _makePuffTexture(scene) {
        const S = 512, C = 256;
        const data = new Uint8Array(S * S * 4);
        let seed = 1337;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const lat = new Float32Array(33 * 33);
        const H = new Float32Array(C * C);
        const D = new Float32Array(C * C);
        const noise = (x, y, f) => {       // значение-шум на решётке 32×32, f — частота
            const gx = x * f, gy = y * f;
            const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
            const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
            const a = lat[(iy & 31) * 33 + (ix & 31)], b = lat[(iy & 31) * 33 + ((ix + 1) & 31)];
            const c = lat[((iy + 1) & 31) * 33 + (ix & 31)], d = lat[((iy + 1) & 31) * 33 + ((ix + 1) & 31)];
            return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        };
        for (let v = 0; v < 4; v++) {
            for (let i = 0; i < lat.length; i++) lat[i] = rnd();
            H.fill(0);
            const blobs = 18 + (v & 1) * 3;
            for (let k = 0; k < blobs; k++) {
                const a = rnd() * 6.2832, d = Math.pow(rnd(), 0.65) * 0.46;
                const cx = 0.5 + Math.cos(a) * d, cy = 0.5 + Math.sin(a) * d;
                const r = (0.16 + rnd() * 0.17) * (1 - d * 0.5), w = 0.55 + rnd() * 0.6;
                const x0 = Math.max(0, Math.floor((cx - r) * C)), x1 = Math.min(C - 1, Math.ceil((cx + r) * C));
                const y0 = Math.max(0, Math.floor((cy - r) * C)), y1 = Math.min(C - 1, Math.ceil((cy + r) * C));
                for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                    const dx = (x / C - cx) / r, dy = (y / C - cy) / r, q = 1 - (dx * dx + dy * dy);
                    if (q > 0) H[y * C + x] += w * q * q;
                }
            }
            for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
                const u = x / C, w = y / C;
                const n = noise(u, w, 6) * 0.5 + noise(u, w, 12) * 0.3 + noise(u, w, 24) * 0.2;
                const dx = u - 0.5, dy = w - 0.5, rr = Math.sqrt(dx * dx + dy * dy) * 2;
                const edge = Math.max(0, 1 - rr * rr);
                let h = H[y * C + x];
                h = h * (0.55 + 0.9 * n) - 0.08;
                H[y * C + x] = h * edge;
                const dens = Math.max(0, Math.min(1, h * 1.5)) * Math.pow(edge, 0.7);
                D[y * C + x] = dens;
            }
            const ox = (v % 2) * C, oy = ((v / 2) | 0) * C;
            for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
                const xm = Math.max(0, x - 2), xp = Math.min(C - 1, x + 2), ym = Math.max(0, y - 2), yp = Math.min(C - 1, y + 2);
                const gx = (H[y * C + xp] - H[y * C + xm]) * 3.2, gy = (H[yp * C + x] - H[ym * C + x]) * 3.2;
                const u = x / C, w = y / C;
                const det = 0.5 + 0.5 * (noise(u + 0.37, w + 0.11, 18) * 0.6 + noise(u, w, 40) * 0.4) - 0.25;
                const o = ((oy + y) * S + ox + x) * 4;
                data[o] = Math.max(0, Math.min(255, (0.5 - gx * 0.5) * 255));
                data[o + 1] = Math.max(0, Math.min(255, (0.5 - gy * 0.5) * 255));
                data[o + 2] = Math.max(0, Math.min(255, det * 255 + 40));
                data[o + 3] = Math.max(0, Math.min(255, D[y * C + x] * 255));
            }
        }
        const tex = BABYLON.RawTexture.CreateRGBATexture(data, S, S, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
        tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        return tex;
    },

    /** Бесшовный шум 128² (4 независимых канала): дрожь пламени. */
    _makeNoiseTexture(scene) {
        const S = 128;
        const data = new Uint8Array(S * S * 4);
        let seed = 4242;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let ch = 0; ch < 4; ch++) {
            const grids = [8, 16, 32].map(n => { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return { n, g }; });
            for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
                let s = 0, amp = 0.55, tot = 0;
                for (const { n, g } of grids) {
                    const gx = x / S * n, gy = y / S * n, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
                    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
                    const a = g[(iy % n) * n + (ix % n)], b = g[(iy % n) * n + ((ix + 1) % n)], c = g[((iy + 1) % n) * n + (ix % n)], d = g[((iy + 1) % n) * n + ((ix + 1) % n)];
                    s += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy); tot += amp; amp *= 0.55;
                }
                data[(y * S + x) * 4 + ch] = Math.max(0, Math.min(255, s / tot * 255));
            }
        }
        const tex = BABYLON.RawTexture.CreateRGBATexture(data, S, S, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
        tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        return tex;
    },

    // ------------------------------------------------------------------ шейдер билбордов

    _makeSys(name, add) {
        const scene = this.scene;
        if (!BABYLON.Effect.ShadersStore['rlPuffVertexShader']) {
            BABYLON.Effect.ShadersStore['rlPuffVertexShader'] = `precision highp float;
attribute vec3 position; attribute vec2 uv;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#endif
uniform mat4 viewProjection; uniform mat4 view; uniform vec3 camPos;
uniform vec3 toSun; uniform vec3 skyZen; uniform vec3 skyHor; uniform vec3 skyGnd; uniform vec4 fogP;
varying vec2 vUV; varying vec4 vCol; varying vec4 vD; varying vec3 vFogC; varying float vFog;
varying vec3 vRight; varying vec3 vUp; varying vec3 vToCam; varying vec2 vQ; varying float vViewZ; varying float vSoft;
${RL_GLSL}
void main(){
#ifdef INSTANCES
  vec4 w0 = world0, w1 = world1, w2 = world2, w3 = world3;
#else
  vec4 w0 = vec4(0.0), w1 = vec4(0.0), w2 = vec4(0.0), w3 = vec4(0.0);
#endif
  vec3 c = w0.xyz; float size = w0.w; float mode = w3.w;
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  vec2 p = position.xy;
  vec3 wp; vec2 q = p;
  vec3 toCam = normalize(camPos - c);
  float soft = 1.0;
  if (mode > 0.5 && mode < 1.5) {
    vec3 ax = w3.xyz; float L = length(ax); ax = L > 1e-5 ? ax / L : up;
    vec3 side = normalize(cross(ax, toCam) + vec3(1e-6));
    wp = c + side * p.x * size + ax * p.y * max(w1.z, size); soft = 0.0;
  } else if (mode > 1.5 && mode < 2.5) {
    wp = c + vec3(p.x, 0.0, p.y) * size * 2.0; soft = 0.0;
  } else if (mode > 2.5 && mode < 3.5) {
    vec3 hr = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-6));
    wp = c + hr * p.x * size + vec3(0.0, p.y + 0.5, 0.0) * size * 1.7; soft = 0.0;
  } else {
    float s = sin(w1.x), co = cos(w1.x);
    q = vec2(co * p.x - s * p.y, s * p.x + co * p.y);
    wp = c + (right * q.x + up * q.y) * size;
    if (mode > 3.5) soft = 0.0;
  }
  vUV = uv; vCol = w2; vD = vec4(w1.y, w1.w, mode, w1.z); vQ = q * 2.0; vRight = right; vUp = up; vToCam = toCam;
  float dist = length(camPos - wp);
  // камера внутри клуба — гасим, чтобы не слепило
  float nearF = (mode < 0.5 || mode > 3.5) ? clamp((dist - size * 0.12) / max(size * 0.85, 0.05), 0.0, 1.0) : 1.0;
  vD.x *= nearF;
  vFogC = rlFogCol((wp - camPos) / max(dist, 1e-3), toSun, skyZen, skyHor, skyGnd);
  vFog = 1.0 - rlFogAmt(camPos, wp, fogP);
  vViewZ = abs((view * vec4(wp, 1.0)).z);
  vSoft = soft > 0.5 ? 1.0 / max(size * 0.8, 0.05) : 0.0;
  gl_Position = viewProjection * vec4(wp, 1.0);
}`;
            BABYLON.Effect.ShadersStore['rlPuffFragmentShader'] = `precision highp float;
varying vec2 vUV; varying vec4 vCol; varying vec4 vD; varying vec3 vFogC; varying float vFog;
varying vec3 vRight; varying vec3 vUp; varying vec3 vToCam; varying vec2 vQ; varying float vViewZ; varying float vSoft;
uniform sampler2D puffTex; uniform sampler2D noiseTex; uniform sampler2D depthTex;
uniform vec3 toSun; uniform vec3 sunCol; uniform vec3 ambSky; uniform vec3 ambGnd;
uniform float additive; uniform float time; uniform float softOn; uniform vec2 invRes;
vec3 flameRamp(float T){
  vec3 c = mix(vec3(0.10, 0.008, 0.0), vec3(1.0, 0.20, 0.02), smoothstep(0.0, 0.35, T));
  c = mix(c, vec3(1.0, 0.58, 0.10), smoothstep(0.28, 0.70, T));
  return mix(c, vec3(1.0, 0.90, 0.58), smoothstep(0.65, 1.10, T));
}
void main(){
  float a = vD.x; float variant = vD.y; float mode = vD.z; float t = vD.w;
  float soft = 1.0;
  if (softOn > 0.5 && vSoft > 0.0) {
    float sz = abs(texture2D(depthTex, gl_FragCoord.xy * invRes).r);
    if (sz < 0.001) sz = 1.0e6;          // пусто в G-буфере (небо, дальняя земля) — нет препятствия
    soft = clamp((sz - vViewZ) * vSoft, 0.0, 1.0);
    soft = soft * soft * (3.0 - 2.0 * soft);
  }
  vec3 rgb; float m;
  if (additive > 0.5) {
    if (mode < 0.5) {                      // огненный шар / клуб огня
      vec2 cell = vec2(mod(variant, 2.0), floor(variant / 2.0)) * 0.5;
      vec4 tx = texture2D(puffTex, cell + clamp(vUV, 0.003, 0.997) * 0.5);
      float d = tx.a * (0.45 + tx.b * 0.9);
      m = d * a; rgb = vCol.rgb * (0.55 + tx.b * 0.8);
    } else if (mode < 1.5) {               // искра-штрих: хвост тусклее головы
      float x = abs(vUV.x - 0.5) * 2.0;
      m = (1.0 - x * x) * pow(vUV.y, 1.6) * a; rgb = vCol.rgb;
    } else if (mode < 2.5) {               // кольцо ударной волны
      vec2 q = vUV * 2.0 - 1.0; float r = length(q);
      float n = texture2D(noiseTex, vUV * 2.0 + variant).r;
      m = smoothstep(0.50, 0.90, r) * (1.0 - smoothstep(0.90, 1.0, r)) * a * (0.65 + 0.7 * n); rgb = vCol.rgb;
    } else if (mode < 3.5) {               // язык пламени
      vec2 p = vUV; float yy = p.y; float x = (p.x - 0.5) * 2.0;
      float seed = variant * 0.173;
      vec4 n1 = texture2D(noiseTex, vec2(p.x * 0.8 + seed, yy * 0.6 - time * 0.85 + seed * 3.0));
      vec4 n2 = texture2D(noiseTex, vec2(p.x * 1.7 - seed, yy * 1.3 - time * 1.7 + 0.5));
      x += (n1.r - 0.5) * 0.95 * yy * (0.4 + yy) + (n2.g - 0.5) * 0.35 * yy;
      float w = pow(max(1.0 - yy, 0.0), 0.75) * smoothstep(0.0, 0.14, yy + 0.05) * (0.30 + 0.62 * sqrt(max(yy * (1.0 - yy), 0.0)) * 1.2);
      w = max(w, 0.004);
      float body = 1.0 - smoothstep(w * 0.25, w, abs(x));
      float I = body * pow(max(1.0 - yy, 0.0), 0.55) * (0.62 + 0.75 * n2.b);
      float core = (1.0 - smoothstep(0.0, 0.6 * w, abs(x))) * pow(max(1.0 - yy, 0.0), 1.5);
      float T = clamp(I * 0.85 + core * 0.7, 0.0, 1.3) * vCol.a * (1.0 - t * 0.55);
      m = I * a; rgb = flameRamp(T) * (2.2 + core * 2.2) * vCol.rgb;
    } else if (mode < 4.5) {               // вспышка: мягкое ядро + лучи
      vec2 q = vUV * 2.0 - 1.0; float r = length(q);
      float ang = atan(q.y, q.x);
      float star = 0.35 * pow(abs(cos(ang * 2.0 + vD.y * 3.0)), 24.0) * (1.0 - r);
      m = (pow(max(1.0 - r, 0.0), 2.4) + star) * a; rgb = vCol.rgb;
    } else {                               // уголёк: мерцающая точка
      vec2 q = vUV * 2.0 - 1.0; float r = length(q);
      m = (1.0 - smoothstep(0.15, 1.0, r)) * a * (0.55 + 0.45 * sin(time * 24.0 + variant * 17.0 + vCol.a * 40.0)); rgb = vCol.rgb;
    }
    m *= soft;
    if (!(m >= 0.002) || isnan(rgb.x + rgb.y + rgb.z)) discard;
    gl_FragColor = vec4(min(rgb, vec3(40.0)) * m * vFog, m);
  } else {
    vec2 cell = vec2(mod(variant, 2.0), floor(variant / 2.0)) * 0.5;
    vec2 uv = clamp(vUV, 0.003, 0.997);
    vec4 t1 = texture2D(puffTex, cell + uv * 0.5);
    if (mode > 1.5 && mode < 2.5) {        // кольцо пыли по земле
      vec2 q = vUV * 2.0 - 1.0; float r = length(q);
      float n = texture2D(noiseTex, vUV * 2.5 + variant * 0.31).r * 0.7 + t1.b * 0.5;
      m = smoothstep(0.28, 0.80, r) * (1.0 - smoothstep(0.84, 1.0, r)) * a * (0.35 + n);
      vec3 amb = mix(ambGnd, ambSky, 0.7);
      rgb = vCol.rgb * (amb + sunCol * 0.32 * (0.6 + 0.4 * t1.b));
    } else {
      float v2 = mod(variant + 1.0, 4.0);
      vec2 cell2 = vec2(mod(v2, 2.0), floor(v2 / 2.0)) * 0.5;
      vec4 t2 = texture2D(puffTex, cell2 + vec2(uv.y, 1.0 - uv.x) * 0.78 * 0.5 + 0.11 * 0.5);
      float d = t1.a * mix(0.50, 1.20, t2.b);
      float er = t * 0.48;
      m = smoothstep(er, er + 0.34, d) * a;
      vec3 n = vec3(t1.rg * 2.0 - 1.0, 0.0);
      n.xy *= 1.15;
      n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
      vec3 N = normalize(vRight * n.x + vUp * n.y + vToCam * n.z);
      float diff = clamp(dot(N, toSun) * 0.5 + 0.5, 0.0, 1.0); diff *= diff;
      float fs = pow(clamp(dot(-vToCam, toSun), 0.0, 1.0), 5.0) * (1.0 - t1.a * 0.6);
      float core = mix(1.0, 0.42, smoothstep(0.30, 1.0, t1.a));
      vec3 amb = mix(ambGnd, ambSky, N.y * 0.5 + 0.5);
      vec3 lit = amb * (0.85 + 0.3 * t1.b) + sunCol * (diff * 0.62 + fs * 0.9) * core;
      rgb = vCol.rgb * lit * mix(0.78, 1.18, t1.b) + vec3(1.0, 0.40, 0.11) * vCol.a * (0.25 + 0.75 * t1.b) * 1.2;
    }
    m *= soft;
    if (!(m >= 0.002) || isnan(rgb.x + rgb.y + rgb.z)) discard;
    rgb = mix(vFogC, min(rgb, vec3(40.0)), vFog);
    gl_FragColor = vec4(rgb * m, m);
  }
}`;
        }
        const mesh = BABYLON.MeshBuilder.CreatePlane(name, { size: 1 }, scene);
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.receiveShadows = false;
        const mat = new BABYLON.ShaderMaterial(name + 'Mat', scene, { vertex: 'rlPuff', fragment: 'rlPuff' }, {
            attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3'],
            uniforms: ['viewProjection', 'view', 'camPos', 'toSun', 'skyZen', 'skyHor', 'skyGnd', 'fogP', 'sunCol', 'ambSky', 'ambGnd', 'additive', 'time', 'softOn', 'invRes'],
            samplers: ['puffTex', 'noiseTex', 'depthTex'],
            needAlphaBlending: true,
        });
        mat.setTexture('puffTex', this._puffTex);
        mat.setTexture('noiseTex', this._noiseTex);
        mat.setTexture('depthTex', this._dummyDepth);
        mat.backFaceCulling = false;
        mat.disableDepthWrite = true;
        mat.alphaMode = add ? BABYLON.Constants.ALPHA_ONEONE : BABYLON.Constants.ALPHA_PREMULTIPLIED_PORTERDUFF;
        mat.setFloat('additive', add ? 1 : 0);
        mat.setFloat('softOn', 0);
        mesh.material = mat;
        mesh.renderingGroupId = 1;
        const max = add ? this.MAX_ADD : this.MAX_PUFFS;
        const buf = new Float32Array(max * 16);
        mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
        mesh.thinInstanceCount = 0;
        scene.setRenderingAutoClearDepthStencil(1, false, false, false);
        return { mesh, mat, list: [], buf, add, max };
    },

    // =================================================================== обломки

    /** Множитель плотности по качеству (0.45 / 0.7 / 1). */
    _q() { return (typeof VoxRender !== 'undefined' && VoxRender.fxScale) || 1; },
    /** Минимальная графика: эффекты, обломки и снег сильно урезаны. */
    _low() { return typeof VoxRender !== 'undefined' && VoxRender.quality === 'low'; },

    /** Один кубик-обломок материала v (байт) в точке, со скоростью; size — множитель вокселя. */
    spawnDebris(x, y, z, v, vx, vy, vz, size = 1) {
        if (!this._cube) return;
        const q = this._q();
        const low = this._low();
        const cap = low ? 600 : Math.floor((this._boost > 0 ? this.MAX_DEBRIS : 6000) * Math.pow(q, 1.3));
        if (this.debris.length >= cap) {
            // вытеснить самый старый из нескольких случайных
            let idx = 0, best = -1;
            for (let k = 0; k < 6; k++) { const i = (Math.random() * this.debris.length) | 0; if (this.debris[i].age > best) { best = this.debris[i].age; idx = i; } }
            this.debris[idx] = this.debris[this.debris.length - 1]; this.debris.pop();
        }
        const c = VoxMat.rgb, j = 0.86 + Math.random() * 0.28;
        const a = Math.random() * Math.PI * 2, s = Math.random() * 2 - 1, r = Math.sqrt(1 - s * s);
        const m = VoxMat.of(v);
        // флаг блеска для шейдера: 0 — матовый, 0.6 металл, 0.95 стекло/плитка
        const flag = m.glass ? 0.95 : (m.spec >= 0.5 ? 0.6 : (m.spec > 0.2 ? 0.25 : 0));
        this.debris.push({
            x, y, z, vx, vy, vz,
            ax: r * Math.cos(a), ay: s, az: r * Math.sin(a), ang: Math.random() * 6.28, spin: (Math.random() * 2 - 1) * 18,
            size: this.vs * size * (0.78 + Math.random() * 0.28), age: 0, life: ((size < 0.6 ? 6 : 12) + Math.random() * 10) * (low ? 0.3 : (0.45 + 0.55 * q)), rest: false, restCheck: 0, restBody: /** @type {VoxBody | null} */ (null),
            r: c[v * 3] * j, g: c[v * 3 + 1] * j, b: c[v * 3 + 2] * j, flag,
        });
    },

    /** Разлёт вынутых вокселей: list — [[wx, wy, wz, v]…] (центры, мир); max — сколько кубиков (плюс крошка). */
    voxelsBurst(list, cx, cy, cz, speed, max = 220) {
        const n = list.length;
        if (!n) return;
        const q = this._q();
        const low = this._low();
        max = low ? Math.max(4, Math.round(max * 0.22)) : Math.max(8, Math.round(max * (0.5 + 0.5 * q)));
        const step = Math.max(1, n / max);
        for (let f = 0; f < n; f += step) {
            const [x, y, z, v] = list[f | 0];
            let dx = x - cx, dy = y - cy, dz = z - cz;
            const l = Math.hypot(dx, dy, dz) || 1;
            dx /= l; dy /= l; dz /= l;
            const sp = speed * (0.35 + Math.random() * 0.9);
            const rr = Math.random();
            this.spawnDebris(x, y, z, v, dx * sp + (Math.random() - 0.5) * 2, dy * sp + Math.random() * speed * 0.4 + 1, dz * sp + (Math.random() - 0.5) * 2,
                rr < 0.5 ? 1 : (rr < 0.8 ? 0.62 : 0.4));
            // мелкая крошка с того же места, быстрее и дальше
            if (!low && Math.random() < 0.55 * q) {
                const s2 = sp * (1.1 + Math.random() * 0.8);
                this.spawnDebris(x, y, z, v, dx * s2 + (Math.random() - 0.5) * 3, dy * s2 + Math.random() * speed * 0.6 + 1.5, dz * s2 + (Math.random() - 0.5) * 3, 0.3 + Math.random() * 0.15);
            }
        }
    },

    /** Тело целиком — в обломки (предел числа тел); every — каждый какой воксель становится кубиком. */
    bodyToDebris(b, every = 2) {
        const W = [0, 0, 0];
        let n = 0;
        for (let y = 0; y < b.sy; y++) for (let z = 0; z < b.sz; z++) for (let x = 0; x < b.sx; x++) {
            const v = b.grid[x + b.sx * (z + b.sz * y)];
            if (!v || (n++ % every)) continue;
            VoxPhysics.toWorld(b, x, y, z, W);
            this.spawnDebris(W[0], W[1], W[2], v, b.v[0], b.v[1], b.v[2]);
        }
    },

    /** Корзины тел по клеткам 2 м (x, z) — обломки проверяют только тела своей клетки. */
    _bodyBuckets() {
        const cell = 2, map = this._bk || (this._bk = new Map());
        map.clear();
        if (typeof VoxPhysics === 'undefined') return map;
        for (const b of VoxPhysics.bodies) {
            if (b.dead) continue;
            const a = b.aabb;
            for (let cx = Math.floor(a[0] / cell); cx <= Math.floor(a[3] / cell); cx++) for (let cz = Math.floor(a[2] / cell); cz <= Math.floor(a[5] / cell); cz++) {
                const key = cx * 4096 + cz;
                let l = map.get(key);
                if (!l) { l = []; map.set(key, l); }
                l.push(b);
            }
        }
        return map;
    },

    /** Обломок против тел: вошёл в воксель тела — отскок от его поверхности с учётом скорости тела. */
    _debrisVsBodies(d, buckets) {
        const l = buckets.get(Math.floor(d.x / 2) * 4096 + Math.floor(d.z / 2));
        if (!l) return;
        const L = this._tl || (this._tl = [0, 0, 0]), C = this._tc || (this._tc = [0, 0, 0]);
        for (const b of l) {
            const a = b.aabb;
            if (d.x < a[0] || d.x > a[3] || d.y < a[1] || d.y > a[4] || d.z < a[2] || d.z > a[5]) continue;
            VoxPhysics.toLocal(b, d.x, d.y, d.z, L);
            const lx = Math.floor(L[0]), ly = Math.floor(L[1]), lz = Math.floor(L[2]);
            if (!b.get(lx, ly, lz)) continue;
            // нормаль: из центра вокселя тела к обломку (мир); выталкивание за его грань
            VoxPhysics.toWorld(b, lx, ly, lz, C);
            let nx = d.x - C[0], ny = d.y - C[1], nz = d.z - C[2];
            const nl = Math.hypot(nx, ny, nz);
            if (nl < 1e-4) { nx = 0; ny = 1; nz = 0; } else { nx /= nl; ny /= nl; nz /= nl; }
            const push = this.vs * 0.55 + d.size * 0.5;
            d.x = C[0] + nx * push; d.y = C[1] + ny * push; d.z = C[2] + nz * push;
            const pv = VoxPhysics.pointVelocity(b, d.x, d.y, d.z);
            let rx = d.vx - pv[0], ry = d.vy - pv[1], rz = d.vz - pv[2];
            const vn = rx * nx + ry * ny + rz * nz;
            if (vn < 0) { rx -= 1.3 * vn * nx; ry -= 1.3 * vn * ny; rz -= 1.3 * vn * nz; }
            rx *= 0.7; ry *= 0.7; rz *= 0.7;
            d.vx = rx + pv[0]; d.vy = ry + pv[1]; d.vz = rz + pv[2];
            d.spin *= 0.6;
            // лёг на спящее тело сверху
            if (b.sleeping && ny > 0.6 && rx * rx + ry * ry + rz * rz < 0.25) { d.rest = true; d.restBody = b; d.vx = d.vy = d.vz = 0; }
            return;
        }
    },

    _updateDebris(dt) {
        const w = this.world, k = 1 / this.vs, g = 9.81;
        const list = this.debris;
        const lowFx = this._low();
        const buckets = lowFx ? new Map() : this._bodyBuckets();
        const maxStep = this.vs * 0.6;
        for (let i = list.length - 1; i >= 0; i--) {
            const d = list[i];
            d.age += dt;
            if (d.age > d.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
            if (!d.rest) {
                d.vy -= g * dt;
                const drag = 1 / (1 + dt * 0.15);
                d.vx *= drag; d.vy *= drag; d.vz *= drag;
                // мелкими шагами: быстрый обломок не проходит сквозь тонкую стену
                const sp = Math.abs(d.vx) + Math.abs(d.vy) + Math.abs(d.vz);
                const n = Math.min(4, Math.max(1, Math.ceil(sp * dt / maxStep)));
                const h = dt / n;
                for (let st = 0; st < n && !d.rest; st++) {
                    const nx = d.x + d.vx * h;
                    if (w.get(Math.floor(nx * k), Math.floor(d.y * k), Math.floor(d.z * k))) { d.vx *= -0.3; d.vz *= 0.8; d.spin *= 0.7; } else d.x = nx;
                    const nz = d.z + d.vz * h;
                    if (w.get(Math.floor(d.x * k), Math.floor(d.y * k), Math.floor(nz * k))) { d.vz *= -0.3; d.vx *= 0.8; d.spin *= 0.7; } else d.z = nz;
                    const ny = d.y + d.vy * h;
                    if (w.get(Math.floor(d.x * k), Math.floor(ny * k), Math.floor(d.z * k))) {
                        if (d.vy < 0) {
                            d.y = (Math.floor(ny * k) + 1) / k + d.size * 0.5;
                            d.vy *= -0.28; d.vx *= 0.62; d.vz *= 0.62; d.spin *= 0.55;
                            if (Math.abs(d.vy) < 0.4 && d.vx * d.vx + d.vz * d.vz < 0.2) { d.rest = true; d.restBody = null; d.vy = 0; }
                        } else d.vy = 0;
                    } else d.y = ny;
                    if (!lowFx) this._debrisVsBodies(d, buckets);
                }
                d.ang += d.spin * dt;
                if (d.y < -5) { list[i] = list[list.length - 1]; list.pop(); continue; }
            } else if ((d.restCheck += dt) > 0.25) {
                // опора исчезла или тело под обломком ожило — снова падает
                d.restCheck = 0;
                if (d.restBody) { if (d.restBody.dead || !d.restBody.sleeping) { d.rest = false; d.restBody = null; } }
                else if (!w.get(Math.floor(d.x * k), Math.floor((d.y - d.size) * k), Math.floor(d.z * k))) d.rest = false;
            }
        }
        const dm = this._dm, dc = this._dc;
        let n = 0;
        for (let i = 0; i < list.length && n < this.MAX_DEBRIS; i++) {
            const d = list[i];
            const fade = Math.min(1, (d.life - d.age) / 0.8);
            const s = d.size * Math.max(0.05, fade);
            // матрица поворота (ось-угол) × масштаб, без аллокаций; строки — образы базисных векторов
            const c = Math.cos(d.ang), sn = Math.sin(d.ang), t = 1 - c;
            const ax = d.ax, ay = d.ay, az = d.az;
            const o = n * 16;
            dm[o] = (t * ax * ax + c) * s; dm[o + 1] = (t * ax * ay + sn * az) * s; dm[o + 2] = (t * ax * az - sn * ay) * s; dm[o + 3] = 0;
            dm[o + 4] = (t * ax * ay - sn * az) * s; dm[o + 5] = (t * ay * ay + c) * s; dm[o + 6] = (t * ay * az + sn * ax) * s; dm[o + 7] = 0;
            dm[o + 8] = (t * ax * az + sn * ay) * s; dm[o + 9] = (t * ay * az - sn * ax) * s; dm[o + 10] = (t * az * az + c) * s; dm[o + 11] = 0;
            dm[o + 12] = d.x; dm[o + 13] = d.y; dm[o + 14] = d.z; dm[o + 15] = 1;
            const o4 = n * 4;
            dc[o4] = d.r; dc[o4 + 1] = d.g; dc[o4 + 2] = d.b; dc[o4 + 3] = d.flag;
            n++;
        }
        if (!n) dm.fill(0, 0, 16);
        this._cube.thinInstanceCount = Math.max(1, n);
        if (n || this._debrisWas) { this._cube.thinInstanceBufferUpdated('matrix'); this._cube.thinInstanceBufferUpdated('instanceColor'); }
        this._debrisWas = n > 0;
    },

    // =================================================================== билборды

    /**
     * Частица. o: { add (сложение), mode (0 клуб/шар, 1 штрих по скорости, 2 кольцо по земле, 3 язык пламени,
     *   4 вспышка, 5 уголёк), size, grow (м/с), life, alpha, fadeIn, fadeOut (доля жизни, с которой гаснет),
     *   vx vy vz, drag, buoy (м/с² вверх), buoyDecay (1/с), gravity, turb (завихрение), wind (0..1),
     *   r g b (дым — «экранные» цвета 0..1, сложение — HDR), emit (свечение дыма 0..1, гаснет ~3 с),
     *   heat (пламя), fire (окраска шара по температуре), stretch (длина штриха), cool (посветление дыма),
     *   variant, spin, bounce, delay, keep (не вытеснять при переполнении — облако ядерного взрыва) }.
     */
    puff(x, y, z, o) {
        if (this._low()) {
            if (!o.add && Math.random() < 0.5) return;
            const sys0 = o.add ? this.addSys : this.alphaSys;
            if (sys0 && sys0.list.length > 500) return;
        }
        const sys = o.add ? this.addSys : this.alphaSys;
        if (!sys) return;
        const list = sys.list;
        const lin = !o.add;
        const p = {
            x, y, z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
            size: o.size || 1, grow: o.grow || 0, life: o.life || 2, age: o.delay ? -o.delay : 0, alpha: o.alpha != null ? o.alpha : 1, fadeIn: o.fadeIn || 0.08,
            fadeOut: o.fadeOut != null ? o.fadeOut : 0.45,
            drag: o.drag != null ? o.drag : 1, buoy: o.buoy || 0, buoyDecay: o.buoyDecay || 0, gravity: o.gravity || 0,
            turb: o.turb || 0, wind: o.wind || 0, ph: Math.random() * 6.28,
            r: lin ? Math.pow(o.r != null ? o.r : 1, 2.2) : (o.r != null ? o.r : 1), g: lin ? Math.pow(o.g != null ? o.g : 1, 2.2) : (o.g != null ? o.g : 1),
            b: lin ? Math.pow(o.b != null ? o.b : 1, 2.2) : (o.b != null ? o.b : 1),
            emit: o.emit || 0, heat: o.heat != null ? o.heat : 1, cool: o.cool || 0,
            mode: o.mode || 0, stretch: o.stretch || 0, fire: !!o.fire, variant: o.variant != null ? o.variant : (Math.random() * 4) | 0,
            rot: Math.random() * 6.28, spin: o.spin != null ? o.spin : (Math.random() - 0.5) * 0.7, bounce: !!o.bounce, dd: 0, keep: !!o.keep,
        };
        if (list.length >= sys.max) {
            let j = (this._rr++ * 7) % list.length;
            for (let t = 0; t < 6 && list[j].keep; t++) j = (this._rr++ * 7) % list.length;
            if (list[j].keep && !p.keep) return;
            list[j] = p;
        } else list.push(p);
    },

    _updateSys(sys, dt, cam) {
        const list = sys.list, buf = sys.buf;
        const w = this.world, k = 1 / this.vs, wind = this.wind;
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            p.age += dt;
            if (p.age >= p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
            if (p.age < 0) continue;
            const dr = 1 / (1 + p.drag * dt);
            p.vx *= dr; p.vy *= dr; p.vz *= dr;
            if (p.buoyDecay) p.buoy *= 1 / (1 + p.buoyDecay * dt);
            p.vy += (p.buoy - p.gravity) * dt;
            if (p.turb) {
                const ph = p.ph + p.age * 0.9;
                p.vx += Math.sin(ph * 1.7 + p.y * 0.9) * p.turb * dt;
                p.vz += Math.cos(ph * 1.3 + p.x * 0.9) * p.turb * dt;
                p.vy += Math.sin(ph * 2.1 + p.z * 0.7) * p.turb * 0.35 * dt;
            }
            if (p.wind) {
                const wk = p.wind * Math.min(1, (p.y - 1.5) * 0.12 + 0.35) * dt * 0.35;
                p.vx += (wind.x - p.vx) * wk; p.vz += (wind.z - p.vz) * wk;
            }
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            if (p.bounce && w.get(Math.floor(p.x * k), Math.floor(p.y * k), Math.floor(p.z * k))) { p.vy = Math.abs(p.vy) * 0.3 + 0.2; p.vx *= 0.5; p.vz *= 0.5; p.y += 0.06; }
            p.size += p.grow * dt;
            p.grow *= 1 / (1 + dt * 1.2);
            p.rot += p.spin * dt;
        }
        if (!sys.add) {
            const cx = cam.x, cy = cam.y, cz = cam.z;
            for (let i = 0; i < list.length; i++) { const p = list[i]; p.dd = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) + (p.z - cz) * (p.z - cz); }
            list.sort(this._sortCmp);
        }
        let n = 0;
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (p.age < 0) continue;
            const t = p.age / p.life;
            const fo = p.fadeOut;
            const out = t < fo ? 1 : Math.pow(Math.max(0, 1 - (t - fo) / (1 - fo)), 1.4);
            let a = p.alpha * Math.min(1, p.age / p.fadeIn) * out;
            let r = p.r, g = p.g, b = p.b;
            if (p.fire) {
                // температура: белый -> жёлтый -> оранжевый -> красный -> тёмный
                const T = Math.max(0, 1 - t * 1.25);
                r = 4.2 * Math.min(1, T * 2.2 + 0.25); g = 2.6 * Math.max(0, T * 1.6 - 0.15); b = 1.4 * Math.max(0, T - 0.55) * 2;
                a *= Math.min(1, T * 1.6 + 0.15);
            } else if (p.cool) {
                const c = Math.min(1, t * p.cool);
                r += (0.30 - r) * c * 0.5; g += (0.28 - g) * c * 0.5; b += (0.26 - b) * c * 0.5;
            }
            const o = n * 16;
            buf[o] = p.x; buf[o + 1] = p.y; buf[o + 2] = p.z; buf[o + 3] = p.size;
            buf[o + 4] = p.rot; buf[o + 5] = a; buf[o + 6] = p.mode === 1 ? p.stretch : t; buf[o + 7] = p.variant;
            buf[o + 8] = r; buf[o + 9] = g; buf[o + 10] = b;
            buf[o + 11] = p.mode === 3 ? p.heat : p.emit * Math.max(0, 1 - t * 6) ;
            buf[o + 12] = p.vx; buf[o + 13] = p.vy; buf[o + 14] = p.vz; buf[o + 15] = p.mode;
            n++;
        }
        sys.mesh.thinInstanceCount = n;
        if (n) sys.mesh.thinInstanceBufferUpdated('matrix');
    },

    // =================================================================== составные эффекты

    /** Линейный цвет материала под точкой (первый твёрдый воксель вниз) в this._gc, светлее (пыль). */
    _groundRgb(x, y, z) {
        const w = this.world, k = 1 / this.vs, c = VoxMat.rgb;
        const ix = Math.floor(x * k), iz = Math.floor(z * k);
        let v = 0;
        for (let iy = Math.floor(y * k); iy >= Math.max(1, Math.floor(y * k) - 25); iy--) { v = w.get(ix, iy, iz); if (v) break; }
        const g = this._gc;
        if (!v) { g[0] = 0.55; g[1] = 0.5; g[2] = 0.42; return g; }
        for (let i = 0; i < 3; i++) g[i] = Math.min(1, c[(v & 127) * 3 + i] * 0.7 + 0.28);
        return g;
    },
    _groundY(x, y, z) {
        const w = this.world, k = 1 / this.vs;
        const ix = Math.floor(x * k), iz = Math.floor(z * k);
        for (let iy = Math.floor(y * k) + 2; iy >= Math.max(1, Math.floor(y * k) - 30); iy--) if (w.get(ix, iy, iz)) return (iy + 1) * this.vs;
        return y - 1;
    },

    /** Взрыв радиуса R (м) в точке: вспышка, огненный шар, ударное кольцо, искры, угольки, густой столб дыма. */
    explosion(x, y, z, R) {
        const q = this._q();
        const s = Math.max(0.5, R / 2.4);
        const gy = this._groundY(x, y, z);
        const gc = this._groundRgb(x, y, z);
        const gr = Math.pow(gc[0], 0.8), gg = Math.pow(gc[1], 0.8), gb = Math.pow(gc[2], 0.8);
        // ядро вспышки и широкий тёплый ореол
        this.puff(x, y, z, { add: true, mode: 4, size: 5.0 * s, grow: 10 * s, life: 0.16, alpha: 1, fadeIn: 0.01, fadeOut: 0.1, r: 8, g: 6, b: 3.6, drag: 0 });
        this.puff(x, y, z, { add: true, mode: 4, size: 8.5 * s, grow: 7 * s, life: 0.42, alpha: 0.6, fadeIn: 0.02, fadeOut: 0.1, r: 3.2, g: 1.3, b: 0.4, drag: 0 });
        // ударное кольцо по земле: светлый фронт и пыль за ним
        this.puff(x, gy + 0.04, z, { add: true, mode: 2, size: 0.4, grow: 17 * s, life: 0.5, alpha: 0.7, fadeIn: 0.01, fadeOut: 0.05, r: 1.7, g: 1.4, b: 1.1, drag: 0.5 });
        this.puff(x, gy + 0.05, z, { mode: 2, size: 0.5, grow: 12 * s, life: 2.4, alpha: 0.65, fadeIn: 0.02, fadeOut: 0.2, r: gr, g: gg, b: gb, drag: 0.8, spin: 0 });
        // огненный шар
        const nf = Math.round(16 * q) + 4;
        for (let i = 0; i < nf; i++) {
            const a = Math.random() * 6.28, e = Math.random() * 2 - 0.3, sp = (2 + Math.random() * 7) * s;
            const ce = Math.cos(e);
            this.puff(x, y + 0.2, z, { add: true, fire: true, size: (0.9 + Math.random() * 0.9) * s, grow: (2.6 + Math.random() * 2.4) * s,
                life: 0.45 + Math.random() * 0.6, vx: Math.cos(a) * ce * sp, vy: Math.sin(e) * sp + 2.0, vz: Math.sin(a) * ce * sp, drag: 3.2, buoy: 4, fadeIn: 0.02, fadeOut: 0.2 });
        }
        // языки огня, летящие вверх вслед шару
        for (let i = 0; i < Math.round(8 * q); i++) {
            const a = Math.random() * 6.28, d = Math.random() * 0.5 * R;
            this.puff(x + Math.cos(a) * d, y - 0.1, z + Math.sin(a) * d, { add: true, mode: 3, size: (0.7 + Math.random() * 0.6) * s, life: 0.7 + Math.random() * 0.6,
                vy: (2 + Math.random() * 3) * s, vx: Math.cos(a) * 1.5, vz: Math.sin(a) * 1.5, drag: 1.5, buoy: 3, alpha: 0.9, fadeIn: 0.03, heat: 1.1 });
        }
        // искры
        const ns = Math.round(60 * q);
        for (let i = 0; i < ns; i++) {
            const a = Math.random() * 6.28, e = Math.random() * 1.7 - 0.2, sp = (8 + Math.random() * 24) * s;
            const ce = Math.cos(e);
            this.puff(x, y + 0.2, z, { add: true, mode: 1, size: 0.03, stretch: 0.3 + Math.random() * 0.55, life: 0.6 + Math.random() * 1.6,
                vx: Math.cos(a) * ce * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * ce * sp, drag: 0.9, gravity: 9.8, bounce: true, r: 6, g: 2.8, b: 0.8, fadeIn: 0.01, fadeOut: 0.55 });
        }
        // угольки: медленно плывут и тлеют
        const ne = Math.round(26 * q);
        for (let i = 0; i < ne; i++) {
            const a = Math.random() * 6.28, e = Math.random() * 1.3, sp = (2 + Math.random() * 7) * s;
            this.puff(x, y + 0.3, z, { add: true, mode: 5, size: 0.05 + Math.random() * 0.04, life: 2.5 + Math.random() * 4, alpha: 0.9,
                vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1, vz: Math.sin(a) * Math.cos(e) * sp, drag: 1.2, buoy: 0.9, gravity: 0, turb: 1.8, wind: 0.6,
                r: 3.2, g: 1.0, b: 0.2, fadeIn: 0.05, fadeOut: 0.5 });
        }
        // дымовой столб: тёмные плотные клубы, поднимаются и катятся «грибом», сносятся ветром
        const nsmoke = Math.round(34 * q) + 8;
        for (let i = 0; i < nsmoke; i++) {
            const a = Math.random() * 6.28, h = Math.random();
            const d = Math.random() * R * 0.5 * (1 - h * 0.3);
            const dark = 0.15 + Math.random() * 0.08;
            const rad = (0.5 + Math.random() * 3.2) * s * (0.4 + h * 0.8);
            this.puff(x + Math.cos(a) * d, y + 0.3 + h * R * 0.7, z + Math.sin(a) * d, {
                size: (1.5 + Math.random() * 1.5) * s, grow: (1.8 + Math.random() * 1.6) * s, life: 9 + Math.random() * 8, alpha: 0.92, fadeIn: 0.35, fadeOut: 0.4,
                vx: Math.cos(a) * rad, vy: (1.3 + h * 3.4 + Math.random() * 1.4) * s, vz: Math.sin(a) * rad,
                drag: 1.5, buoy: 0.75, buoyDecay: 0.18, turb: 1.4, wind: 1, cool: 1.2,
                r: dark, g: dark * 0.97, b: dark * 0.93, emit: 0.5, delay: Math.random() * 0.15 });
        }
        // пылевая шапка у земли: материал под взрывом
        const nd = Math.round(14 * q) + 4;
        for (let i = 0; i < nd; i++) {
            const a = i / nd * 6.28 + Math.random() * 0.4;
            this.puff(x + Math.cos(a) * 0.4, gy + 0.3, z + Math.sin(a) * 0.4, { size: (0.9 + Math.random() * 0.6) * s, grow: (2.2 + Math.random()) * s, life: 3 + Math.random() * 3, alpha: 0.6, fadeIn: 0.1, fadeOut: 0.3,
                vx: Math.cos(a) * (6 + Math.random() * 5) * s, vy: 0.5 + Math.random() * 1.2, vz: Math.sin(a) * (6 + Math.random() * 5) * s, drag: 3, buoy: 0.35, buoyDecay: 0.3, turb: 0.6, wind: 0.8,
                r: gr, g: gg, b: gb });
        }
        VoxRender.flash(x, y + 0.6, z, [1.0, 0.62, 0.28], 26 * s, 18 * s + 6, 0.5 + 0.15 * s, 0.25);
    },

    /**
     * Ядерный взрыв (R — радиус огненного шара, м): ослепительная вспышка (свет на всю карту и белый экран),
     * ядро взрыва, кольцо конденсации, волна пыли по земле; дальше эмиттер (~11 с, _updateNukes) поднимает
     * огненный шар «грибом»: клубящаяся шапка, ножка из пыли и дыма, дождь угольков, свет пламени.
     * Число частиц — по качеству графики.
     */
    nuke(x, y, z, R) {
        const q = this._q();
        const gy = this._groundY(x, y, z);
        const gc = this._groundRgb(x, y, z);
        const gr = gc[0], gg = gc[1], gb = gc[2];
        this._boost = 30;
        this.explosion(x, y, z, 3.5);
        // вспышка: белое ядро, оранжевый ореол, свет и экран
        VoxRender.flash(x, y + 5, z, [1, 0.93, 0.82], 160, 180, 1.8, 0);
        this.puff(x, y + 2, z, { add: true, mode: 4, size: 22, grow: 40, life: 0.55, alpha: 1, fadeIn: 0.01, fadeOut: 0.05, r: 9, g: 8.4, b: 7.5, drag: 0 });
        this.puff(x, y + 3, z, { add: true, mode: 4, size: 34, grow: 12, life: 1.8, alpha: 0.75, fadeIn: 0.02, fadeOut: 0.1, r: 4.2, g: 2.3, b: 0.8, drag: 0 });
        this._screenFlash(x, y + 3, z);
        // ударная волна по земле: светлый фронт и кольцо пыли на всю карту
        this.puff(x, gy + 0.06, z, { add: true, mode: 2, size: 1, grow: 75, life: 0.9, alpha: 0.9, fadeIn: 0.01, fadeOut: 0.05, r: 2.6, g: 2.2, b: 1.7, drag: 0, spin: 0 });
        this.puff(x, gy + 0.1, z, { mode: 2, size: 1, grow: 52, life: 5, alpha: 0.8, fadeIn: 0.02, fadeOut: 0.25, r: gr, g: gg, b: gb, drag: 0, spin: 0, keep: true });
        // кольцо конденсации над шаром (облако Вильсона): белая расширяющаяся юбка
        this.puff(x, y + R * 0.9, z, { mode: 2, size: 2, grow: 60, life: 1.6, alpha: 0.55, fadeIn: 0.05, fadeOut: 0.2, r: 0.95, g: 0.95, b: 0.97, drag: 0, spin: 0, delay: 0.12 });
        const nw = Math.round(40 * q) + 10;
        for (let i = 0; i < nw; i++) {
            const a = i / nw * 6.28 + Math.random() * 0.2, sp = 24 + Math.random() * 8;
            this.puff(x + Math.cos(a) * R * 0.5, y + R * 0.8 + (Math.random() - 0.5) * 1.5, z + Math.sin(a) * R * 0.5, { size: 2 + Math.random() * 1.5, grow: 3, life: 1.4 + Math.random() * 0.6, alpha: 0.5,
                fadeIn: 0.05, fadeOut: 0.2, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2, vz: Math.sin(a) * sp, drag: 2.2, r: 0.93, g: 0.93, b: 0.95, delay: 0.1 + Math.random() * 0.06 });
        }
        // огненный шар сразу: много крупных клубов огня
        const nf = Math.round(70 * q) + 14;
        for (let i = 0; i < nf; i++) {
            const a = Math.random() * 6.28, e = Math.random() * 2.2 - 0.6, sp = 6 + Math.random() * 16, ce = Math.cos(e);
            this.puff(x, y + 1, z, { add: true, fire: true, size: 2.4 + Math.random() * 2.4, grow: 5 + Math.random() * 4, life: 0.9 + Math.random() * 1.0,
                vx: Math.cos(a) * ce * sp, vy: Math.sin(e) * sp + 4, vz: Math.sin(a) * ce * sp, drag: 3.6, buoy: 5, fadeIn: 0.02, fadeOut: 0.25 });
        }
        // искры и раскалённые осколки во все стороны
        const ns = Math.round(160 * q) + 20;
        for (let i = 0; i < ns; i++) {
            const a = Math.random() * 6.28, e = Math.random() * 1.6 - 0.1, sp = 18 + Math.random() * 40, ce = Math.cos(e);
            this.puff(x, y + 1, z, { add: true, mode: 1, size: 0.05, stretch: 0.5 + Math.random(), life: 0.8 + Math.random() * 2.2,
                vx: Math.cos(a) * ce * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * ce * sp, drag: 0.6, gravity: 9.8, bounce: true, r: 7, g: 3.2, b: 0.9, fadeIn: 0.01, fadeOut: 0.5 });
        }
        // волна пыли по земле: плотная стена катится наружу
        const nd = Math.round(70 * q) + 16;
        for (let i = 0; i < nd; i++) {
            const a = i / nd * 6.28 + Math.random() * 0.15, sp = 16 + Math.random() * 14;
            this.puff(x + Math.cos(a) * 2, gy + 0.4 + Math.random() * 0.8, z + Math.sin(a) * 2, { size: 2.2 + Math.random() * 1.4, grow: 3 + Math.random() * 2, life: 6 + Math.random() * 4, alpha: 0.75,
                fadeIn: 0.05, fadeOut: 0.3, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 1.6, vz: Math.sin(a) * sp, drag: 0.9, buoy: 0.25, buoyDecay: 0.3, turb: 0.8, wind: 0.6,
                r: gr, g: gg, b: gb, keep: true });
        }
        this._nukes.push({ x, y: gy, z, R, t: 0, q, acc: new Float32Array(5), lit: 0, gr, gg, gb });
    },

    /** Белый экран вспышки: сильнее, когда взрыв в кадре и ближе. */
    _screenFlash(x, y, z) {
        if (typeof document === 'undefined') return;
        const cam = VoxRender.camera;
        let k = 0.45;
        if (cam && cam.getDirection) {
            const f = cam.getDirection(BABYLON.Axis.Z), p = cam.position;
            const dx = x - p.x, dy = y - p.y, dz = z - p.z, d = Math.hypot(dx, dy, dz) || 1;
            k = 0.35 + 0.6 * Math.max(0, (f.x * dx + f.y * dy + f.z * dz) / d) * Math.min(1, 60 / (d + 10));
        }
        let el = document.getElementById('rl-flash');
        if (!el) {
            el = document.createElement('div');
            el.id = 'rl-flash';
            el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;background:radial-gradient(circle,#fffdf6 0%,#fff1d0 60%,#ffd9a0 100%);opacity:0';
            document.body.appendChild(el);
        }
        el.style.transition = 'none';
        el.style.opacity = String(Math.min(0.95, k));
        void el.offsetWidth;
        el.style.transition = 'opacity 1.6s cubic-bezier(.2,.6,.3,1)';
        el.style.opacity = '0';
    },

    /** Гриб ядерного взрыва: огненный шар поднимается и остывает, шапка клубится кольцом, ножка тянется от земли. */
    _updateNukes(dt) {
        for (let i = this._nukes.length - 1; i >= 0; i--) {
            const N = this._nukes[i];
            N.t += dt;
            const t = N.t;
            if (t > 11) { this._nukes.splice(i, 1); continue; }
            const q = N.q, A = N.acc;
            // высота центра шара: быстрый подъём, потом медленнее (≈ 8 м за 1 с, 18 м за 3 с, 25 м к концу)
            const H = 30, tau = 3.0;
            const h = 3 + H * (1 - Math.exp(-t / tau)), vr = H / tau * Math.exp(-t / tau);
            const cx = N.x, cy = N.y + h, cz = N.z;
            const rb = 4 + 7 * Math.min(1, t / 3.5);             // радиус шапки, м
            const heat = Math.max(0, 1 - t / 6);
            // огонь внутри шара
            A[0] += 170 * q * heat * dt;
            while (A[0] >= 1) {
                A[0]--;
                const a = Math.random() * 6.28, rr = rb * (0.25 + Math.random() * 0.65);
                this.puff(cx + Math.cos(a) * rr, cy + (Math.random() - 0.45) * rb * 0.6, cz + Math.sin(a) * rr, { add: true, fire: true, size: 2.4 + Math.random() * 2.6 + rb * 0.15, grow: 2.5,
                    life: 0.7 + Math.random() * 0.8, vx: Math.cos(a) * 1.5, vy: vr + 1, vz: Math.sin(a) * 1.5, drag: 1.5, fadeIn: 0.05, fadeOut: 0.3 });
            }
            // шапка: клубы по кольцу, внутренние уходят вверх, внешний край заворачивается вниз
            if (t < 8.5) {
                A[1] += (55 * q + 10) * dt;
                while (A[1] >= 1) {
                    A[1]--;
                    const a = Math.random() * 6.28, ring = 0.45 + Math.random() * 0.7, rr = rb * ring;
                    const roll = ring > 0.85 ? -1 : 1;
                    const g0 = 0.3 + (1 - heat) * 0.24 + Math.random() * 0.08;
                    this.puff(cx + Math.cos(a) * rr, cy + (Math.random() - 0.35) * rb * 0.55, cz + Math.sin(a) * rr, { size: 3.2 + Math.random() * 2.3 + rb * 0.15, grow: 1.4,
                        life: 14 + Math.random() * 7, alpha: 0.92, fadeIn: 0.25, fadeOut: 0.55,
                        vx: Math.cos(a) * (1 + Math.random() * 1.8), vy: vr * 0.9 + roll * (0.6 + Math.random()), vz: Math.sin(a) * (1 + Math.random() * 1.8),
                        drag: 0.7, turb: 0.7, wind: 0.35, cool: 0.4, r: g0 * 1.12, g: g0, b: g0 * 0.9, emit: Math.min(1, heat * 1.4), keep: true });
                }
            }
            // ножка: пыль и дым от земли к шапке
            if (t > 0.4 && t < 8) {
                A[2] += (28 * q + 6) * dt;
                while (A[2] >= 1) {
                    A[2]--;
                    const top = Math.max(1, h - rb * 0.5), hh = Math.random() * top;
                    const a = Math.random() * 6.28, rr = (1.2 + Math.random() * 1.4) * (1 + hh / top * 0.3), mix = 0.3 + Math.random() * 0.4;
                    this.puff(cx + Math.cos(a) * rr, N.y + 0.5 + hh, cz + Math.sin(a) * rr, { size: 1.6 + Math.random() * 1.3, grow: 0.8, life: 9 + Math.random() * 5, alpha: 0.85, fadeIn: 0.3, fadeOut: 0.5,
                        vx: -Math.cos(a) * 0.4, vy: vr * (0.4 + hh / top * 0.6) + 0.5, vz: -Math.sin(a) * 0.4, drag: 0.8, turb: 0.6, wind: 0.3,
                        r: N.gr * (1 - mix) + 0.5 * mix, g: N.gg * (1 - mix) + 0.46 * mix, b: N.gb * (1 - mix) + 0.42 * mix, emit: heat * 0.6, keep: true });
                }
            }
            // пыль у основания ножки подсасывается к центру
            if (t > 1 && t < 7) {
                A[3] += (12 * q + 3) * dt;
                while (A[3] >= 1) {
                    A[3]--;
                    const a = Math.random() * 6.28, rr = 5 + Math.random() * 9;
                    this.puff(cx + Math.cos(a) * rr, N.y + 0.4, cz + Math.sin(a) * rr, { size: 1.6 + Math.random(), grow: 1.2, life: 5 + Math.random() * 3, alpha: 0.6, fadeIn: 0.4, fadeOut: 0.4,
                        vx: -Math.cos(a) * 2.2, vy: 0.4, vz: -Math.sin(a) * 2.2, drag: 0.4, buoy: 0.3, turb: 0.5, r: N.gr, g: N.gg, b: N.gb });
                }
            }
            // угольки сыплются из шапки
            if (t > 0.8 && t < 9) {
                A[4] += 45 * q * (0.3 + heat) * dt;
                while (A[4] >= 1) {
                    A[4]--;
                    const a = Math.random() * 6.28, rr = Math.random() * rb;
                    this.puff(cx + Math.cos(a) * rr, cy + (Math.random() - 0.5) * rb * 0.5, cz + Math.sin(a) * rr, { add: true, mode: 5, size: 0.06 + Math.random() * 0.06, life: 3 + Math.random() * 3, alpha: 0.95,
                        vx: Math.cos(a) * (1 + Math.random() * 3), vy: Math.random() * 2, vz: Math.sin(a) * (1 + Math.random() * 3), drag: 0.6, gravity: 2.2, turb: 1.2, wind: 0.6,
                        r: 3.6, g: 1.2, b: 0.25, fadeIn: 0.05, fadeOut: 0.5 });
                }
            }
            // свет огненного шара поднимается вместе с ним и гаснет
            N.lit -= dt;
            if (N.lit <= 0 && heat > 0.05) { N.lit = 0.5; VoxRender.flash(cx, cy, cz, [1, 0.55, 0.22], 50 * heat + 6, 90, 0.75, 0.15); }
        }
    },

    /** Пыль от разрушения: цвет материала, amount 0..1+; стекло — блёстки, крошка мелких кубиков. */
    dust(x, y, z, v, amount, nx = 0, ny = 1, nz = 0) {
        const q = this._q();
        const c = VoxMat.rgb;
        const r = Math.min(1, c[v * 3] * 0.65 + 0.28), g = Math.min(1, c[v * 3 + 1] * 0.65 + 0.26), b = Math.min(1, c[v * 3 + 2] * 0.65 + 0.23);
        const m = VoxMat.of(v);
        const n = Math.max(1, Math.round(Math.min(14, 2 + amount * 6) * q));
        for (let i = 0; i < n; i++) {
            this.puff(x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.2, {
                size: 0.28 + Math.random() * 0.32 + amount * 0.22, grow: 0.7 + amount * 0.7, life: 1.5 + Math.random() * 2.2, alpha: 0.5, fadeIn: 0.05, fadeOut: 0.3,
                vx: nx * 1.6 + (Math.random() - 0.5) * 1.5, vy: ny * 1.6 + (Math.random() - 0.3) * 1.1, vz: nz * 1.6 + (Math.random() - 0.5) * 1.5,
                drag: 2.4, buoy: 0.12, turb: 0.5, wind: 0.7, r, g, b });
        }
        // крошка: мелкие кубики того же материала
        const chips = Math.round(Math.min(10, amount * 9 + 1) * q);
        for (let i = 0; i < chips; i++) {
            const sp = 1.2 + Math.random() * 3.2;
            this.spawnDebris(x, y, z, v, (nx + (Math.random() - 0.5) * 1.4) * sp, (ny + Math.random() * 0.9) * sp + 0.6, (nz + (Math.random() - 0.5) * 1.4) * sp, 0.28 + Math.random() * 0.2);
        }
        if (m.glass) {
            // осколки блестят: белые искры-блёстки
            for (let i = 0; i < Math.round(10 * q); i++) {
                const sp = 1 + Math.random() * 3;
                this.puff(x, y, z, { add: true, mode: 5, size: 0.035 + Math.random() * 0.03, life: 0.5 + Math.random() * 0.9, alpha: 1,
                    vx: (nx + (Math.random() - 0.5) * 1.6) * sp, vy: (ny + Math.random()) * sp, vz: (nz + (Math.random() - 0.5) * 1.6) * sp,
                    drag: 1, gravity: 8, r: 3.4, g: 4.2, b: 5, fadeIn: 0.01, fadeOut: 0.6 });
            }
        }
    },

    /** Пыль удара тела о землю (сила 0..1): кольцо по земле и клубы материала. */
    impactDust(x, y, z, v, strength) {
        if (strength < 0.15) return;
        const q = this._q();
        const c = VoxMat.rgb;
        const r = Math.min(1, c[v * 3] * 0.55 + 0.33), g = Math.min(1, c[v * 3 + 1] * 0.55 + 0.31), b = Math.min(1, c[v * 3 + 2] * 0.55 + 0.28);
        const n = Math.max(1, Math.round(Math.min(10, 1 + strength * 8) * q));
        for (let i = 0; i < n; i++) {
            const a = Math.random() * 6.28;
            this.puff(x, y + 0.05, z, { size: 0.32 + strength * 0.55, grow: 0.9 + strength, life: 1.5 + Math.random() * 2.2, alpha: 0.45 * Math.min(1, strength + 0.3), fadeIn: 0.06, fadeOut: 0.3,
                vx: Math.cos(a) * (1 + strength * 3.2), vy: 0.3 + Math.random() * 0.6, vz: Math.sin(a) * (1 + strength * 3.2), drag: 3, buoy: 0.1, turb: 0.5, wind: 0.7, r, g, b });
        }
        if (strength > 0.35) this.puff(x, y + 0.03, z, { mode: 2, size: 0.3, grow: (2 + strength * 4), life: 0.9, alpha: 0.5, fadeIn: 0.02, fadeOut: 0.1, r, g, b, drag: 1, spin: 0 });
    },

    /** Искры (металл, рикошет). */
    sparks(x, y, z, nx, ny, nz, n = 10, hot = 1) {
        const q = this._q();
        n = Math.max(1, Math.round(n * (0.5 + 0.5 * q)));
        for (let i = 0; i < n; i++) {
            const sp = 3 + Math.random() * 8;
            this.puff(x, y, z, { add: true, mode: 1, size: 0.02, stretch: 0.14 + Math.random() * 0.22, life: 0.25 + Math.random() * 0.55,
                vx: (nx + (Math.random() - 0.5) * 1.4) * sp, vy: (ny + (Math.random() - 0.3) * 1.4) * sp, vz: (nz + (Math.random() - 0.5) * 1.4) * sp,
                drag: 1, gravity: 9.8, r: 6 * hot, g: 3 * hot, b: 1.0 * hot, fadeIn: 0.01, fadeOut: 0.5, bounce: true });
        }
        if (n > 3) this.puff(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, { add: true, mode: 4, size: 0.14, life: 0.06, alpha: 0.9, fadeIn: 0.005, fadeOut: 0.1, r: 4 * hot, g: 2.4 * hot, b: 1 * hot, drag: 0 });
    },

    /** Вспышка выстрела у ствола: ядро, лучи, струя вперёд, клочок дыма и свет. */
    muzzle(x, y, z, dx, dy, dz, big = 1) {
        this.puff(x, y, z, { add: true, mode: 4, size: 0.42 * big, life: 0.06, alpha: 1, fadeIn: 0.004, fadeOut: 0.1, r: 8, g: 5, b: 2.4, drag: 0 });
        this.puff(x + dx * 0.15, y + dy * 0.15, z + dz * 0.15, { add: true, mode: 1, size: 0.14 * big, stretch: 0.6 * big, life: 0.05, vx: dx, vy: dy, vz: dz, r: 7, g: 4.2, b: 1.8, drag: 0, fadeIn: 0.004 });
        this.puff(x, y, z, { size: 0.18, grow: 1.0, life: 1.3, alpha: 0.28, vx: dx * 1.6, vy: dy * 1.6 + 0.3, vz: dz * 1.6, drag: 3, buoy: 0.3, turb: 0.4, wind: 0.5, r: 0.72, g: 0.72, b: 0.72 });
        VoxRender.flash(x, y, z, [1, 0.75, 0.45], 4 * big, 7, 0.07);
    },

    /** Трассер от a до b. */
    tracer(ax, ay, az, bx, by, bz) {
        const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
        if (L < 0.5) return;
        const mx = ax + dx * 0.55, my = ay + dy * 0.55, mz = az + dz * 0.55;
        this.puff(mx, my, mz, { add: true, mode: 1, size: 0.014, stretch: Math.min(L * 0.45, 6), life: 0.05, vx: dx / L * 0.001, vy: dy / L * 0.001, vz: dz / L * 0.001, r: 5, g: 4, b: 2.4, drag: 0, fadeIn: 0.004 });
    },

    /** Языки пламени над горящим вокселем (интенсивность 0..1); вызывается раз в кадр на воксель. */
    fire(x, y, z, k) {
        const q = this._q(), dt = Math.max(this._dt, 0.004);
        // частота рождения — в секунду, умноженная на dt кадра
        if (Math.random() < 14 * dt * q * (0.5 + k * 0.5)) this.puff(x + (Math.random() - 0.5) * 0.14, y, z + (Math.random() - 0.5) * 0.14, { add: true, mode: 3,
            size: 0.2 + Math.random() * 0.22 * k, life: 0.55 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 0.3,
            drag: 1.4, buoy: 1.1, alpha: 0.9, fadeIn: 0.06, fadeOut: 0.35, heat: 0.85 + Math.random() * 0.3, turb: 0.6 });
        if (Math.random() < 3 * dt * q) this.puff(x, y + 0.08, z, { add: true, mode: 4, size: 0.55 + k * 0.3, life: 0.4, alpha: 0.22, fadeIn: 0.1, fadeOut: 0.5, r: 1.3, g: 0.5, b: 0.1, drag: 0 });
        if (Math.random() < 2.4 * dt * q * k) this.puff(x, y + 0.35, z, { size: 0.3 + Math.random() * 0.12, grow: 0.8, life: 4.5 + Math.random() * 3.5, alpha: 0.5, fadeIn: 0.35, fadeOut: 0.4,
            vx: (Math.random() - 0.5) * 0.4, vy: 0.9, vz: (Math.random() - 0.5) * 0.4, drag: 0.8, buoy: 0.5, buoyDecay: 0.15, turb: 0.7, wind: 1, cool: 1,
            r: 0.22, g: 0.21, b: 0.20, emit: 0.55 });
        if (Math.random() < 1.6 * dt * q) this.puff(x, y + 0.1, z, { add: true, mode: 5, size: 0.04, life: 1.4 + Math.random() * 1.8, alpha: 0.9,
            vx: (Math.random() - 0.5) * 0.9, vy: 1.4 + Math.random() * 2, vz: (Math.random() - 0.5) * 0.9, drag: 0.6, buoy: 0.8, turb: 1.5, wind: 0.5, r: 3.2, g: 1.0, b: 0.2, fadeOut: 0.5 });
    },

    /** Дымный след ракеты. */
    trail(x, y, z) {
        this.puff(x, y, z, { size: 0.24, grow: 0.95, life: 2.8 + Math.random(), alpha: 0.55, fadeIn: 0.04, fadeOut: 0.35, vx: (Math.random() - 0.5) * 0.3, vy: 0.25, vz: (Math.random() - 0.5) * 0.3,
            drag: 1.5, buoy: 0.2, turb: 0.5, wind: 0.8, cool: 0.8, r: 0.74, g: 0.73, b: 0.72, emit: 0.2 });
        this.puff(x, y, z, { add: true, mode: 4, size: 0.34, life: 0.1, alpha: 0.9, fadeIn: 0.01, fadeOut: 0.2, r: 4, g: 2, b: 0.6, drag: 0 });
        if (Math.random() < 0.5) this.puff(x, y, z, { add: true, mode: 5, size: 0.04, life: 0.6 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, drag: 2, r: 3.4, g: 1.2, b: 0.3, fadeOut: 0.6 });
    },

    // =================================================================== снегопад

    /** @type {{ mesh: BABYLON.Mesh, mat: BABYLON.ShaderMaterial, n: number, pos: Float32Array, sp: Float32Array, ph: Float32Array, sz: Float32Array, cov: Uint8Array, buf: Float32Array, t: number, chk: number } | null} */
    _snow: null,

    /**
     * Снегопад вокруг камеры (on = false — выключить): снежинки в коробке 34 × 16 × 34 м следуют за игроком,
     * падают с покачиванием и ветром; под крышей и внутри построек их не видно (проверка вверх по вокселям,
     * понемногу каждый кадр). Число — по качеству графики.
     */
    snowfall(on) {
        if (!on) { if (this._snow) { this._snow.mesh.dispose(); this._snow = null; } return; }
        if (this._snow || !this.scene) return;
        const scene = this.scene;
        if (!BABYLON.Effect.ShadersStore['rlSnowVertexShader']) {
            BABYLON.Effect.ShadersStore['rlSnowVertexShader'] = 'precision highp float;\n' +
                'attribute vec3 position; attribute vec2 uv;\n' +
                '#ifdef INSTANCES\nattribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;\n#endif\n' +
                'uniform mat4 viewProjection; uniform mat4 view; uniform vec3 camPos; uniform float fogDensity;\n' +
                'varying vec2 vUV; varying float vA; varying float vFog;\n' +
                'void main(){\n' +
                '#ifdef INSTANCES\n  vec4 w0 = world0, w1 = world1;\n#else\n  vec4 w0 = vec4(0.0), w1 = vec4(0.0);\n#endif\n' +
                '  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);\n' +
                '  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);\n' +
                '  vec3 wp = w0.xyz + (right * position.x + up * position.y) * w0.w;\n' +
                '  vUV = uv; vA = w1.x;\n' +
                '  float d = length(camPos - wp);\n' +
                '  vFog = clamp(exp(-pow(d * fogDensity, 2.0)), 0.0, 1.0);\n' +
                '  gl_Position = viewProjection * vec4(wp, 1.0);\n}';
            BABYLON.Effect.ShadersStore['rlSnowFragmentShader'] = 'precision highp float;\n' +
                'varying vec2 vUV; varying float vA; varying float vFog; uniform vec3 fogColor;\n' +
                'void main(){\n' +
                '  vec2 q = vUV * 2.0 - 1.0;\n' +
                '  float m = smoothstep(1.0, 0.1, dot(q, q)) * vA;\n' +
                '  if (m < 0.01) discard;\n' +
                '  vec3 c = mix(fogColor, vec3(0.97, 0.98, 1.0), vFog);\n' +
                '  gl_FragColor = vec4(c * m, m);\n}';
        }
        const n = this._low() ? 500 : Math.round(2600 * Math.max(0.3, this._q()));
        const mesh = BABYLON.MeshBuilder.CreatePlane('snow', { size: 1 }, scene);
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        const mat = new BABYLON.ShaderMaterial('snowMat', scene, { vertex: 'rlSnow', fragment: 'rlSnow' }, {
            attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3'],
            uniforms: ['viewProjection', 'view', 'camPos', 'fogDensity', 'fogColor'], needAlphaBlending: true,
        });
        mat.backFaceCulling = false;
        mat.disableDepthWrite = true;
        mat.alphaMode = BABYLON.Constants.ALPHA_PREMULTIPLIED_PORTERDUFF;
        mesh.material = mat;
        mesh.renderingGroupId = 1;
        const buf = new Float32Array(n * 16);
        mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
        const cam = VoxRender.camera.position;
        const S = this._snow = { mesh, mat, n, pos: new Float32Array(n * 3), sp: new Float32Array(n), ph: new Float32Array(n), sz: new Float32Array(n), cov: new Uint8Array(n), buf, t: 0, chk: 0 };
        for (let i = 0; i < n; i++) {
            S.pos[i * 3] = cam.x + (Math.random() - 0.5) * 34; S.pos[i * 3 + 1] = cam.y - 5 + Math.random() * 16; S.pos[i * 3 + 2] = cam.z + (Math.random() - 0.5) * 34;
            S.sp[i] = 0.7 + Math.random() * 0.8; S.ph[i] = Math.random() * 6.28; S.sz[i] = 0.022 + Math.random() * 0.028;
            S.cov[i] = 2;                                         // 2 — ещё не проверена
        }
    },

    windX: 0, windZ: 0,
    setWind(x, z) { this.windX = x; this.windZ = z; },

    /**
     * Дождь: косые штрихи вокруг камеры, amount 0..1 (0 — выключить). Под крышей их не видно (как у снега), в кадре
     * изредка всплески у земли; ветер (setWind) наклоняет струи.
     */
    rainfall(amount) {
        if (!amount) { if (this._rain) { this._rain.mesh.dispose(); this._rain = null; } return; }
        if (this._rain || !this.scene) { if (this._rain) this._rain.amt = amount; return; }
        const scene = this.scene;
        if (!BABYLON.Effect.ShadersStore['rlRainVertexShader']) {
            BABYLON.Effect.ShadersStore['rlRainVertexShader'] = 'precision highp float;\n' +
                'attribute vec3 position;\n' +
                '#ifdef INSTANCES\nattribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;\n#endif\n' +
                'uniform mat4 viewProjection; uniform vec3 camPos;\n' +
                'varying float vA; varying float vY;\n' +
                'void main(){\n' +
                '#ifdef INSTANCES\n  vec4 w0 = world0, w1 = world1;\n#else\n  vec4 w0 = vec4(0.0), w1 = vec4(0.0);\n#endif\n' +
                '  vec3 dir = w1.xyz; vec3 toC = normalize(camPos - w0.xyz);\n' +
                '  vec3 right = normalize(cross(dir, toC));\n' +
                '  vec3 wp = w0.xyz + right * position.x * w0.w + dir * position.y;\n' +
                '  vA = w1.w; vY = position.y + 0.5;\n' +
                '  gl_Position = viewProjection * vec4(wp, 1.0);\n}';
            BABYLON.Effect.ShadersStore['rlRainFragmentShader'] = 'precision highp float;\n' +
                'varying float vA; varying float vY; uniform vec3 tint;\n' +
                'void main(){\n' +
                '  float m = vA * smoothstep(0.0, 0.3, vY) * smoothstep(1.0, 0.7, vY);\n' +
                '  if (m < 0.004) discard;\n' +
                '  gl_FragColor = vec4(tint * m, m);\n}';
        }
        const n = this._low() ? 450 : Math.round(1900 * Math.max(0.4, this._q()));
        const mesh = BABYLON.MeshBuilder.CreatePlane('rain', { size: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        const mat = new BABYLON.ShaderMaterial('rainMat', scene, { vertex: 'rlRain', fragment: 'rlRain' }, {
            attributes: ['position', 'world0', 'world1', 'world2', 'world3'], uniforms: ['viewProjection', 'camPos', 'tint'], needAlphaBlending: true,
        });
        mat.backFaceCulling = false;
        mat.disableDepthWrite = true;
        mat.alphaMode = BABYLON.Constants.ALPHA_PREMULTIPLIED_PORTERDUFF;
        mesh.material = mat;
        mesh.renderingGroupId = 1;
        const buf = new Float32Array(n * 16);
        mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
        const cam = VoxRender.camera.position;
        const R = this._rain = { mesh, mat, n, amt: amount, pos: new Float32Array(n * 3), sp: new Float32Array(n), cov: new Uint8Array(n), buf, chk: 0 };
        for (let i = 0; i < n; i++) {
            R.pos[i * 3] = cam.x + (Math.random() - 0.5) * 30; R.pos[i * 3 + 1] = cam.y - 4 + Math.random() * 14; R.pos[i * 3 + 2] = cam.z + (Math.random() - 0.5) * 30;
            R.sp[i] = 13 + Math.random() * 6;
            R.cov[i] = 0;
        }
    },

    _updateRain(dt, cam) {
        const R = this._rain, w = this.world, k = 1 / this.vs, B = 30, H = 14, half = B / 2;
        const wx = this.windX * 1.6 + 0.4, wz = this.windZ * 1.6 + 0.2, pos = R.pos, buf = R.buf;
        for (let c = 0; c < 120; c++) {
            const i = R.chk = (R.chk + 1) % R.n;
            const gx = Math.floor(pos[i * 3] * k), gy = Math.floor(pos[i * 3 + 1] * k), gz = Math.floor(pos[i * 3 + 2] * k);
            let cov = 0;
            for (let y = Math.max(0, gy); y < Math.min(w.sy, gy + 90); y += 2) if (w.get(gx, y, gz)) { cov = 1; break; }
            R.cov[i] = cov;
        }
        const a0 = 0.34 * R.amt;
        for (let i = 0; i < R.n; i++) {
            const o = i * 3, sp = R.sp[i];
            let x = pos[o] + wx * dt, y = pos[o + 1] - sp * dt, z = pos[o + 2] + wz * dt;
            if (x - cam.x > half) x -= B; else if (x - cam.x < -half) x += B;
            if (z - cam.z > half) z -= B; else if (z - cam.z < -half) z += B;
            if (y < cam.y - 4 || y < 0.3) { y += H; } else if (y > cam.y + 10) y -= H;
            pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
            const hd = Math.max(Math.abs(x - cam.x), Math.abs(z - cam.z));
            const a = R.cov[i] ? 0 : a0 * Math.max(0, Math.min(1, (half - hd) / 4));
            const b = i * 16, L = 0.55 * (sp / 16);
            buf[b] = x; buf[b + 1] = y; buf[b + 2] = z; buf[b + 3] = 0.012;
            buf[b + 4] = wx * 0.05 * L; buf[b + 5] = L; buf[b + 6] = wz * 0.05 * L; buf[b + 7] = a;
        }
        R.mesh.thinInstanceCount = R.n;
        R.mesh.thinInstanceBufferUpdated('matrix');
        R.mat.setVector3('camPos', cam);
        const e = VoxRender.env;
        R.mat.setVector3('tint', new BABYLON.Vector3(0.55 + e.ambSky.x * 0.5, 0.6 + e.ambSky.y * 0.5, 0.7 + e.ambSky.z * 0.4));
        // всплески у земли вокруг игрока
        if (!this._low() && Math.random() < dt * 22 * R.amt) {
            const sx = cam.x + (Math.random() - 0.5) * 14, sz = cam.z + (Math.random() - 0.5) * 14, gy = this._groundY(sx, cam.y + 3, sz);
            if (gy != null && !R.cov[(Math.random() * R.n) | 0]) this.puff(sx, gy + 0.03, sz, { size: 0.05, grow: 2.4, life: 0.16, alpha: 0.42, vy: 0.3, drag: 1, r: 0.8, g: 0.86, b: 0.95 });
        }
    },

    _updateSnow(dt, cam) {
        const S = this._snow, w = this.world, k = 1 / this.vs;
        const B = 34, H = 16, half = B / 2;
        S.t += dt;
        const t = S.t, wx = 0.35 + Math.sin(t * 0.13) * 0.25, wz = 0.12;
        const pos = S.pos, buf = S.buf;
        // укрытие: луч вверх по вокселям у части снежинок за кадр
        for (let c = 0; c < 140; c++) {
            const i = S.chk = (S.chk + 1) % S.n;
            const gx = Math.floor(pos[i * 3] * k), gy = Math.floor(pos[i * 3 + 1] * k), gz = Math.floor(pos[i * 3 + 2] * k);
            let cov = 0;
            for (let y = Math.max(0, gy); y < Math.min(w.sy, gy + 90); y += 2) if (w.get(gx, y, gz)) { cov = 1; break; }
            S.cov[i] = cov;
        }
        for (let i = 0; i < S.n; i++) {
            const o = i * 3;
            let x = pos[o], y = pos[o + 1], z = pos[o + 2];
            const ph = S.ph[i];
            y -= S.sp[i] * dt;
            x += (Math.sin(t * 0.9 + ph) * 0.3 + wx) * dt;
            z += (Math.cos(t * 0.7 + ph * 1.3) * 0.25 + wz) * dt;
            if (x - cam.x > half) x -= B; else if (x - cam.x < -half) x += B;
            if (z - cam.z > half) z -= B; else if (z - cam.z < -half) z += B;
            if (y < cam.y - 5 || y < 0.2) { y += H; S.cov[i] = 2; } else if (y > cam.y + 11) { y -= H; S.cov[i] = 2; }
            pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
            const hd = Math.max(Math.abs(x - cam.x), Math.abs(z - cam.z));
            const edge = Math.min(1, (half - hd) / 4);
            const a = S.cov[i] === 1 ? 0 : 0.85 * Math.max(0, edge);
            const b = i * 16;
            buf[b] = x; buf[b + 1] = y; buf[b + 2] = z; buf[b + 3] = S.sz[i];
            buf[b + 4] = a;
        }
        S.mesh.thinInstanceCount = S.n;
        S.mesh.thinInstanceBufferUpdated('matrix');
        const m = S.mat;
        m.setVector3('camPos', cam);
        m.setFloat('fogDensity', this.scene.fogDensity);
        m.setColor3('fogColor', this.scene.fogColor);
    },

    clear() {
        this.debris = [];
        this._nukes = [];
        if (this.alphaSys) this.alphaSys.list = [];
        if (this.addSys) this.addSys.list = [];
    },

    /** dt — игровое (замедление), realDt — кадра. */
    update(dt, realDt) {
        if (!this.scene) return;
        this._dt = realDt || dt;
        const cam = VoxRender.camera.position;
        if (this._snow) this._updateSnow(dt, cam);
        if (this._rain) this._updateRain(dt, cam);
        const e = VoxRender.env;
        const eng = VoxRender.engine;
        this._invRes.set(1 / Math.max(1, eng.getRenderWidth()), 1 / Math.max(1, eng.getRenderHeight()));
        const depth = VoxRender.softParticles ? VoxRender.depthTex : null;
        for (const sys of [this.alphaSys, this.addSys]) {
            const m = sys.mat;
            m.setVector3('camPos', cam);
            m.setVector3('toSun', e.toSun);
            m.setVector3('skyZen', e.skyZen);
            m.setVector3('skyHor', e.skyHor);
            m.setVector3('skyGnd', e.skyGnd);
            m.setVector3('sunCol', e.sunCol);
            m.setVector3('ambSky', e.ambSky);
            m.setVector3('ambGnd', e.ambGnd);
            m.setVector4('fogP', e.fog);
            m.setFloat('time', e.time);
            m.setVector2('invRes', this._invRes);
            m.setFloat('softOn', depth ? 1 : 0);
            if (this._depthNow !== depth) m.setTexture('depthTex', depth || this._dummyDepth);
            this._updateSys(sys, dt, cam);
        }
        if (this._depthNow !== depth) {
            this._depthNow = depth;
            if (depth && depth.updateSamplingMode) depth.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
        }
        this._updateDebris(dt);
        if (this._boost > 0) this._boost -= dt;
        if (this._nukes.length) this._updateNukes(dt);
    },
};
