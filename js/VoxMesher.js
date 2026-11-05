// VoxMesher.js — жадная сетка вокселей с запечённым ambient occlusion (AO в цвете вершин).
// Вход — сетка с рамкой в 1 воксель (Uint8Array, порядок x + px·(z + pz·y)), выход — два набора
// буферов: непрозрачный и стекло (стекло рисуется отдельным прозрачным мешем).
// Соседние грани одного материала и одинакового AO склеиваются в один прямоугольник; вариацию
// цвета по вокселям даёт шейдер (VoxRender, хэш координаты вокселя), поэтому склейка не теряет вид.
// Вершина: col — чистый цвет материала (AO не вмешан), aux = (шум, блик, свечение, класс + AO):
// целая часть w — класс материала для шейдера (VoxMesher.CLS, +32 у обгоревшего), дробная — AO 0.4..0.99.
// Шейдер применяет AO к окружению сильнее, чем к прямому свету.

class VoxMeshBuf {
    constructor() { this.cap = 0; this.n = 0; this.ni = 0; this.grow(4096); }
    grow(verts) {
        const cap = Math.max(verts, this.cap * 2);
        const cp = (a, s) => { const b = new Float32Array(cap * s); if (a) b.set(a.subarray(0, this.n * s)); return b; };
        this.pos = cp(this.pos, 3); this.nrm = cp(this.nrm, 3); this.col = cp(this.col, 4); this.aux = cp(this.aux, 4);
        const idx = new Uint32Array(cap * 3 / 2);
        if (this.idx) idx.set(this.idx.subarray(0, this.ni));
        this.idx = idx;
        this.cap = cap;
    }
    reset() { this.n = 0; this.ni = 0; }
    /** Копия заполненной части: { pos, nrm, col, aux, idx } или null, если пусто. */
    take() {
        if (!this.n) return null;
        return {
            pos: this.pos.slice(0, this.n * 3), nrm: this.nrm.slice(0, this.n * 3),
            col: this.col.slice(0, this.n * 4), aux: this.aux.slice(0, this.n * 4), idx: this.idx.slice(0, this.ni),
        };
    }
}

