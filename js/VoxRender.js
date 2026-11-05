// VoxRender.js — свой Babylon-вид Rubble Lab: движок на #world3d, сцена (правосторонняя, метры),
// камера от первого лица, тёплое низкое солнце с картой теней по кадру у игрока, атмосфера (небо с
// облаками и диском солнца, высотный туман с рассеянием солнца), дальняя земля, постобработка (ACES,
// цветокоррекция кривыми, bloom, SSAO, MSAA/FXAA, зерно), сетки чанков мира и тел, пул точечных огней.
//
// Свет считает плагин VoxMatPlugin сам (линейное HDR-пространство, без зажима суммы света, как у
// StandardMaterial): прямой свет (солнце + огни) с мягкой AO, полусферное окружение с ложным
// отскоком, туман, блики и отражение неба у металла и стекла. Шум цвета по вокселю и мелкая
// зернистость затухают по размеру вокселя на экране (нет муара на траве вдали).
// Режимы плагина: world (чанки, тела, модели в руках), glass, debris (кубики-обломки), land (дальняя земля).
//
// Данные вершины (VoxMesher): col — цвет материала (sRGB), voxData = (шум, блик, свечение,
// класс + AO): целая часть w — класс материала (+32 обгорел), дробная — AO 0..1.

/** Общий GLSL: шум без sin(), небо, туман. Цвета — линейные. */
const RL_GLSL = `
float rlH2(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float rlH3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float rlVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rlH2(i), rlH2(i + vec2(1.0, 0.0)), f.x), mix(rlH2(i + vec2(0.0, 1.0)), rlH2(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 rlSky(vec3 d, vec3 toSun, vec3 zen, vec3 hor, vec3 gnd){
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(hor, zen, t);
  float s = max(dot(d, toSun), 0.0);
  col += vec3(1.0, 0.58, 0.26) * (pow(s, 4.0) * 0.22 + pow(s, 22.0) * 0.5) * (1.0 - t * 0.55);
  float below = 1.0 - smoothstep(-0.10, 0.0, h);
  return mix(col, gnd, below);
}
vec3 rlFogCol(vec3 d, vec3 toSun, vec3 zen, vec3 hor, vec3 gnd){
  vec3 q = normalize(vec3(d.x, 0.03 + max(d.y, 0.0) * 0.30, d.z));
  return rlSky(q, toSun, zen, hor, gnd);
}
float rlFogAmt(vec3 cam, vec3 p, vec4 f){
  vec3 r = p - cam; float t = length(r);
  float a = f.y * r.y;
  float avg = abs(a) > 0.0005 ? (1.0 - exp(-a)) / a : 1.0;
  float od = f.x * exp(-f.y * (cam.y - f.z)) * t * avg;
  return min(1.0 - exp(-od), f.w);
}
`;

