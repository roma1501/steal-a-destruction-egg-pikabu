// GamePlayer.js — игрок от первого лица: ящик 0.56 × 1.75 м против вокселей мира (по осям, со
// ступенькой до 0.45 м — завалы проходятся без прыжков), опора и толчки твёрдых тел (точки
// поверхности тел из VoxPhysics), прыжок, бег, присед, отдача взрывов; камера с качанием, отдачей
// и тряской. Режим полёта (noclip) — для осмотра разрушений.

class GamePlayer {
    /** @param {VoxWorld} world @param {{x:number,y:number,z:number}} at ноги, метры @param {number} yaw */
    constructor(world, at, yaw) {
        this.world = world;
        this.vs = world.vs;
        this.pos = { x: at.x, y: at.y, z: at.z };
        this.vel = { x: 0, y: 0, z: 0 };
        this.yaw = yaw; this.pitch = 0;
        this.r = 0.28; this.hStand = 1.75; this.hCrouch = 1.1; this.h = 1.75;
        this.onGround = false; this.groundMat = 'grass';
        /** @type {VoxBody | null} */
        this.groundBody = null;
        this.fly = false;
        this.eyeLift = 0;          // сглаживание подъёма на ступеньку
        this.bob = 0; this.bobAmp = 0;
        this.kick = 0; this.kickYaw = 0;       // отдача
        this.trauma = 0;           // тряска камеры 0..1
        this.landDip = 0;
        this.stepDist = 0;
        this.coyote = 0; this.jumpBuf = 0;
        this.fovBoost = 0;
        this.fovMul = 1;           // прицел снайперки
        this.speedMul = 1;         // оружие в руках, яйцо, улучшения
        this._shake = { x: 0, y: 0, r: 0 };
    }


    get eye() {
        return { x: this.pos.x, y: this.pos.y + this.h - 0.13 - this.eyeLift - this.landDip, z: this.pos.z };
    }
    /** Направление взгляда (единичный вектор). Правосторонняя сцена: yaw 0 смотрит вдоль −z. */
    dir() {
        const cp = Math.cos(this.pitch);
        return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
    }

