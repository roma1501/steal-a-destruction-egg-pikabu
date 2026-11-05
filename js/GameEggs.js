// GameEggs.js — яйца: мелкие воксельные меши (узор по записи EGGS), сияние по редкости, физическое тело при падении.
// Модель в гнезде и на алтаре — меш без физики; выпавшее яйцо — VoxBody (грубая сетка для столкновений), вид — тот же меш.

/** @satisfies {Record<string, any>} */
const GameEggs = {
    VOX: 0.05,             // сторона вокселя яйца, м
    SX: 18, SY: 25, SZ: 18,
    /** @type {Record<string, FolkGrid>} */
    _grids: {},

    /** Сетка яйца с узором. */
    grid(def) {
        if (this._grids[def.id]) return this._grids[def.id];
        const { SX, SY, SZ } = this;
        const a = M[def.a] || M.egg_white, b = M[def.b] || M.egg_dark;
        const g = new FolkGrid(SX, SY, SZ);
        const cx = SX / 2, cz = SZ / 2, cy = SY * 0.44;
        const rnd = (x, y, z) => VoxFolk.hash(x, y, z);
        for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
            const u = (x + 0.5 - cx) / (SX / 2), w = (z + 0.5 - cz) / (SZ / 2);
            // яйцо: снизу шире, сверху уже
            const t = (y + 0.5 - cy) / (y + 0.5 > cy ? SY - cy : cy);
            const k = y + 0.5 > cy ? 1 - 0.06 * t : 1;
            if ((u * u + w * w) / (k * k) + t * t > 1) continue;
            let v = a;
            const ang = Math.atan2(w, u);
            switch (def.pattern) {
                case 'stripes': v = (y >> 2) % 2 ? b : a; break;
                case 'rings': v = (((y + 1) / 3) | 0) % 3 === 1 ? b : a; break;
                case 'zigzag': v = Math.abs(((y + Math.abs(((ang * 3.82 + 12) % 2) - 1) * 5) % 8) - 4) < 1.4 ? b : a; break;
                case 'checker': v = (((x >> 1) + (y >> 1) + (z >> 1)) & 1) ? b : a; break;
                case 'spots': v = rnd(x >> 2, y >> 2, z >> 2) > 0.68 ? b : a; break;
                case 'stars': v = rnd(x, y, z) > 0.9 ? b : a; break;
                case 'split': v = y > SY * 0.52 ? b : (y === Math.round(SY * 0.5) ? M.egg_white : a); break;
                case 'glitch': { const r = rnd(x >> 1, y >> 1, z >> 1); v = r > 0.62 ? b : (r < 0.14 ? M.egg_white : a); break; }
                case 'cracks': {
                    const q = Math.abs(Math.sin(ang * 3 + y * 0.55) * 7 - ((y * 1.3) % 7));
                    v = q < 0.55 ? b : a;
                    break;
                }
            }
            g.set(x, y, z, v);
        }
        this._grids[def.id] = g;
        return g;
    },

    /** Меш яйца: начало — низ по центру. opts: { group — группа рендера, scale }. */
    mesh(def, opts = {}) {
        const g = this.grid(def), { sx, sy, sz } = g;
        const px = sx + 2, pz = sz + 2, pad = new Uint8Array(px * pz * (sy + 2));
        for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
            const src = sx * (z + sz * y);
            pad.set(g.data.subarray(src, src + sx), 1 + px * ((z + 1) + pz * (y + 1)));
        }
        const r = VoxMesher.build(pad, sx, sy, sz, -(sx >> 1), 0, -(sz >> 1), 0.1);
        const m = new BABYLON.Mesh('egg-' + def.id, VoxRender.scene);
        VoxRender.applyBuffers(m, r.opaque);
        m.material = opts.group === 2 ? VoxRender.vmMat : VoxRender.mat;
        m.isPickable = false;
        m.receiveShadows = true;
        if (opts.group) { m.renderingGroupId = opts.group; if (opts.group === 2) m.layerMask = VoxRender.VM_LAYER; }
        m.scaling.setAll(this.VOX / 0.1 * (opts.scale || 1));
        VoxRender._casters = [];
        return m;
    },

    /** Цвет редкости как [r, g, b] 0..1 (огни и частицы). */
    rarityRgb(def) {
        const hex = RARITIES[def.rarity].color, n = parseInt(hex.slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    },

    /** Искры вокруг яйца: чем реже яйцо, тем больше. Звать каждый кадр. */
    sparkle(def, x, y, z, dt) {
        const n = 0.8 + def.rarity * 1.6;
        if (Math.random() > n * dt) return;
        const c = this.rarityRgb(def), a = Math.random() * 6.28, r = 0.3 + Math.random() * 0.3;
        VoxFX.puff(x + Math.cos(a) * r, y + 0.1 + Math.random() * 0.9, z + Math.sin(a) * r, { add: true, mode: 5, size: 0.045, life: 0.9, alpha: 1, vy: 0.5 + Math.random() * 0.5, drag: 0.5, r: c[0] * 3, g: c[1] * 3, b: c[2] * 3, fadeOut: 0.5 });
    },

    /** Выпавшее яйцо: твёрдое тело с видом-мешем. Возвращает VoxBody. */
    spawnBody(def, x, y, z, vx = 0, vy = 2, vz = 0) {
        const sx = 7, sy = 10, sz = 7;
        const grid = new Uint8Array(sx * sy * sz);
        for (let yy = 0; yy < sy; yy++) for (let zz = 0; zz < sz; zz++) for (let xx = 0; xx < sx; xx++) {
            const u = (xx + 0.5 - sx / 2) / (sx / 2), w = (zz + 0.5 - sz / 2) / (sz / 2), t = (yy + 0.5 - sy * 0.44) / (yy + 0.5 > sy * 0.44 ? sy * 0.56 : sy * 0.44);
            if (u * u + w * w + t * t <= 1.05) grid[xx + sx * (zz + sz * yy)] = M.egg_stone;
        }
        const k = 1 / VoxPhysics.vs;
        const b = VoxPhysics.createBody(grid, sx, sy, sz, Math.floor(x * k) - 3, Math.floor(y * k), Math.floor(z * k) - 3, { minCount: 1, v: [vx, vy, vz], w: [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3] });
        if (!b) return null;
        if (b.meshO) b.meshO.setEnabled(false);
        const m = this.mesh(def);
        m.parent = b.node;
        m.position.set(0, -b.com[1] + 0.02, 0);
        return b;
    },
};