class VoxMatPlugin extends BABYLON.MaterialPluginBase {
    /** @param {BABYLON.Material} material @param {'world' | 'glass' | 'debris' | 'land'} mode */
    constructor(material, mode = 'world') {
        super(material, 'VoxMat', 300, { VOXMAT: false, VOXGLASS: false, VOXDEB: false, VOXLAND: false });
        this.mode = mode;
        this._enable(true);
    }
    prepareDefines(defines) {
        defines.VOXMAT = this.mode === 'world' || this.mode === 'glass';
        defines.VOXGLASS = this.mode === 'glass';
        defines.VOXDEB = this.mode === 'debris';
        defines.VOXLAND = this.mode === 'land';
    }
    getClassName() { return 'VoxMatPlugin'; }
    getAttributes(attributes) { if (this.mode === 'world' || this.mode === 'glass') attributes.push('voxData'); }
    getUniforms() {
        const v3 = n => ({ name: n, size: 3, type: 'vec3' });
        return {
            ubo: [
                { name: 'voxInv', size: 1, type: 'float' }, { name: 'voxBevel', size: 1, type: 'float' }, { name: 'rlTime', size: 1, type: 'float' },
                v3('rlToSun'), v3('rlSkyZen'), v3('rlSkyHor'), v3('rlSkyGnd'), v3('rlAmbSky'), v3('rlAmbGnd'),
                { name: 'rlFog', size: 4, type: 'vec4' },
            ],
            fragment: `uniform float voxInv; uniform float voxBevel; uniform float rlTime;
uniform vec3 rlToSun; uniform vec3 rlSkyZen; uniform vec3 rlSkyHor; uniform vec3 rlSkyGnd; uniform vec3 rlAmbSky; uniform vec3 rlAmbGnd; uniform vec4 rlFog;`,
        };
    }
    bindForSubMesh(ubo) {
        const e = VoxRender.env;
        ubo.updateFloat('voxInv', 1 / VoxRender.vs);
        ubo.updateFloat('voxBevel', VoxRender.bevel);
        ubo.updateFloat('rlTime', e.time);
        ubo.updateFloat3('rlToSun', e.toSun.x, e.toSun.y, e.toSun.z);
        ubo.updateFloat3('rlSkyZen', e.skyZen.x, e.skyZen.y, e.skyZen.z);
        ubo.updateFloat3('rlSkyHor', e.skyHor.x, e.skyHor.y, e.skyHor.z);
        ubo.updateFloat3('rlSkyGnd', e.skyGnd.x, e.skyGnd.y, e.skyGnd.z);
        ubo.updateFloat3('rlAmbSky', e.ambSky.x, e.ambSky.y, e.ambSky.z);
        ubo.updateFloat3('rlAmbGnd', e.ambGnd.x, e.ambGnd.y, e.ambGnd.z);
        ubo.updateFloat4('rlFog', e.fog.x, e.fog.y, e.fog.z, e.fog.w);
    }
    getCustomCode(shaderType) {
        if (shaderType === 'vertex') return {
            CUSTOM_VERTEX_DEFINITIONS: `
#ifdef VOXMAT
attribute vec4 voxData; varying vec4 vVoxData;
#endif
varying vec3 vVoxPos; varying vec3 vVoxNrm;`,
            CUSTOM_VERTEX_MAIN_END: `
#ifdef VOXMAT
vVoxData = voxData;
#endif
vVoxPos = position; vVoxNrm = normal;`,
        };
        if (shaderType === 'fragment') return {
            CUSTOM_FRAGMENT_DEFINITIONS: `
varying vec3 vVoxPos; varying vec3 vVoxNrm;
#ifdef VOXMAT
varying vec4 vVoxData;
#endif
float voxHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
${RL_GLSL}`,
            CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
float rlAO = 1.0; float rlCls = 0.0; bool rlChar = false; float rlPx = 100.0; vec3 rlEmis = vec3(0.0); float rlFl = 0.0;
float rlDist = length(vPositionW - vEyePosition.xyz);
baseColor.rgb = pow(max(baseColor.rgb, vec3(0.0)), vec3(2.2));
#ifdef VOXMAT
{
    float cl = floor(vVoxData.w);
    rlAO = clamp(vVoxData.w - cl, 0.0, 1.0);
    rlChar = cl >= 31.5;
    rlCls = rlChar ? cl - 32.0 : cl;
    vec3 vq = vVoxPos * voxInv - vVoxNrm * 0.5;
    rlPx = 1.0 / max(max(fwidth(vq.x), fwidth(vq.y)), max(fwidth(vq.z), 1e-4));
    vec3 vc = floor(vq + 1e-3);
    float vh = voxHash(vc), vh2 = voxHash(vc + vec3(17.31, 3.7, 9.1));
    float amp = vVoxData.x * smoothstep(3.0, 9.0, rlPx);
    float lum = 1.0 + (vh - 0.5) * 2.0 * amp;
    vec3 tint = vec3(1.0 + (vh2 - 0.5) * amp * 0.6, 1.0, 1.0 - (vh2 - 0.5) * amp * 0.6);
    float subK = smoothstep(5.0, 14.0, rlPx);
    float sub = rlH3(floor(vq * 4.0) + 5.5) - 0.5;
    vec2 pg = vVoxPos.xz;
    if (rlCls > 0.5 && rlCls < 1.5) {
        // трава: пятна разного масштаба, сухие жёлтые прогалины, мелкая крапинка
        float n1 = rlVN(pg * 0.35), n2 = rlVN(pg * 0.11 + 11.7), n3 = rlVN(pg * 2.3 + 3.1);
        vec3 dry = mix(vec3(1.05, 1.03, 0.78), vec3(1.18, 1.05, 0.66), n2);
        tint *= vec3(0.93, 0.90, 0.80) * mix(vec3(1.0), dry, 0.55 * smoothstep(0.25, 0.9, n1));
        lum *= 0.94 + 0.12 * n2 + (n3 - 0.5) * 0.14 * smoothstep(3.0, 9.0, rlPx);
        lum *= 1.0 + sub * 0.22 * subK;
    } else if (rlCls > 1.5 && rlCls < 2.5) {
        float n1 = rlVN(pg * 0.9 + vVoxPos.y * 3.0);
        lum *= 0.85 + 0.3 * n1 + sub * 0.14 * subK;
    } else if (rlCls > 2.5 && rlCls < 3.5) {
        float n1 = rlVN(vVoxPos.xy * 3.0 + vVoxPos.z * 2.0);
        lum *= 0.9 + 0.2 * n1 + sub * 0.2 * subK;
    } else if (rlCls > 3.5 && rlCls < 4.5) {
        // дерево: волокна вдоль длинной оси
        vec3 an = abs(vVoxNrm);
        float g = an.y > 0.5 ? rlVN(vec2(vVoxPos.x * 38.0, vVoxPos.z * 3.0)) : rlVN(vec2((vVoxPos.x + vVoxPos.z) * 3.0, vVoxPos.y * 40.0));
        lum *= 0.93 + 0.14 * g * subK + 0.07 * (1.0 - subK);
    } else if (rlCls > 7.5 && rlCls < 8.5) {
        lum *= 1.0 + (rlH3(floor(vq * 2.0) + 3.3) - 0.5) * 0.35;
    } else {
        lum *= 1.0 + sub * 0.07 * subK;
    }
    baseColor.rgb *= tint * lum;
    // шипы как у Roblox: круглые выступы на верхних гранях всего мира — свет сверху-слева, тень снизу-справа
    if (rlCls < 11.5 && vVoxNrm.y > 0.5) {
        vec2 sc = fract(vVoxPos.xz * 2.5) - 0.5;
        float sd = length(sc);
        float sf = smoothstep(1.2, 3.2, rlPx);
        float ring = smoothstep(0.34, 0.30, sd) * smoothstep(0.20, 0.25, sd);
        float sl = dot(sc / max(sd, 1e-3), vec2(-0.707, -0.707));
        baseColor.rgb *= 1.0 + ring * sl * 0.34 * sf;
        baseColor.rgb *= 1.0 + smoothstep(0.26, 0.0, sd) * 0.05 * sf;
    }
    // фаска на гранях вокселя
    vec3 fq = fract(vq + vVoxNrm * 0.5);
    vec3 an2 = abs(vVoxNrm);
    vec2 e2 = an2.x > 0.5 ? fq.yz : (an2.y > 0.5 ? fq.xz : fq.xy);
    vec2 ed = min(e2, 1.0 - e2);
    float bev = voxBevel * smoothstep(3.0, 9.0, rlPx) * ((rlCls > 0.5 && rlCls < 1.5) ? 0.3 : (rlCls > 10.5 && rlCls < 11.5 ? 0.0 : 1.0));
    baseColor.rgb *= mix(1.0 - bev, 1.0, smoothstep(0.0, 0.14, min(ed.x, ed.y)));
    if (rlChar) {
        float soot = rlVN(vVoxPos.xz * 9.0 + vVoxPos.y * 7.0);
        baseColor.rgb *= 0.6 + 0.8 * soot;
        baseColor.rgb += vec3(0.05, 0.046, 0.042) * step(0.80, vh2) * (0.4 + 0.6 * subK);
    }
    rlEmis = baseColor.rgb * vVoxData.z * 4.0;
}
#endif
#ifdef VOXDEB
{
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
    rlFl = vColor.a;
#endif
    vec3 fq = vVoxPos + 0.5; vec3 an2 = abs(vVoxNrm);
    vec2 e2 = an2.x > 0.5 ? fq.yz : (an2.y > 0.5 ? fq.xz : fq.xy);
    vec2 ed = min(e2, 1.0 - e2);
    baseColor.rgb *= mix(0.86, 1.0, smoothstep(0.0, 0.16, min(ed.x, ed.y)));
    rlAO = 0.72 + 0.28 * smoothstep(-0.8, 0.8, vVoxNrm.y);
    rlEmis = rlFl > 1.5 ? vec3(1.0, 0.32, 0.06) * (rlFl - 1.5) * 1.6 : vec3(0.0);
}
#endif
#ifdef VOXLAND
{
    vec2 w = vPositionW.xz;
    float n2 = rlVN(w * 0.12 + 3.3), n3 = rlVN(w * 0.8 + 7.1);
    vec2 fc = floor(w * 0.022);
    float fh = rlH2(fc), fh2 = rlH2(fc + 7.7);
    vec3 field = mix(vec3(0.84, 1.0, 0.70), vec3(1.24, 1.06, 0.60), fh);
    float rows = fh2 > 0.5 ? mix(1.0, 0.92 + 0.08 * sin(dot(w, vec2(0.8, 0.6)) * 5.0), (1.0 - smoothstep(50.0, 260.0, rlDist))) : 1.0;
    baseColor.rgb *= mix(vec3(1.0), field, 0.7) * rows * (0.80 + 0.30 * n2 + 0.12 * n3);
}
#endif
`,
            CUSTOM_FRAGMENT_BEFORE_FOG: `
{
    vec3 rlN = normalW; vec3 rlV = viewDirectionW;
    vec3 rlAmb = mix(rlAmbGnd, rlAmbSky, rlN.y * 0.5 + 0.5);
    float rlAoA = rlAO * rlAO;
    float rlAoD = mix(1.0, rlAO, 0.5);
    vec3 rlLit = baseColor.rgb * (diffuseBase * rlAoD + rlAmb * rlAoA);
    vec3 rlSpec = finalSpecular;
#ifdef VOXMAT
    rlSpec *= vVoxData.y * 1.6;
    float rlMetal = vVoxData.y;
#else
    float rlMetal = 0.0;
#endif
#ifdef VOXDEB
    color.a = 1.0;      // в альфе цвета экземпляра лежит флаг блеска, а не прозрачность
    rlSpec *= clamp(rlFl, 0.0, 1.5) * 1.2;
    rlMetal = rlFl > 0.1 && rlFl < 1.5 ? rlFl * 0.8 : 0.0;
#endif
    vec3 rlRefl = vec3(0.0);
    if (rlMetal > 0.12) {
        vec3 rlR = reflect(-rlV, rlN);
        float rlFr = 0.14 + 0.86 * pow(1.0 - clamp(dot(rlN, rlV), 0.0, 1.0), 4.0);
        rlRefl = rlSky(rlR, rlToSun, rlSkyZen, rlSkyHor, rlSkyGnd) * rlFr * rlMetal * rlAoA * mix(vec3(1.0), baseColor.rgb * 2.2, 0.55);
    }
    color.rgb = rlLit + rlSpec + rlRefl + rlEmis;
#ifdef VOXGLASS
    {
        float rlNd = dot(rlN, rlV);
        float rlFr = 0.06 + 0.94 * pow(1.0 - clamp(abs(rlNd), 0.0, 1.0), 4.0);
        vec3 rlR = reflect(-rlV, rlNd < 0.0 ? -rlN : rlN);
        vec3 rlRc = rlSky(rlR, rlToSun, rlSkyZen, rlSkyHor, rlSkyGnd) * (0.45 + 0.55 * rlAoA);
        float rlA = clamp(0.20 + rlFr * 0.72 + dot(rlSpec, vec3(0.33)), 0.0, 0.94);
        vec3 rlWant = rlLit * 0.75 + rlRc * rlFr * 1.15 + rlSpec;
        color.rgb = rlWant / max(rlA, 0.1);
        color.a = rlA;
    }
#endif
    vec3 rlRay = vPositionW - vEyePosition.xyz;
    float rlF = rlFogAmt(vEyePosition.xyz, vPositionW, rlFog);
    color.rgb = mix(color.rgb, rlFogCol(rlRay / max(rlDist, 1e-3), rlToSun, rlSkyZen, rlSkyHor, rlSkyGnd), rlF);
    color.rgb = pow(max(color.rgb, vec3(0.0)), vec3(1.0 / 2.2));
}
`,
        };
        return null;
    }
}

/**
 * Небо по времени суток (линейные цвета). sun — направление от солнца, sunI — сила, stars — звёзды.
 * Погода (setAtmosphere) поверх них добавляет облачность, туман и темноту.
 */
const VOX_SKIES = {
    day: { sun: [-0.42, -0.82, -0.38], sunC: [1.0, 0.95, 0.86], sunI: 1.12, disc: [2.6, 2.4, 2.05], zen: [0.09, 0.30, 0.82], hor: [0.66, 0.84, 1.0], gnd: [0.40, 0.55, 0.42], ambS: [0.5, 0.58, 0.74], ambG: [0.34, 0.3, 0.26], fog: 0.0016, stars: 0, fill: 0.85 },
    dawn: { sun: [-0.8, -0.3, -0.5], sunC: [1.0, 0.62, 0.44], sunI: 0.62, disc: [3.0, 1.9, 1.2], zen: [0.16, 0.24, 0.58], hor: [1.0, 0.66, 0.5], gnd: [0.42, 0.36, 0.38], ambS: [0.3, 0.25, 0.38], ambG: [0.2, 0.13, 0.13], fog: 0.0028, stars: 0.05, fill: 0.8 },
    sunset: { sun: [0.82, -0.24, 0.42], sunC: [1.0, 0.46, 0.2], sunI: 0.56, disc: [3.2, 1.5, 0.7], zen: [0.2, 0.14, 0.42], hor: [1.0, 0.46, 0.24], gnd: [0.34, 0.24, 0.26], ambS: [0.26, 0.17, 0.28], ambG: [0.18, 0.1, 0.09], fog: 0.003, stars: 0.12, fill: 0.72 },
    night: { sun: [-0.3, -0.76, 0.52], sunC: [0.6, 0.72, 1.0], sunI: 0.1, disc: [1.5, 1.6, 1.8], zen: [0.012, 0.022, 0.08], hor: [0.07, 0.1, 0.2], gnd: [0.03, 0.04, 0.07], ambS: [0.045, 0.065, 0.13], ambG: [0.022, 0.025, 0.045], fog: 0.0022, stars: 1, fill: 0.42 },
};

/** Пресеты уровней качества. */
const VOX_QUALITY = {
    low: { dpr: 1, scale: 1.2, casters: 24, lights: 2, shadow: 1024, refresh: 2, pcss: false, filter: 0, ssao: false, bloom: false, ca: false, grain: false, sharpen: false, fxaa: false, msaa: 1, fx: 0.45, soft: false, rays: false },
    medium: { dpr: 1.25, scale: 1, casters: 38, lights: 3, shadow: 1536, refresh: 1, pcss: false, filter: 1, ssao: false, bloom: true, ca: false, grain: false, sharpen: true, fxaa: true, msaa: 1, fx: 0.7, soft: false, rays: false },
    high: { dpr: 1.5, scale: 1, casters: 80, lights: 4, shadow: 2048, refresh: 1, pcss: true, filter: 2, ssao: true, bloom: true, ca: false, grain: false, sharpen: true, fxaa: false, msaa: 4, fx: 1, soft: true, rays: true },
};

/** @satisfies {Record<string, any>} */
const VoxRender = {
    vs: 0.1,
    bevel: 0.07,
    /** @type {BABYLON.Engine | null} */
    engine: null,
    /** @type {BABYLON.Scene | null} */
    scene: null,
    /** @type {BABYLON.FreeCamera | null} */
    camera: null,
    /** @type {BABYLON.FreeCamera | null} */
    vmCam: null,
    /** @type {BABYLON.ImageProcessingConfiguration | null} */
    vmImage: null,
    /** @type {BABYLON.StandardMaterial | null} */
    vmMat: null,
    /** Слой мешей оружия в руках: их видит только vmCam. */
    VM_LAYER: 0x10000000,
    /** Погодная темнота и молния. */
    _bolt: 0,
    /** @type {any} */
    _atm: null,
    _lamp: false,
    /** @type {BABYLON.DirectionalLight | null} */
    sun: null,
    /** @type {BABYLON.HemisphericLight | null} */
    hemi: null,
    /** @type {BABYLON.ShadowGenerator | null} */
    shadow: null,
    /** @type {BABYLON.DefaultRenderingPipeline | null} */
    pipeline: null,
    /** @type {BABYLON.SSAO2RenderingPipeline | null} */
    ssao: null,
    /** @type {BABYLON.GeometryBufferRenderer | null} */
    gbr: null,
    /** @type {BABYLON.StandardMaterial | null} */
    mat: null,
    /** @type {BABYLON.StandardMaterial | null} */
    glassMat: null,
    /** @type {VoxWorld | null} */
    world: null,
    /** Сетки мира сгруппированы в ячейки CELL×CELL×CELL чанков: один меш на ячейку — в разы меньше вызовов отрисовки. */
    CELL: 2,
    /** @type {Map<number, { o: BABYLON.Mesh | null, g: BABYLON.Mesh | null, parts: Map<number, { opaque: any, glass: any }> }>} */
    chunks: new Map(),
    /** @type {Set<number>} */
    _dirtyCells: new Set(),
    /** @type {BABYLON.PointLight[]} */
    lights: [],
    /** @type {{ t: number, dur: number, peak: number, light: BABYLON.PointLight, flicker: number }[]} */
    _flashes: [],
    _pad: new Uint8Array((VOX_CH + 2) ** 3),
    /** направление света (от солнца вниз) — ставится setSun() */
    sunDir: new BABYLON.Vector3(-0.42, -0.82, -0.38).normalize(),
    quality: 'high',
    /** доля плотности частиц для VoxFX (по уровню качества) */
    fxScale: 1,
    /** мягкие частицы (depth G-буфера) доступны */
    softParticles: false,
    /** @type {BABYLON.BaseTexture | null} */
    depthTex: null,
    FLASH_GAIN: 0.17,
    shadowSize: 80,
    _shadowCenter: new BABYLON.Vector3(),
    /** @type {BABYLON.AbstractMesh[]} */
    _casters: [],
    _castTick: 0,
    _casterR: 80,
    _nLights: 4,
    stats: { chunks: 0, tris: 0, updateMs: 0, renderMs: 0, gpuMs: 0 },
    /** Атмосфера (линейные цвета): читают плагин материалов, небо и шейдер частиц. */
    env: {
        time: 0,
        toSun: new BABYLON.Vector3(0.6, 0.52, 0.6),
        sunCol: new BABYLON.Vector3(2.6, 2.4, 2.05),
        skyZen: new BABYLON.Vector3(0.09, 0.30, 0.82),
        skyHor: new BABYLON.Vector3(0.66, 0.84, 1.0),
        skyGnd: new BABYLON.Vector3(0.40, 0.55, 0.42),
        ambSky: new BABYLON.Vector3(0.5, 0.58, 0.74),
        ambGnd: new BABYLON.Vector3(0.34, 0.3, 0.26),
        // плотность, спад с высотой (1/м), высота земли, предел
        fog: new BABYLON.Vector4(0.0016, 0.034, 2.0, 0.7),
    },
    _sunBasis: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
    _v1: new BABYLON.Vector3(),
    _autoQ: { t: 0, acc: 0, n: 0, on: true, hold: 0 },

    /** @param {HTMLCanvasElement} canvas @param {VoxWorld} world */
    init(canvas, world) {
        this.world = world;
        this.vs = world.vs;
        // сглаживание экрана нужно модели в руках: она рисуется поверх постобработки своей камерой
        const engine = this.engine = new BABYLON.Engine(canvas, typeof IS_MOBILE === 'undefined' || !IS_MOBILE, {
            preserveDrawingBuffer: false, stencil: false, antialias: false, powerPreference: 'high-performance',
            doNotHandleContextLost: false,
        }, false);
        engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
        const scene = this.scene = new BABYLON.Scene(engine);
        scene.useRightHandedSystem = true;
        scene.skipPointerMovePicking = true;
        scene.autoClear = true;
        const hz = this.env.skyHor;
        scene.clearColor = new BABYLON.Color4(hz.x, hz.y, hz.z, 1);
        scene.fogMode = BABYLON.Scene.FOGMODE_NONE;      // туман считают плагин и шейдеры частиц (высотный)
        scene.ambientColor = new BABYLON.Color3(0, 0, 0);

        const cam = this.camera = new BABYLON.FreeCamera('eye', new BABYLON.Vector3(25, 4, 25), scene);
        cam.inputs.clear();
        cam.minZ = 0.04; cam.maxZ = 900;
        cam.fov = 1.15;
        cam.rotationQuaternion = new BABYLON.Quaternion();
        // Камера оружия: своя, поверх кадра и после постобработки. Ни SSAO, ни свечение мира не ложатся на ствол (он не «просвечивает»).
        const vmCam = this.vmCam = new BABYLON.FreeCamera('eyeVm', new BABYLON.Vector3(25, 4, 25), scene);
        vmCam.inputs.clear();
        vmCam.minZ = 0.04; vmCam.maxZ = 60;
        vmCam.fov = 1.12;
        vmCam.rotationQuaternion = new BABYLON.Quaternion();
        vmCam.layerMask = this.VM_LAYER;
        scene.activeCameras = [cam, vmCam];
        scene.cameraToUseForPointers = cam;

        // Свет: небо первым, солнце последним (порядок важен для maxSimultaneousLights = 6).
        // Полусфера слабая: основное окружение плагин считает сам (с AO); её хватает чужим материалам.
        const hemi = this.hemi = new BABYLON.HemisphericLight('sky', new BABYLON.Vector3(0.2, 1, 0.1), scene);
        hemi.diffuse = new BABYLON.Color3(0.36, 0.48, 0.72);
        hemi.groundColor = new BABYLON.Color3(0.22, 0.17, 0.11);
        hemi.specular = new BABYLON.Color3(0, 0, 0);
        hemi.intensity = 0.16;
        for (let i = 0; i < 4; i++) {
            const l = new BABYLON.PointLight('fx' + i, new BABYLON.Vector3(0, -100, 0), scene);
            l.intensity = 0; l.range = 20; l.diffuse = new BABYLON.Color3(1, 0.6, 0.25); l.specular = new BABYLON.Color3(0.4, 0.3, 0.2);
            this.lights.push(l);
        }
        const sun = this.sun = new BABYLON.DirectionalLight('sun', this.sunDir.clone(), scene);
        sun.diffuse = new BABYLON.Color3(1.0, 0.95, 0.86);
        sun.specular = new BABYLON.Color3(1.0, 0.95, 0.85);
        sun.intensity = 1.12;
        sun.autoUpdateExtends = false;
        sun.autoCalcShadowZBounds = false;
        sun.shadowMinZ = 0; sun.shadowMaxZ = 200;
        this.setSun(this.sunDir.x, this.sunDir.y, this.sunDir.z);

        const mat = this.mat = new BABYLON.StandardMaterial('vox', scene);
        mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        mat.specularColor = new BABYLON.Color3(0.45, 0.45, 0.45);
        mat.specularPower = 42;
        mat.maxSimultaneousLights = 6;
        mat.backFaceCulling = true;
        new VoxMatPlugin(mat, 'world');
        // Модели в руках рисует камера без постобработки: у их материалов своя обработка цвета, иначе они темнеют
        const vmI = this.vmImage = new BABYLON.ImageProcessingConfiguration();
        vmI.applyByPostProcess = false;
        vmI.isEnabled = false;
        const vmMat = this.vmMat = new BABYLON.StandardMaterial('voxVm', scene);
        vmMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        vmMat.specularColor = new BABYLON.Color3(0.45, 0.45, 0.45);
        vmMat.specularPower = 42;
        vmMat.maxSimultaneousLights = 6;
        vmMat.imageProcessingConfiguration = vmI;
        new VoxMatPlugin(vmMat, 'world');
        const gm = this.glassMat = new BABYLON.StandardMaterial('glass', scene);
        gm.diffuseColor = new BABYLON.Color3(1, 1, 1);
        gm.specularColor = new BABYLON.Color3(0.9, 0.9, 0.9);
        gm.specularPower = 120;
        gm.alpha = 0.32;
        gm.maxSimultaneousLights = 6;
        gm.backFaceCulling = false;
        gm.separateCullingPass = true;
        new VoxMatPlugin(gm, 'glass');

        this._makeSky();
        this._makeFarLand();
        this._makePipeline();
        this.setQuality(this.quality);
        window.addEventListener('resize', () => engine.resize());
        return this;
    },

    /** Время суток и погода: свет, небо, туман, облачность. sky — ключ VOX_SKIES, weather — clear | rain | snow | storm. */
    setAtmosphere(sky, weather) {
        const S = VOX_SKIES[sky] || VOX_SKIES.day, e = this.env;
        // погода: k — насколько затянуто небо (0 ясно, 1 буря), серый цвет с оттенком времени суток
        const k = weather === 'storm' ? 1 : (weather === 'rain' ? 0.72 : (weather === 'snow' ? 0.5 : 0));
        const dark = weather === 'storm' ? 0.2 : (weather === 'rain' ? 0.38 : (weather === 'snow' ? 0.7 : 1));
        const gray = (c, g) => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return c.map(v => (v + (l - v) * k * 0.85) * (1 - k * (1 - g))); };
        const z = gray(S.zen, 0.6), h = gray(S.hor, 0.58), g0 = gray(S.gnd, 0.7), aS = gray(S.ambS, 0.52), aG = gray(S.ambG, 0.55);
        e.skyZen.set(z[0], z[1], z[2]); e.skyHor.set(h[0], h[1], h[2]); e.skyGnd.set(g0[0], g0[1], g0[2]);
        e.ambSky.set(aS[0], aS[1], aS[2]); e.ambGnd.set(aG[0], aG[1], aG[2]);
        e.sunCol.set(S.disc[0] * dark, S.disc[1] * dark, S.disc[2] * dark);
        e.fog.x = S.fog + k * 0.0075;
        this.sun.diffuse.set(S.sunC[0], S.sunC[1], S.sunC[2]);
        this.sun.specular.set(S.sunC[0], S.sunC[1], S.sunC[2]);
        this.sun.intensity = S.sunI * dark;
        this.setSun(S.sun[0], S.sun[1], S.sun[2]);
        this._atm = { sun: this.sun.intensity, amb: [aS[0], aS[1], aS[2]] };
        this.scene.clearColor.set(h[0], h[1], h[2], 1);
        if (this._skyMat) {
            const m = this._skyMat;
            m.setVector3('zenith', e.skyZen); m.setVector3('horizon', e.skyHor); m.setVector3('groundCol', e.skyGnd); m.setVector3('sunCol', e.sunCol); m.setVector3('toSun', e.toSun);
            m.setFloat('stars', S.stars * (1 - k));
            m.setFloat('cover', k);
        }
        if (typeof GameWeapons !== 'undefined' && GameWeapons.fill) GameWeapons.fill.intensity = S.fill;
    },

    /** Фонарь у глаз игрока ночью и в бурю: один из огней-вспышек занят им. */
    setHeadlamp(on) {
        this._lamp = !!on;
        const L = this.lights[0];
        if (!L) return;
        L.intensity = on ? 0.62 : 0;
        if (on) { L.diffuse.set(1, 0.95, 0.82); L.specular.set(0.2, 0.2, 0.16); L.range = 11; }
    },

    /** Молния: всё небо и земля на миг вспыхивают. */
    lightning() { this._bolt = 1; },
    _updateBolt(dt) {
        if (this._lamp && this.lights[0] && this.camera) this.lights[0].position.copyFrom(this.camera.position);
        if (this._bolt <= 0 || !this._atm) return;
        this._bolt = Math.max(0, this._bolt - dt * 4.5);
        const f = this._bolt * (0.6 + 0.4 * Math.sin(this._bolt * 40));
        this.sun.intensity = this._atm.sun + f * 1.6;
        const a = this._atm.amb;
        this.env.ambSky.set(a[0] + f * 0.75, a[1] + f * 0.8, a[2] + f * 0.95);
        if (this._skyMat) this._skyMat.setFloat('flash', f);
    },

    /** Направление света (от солнца): пересчёт базиса теней, неба и цветов. */
    setSun(x, y, z) {
        const l = Math.hypot(x, y, z) || 1;
        this.sunDir.set(x / l, y / l, z / l);
        const d = this.sunDir;
        this.env.toSun.set(-d.x, -d.y, -d.z);
        if (this.sun) this.sun.direction.copyFrom(d);
        // базис кадра теней: right = d × Y, up = right × d
        let rx = d.y * 0 - d.z * 1, ry = d.z * 0 - d.x * 0, rz = d.x * 1 - d.y * 0;
        const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
        const ux = ry * d.z - rz * d.y, uy = rz * d.x - rx * d.z, uz = rx * d.y - ry * d.x;
        const ul = Math.hypot(ux, uy, uz) || 1;
        const b = this._sunBasis;
        b.rx = rx; b.ry = ry; b.rz = rz; b.ux = ux / ul; b.uy = uy / ul; b.uz = uz / ul;
        if (this._skyMat) this._skyMat.setVector3('toSun', this.env.toSun);
    },

    _makeShadows(size, q) {
        if (this.shadow) { this.shadow.dispose(); this.shadow = null; }
        if (!size) return;
        const sg = this.shadow = new BABYLON.ShadowGenerator(size, this.sun);
        if (q && q.pcss) {
            sg.useContactHardeningShadow = true;
            sg.contactHardeningLightSizeUVRatio = 0.045;
        } else {
            sg.usePercentageCloserFiltering = true;
        }
        sg.filteringQuality = q && q.filter === 2 ? BABYLON.ShadowGenerator.QUALITY_HIGH : (q && q.filter === 1 ? BABYLON.ShadowGenerator.QUALITY_MEDIUM : BABYLON.ShadowGenerator.QUALITY_LOW);
        // только задние грани в карту теней: воксельные тела замкнуты, и угла наклона солнца хватает без «акне»
        sg.forceBackFacesOnly = true;
        sg.bias = 0.0003;
        sg.normalBias = 0.01;
        sg.darkness = 0;
        sg.transparencyShadow = false;
        sg.getShadowMap().refreshRate = q && q.refresh ? q.refresh : 1;
        this._casters = [];
    },

    _makeSky() {
        const scene = this.scene;
        BABYLON.Effect.ShadersStore['rlSkyVertexShader'] = `precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vDir;
void main(){ vDir = position; vec4 p = worldViewProjection * vec4(position, 1.0); gl_Position = p.xyww; }`;
        BABYLON.Effect.ShadersStore['rlSkyFragmentShader'] = `precision highp float;
varying vec3 vDir; uniform vec3 toSun; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 groundCol; uniform vec3 sunCol; uniform float time; uniform float stars; uniform float cover; uniform float flash;
${RL_GLSL}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * rlVN(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = rlSky(d, toSun, zenith, horizon, groundCol);
  float s = max(dot(d, toSun), 0.0);
  col += sunCol * (smoothstep(0.99968, 0.99985, s) * 9.0 + pow(s, 500.0) * 1.4 + pow(s, 70.0) * 0.28);
  if (stars > 0.001 && h > 0.0) {
    vec3 sq = floor(d * 210.0);
    float st = rlH3(sq);
    float tw = 0.65 + 0.35 * sin(time * 2.0 + st * 40.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9965, st) * (st - 0.9965) * 285.0 * tw * stars * smoothstep(0.02, 0.2, h);
  }
  if (h > 0.005) {
    float hh = h + 0.08;
    vec2 uv = d.xz / hh * 1.25 + vec2(time * (0.0045 + cover * 0.03), time * (0.0017 + cover * 0.012));
    float f = fbm(uv);
    float c = smoothstep(0.50 - cover * 0.34, 0.80 - cover * 0.26, f);
    vec2 sd = toSun.xz / max(length(toSun.xz), 0.2) * 0.07;
    float f2 = fbm(uv + sd);
    float lit = clamp(0.62 + (f - f2) * 4.2, 0.0, 1.2);
    float edge = clamp(c * (1.0 - c) * 4.0, 0.0, 1.0);
    vec3 shade = mix(zenith * 1.6 + vec3(0.14, 0.16, 0.22), vec3(0.62, 0.66, 0.76), 0.5);
    vec3 bright = sunCol * 0.36 + vec3(0.55, 0.52, 0.48);
    vec3 cc = mix(shade, bright, clamp(lit, 0.0, 1.0));
    cc = mix(cc, vec3(dot(cc, vec3(0.33))) * (0.72 + 0.28 * lit), cover) * (1.0 - cover * 0.5);
    cc *= 1.0 - stars * 0.86;
    cc += sunCol * 0.14 * pow(s, 6.0) * edge * 2.0;
    float fade = smoothstep(0.0, 0.26, h);
    col = mix(col, mix(horizon, cc, fade), c * 0.9 * fade);
    // тонкие перистые полосы
    float ci = rlVN(vec2(d.x * 7.0 + d.z * 3.0 + time * 0.003, d.z * 26.0 / hh)) * rlVN(d.xz * 5.0 + 4.0);
    col += (bright * 0.5) * smoothstep(0.38, 0.8, ci) * 0.16 * fade * (1.0 - c);
  }
  col += vec3(0.75, 0.8, 1.0) * flash * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;
        const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 1600, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
        const sm = new BABYLON.ShaderMaterial('skyMat', scene, { vertex: 'rlSky', fragment: 'rlSky' }, {
            attributes: ['position'], uniforms: ['worldViewProjection', 'toSun', 'zenith', 'horizon', 'groundCol', 'sunCol', 'time', 'stars', 'cover', 'flash'],
        });
        sm.backFaceCulling = false;
        sm.disableDepthWrite = true;
        const e = this.env;
        sm.setVector3('toSun', e.toSun);
        sm.setVector3('zenith', e.skyZen);
        sm.setVector3('horizon', e.skyHor);
        sm.setVector3('groundCol', e.skyGnd);
        sm.setVector3('sunCol', e.sunCol);
        sm.setFloat('time', 0);
        sm.setFloat('stars', 0); sm.setFloat('cover', 0); sm.setFloat('flash', 0);
        sky.material = sm;
        sky.infiniteDistance = true;
        sky.applyFog = false;
        sky.isPickable = false;
        sky.renderingGroupId = 0;
        this._sky = sky; this._skyMat = sm;
    },

    // Земля за краем карты (рамка вокруг квадрата мира) и кольцо дальних холмов.
    /** Средний цвет верхнего твёрдого вокселя вдоль границы карты (каждый 4-й столбец); пусто — трава. */
    _borderColor() {
        const w = this.world, rgb = VoxMat.rgb;
        let r = 0, g = 0, b = 0, n = 0;
        const col = (x, z) => {
            for (let y = w.sy - 1; y > 0; y--) {
                const v = w.get(x, y, z);
                if (!v) continue;
                r += rgb[v * 3]; g += rgb[v * 3 + 1]; b += rgb[v * 3 + 2]; n++;
                return;
            }
        };
        for (let i = 0; i < w.sx; i += 4) { col(i, 1); col(i, w.sz - 2); }
        for (let i = 0; i < w.sz; i += 4) { col(1, i); col(w.sx - 2, i); }
        return n ? [r / n, g / n, b / n] : [0.33, 0.50, 0.21];
    },

    _makeFarLand() {
        const scene = this.scene, w = this.world;
        const W = w.sx * this.vs, D = w.sz * this.vs;
        const top = (w.groundTop || 20) * this.vs;
        const far = 700;
        const m = new BABYLON.StandardMaterial('farGround', scene);
        m.diffuseColor = new BABYLON.Color3(1, 1, 1);
        m.specularColor = new BABYLON.Color3(0, 0, 0);
        m.maxSimultaneousLights = 6;
        m.backFaceCulling = false;
        new VoxMatPlugin(m, 'land');
        const pos = [], col = [], idx = [];
        // цвет земли за краем — средний цвет верхних вокселей по границе карты (снег, песок, трава, асфальт)
        const bc = this._borderColor();
        const quad = (x0, z0, x1, z1) => {
            const n = pos.length / 3;
            pos.push(x0, top, z0, x1, top, z0, x1, top, z1, x0, top, z1);
            for (let i = 0; i < 4; i++) col.push(bc[0], bc[1], bc[2], 1);
            idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
        };
        quad(-far, -far, W + far, 0); quad(-far, D, W + far, D + far);
        quad(-far, 0, 0, D); quad(W, 0, W + far, D);
        // холмы: кольцо из сетки с шумом
        const R0 = 110, R1 = 520, seg = 96, rings = 10;
        const cx = W / 2, cz = D / 2;
        const noise = (a, r) => Math.sin(a * 3 + r * 0.01) * 0.5 + Math.sin(a * 7.3 + 1.3) * 0.3 + Math.sin(a * 13.1 + r * 0.02) * 0.2;
        const base = pos.length / 3;
        for (let j = 0; j <= rings; j++) {
            const t = j / rings, r = R0 + (R1 - R0) * t;
            for (let i = 0; i <= seg; i++) {
                const a = i / seg * Math.PI * 2;
                const hgt = top - 0.05 + Math.max(0, Math.sin(t * Math.PI)) * (18 + 26 * noise(a, r)) * Math.min(1, t * 3);
                pos.push(cx + Math.cos(a) * r, Math.max(top - 0.05, hgt), cz + Math.sin(a) * r);
                const g = 0.8 + 0.2 * noise(a * 2, r);
                col.push(bc[0] * 0.92 * g, bc[1] * 0.94 * g, bc[2] * 0.96 * g, 1);
            }
        }
        for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
            const a = base + j * (seg + 1) + i, b = a + seg + 1;
            idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
        const mesh = new BABYLON.Mesh('farLand', scene);
        const vd = new BABYLON.VertexData();
        vd.positions = pos; vd.colors = col; vd.indices = idx;
        const nrm = [];
        BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
        for (let i = 0; i < nrm.length; i += 3) if (nrm[i + 1] < 0) { nrm[i] = -nrm[i]; nrm[i + 1] = -nrm[i + 1]; nrm[i + 2] = -nrm[i + 2]; }
        vd.normals = nrm;
        vd.applyToMesh(mesh);
        mesh.material = m;
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.freezeWorldMatrix();
        this._farLand = mesh;
    },

    _makePipeline() {
        const scene = this.scene, cam = this.camera;
        const p = this.pipeline = new BABYLON.DefaultRenderingPipeline('post', true, scene, [cam]);
        p.samples = 1;
        p.fxaaEnabled = false;
        p.imageProcessingEnabled = true;
        const ip = p.imageProcessing;
        // чистая яркая картинка в духе Roblox: без киношного тонмаппинга, зерна и виньетки
        ip.toneMappingEnabled = false;
        ip.exposure = 1.0;
        ip.contrast = 1.06;
        const cc = new BABYLON.ColorCurves();
        cc.globalSaturation = 14;
        ip.colorCurves = cc;
        ip.colorCurvesEnabled = true;
        ip.vignetteEnabled = false;
        p.bloomEnabled = true;
        p.bloomThreshold = 1.0;
        p.bloomWeight = 0.14;
        p.bloomKernel = 56;
        p.bloomScale = 0.5;
        p.grainEnabled = false;
        p.grain.intensity = 3.5;
        p.grain.animated = true;
        p.chromaticAberrationEnabled = false;
        p.chromaticAberration.aberrationAmount = 1.4;
        p.chromaticAberration.radialIntensity = 0.7;
        p.sharpenEnabled = true;
        p.sharpen.edgeAmount = 0.12;
    },

    _makeSSAO(on) {
        const scene = this.scene;
        if (this.ssao) { this.ssao.dispose(true); this.ssao = null; this.gbr = null; this.depthTex = null; }
        this.softParticles = false;
        if (!on || !BABYLON.SSAO2RenderingPipeline.IsSupported || /[?&]nossao/.test(location.search)) return;
        // G-буфер ставим сами: вдвое меньше экрана, без прозрачных мешей (иначе плоскости частиц
        // с их «матрицами» попадают в глубину и дают серые многоугольники в SSAO)
        const g = this.gbr = scene.enableGeometryBufferRenderer(0.5);
        if (!g) return;
        g.renderTransparentMeshes = false;
        g.renderList = this._casters.length ? this._casters : null;
        // forceGeometryBuffer: отдельный проход G-буфера — с prePass карта теней и MRT давали
        // «Mismatch between texture format and sampler type» и чёрную землю
        const s = this.ssao = new BABYLON.SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera], true);
        s.radius = 0.55;
        s.totalStrength = 1.0;
        s.base = 0.0;
        s.samples = 14;
        s.maxZ = 70;
        s.minZAspect = 0.5;
        s.expensiveBlur = true;
        s.bilateralSamples = 12;
        try { this.depthTex = g.getGBuffer().textures[g.getTextureIndex(BABYLON.GeometryBufferRenderer.DEPTH_TEXTURE_TYPE)]; } catch (e) { this.depthTex = null; }
        this.softParticles = !!this.depthTex;
    },