/** @satisfies {Record<string, any>} */
const VoxMesher = {
    opaque: new VoxMeshBuf(),
    glass: new VoxMeshBuf(),
    AO: [0.40, 0.62, 0.82, 0.99],
    /** Класс материала для шейдера: 1 трава, 2 земля/песок, 3 камень/бетон, 4 дерево, 5 кирпич/кровля, 6 штукатурка, 7 металл/краска, 8 листва, 9 лампа, 10 стекло. */
    CLS_BY_KEY: {
        grass: 1, dirt: 2, sand: 2, bedrock: 3, rock: 3, concrete: 3, concrete2: 3, asphalt: 3, mortar: 3,
        wood: 4, plank: 4, darkwood: 4, crate: 4, brick: 5, brick2: 5, roof: 5, plaster: 6, plaster2: 6, tile: 6, foam: 6,
        metal: 7, rust: 7, hazard: 7, barrel: 7, blue: 7, leaves: 8, lamp: 9, glass: 10,
    },
    /** @type {Uint8Array | null} */
    _cls: null,
    /** @type {Int32Array | null} */
    _mask: null,
    /** @type {Uint8Array | null} */
    _occ: null,

    /**
     * Сетка куска: p — сетка с рамкой, nx·ny·nz — размер без рамки; offset — смещение вокселей
     * (вершины = (локальные + offset) · vs). Возвращает { opaque, glass } (каждое — буферы или null).
     */
    build(p, nx, ny, nz, ox, oy, oz, vs) {
        const px = nx + 2, pz = nz + 2, pl = px * pz;
        const dims = [nx, ny, nz];
        // шаг индекса в рамочной сетке по осям x, y, z
        const step = [1, pl, px];
        const maxM = Math.max(nx * ny, ny * nz, nx * nz);
        if (!this._mask || this._mask.length < maxM) this._mask = new Int32Array(maxM);
        const mask = this._mask;
        // закрывает ли воксель свет (для AO и граней): твёрдое и не стекло
        if (!this._occ) {
            this._occ = new Uint8Array(256);
            for (let v = 1; v < 256; v++) this._occ[v] = (v & 127) && !VoxMat.of(v).glass ? 1 : 0;
        }
        const occ = this._occ;
        if (!this._cls) {
            this._cls = new Uint8Array(256);
            for (let v = 1; v < 256; v++) {
                const m = VoxMat.of(v);
                // 11 — плиты базы (шипы, без фаски), 12 — игрушечный пластик (без шипов)
                this._cls[v] = (m.plastic ? 11 : m.toy ? 12 : (this.CLS_BY_KEY[m.key] || 0)) + ((v & 128) ? 32 : 0);
            }
        }
        const isGlass = VoxMat.aux;          // aux[v*4+3] = 1 у стекла
        const op = this.opaque, gl = this.glass;
        op.reset(); gl.reset();
        const AO = this.AO;
        for (let d = 0; d < 3; d++) {
            const u = (d + 1) % 3, v = (d + 2) % 3;
            const nd = dims[d], nu = dims[u], nv = dims[v];
            const sd = step[d], su = step[u], sv = step[v];
            for (let side = -1; side <= 1; side += 2) {
                for (let s = 0; s < nd; s++) {
                    // заполнить маску слоя
                    let mi = 0;
                    const base = 1 + pl + px + s * sd;      // (1,1,1) — начало без рамки
                    for (let b = 0; b < nv; b++) {
                        for (let a = 0; a < nu; a++, mi++) {
                            const i = base + a * su + b * sv;
                            const val = p[i];
                            if (!val) { mask[mi] = 0; continue; }
                            const nb = p[i + side * sd];
                            const g = isGlass[val * 4 + 3] > 0;
                            let vis;
                            if (g) vis = !nb;
                            else vis = !nb || (isGlass[nb * 4 + 3] > 0);
                            if (!vis) { mask[mi] = 0; continue; }
                            // AO по слою соседа
                            const q = i + side * sd;
                            const s1 = occ[p[q - su]], s2 = occ[p[q + su]], t1 = occ[p[q - sv]], t2 = occ[p[q + sv]];
                            const c00 = occ[p[q - su - sv]], c10 = occ[p[q + su - sv]], c11 = occ[p[q + su + sv]], c01 = occ[p[q - su + sv]];
                            const a0 = (s1 && t1) ? 0 : 3 - (s1 + t1 + c00);
                            const a1 = (s2 && t1) ? 0 : 3 - (s2 + t1 + c10);
                            const a2 = (s2 && t2) ? 0 : 3 - (s2 + t2 + c11);
                            const a3 = (s1 && t2) ? 0 : 3 - (s1 + t2 + c01);
                            mask[mi] = val | (a0 << 8) | (a1 << 10) | (a2 << 12) | (a3 << 14) | (g ? 1 << 16 : 0);
                        }
                    }
                    // жадная склейка
                    const plane = s + (side > 0 ? 1 : 0);
                    mi = 0;
                    for (let b = 0; b < nv; b++) {
                        for (let a = 0; a < nu; ) {
                            const k = mask[b * nu + a];
                            if (!k) { a++; continue; }
                            let w = 1;
                            while (a + w < nu && mask[b * nu + a + w] === k) w++;
                            let h = 1;
                            outer: while (b + h < nv) {
                                const row = (b + h) * nu;
                                for (let t = 0; t < w; t++) if (mask[row + a + t] !== k) break outer;
                                h++;
                            }
                            for (let hh = 0; hh < h; hh++) mask.fill(0, (b + hh) * nu + a, (b + hh) * nu + a + w);
                            this._quad(k & 0x10000 ? gl : op, k, d, u, v, side, plane, a, b, w, h, ox, oy, oz, vs, AO);
                            a += w;
                        }
                    }
                }
            }
        }
        return { opaque: op.take(), glass: gl.take() };
    },

    _quad(buf, k, d, u, v, side, plane, a, b, w, h, ox, oy, oz, vs, AO) {
        if (buf.n + 4 > buf.cap) buf.grow(buf.n + 4);
        const val = k & 255;
        const ao = [(k >> 8) & 3, (k >> 10) & 3, (k >> 12) & 3, (k >> 14) & 3];
        const off = [ox, oy, oz];
        const cu = [a, a + w, a + w, a], cv = [b, b, b + h, b + h];
        const r = VoxMat.rgb[val * 3], g = VoxMat.rgb[val * 3 + 1], bl = VoxMat.rgb[val * 3 + 2];
        const x0 = VoxMat.aux[val * 4], x1 = VoxMat.aux[val * 4 + 1], x2 = VoxMat.aux[val * 4 + 2], cls = this._cls[val];
        const n0 = buf.n;
        const c = [0, 0, 0];
        for (let t = 0; t < 4; t++) {
            c[d] = plane; c[u] = cu[t]; c[v] = cv[t];
            const o3 = (n0 + t) * 3, o4 = (n0 + t) * 4;
            buf.pos[o3] = (c[0] + off[0]) * vs; buf.pos[o3 + 1] = (c[1] + off[1]) * vs; buf.pos[o3 + 2] = (c[2] + off[2]) * vs;
            buf.nrm[o3] = d === 0 ? side : 0; buf.nrm[o3 + 1] = d === 1 ? side : 0; buf.nrm[o3 + 2] = d === 2 ? side : 0;
            buf.col[o4] = r; buf.col[o4 + 1] = g; buf.col[o4 + 2] = bl; buf.col[o4 + 3] = 1;
            buf.aux[o4] = x0; buf.aux[o4 + 1] = x1; buf.aux[o4 + 2] = x2; buf.aux[o4 + 3] = cls + AO[ao[t]];
        }
        buf.n += 4;
        // обход: (u,v) — правая тройка с d, порядок 0-1-2-3 против часовой со стороны +d;
        // лицевая сторона Babylon в правосторонней сцене — по часовой, поэтому для +d — 0-3-2-1
        const flip = ao[0] + ao[2] < ao[1] + ao[3];
        let i0, i1, i2, i3;
        if (side < 0) { i0 = 0; i1 = 1; i2 = 2; i3 = 3; } else { i0 = 0; i1 = 3; i2 = 2; i3 = 1; }
        const id = buf.idx;
        let ii = buf.ni;
        const V = [n0 + i0, n0 + i1, n0 + i2, n0 + i3];
        // для стороны −d вершины 1 и 3 поменялись местами — пары диагоналей те же
        if (!flip) { id[ii++] = V[0]; id[ii++] = V[1]; id[ii++] = V[2]; id[ii++] = V[0]; id[ii++] = V[2]; id[ii++] = V[3]; }
        else { id[ii++] = V[1]; id[ii++] = V[2]; id[ii++] = V[3]; id[ii++] = V[1]; id[ii++] = V[3]; id[ii++] = V[0]; }
        buf.ni = ii;
    },
};
