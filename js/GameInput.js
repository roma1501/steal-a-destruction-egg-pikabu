// GameInput.js — захват курсора в этой игре, поверх Input.js:
// · отказ браузера сразу после Esc (пауза около 1.25 с) и повторный запрос той же попытки не считаются запретом: игра
//   не уходит навсегда на взгляд правой кнопкой, следующий клик захватывает курсор как обычно;
// · если захват запрещён по-настоящему (iframe без разрешения), камера идёт за мышью без нажатий, а клик время от времени
//   пробует захватить снова; получилось — обычный режим возвращается;
// · Tab переключает курсор: отпустить (без паузы) и захватить снова, см. toggle().

(function () {
    for (const [code, text] of [['ru', 'Нажмите или Tab, чтобы управлять'], ['en', 'Click or press Tab to take control']]) {
        if (typeof LANG_STRINGS !== 'undefined' && LANG_STRINGS[code]) LANG_STRINGS[code]['input.capture'] = text;
    }
})();

/** @satisfies {Record<string, any>} */
const GameInput = {
    /** Номер попытки захвата: один запрос игры может дать два отказа (с unadjustedMovement и без). */
    attempt: 0,
    errAt: -1,
    /** Захват хоть раз удался: значит, он разрешён, и отказы временные. */
    ever: false,
    unlockAt: -1e9,
    retryAt: 0,
    /** Tab при запрещённом захвате: камера не следует за мышью, курсором можно нажимать кнопки. */
    lookOff: false,

    init() {
        const G = this, I = /** @type {any} */ (Input);
        I.capture = function () {
            const cv = this.canvas;
            const can = this.wantsLock() || (this.lockFailed && this._accepts() && this.device !== 'touch' && !this.mouseTouch);
            if (!cv || this.locked || !can || typeof cv.requestPointerLock !== 'function') return false;
            G.attempt++;
            try {
                const p = cv.requestPointerLock({ unadjustedMovement: true });
                if (p && p.catch) p.catch(() => {
                    try { const q = cv.requestPointerLock(); if (q && q.catch) q.catch(() => { /* отказ — pointerlockerror */ }); } catch (e) { /* нет захвата */ }
                });
            } catch (e) { /* нет захвата */ }
            return true;
        };
        const change = I._onLockChange;
        I._onLockChange = function () {
            const was = this.locked;
            if (was && !(document.pointerLockElement === this.canvas)) G.unlockAt = this._now();
            change.call(this);
            if (!this.locked) return;
            G.ever = true;
            G.lookOff = false;
            if (this.lockFailed) { this.lockFailed = false; this.mouseMode = 'lock'; }
        };
        I._onLockError = function () {
            if (G.errAt === G.attempt) return;
            G.errAt = G.attempt;
            if (G.ever || this._now() - G.unlockAt < 2000) return;
            // сразу в запасной режим, чтобы камера не стояла; следующий клик попробует захват снова
            this._lockErrors++;
            if (this.locked) return;
            this.lockFailed = true;
            if (this.mouseMode === 'lock') this.mouseMode = 'drag';
        };
        const down = I._onPointerDown;
        I._onPointerDown = function (e) {
            if (this.lockFailed && !this.locked && e.button === 0 && e.pointerType !== 'touch' && this._isSurface(e.target) && this._accepts() && this._now() > G.retryAt) {
                G.retryAt = this._now() + 4000;
                this.capture();
            }
            down.call(this, e);
        };
        const move = I._onMouseMove;
        I._onMouseMove = function (e) {
            if (!this.lockFailed || this.locked || G.lookOff || this.device === 'touch') { move.call(this, e); return; }
            if (this._skipMove) { this._skipMove = false; return; }
            if (!this._accepts()) return;
            const k = this.c.lookClamp, s = this.c.mouseScale;
            const dx = Math.max(-k, Math.min(k, e.movementX || 0)) * s, dy = Math.max(-k, Math.min(k, e.movementY || 0)) * s;
            this.look.dx += dx; this.look.dy += dy;
            this.lookTotal += Math.abs(dx) + Math.abs(dy);
        };
    },

    /** Tab: курсор свободен или захвачен. Возвращает true, если курсор теперь свободен. */
    toggle(hud) {
        const I = /** @type {any} */ (Input);
        if (I.device === 'touch' || I.mouseTouch) return false;
        if (I.lockFailed) { this.lookOff = !this.lookOff; I.capture(); return this.lookOff; }
        if (I.locked) { hud._tabFree = true; I.release(); return true; }
        I.capture();
        return false;
    },
};