    /** low | medium | high: тени, SSAO, плотность пикселей, постобработка, плотность частиц. */
    setQuality(q) {
        const P = VOX_QUALITY[q] || VOX_QUALITY.high;
        if (!VOX_QUALITY[q]) q = 'high';
        this.quality = q;
        this.fxScale = P.fx;
        const dpr = window.devicePixelRatio || 1;
        this.engine.setHardwareScalingLevel(P.scale / Math.min(dpr, P.dpr));
        // меньше точечных огней и кастеров теней — меньше вызовов отрисовки и дешевле шейдер
        for (let i = 0; i < this.lights.length; i++) this.lights[i].setEnabled(i < P.lights);
        if (this._lamp) this.setHeadlamp(true);
        this._casterR = P.casters;
        this._nLights = P.lights;
        this._makeShadows(P.shadow, P);
        const p = this.pipeline;
        if (p) {
            p.samples = P.msaa;
            p.fxaaEnabled = P.fxaa;
            p.bloomEnabled = P.bloom;
            if (P.bloom) { p.bloomKernel = q === 'high' ? 40 : 28; p.bloomScale = q === 'high' ? 0.5 : 0.25; }
            p.chromaticAberrationEnabled = P.ca;
            p.grainEnabled = P.grain;
            p.sharpenEnabled = P.sharpen;
        }
        this._makeSSAO(P.ssao);
        this._casters = [];
        this._autoQ.t = 0; this._autoQ.acc = 0; this._autoQ.n = 0;
    },