    /** Пересекается ли ящик игрока (ноги в p) с вокселями мира. */
    _hitsWorld(px, py, pz, h) {
        const k = 1 / this.vs, r = this.r, e = 1e-4;
        const x0 = Math.floor((px - r) * k), x1 = Math.floor((px + r - e) * k);
        const y0 = Math.floor((py + e) * k), y1 = Math.floor((py + h - e) * k);
        const z0 = Math.floor((pz - r) * k), z1 = Math.floor((pz + r - e) * k);
        const w = this.world;
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.get(x, y, z)) return true;
        if (x0 < 0 || z0 < 0 || x1 >= w.sx || z1 >= w.sz) return true;     // край карты — стена
        return false;
    }

    /** Сдвиг по одной оси с упором в воксели; горизонтально — подъём на ступеньку. */
    _moveAxis(axis, d) {
        if (!d) return;
        const p = this.pos;
        const tryAt = (dx, dy, dz) => !this._hitsWorld(p.x + dx, p.y + dy, p.z + dz, this.h);
        const dx = axis === 0 ? d : 0, dy = axis === 1 ? d : 0, dz = axis === 2 ? d : 0;
        if (tryAt(dx, dy, dz)) { p.x += dx; p.y += dy; p.z += dz; return; }
        if (axis !== 1 && (this.onGround || this.coyote > 0)) {
            for (let s = 1; s <= 5; s++) {
                const up = s * this.vs * 0.9 + 0.005;
                if (up > 0.46) break;
                if (tryAt(0, up, 0) && tryAt(dx, up, dz)) {
                    p.x += dx; p.z += dz; p.y += up;
                    this.eyeLift += up;           // камера догоняет плавно
                    // опустить на ступень
                    let down = 0;
                    while (down < up && tryAt(0, -(down + 0.01), 0)) down += 0.01;
                    p.y -= down;
                    this.eyeLift -= down;
                    return;
                }
            }
        }
        // упор: найти самую дальнюю свободную долю
        let lo = 0, hi = 1;
        for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (tryAt(dx * m, dy * m, dz * m)) lo = m; else hi = m; }
        p.x += dx * lo; p.y += dy * lo; p.z += dz * lo;
        if (axis === 0) this.vel.x = 0; else if (axis === 1) { if (d < 0) this.onGround = true; this.vel.y = 0; } else this.vel.z = 0;
    }

    /** Взрывной толчок: импульс в м/с. */
    push(ix, iy, iz) {
        this.vel.x += ix; this.vel.y += iy; this.vel.z += iz;
        if (iy > 0.5) this.onGround = false;
    }
    addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

    /**
     * Ход игрока: look {dx, dy} px, move {x вправо, y вперёд}, keys { jump, sprint, crouch }.
     * Физика тел — VoxPhysics.playerContacts (опора, толчки) после движения по миру.
     */
    update(dt, look, move, keys) {
        const sens = (typeof RL_MOUSE_SENS !== 'undefined' ? RL_MOUSE_SENS : 0.0021);
        this.yaw -= look.dx * sens;
        this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch - look.dy * sens));
        const speed = keys.sprint ? (typeof RL_PLAYER_SPRINT !== 'undefined' ? RL_PLAYER_SPRINT : 7.4) : (typeof RL_PLAYER_SPEED !== 'undefined' ? RL_PLAYER_SPEED : 4.3);
        const speedMul = this.speedMul;
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        // вперёд — (−sin, −cos), вправо — (cos, −sin)
        let wx = -sy * move.y + cy * move.x, wz = -cy * move.y - sy * move.x;
        const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }

        if (this.fly) {
            const f = this.dir();
            const s = (keys.sprint ? 22 : 9);
            this.pos.x += (f.x * move.y + cy * move.x) * s * dt;
            this.pos.y += (f.y * move.y + (keys.jump ? 1 : 0) - (keys.crouch ? 1 : 0)) * s * dt;
            this.pos.z += (f.z * move.y - sy * move.x) * s * dt;
            this.vel.x = this.vel.y = this.vel.z = 0;
            this._camFx(dt, 0);
            return;
        }

        // присед: встать, только если есть место
        const wantH = keys.crouch ? this.hCrouch : this.hStand;
        if (wantH > this.h) { if (!this._hitsWorld(this.pos.x, this.pos.y, this.pos.z, wantH)) this.h = Math.min(wantH, this.h + dt * 4); }
        else this.h = Math.max(wantH, this.h - dt * 5);
        const crouchK = this.h < this.hStand - 0.1 ? 0.5 : 1;

        // разгон
        const v = this.vel;
        const targX = wx * speed * crouchK * speedMul, targZ = wz * speed * crouchK * speedMul;
        const acc = this.onGround ? 60 : 9;
        const ax = targX - v.x, az = targZ - v.z;
        const al = Math.hypot(ax, az), maxA = acc * dt;
        if (al > maxA) { v.x += ax / al * maxA; v.z += az / al * maxA; } else { v.x = targX; v.z = targZ; }
        // прыжок: буфер и «койот»
        this.coyote = this.onGround ? 0.1 : Math.max(0, this.coyote - dt);
        this.jumpBuf = keys.jumpPressed ? 0.14 : Math.max(0, this.jumpBuf - dt);
        if (this.jumpBuf > 0 && this.coyote > 0) {
            v.y = (typeof RL_PLAYER_JUMP !== 'undefined' ? RL_PLAYER_JUMP : 5.0);
            if (this.groundBody) { const gv = this.groundBody.v; v.x += gv[0] * 0.5; v.z += gv[2] * 0.5; }
            this.jumpBuf = 0; this.coyote = 0; this.onGround = false;
        }
        v.y -= (typeof RL_PLAYER_GRAVITY !== 'undefined' ? RL_PLAYER_GRAVITY : 14) * dt;
        if (v.y < -40) v.y = -40;
        const fallSpeed = -v.y;
        const wasGround = this.onGround;
        this.onGround = false;
        // перенос стоящего на теле
        let carryX = 0, carryY = 0, carryZ = 0;
        if (this.groundBody && wasGround && typeof VoxPhysics !== 'undefined') {
            const pv = VoxPhysics.pointVelocity(this.groundBody, this.pos.x, this.pos.y, this.pos.z);
            carryX = pv[0]; carryY = Math.min(0, pv[1]); carryZ = pv[2];
        }
        this.groundBody = null;
        // движение по осям мелкими шагами (не проскочить тонкую стену)
        const total = Math.max(Math.abs(v.x + carryX), Math.abs(v.y + carryY), Math.abs(v.z + carryZ)) * dt;
        const n = Math.max(1, Math.ceil(total / (this.vs * 0.45)));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
            this._moveAxis(1, (v.y + carryY) * h);
            this._moveAxis(0, (v.x + carryX) * h);
            this._moveAxis(2, (v.z + carryZ) * h);
        }
        // проверка земли под ногами (для «на земле» без движения вниз)
        if (!this.onGround && v.y <= 0 && this._hitsWorld(this.pos.x, this.pos.y - 0.02, this.pos.z, 0.05)) this.onGround = true;
        if (typeof VoxPhysics !== 'undefined') VoxPhysics.playerContacts(this, dt);
        if (this.onGround && !wasGround && fallSpeed > 3) {
            this.landDip = Math.min(0.22, fallSpeed * 0.02);
            if (typeof GameAudio !== 'undefined') GameAudio.land(this.groundMat, Math.min(1, fallSpeed / 14));
        }
        if (this.onGround) this.groundMat = this._matUnder();
        // шаги
        const hs = Math.hypot(v.x, v.z);
        if (this.onGround && hs > 0.5) {
            this.stepDist += hs * dt;
            const stride = keys.sprint ? 1.9 : 1.45;
            if (this.stepDist > stride) {
                this.stepDist = 0;
                if (typeof GameAudio !== 'undefined') GameAudio.footstep(this.groundMat, Math.min(1, hs / 7.4));
            }
        }
        this.fovBoost += ((keys.sprint && hs > 5 ? 0.08 : 0) - this.fovBoost) * Math.min(1, dt * 6);
        this._camFx(dt, this.onGround ? hs : 0);
    }

    _matUnder() {
        const k = 1 / this.vs;
        const v = this.world.get(Math.floor(this.pos.x * k), Math.floor((this.pos.y - 0.05) * k), Math.floor(this.pos.z * k));
        return v ? VoxMat.of(v).sound : (this.groundBody ? this.groundBody.sound : 'grass');
    }

    _camFx(dt, hs) {
        this.eyeLift += (0 - this.eyeLift) * Math.min(1, dt * 12);
        this.landDip += (0 - this.landDip) * Math.min(1, dt * 7);
        const amp = Math.min(1, hs / 7) * 0.045;
        this.bobAmp += (amp - this.bobAmp) * Math.min(1, dt * 8);
        this.bob += dt * (hs > 5 ? 13 : 10);
        this.kick += (0 - this.kick) * Math.min(1, dt * 10);
        this.kickYaw += (0 - this.kickYaw) * Math.min(1, dt * 10);
        this.trauma = Math.max(0, this.trauma - dt * 0.9);
        const t = performance.now() / 1000, s = this.trauma * this.trauma;
        this._shake.x = s * 0.06 * (Math.sin(t * 37.1) + Math.sin(t * 23.7) * 0.5);
        this._shake.y = s * 0.06 * (Math.sin(t * 31.3 + 1.7) + Math.sin(t * 19.1) * 0.5);
        this._shake.r = s * 0.05 * Math.sin(t * 27.9 + 0.4);
    }

    /** Камера: позиция и поворот (кватернион из yaw/pitch с качанием, отдачей и тряской). */
    applyCamera(cam) {
        const e = this.eye;
        const bobY = Math.sin(this.bob * 2) * this.bobAmp * 0.6, bobX = Math.cos(this.bob) * this.bobAmp * 0.5;
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        cam.position.set(e.x + cy * bobX, e.y + bobY, e.z - sy * bobX);
        const yaw = this.yaw + this.kickYaw + this._shake.x;
        const pitch = this.pitch + this.kick + this._shake.y;
        // правосторонняя: взгляд −z при yaw 0; поворот: yaw вокруг Y, pitch вокруг X
        BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, GamePlayer.PITCH_SIGN * pitch,this._shake.r + Math.cos(this.bob) * this.bobAmp * 0.25, cam.rotationQuaternion);
        cam.fov = ((typeof RL_FOV !== 'undefined' ? RL_FOV : 1.12) + this.fovBoost) * this.fovMul;
    }
}
/** Знак наклона для кватерниона камеры (правосторонняя сцена Babylon). */
GamePlayer.PITCH_SIGN = 1;
