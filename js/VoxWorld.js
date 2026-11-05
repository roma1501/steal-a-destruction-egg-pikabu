// VoxWorld.js — статический воксельный мир: плотная сетка байтов (VoxMat), чанки для сетки рендера,
// «кирпичи» 8³ для быстрых проверок пустоты, луч по вокселям (DDA) и поиск оторвавшихся кусков.
// Координаты вокселей: x вправо, y вверх, z вглубь карты; метры = воксель · VOX_SIZE.
// Индекс: x + (z << bx) + (y << (bx + bz)) — горизонтальный слой непрерывен.

const VOX_CH = 32;               // сторона чанка сетки рендера (вокселей)
const VOX_BR = 8;                // сторона «кирпича» занятости

class VoxWorld {
    /** @param {number} sx степень двойки @param {number} sy кратно VOX_CH @param {number} sz степень двойки */
    constructor(sx, sy, sz) {
        this.vs = typeof RL_VOX_SIZE !== 'undefined' ? RL_VOX_SIZE : 0.1;
        this.sx = sx; this.sy = sy; this.sz = sz;
        this.bx = Math.log2(sx) | 0; this.bz = Math.log2(sz) | 0;
        this.by = this.bx + this.bz;
        this.layer = sx * sz;
        this.data = new Uint8Array(sx * sy * sz);
        this.mark = new Uint8Array(sx * sy * sz);
        this.cx = sx / VOX_CH; this.cy = sy / VOX_CH; this.cz = sz / VOX_CH;
        this.chunkSolid = new Int32Array(this.cx * this.cy * this.cz);
        this.chunkDirty = new Uint8Array(this.cx * this.cy * this.cz);
        /** @type {number[]} */
        this.dirtyList = [];
        this.brx = sx / VOX_BR; this.bry = sy / VOX_BR; this.brz = sz / VOX_BR;
        this.brick = new Uint16Array(this.brx * this.bry * this.brz);
        this.limit = 260000;
        this._stack = new Int32Array(this.limit + 16);
        this._vis = new Int32Array(this.limit + 16);
        this.version = 0;          // растёт при каждой правке (кэш физики и игрока)
        this.groundTop = 20;       // первый свободный слой над землёй (ставит GameMapBuild)
    }