    // ---------- сетки ----------

    /** Буферы мешера -> меш (новый или прежний). */
    applyBuffers(mesh, b) {
        const vd = new BABYLON.VertexData();
        vd.positions = b.pos; vd.normals = b.nrm; vd.colors = b.col; vd.indices = b.idx;
        vd.applyToMesh(mesh, false);
        mesh.setVerticesData('voxData', b.aux, false, 4);
        return mesh;
    },

    _newMesh(name, glass) {
        const m = new BABYLON.Mesh(name, this.scene);
        m.material = glass ? this.glassMat : this.mat;
        m.isPickable = false;
        m.receiveShadows = true;
        m.doNotSyncBoundingInfo = false;
        if (glass) m.alphaIndex = 10;
        return m;
    },

    /** Пересобрать сетку чанка c (номер чанка мира): буферы кладутся в ячейку, меш ячейки собирается в updateDirty. */
    meshChunk(c) {
        const w = this.world, K = this.CELL;
        const cx = c % w.cx, cz = ((c / w.cx) | 0) % w.cz, cy = (c / (w.cx * w.cz)) | 0;
        const x0 = cx * VOX_CH, y0 = cy * VOX_CH, z0 = cz * VOX_CH;
        const ncx = Math.ceil(w.cx / K), ncz = Math.ceil(w.cz / K);
        const cid = ((cx / K) | 0) + ((cz / K) | 0) * ncx + ((cy / K) | 0) * ncx * ncz;
        let cell = this.chunks.get(cid);
        if (!w.chunkSolid[c]) {
            if (cell && cell.parts.delete(c)) this._dirtyCells.add(cid);
            return;
        }
        w.copyPadded(x0, y0, z0, VOX_CH, this._pad);
        const r = VoxMesher.build(this._pad, VOX_CH, VOX_CH, VOX_CH, x0, y0, z0, this.vs);
        if (!cell) { cell = { o: null, g: null, parts: new Map() }; this.chunks.set(cid, cell); }
        if (r.opaque || r.glass) cell.parts.set(c, r); else cell.parts.delete(c);
        this._dirtyCells.add(cid);
    },

