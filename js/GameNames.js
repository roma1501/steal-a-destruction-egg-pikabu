// GameNames.js — таблички над головами: ники ботов на базе и имена продавцов, как над игроками в Roblox.
// Свой маленький пул DOM-элементов и проекция через матрицу камеры; клики не перехватывает.

/** @satisfies {Record<string, any>} */
const GameNames = {
    /** @type {{ el: HTMLElement, on: boolean }[]} */
    _pool: [],
    /** @type {HTMLElement | null} */
    _root: null,
    MAX: 12,
    RANGE: 22,
    _v: /** @type {BABYLON.Vector3 | null} */ (null),
    _out: /** @type {BABYLON.Vector3 | null} */ (null),

    init() {
        if (this._root) return;
        const st = document.createElement('style');
        st.textContent = '#sde-names{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:6}'
            + '.sde-name{position:absolute;left:0;top:0;white-space:nowrap;font:400 15px "Russo One","Rubik",system-ui,sans-serif;color:#fff;'
            + 'text-shadow:-2px 0 #000,2px 0 #000,0 -2px #000,0 2px #000,-1px -1px #000,1px 1px #000,-1px 1px #000,1px -1px #000;will-change:transform}'
            + '.sde-name.npc{color:#ffe14a;font-size:17px}.sde-name.hurt{color:#ff6a5a}';
        document.head.appendChild(st);
        const r = this._root = document.createElement('div');
        r.id = 'sde-names';
        document.body.appendChild(r);
        for (let i = 0; i < this.MAX; i++) {
            const el = document.createElement('div');
            el.className = 'sde-name';
            el.style.display = 'none';
            r.appendChild(el);
            this._pool.push({ el, on: false });
        }
        this._v = new BABYLON.Vector3();
        this._out = new BABYLON.Vector3();
    },

    /** Кадр: list — [{ rig, name, cls }] (GameBase.nameTags()). */
    update(list) {
        if (!this._root) this.init();
        const pool = this._pool;
        const scene = VoxRender.scene, cam = VoxRender.camera, eng = VoxRender.engine;
        const W = window.innerWidth, H = window.innerHeight;
        const tm = cam.getTransformationMatrix();
        const m = tm.m;
        let used = 0;
        const c = [0, 0, 0];
        for (const q of list) {
            if (used >= pool.length) break;
            const rig = q.rig;
            if (!rig || rig.gone) continue;
            rig.center(c);
            const top = c[1] + rig.h * 0.72 + 0.28;
            const dx = c[0] - cam.position.x, dz = c[2] - cam.position.z;
            const d = Math.hypot(dx, dz);
            if (d > this.RANGE) continue;
            // проекция: матрица вида-проекции Babylon (вектор-строка)
            const x = c[0], y = top, z = c[2];
            const w = x * m[3] + y * m[7] + z * m[11] + m[15];
            if (w <= 0.05) continue;
            const sx = (x * m[0] + y * m[4] + z * m[8] + m[12]) / w, sy = (x * m[1] + y * m[5] + z * m[9] + m[13]) / w;
            if (sx < -1.05 || sx > 1.05 || sy < -1.05 || sy > 1.05) continue;
            const P = pool[used++];
            if (!P.on) { P.on = true; P.el.style.display = ''; }
            if (P.el.textContent !== q.name) P.el.textContent = q.name;
            const cls = 'sde-name' + (q.cls ? ' ' + q.cls : '');
            if (P.el.className !== cls) P.el.className = cls;
            const s = Math.max(0.6, Math.min(1.15, 9 / (d + 2)));
            P.el.style.opacity = String(Math.min(1, (this.RANGE - d) / 4));
            P.el.style.transform = 'translate(' + ((sx * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((0.5 - sy * 0.5) * H).toFixed(1) + 'px) translate(-50%,-100%) scale(' + s.toFixed(2) + ')';
        }
        for (let i = used; i < pool.length; i++) if (pool[i].on) { pool[i].on = false; pool[i].el.style.display = 'none'; }
    },
    hide() { for (const P of this._pool) if (P.on) { P.on = false; P.el.style.display = 'none'; } },
};