    idx(x, y, z) { return x + (z << this.bx) + (y << this.by); }
    inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; }
    get(x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
        return this.data[x + (z << this.bx) + (y << this.by)];
    }
    /** Воксель по метрам. */
    at(px, py, pz) { const k = 1 / this.vs; return this.get(Math.floor(px * k), Math.floor(py * k), Math.floor(pz * k)); }

    set(x, y, z, v) {
        if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
        const i = x + (z << this.bx) + (y << this.by);
        const old = this.data[i];
        if (old === v) return;
        this.data[i] = v;
        const d = (v ? 1 : 0) - (old ? 1 : 0);
        if (d) {
            this.chunkSolid[this.chunkOf(x, y, z)] += d;
            this.brick[(x >> 3) + (z >> 3) * this.brx + (y >> 3) * this.brx * this.brz] += d;
        }
        this.touch(x, y, z);
    }

    /** Правка без пометок (заполнение карты при сборке): потом recount(). */
    put(x, y, z, v) {
        if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
        this.data[x + (z << this.bx) + (y << this.by)] = v;
    }

    /** Ящик [x0,x1) × [y0,y1) × [z0,z1) материалом v (0 — вырезать). Быстрый путь сборки карты. */
    fill(x0, y0, z0, x1, y1, z1, v) {
        x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); z0 = Math.max(0, z0 | 0);
        x1 = Math.min(this.sx, x1 | 0); y1 = Math.min(this.sy, y1 | 0); z1 = Math.min(this.sz, z1 | 0);
        for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
            const base = (z << this.bx) + (y << this.by);
            this.data.fill(v, base + x0, base + x1);
        }
    }

    chunkOf(x, y, z) { return ((x / VOX_CH) | 0) + ((z / VOX_CH) | 0) * this.cx + ((y / VOX_CH) | 0) * this.cx * this.cz; }

    /** Пометить чанк(и) для пересборки сетки: соседний — если воксель на границе (AO и грани). */
    touch(x, y, z) {
        this.version++;
        const lx = x % VOX_CH, ly = y % VOX_CH, lz = z % VOX_CH;
        this._dirty(x, y, z);
        if (lx === 0) this._dirty(x - 1, y, z); else if (lx === VOX_CH - 1) this._dirty(x + 1, y, z);
        if (ly === 0) this._dirty(x, y - 1, z); else if (ly === VOX_CH - 1) this._dirty(x, y + 1, z);
        if (lz === 0) this._dirty(x, y, z - 1); else if (lz === VOX_CH - 1) this._dirty(x, y, z + 1);
    }
    _dirty(x, y, z) {
        if (!this.inside(x, y, z)) return;
        const c = this.chunkOf(x, y, z);
        if (!this.chunkDirty[c]) { this.chunkDirty[c] = 1; this.dirtyList.push(c); }
    }

    /** Пересчитать счётчики чанков и кирпичей после put/fill; все чанки — в пересборку. */
    recount() {
        this.chunkSolid.fill(0); this.brick.fill(0);
        const { sx, sy, sz, data } = this;
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
            const base = (z << this.bx) + (y << this.by);
            const cRow = ((z / VOX_CH) | 0) * this.cx + ((y / VOX_CH) | 0) * this.cx * this.cz;
            const bRow = (z >> 3) * this.brx + (y >> 3) * this.brx * this.brz;
            for (let x = 0; x < sx; x++) {
                if (!data[base + x]) continue;
                this.chunkSolid[cRow + ((x / VOX_CH) | 0)]++;
                this.brick[bRow + (x >> 3)]++;
            }
        }
        this.dirtyList.length = 0;
        for (let c = 0; c < this.chunkDirty.length; c++) { this.chunkDirty[c] = 1; this.dirtyList.push(c); }
        this.version++;
    }

    /** Есть ли твёрдое в ящике вокселей [x0..x1] × [y0..y1] × [z0..z1] (включительно) — по кирпичам 8³. */
    regionHasSolid(x0, y0, z0, x1, y1, z1) {
        const b0x = Math.max(0, x0 >> 3), b1x = Math.min(this.brx - 1, x1 >> 3);
        const b0y = Math.max(0, y0 >> 3), b1y = Math.min(this.bry - 1, y1 >> 3);
        const b0z = Math.max(0, z0 >> 3), b1z = Math.min(this.brz - 1, z1 >> 3);
        if (b0x > b1x || b0y > b1y || b0z > b1z) return false;
        for (let by = b0y; by <= b1y; by++) for (let bz = b0z; bz <= b1z; bz++) {
            const row = bz * this.brx + by * this.brx * this.brz;
            for (let bx = b0x; bx <= b1x; bx++) if (this.brick[row + bx]) return true;
        }
        return false;
    }

    /** Скопировать чанк с рамкой в 1 воксель: out — Uint8Array((n+2)³), порядок x + (n+2)·(z + (n+2)·y). */
    copyPadded(x0, y0, z0, n, out) {
        const p = n + 2;
        let o = 0;
        for (let y = y0 - 1; y <= y0 + n; y++) {
            for (let z = z0 - 1; z <= z0 + n; z++) {
                if (y < 0 || y >= this.sy || z < 0 || z >= this.sz) { out.fill(0, o, o + p); o += p; continue; }
                const base = (z << this.bx) + (y << this.by);
                for (let x = x0 - 1; x <= x0 + n; x++, o++) out[o] = (x < 0 || x >= this.sx) ? 0 : this.data[base + x];
            }
        }
        return out;
    }

    /**
     * Луч по вокселям (Amanatides–Woo) в метрах: dir — единичный. Возвращает попадание
     * { x, y, z (воксель), nx, ny, nz (нормаль грани), t (м), v (байт) } или null.
     */
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
        const k = 1 / this.vs;
        let px = ox * k, py = oy * k, pz = oz * k;
        let x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
        const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
        const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e30, tdy = dy !== 0 ? Math.abs(1 / dy) : 1e30, tdz = dz !== 0 ? Math.abs(1 / dz) : 1e30;
        let tmx = dx !== 0 ? ((sx > 0 ? (x + 1 - px) : (px - x)) * tdx) : 1e30;
        let tmy = dy !== 0 ? ((sy > 0 ? (y + 1 - py) : (py - y)) * tdy) : 1e30;
        let tmz = dz !== 0 ? ((sz > 0 ? (z + 1 - pz) : (pz - z)) * tdz) : 1e30;
        const maxT = maxDist * k;
        let t = 0, nx = 0, ny = 0, nz = 0;
        for (let guard = 0; guard < 4096; guard++) {
            if (y < 0 && sy < 0) return null;
            const v = this.get(x, y, z);
            if (v) return { x, y, z, nx, ny, nz, t: t * this.vs, v };
            if (tmx < tmy) {
                if (tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
                else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
            } else {
                if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
                else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
            }
            if (t > maxT) return null;
        }
        return null;
    }

    /**
     * Нагрузка над срезом yCut: обход твёрдого от seeds только по слоям y >= yCut (вниз ниже среза не
     * идём). mass — масса над срезом (кг), cap — сколько держат опоры (воксели слоя yCut, под которыми
     * есть твёрдое): сумма hold[байт]. big — обход упёрся в limit (огромная конструкция — не ломаем).
     * supports — индексы опорных вокселей.
     */
    loadAbove(seeds, yCut, limit, hold, mass1) {
        const { data, mark, sx, sz, layer } = this;
        const stack = this._stack, vis = this._vis;
        const mx = sx - 1, mz = sz - 1, bx = this.bx, by = this.by, sy = this.sy;
        limit = Math.min(limit, this.limit);
        let vn = 0, sp = 0, mass = 0, cap = 0, big = false, smx = 0, smz = 0;
        const supports = [];
        for (const s of seeds) {
            if (!data[s] || mark[s] || (s >> by) < yCut) continue;
            mark[s] = 4; stack[sp++] = s; vis[vn++] = s;
            while (sp > 0) {
                const i = stack[--sp];
                const v = data[i], y = i >> by;
                const m1 = mass1[v];
                mass += m1;
                smx += m1 * (i & mx); smz += m1 * ((i >> bx) & mz);
                if (y === yCut && data[i - layer]) { cap += hold[v]; supports.push(i); }
                const x = i & mx, z = (i >> bx) & mz;
                let n;
                if (y + 1 < sy) { n = i + layer; if (data[n] && !mark[n]) { mark[n] = 4; stack[sp++] = n; vis[vn++] = n; } }
                if (y > yCut) { n = i - layer; if (data[n] && !mark[n]) { mark[n] = 4; stack[sp++] = n; vis[vn++] = n; } }
                if (x > 0) { n = i - 1; if (data[n] && !mark[n]) { mark[n] = 4; stack[sp++] = n; vis[vn++] = n; } }
                if (x < mx) { n = i + 1; if (data[n] && !mark[n]) { mark[n] = 4; stack[sp++] = n; vis[vn++] = n; } }
                if (z > 0) { n = i - sx; if (data[n] && !mark[n]) { mark[n] = 4; stack[sp++] = n; vis[vn++] = n; } }
                if (z < mz) { n = i + sx; if (data[n] && !mark[n]) { mark[n] = 4; stack[sp++] = n; vis[vn++] = n; } }
                if (vn >= limit - 8) { big = true; break; }
            }
            if (big) break;
        }
        for (let k = 0; k < vn; k++) mark[vis[k]] = 0;
        return { mass, cap, supports, big, count: vn, comX: mass ? smx / mass + 0.5 : 0, comZ: mass ? smz / mass + 0.5 : 0 };
    }

    /**
     * Поиск кусков, которые больше ни на что не опираются. seeds — индексы твёрдых вокселей рядом с
     * вырезом. Обход в глубину «сначала вниз»: опора — неразрушимый материал (коренная порода) или
     * слой y = 0; обход длиннее limit считается опёртым (огромное здание не падает целиком).
     * Возвращает массив кусков — Int32Array индексов.
     */
    findFloating(seeds) {
        const { data, mark, sx, sz, layer } = this;
        const stack = this._stack, vis = this._vis, limit = this.limit;
        const mx = sx - 1, mz = sz - 1, bx = this.bx, by = this.by, sy = this.sy;
        /** @type {Int32Array[]} */
        const comps = [];
        /** @type {Int32Array[]} */
        const touched = [];
        const hard = VoxMat.list;
        for (let s = 0; s < seeds.length; s++) {
            const seed = seeds[s];
            if (!data[seed] || mark[seed]) continue;
            let sp = 0, vn = 0, anchored = false;
            mark[seed] = 1; stack[sp++] = seed; vis[vn++] = seed;
            while (sp > 0) {
                const i = stack[--sp];
                const v = data[i];
                const y = i >> by;
                if (y === 0 || hard[(v & 127) - 1].hard === 0) { anchored = true; break; }
                const x = i & mx, z = (i >> bx) & mz;
                // порядок: вверх, стороны, вниз (последний в стеке — первым из него)
                let n;
                if (y + 1 < sy) { n = i + layer; if (data[n]) { const m = mark[n]; if (m === 2) { anchored = true; break; } if (!m) { mark[n] = 1; stack[sp++] = n; vis[vn++] = n; } } }
                if (x > 0) { n = i - 1; if (data[n]) { const m = mark[n]; if (m === 2) { anchored = true; break; } if (!m) { mark[n] = 1; stack[sp++] = n; vis[vn++] = n; } } }
                if (x < mx) { n = i + 1; if (data[n]) { const m = mark[n]; if (m === 2) { anchored = true; break; } if (!m) { mark[n] = 1; stack[sp++] = n; vis[vn++] = n; } } }
                if (z > 0) { n = i - sx; if (data[n]) { const m = mark[n]; if (m === 2) { anchored = true; break; } if (!m) { mark[n] = 1; stack[sp++] = n; vis[vn++] = n; } } }
                if (z < mz) { n = i + sx; if (data[n]) { const m = mark[n]; if (m === 2) { anchored = true; break; } if (!m) { mark[n] = 1; stack[sp++] = n; vis[vn++] = n; } } }
                n = i - layer; if (data[n]) { const m = mark[n]; if (m === 2) { anchored = true; break; } if (!m) { mark[n] = 1; stack[sp++] = n; vis[vn++] = n; } }
                if (vn >= limit) { anchored = true; break; }
            }
            const list = vis.slice(0, vn);
            touched.push(list);
            const tag = anchored ? 2 : 3;
            for (let k = 0; k < vn; k++) mark[list[k]] = tag;
            if (!anchored) comps.push(list);
        }
        for (const list of touched) for (let k = 0; k < list.length; k++) mark[list[k]] = 0;
        return comps;
    }
}