    /** Склеить буферы чанков ячейки в один меш (непрозрачный) и один (стекло). */
    _mergeCell(cid) {
        const cell = this.chunks.get(cid);
        if (!cell) return;
        for (const [key, src, glass] of /** @type {[string, string, boolean][]} */ ([['o', 'opaque', false], ['g', 'glass', true]])) {
            let nv = 0, ni = 0;
            for (const p of cell.parts.values()) { const b = p[src]; if (b) { nv += b.pos.length / 3; ni += b.idx.length; } }
            let m = cell[key];
            if (!nv) { if (m) { m.dispose(); cell[key] = null; } continue; }
            const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 4), aux = new Float32Array(nv * 4);
            const idx = new Uint32Array(ni);
            let vo = 0, io = 0;
            for (const p of cell.parts.values()) {
                const b = p[src]; if (!b) continue;
                const n = b.pos.length / 3;
                pos.set(b.pos, vo * 3); nrm.set(b.nrm, vo * 3); col.set(b.col, vo * 4); aux.set(b.aux, vo * 4);
                for (let i = 0; i < b.idx.length; i++) idx[io + i] = b.idx[i] + vo;
                vo += n; io += b.idx.length;
            }
            if (!m) { m = cell[key] = this._newMesh('cell' + cid + key, glass); m.freezeWorldMatrix(); }
            this.applyBuffers(m, { pos, nrm, col, aux, idx });
        }
        if (!cell.o && !cell.g && !cell.parts.size) this.chunks.delete(cid);
        this._casters = [];
    },

    _flushCells() {
        if (!this._dirtyCells.size) return;
        for (const cid of this._dirtyCells) this._mergeCell(cid);
        this._dirtyCells.clear();
    },

    /** Пересобрать помеченные чанки, не дольше budgetMs (все — budgetMs = Infinity); noMerge — склейку ячеек отложить. */
    updateDirty(budgetMs, noMerge = false) {
        const w = this.world;
        const t0 = performance.now();
        while (w.dirtyList.length) {
            const c = w.dirtyList.shift();
            w.chunkDirty[c] = 0;
            this.meshChunk(c);
            if (performance.now() - t0 > budgetMs) break;
        }
        if (!noMerge) this._flushCells();
    },

    /** Новая карта без перезагрузки страницы: снять сетки и дальнюю землю (её цвет зависит от карты). */
    resetWorld() {
        for (const cell of this.chunks.values()) { if (cell.o) cell.o.dispose(); if (cell.g) cell.g.dispose(); }
        this.chunks.clear();
        this._dirtyCells.clear();
        this._casters = [];
        if (this._farLand) { this._farLand.dispose(); this._farLand = null; }
    },
    remakeFarLand() { if (!this._farLand) this._makeFarLand(); },

    /** Все чанки под экраном загрузки, с прогрессом (0..1). */
    async buildAll(onProgress) {
        const w = this.world;
        const total = w.dirtyList.length || 1;
        while (w.dirtyList.length) {
            this.updateDirty(24, true);
            if (onProgress) onProgress(1 - w.dirtyList.length / total);
            await new Promise(r => setTimeout(r, 0));
        }
        this._flushCells();
    },

    /** Вид тела: узел (позиция/поворот центра масс) + меши (непрозрачный, стекло). */
    makeBodyView(body) {
        const node = body.node || (body.node = new BABYLON.TransformNode('body', this.scene));
        node.rotationQuaternion = node.rotationQuaternion || new BABYLON.Quaternion();
        this.rebuildBodyView(body);
        return node;
    },
    rebuildBodyView(body) {
        const vs = this.vs;
        const p = body.padded();
        const r = VoxMesher.build(p, body.sx, body.sy, body.sz, body.ox, body.oy, body.oz, vs);
        for (const [key, buf, glass] of /** @type {[string, any, boolean][]} */ ([['meshO', r.opaque, false], ['meshG', r.glass, true]])) {
            let m = body[key];
            if (!buf) { if (m) { m.dispose(); body[key] = null; } continue; }
            if (!m) {
                m = body[key] = this._newMesh('b', glass);
                m.parent = body.node;
            }
            this.applyBuffers(m, buf);
            // вершины — в координатах вокселей карты; центр масс тела — начало узла
            m.position.set(-(body.ox * vs + body.com[0]), -(body.oy * vs + body.com[1]), -(body.oz * vs + body.com[2]));
        }
        this._casters = [];
    },
    disposeBodyView(body) {
        if (body.meshO) body.meshO.dispose();
        if (body.meshG) body.meshG.dispose();
        if (body.node) body.node.dispose();
        body.meshO = body.meshG = body.node = null;
        this._casters = [];
    },

    // ---------- огни ----------

    /**
     * Вспышка точечным светом: цвет [r,g,b], пик яркости (шкала прежней игры, внутри ×FLASH_GAIN — свет
     * теперь без зажима), дальность м, длительность с, flicker 0..1.
     */
    flash(x, y, z, color, peak, range, dur, flicker = 0) {
        let best = this.lights[this._lamp ? 1 : 0], bestLeft = Infinity;
        const fl = this._flashes;
        for (let li = this._lamp ? 1 : 0; li < this._nLights; li++) {
            const l = this.lights[li];
            let left = 0;
            for (let i = 0; i < fl.length; i++) if (fl[i].light === l) { left = (fl[i].dur - fl[i].t) * fl[i].peak; break; }
            if (left < bestLeft) { bestLeft = left; best = l; }
        }
        for (let i = fl.length - 1; i >= 0; i--) if (fl[i].light === best) { fl[i] = fl[fl.length - 1]; fl.pop(); }
        best.position.set(x, y, z);
        best.diffuse.set(color[0], color[1], color[2]);
        best.range = range;
        fl.push({ t: 0, dur, peak, light: best, flicker });
    },

    // ---------- кадр ----------

    /** Кадр теней у игрока: ортокадр солнца, привязанный к сетке текселей (без «дрожи»). Без аллокаций. */
    _updateShadow() {
        const sg = this.shadow; if (!sg) return;
        const cam = this.camera, sun = this.sun;
        const size = this.shadowSize;
        const f = this._v1;
        cam.getDirectionToRef(BABYLON.Axis.Z, f);
        // в правосторонней сцене взгляд камеры — локальная −Z
        const fl = -(Math.hypot(f.x, f.z) || 1);
        const w = this.world;
        const cx = Math.max(0, Math.min(w.sx * this.vs, cam.position.x + f.x / fl * size * 0.2));
        const cy = cam.position.y;
        const cz = Math.max(0, Math.min(w.sz * this.vs, cam.position.z + f.z / fl * size * 0.2));
        const map = sg.getShadowMap();
        const texel = size / map.getSize().width;
        const d = this.sunDir, b = this._sunBasis;
        const cr = Math.round((cx * b.rx + cy * b.ry + cz * b.rz) / texel) * texel;
        const cu = Math.round((cx * b.ux + cy * b.uy + cz * b.uz) / texel) * texel;
        const cd = cx * d.x + cy * d.y + cz * d.z;
        const px = b.rx * cr + b.ux * cu + d.x * cd, py = b.ry * cr + b.uy * cu + d.y * cd, pz = b.rz * cr + b.uz * cu + d.z * cd;
        this._shadowCenter.set(px, py, pz);
        sun.position.set(px - d.x * 100, py - d.y * 100, pz - d.z * 100);
        sun.direction.copyFrom(d);
        sun.orthoLeft = -size / 2; sun.orthoRight = size / 2;
        sun.orthoTop = size / 2; sun.orthoBottom = -size / 2;
        // кастеры: меши, чей габарит у кадра
        if (!this._casters.length || ++this._castTick % 20 === 0) {
            const list = [];
            const R = this._casterR || size * 0.75;
            const meshes = this.scene.meshes;
            for (let i = 0; i < meshes.length; i++) {
                const m = meshes[i];
                if (!m.receiveShadows || m === this._farLand || !m.isEnabled() || !m.getTotalVertices()) continue;
                const bb = m.getBoundingInfo().boundingSphere;
                const dx = bb.centerWorld.x - cx, dz = bb.centerWorld.z - cz;
                if (dx * dx + dz * dz < (R + bb.radiusWorld) ** 2) list.push(m);
            }
            this._casters = list;
            map.renderList = list;
            if (this.gbr) this.gbr.renderList = list;
        }
    },

    update(dt) {
        const t0 = performance.now();
        const e = this.env;
        e.time += dt;
        if (this._skyMat) this._skyMat.setFloat('time', e.time);
        for (let i = this._flashes.length - 1; i >= 0; i--) {
            const f = this._flashes[i];
            f.t += dt;
            const k = Math.max(0, 1 - f.t / f.dur);
            const fl = f.flicker ? (1 - f.flicker * 0.5 + Math.random() * f.flicker) : 1;
            f.light.intensity = f.peak * this.FLASH_GAIN * k * k * fl;
            if (f.t >= f.dur) { f.light.intensity = 0; this._flashes.splice(i, 1); }
        }
        this._updateBolt(dt);
        this._updateShadow();
        this.stats.updateMs += (performance.now() - t0 - this.stats.updateMs) * 0.1;
        this._autoQuality(dt);
    },

    /**
     * Если большинство кадров за 5 с медленнее ~42 fps и игрок не выбирал качество — понизить уровень
     * (high → medium → low). Считаем долю медленных кадров, а не среднее: разовые подвисания компиляции
     * шейдеров не в счёт.
     */
    _autoQuality(dt) {
        const a = this._autoQ;
        if (!a.on || dt <= 0) return;
        // ядерный взрыв нагружает нарочно: его секунды не в счёт
        if (a.hold > 0) { a.hold -= dt; a.t = 0; a.acc = 0; a.n = 0; return; }
        if (dt > 0.25) return;
        if (typeof Game !== 'undefined' && Game.state && Game.state.quality) { a.on = false; return; }
        a.t += dt;
        if (a.t < 3) return;                 // прогрев: компиляция шейдеров
        a.n++;
        if (dt > 1 / 42) a.acc++;
        if (a.t > 8) {
            const slow = a.acc / Math.max(1, a.n);
            a.t = 3; a.acc = 0; a.n = 0;
            if (slow > 0.7 && this.quality !== 'low') this.setQuality(this.quality === 'high' ? 'medium' : 'low');
        }
    },

    /** Не понижать качество автоматически sec секунд (ядерный взрыв). */
    holdAuto(sec) { this._autoQ.hold = Math.max(this._autoQ.hold, sec); },

    /** Замер GPU-времени кадра (EXT_disjoint_timer_query): после вызова stats.gpuMs обновляется каждый кадр. */
    enableGpuTiming() {
        if (this._gpuInst) return true;
        try {
            const inst = this._gpuInst = new BABYLON.EngineInstrumentation(this.engine);
            inst.captureGPUFrameTime = true;
            this.scene.onAfterRenderObservable.add(() => { this.stats.gpuMs = inst.gpuFrameTimeCounter.current * 1e-6; });
            return true;
        } catch (e) { return false; }
    },

    render() {
        const t0 = performance.now();
        this.scene.render();
        this.stats.renderMs += (performance.now() - t0 - this.stats.renderMs) * 0.1;
    },
};
