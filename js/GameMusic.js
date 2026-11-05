// GameMusic.js — воспроизведение звука из готовых файлов: музыка, фон и голоса лежат в assets/sounds/baked (GameAudioBaked.js),
// их готовит tools/bake-audio.mjs. Подключается после GameAudio.js: подменяет сборку буферов на загрузку файлов.

(function () {
    const A = /** @type {any} */ (GameAudio);

    A.MUSIC = {
        menu: { vol: 0.95, fade: 1.6 }, play: { vol: 1, fade: 1.8 }, play2: { vol: 1, fade: 1.8 }, play3: { vol: 1, fade: 2.2 },
        tense: { vol: 1, fade: 0.7 }, results: { vol: 0.85, fade: 0.9 }, fail: { vol: 0.85, fade: 0.9 },
    };

    /** Запас файла вокруг петли: tools/bake-audio.mjs (PAD) плюс задержка кодека. */
    const PAD = 0.3, CODEC = 0.06;
    const baked = typeof GAME_AUDIO_BAKED !== 'undefined' ? GAME_AUDIO_BAKED : null;

    if (baked) {
        /** Файл -> буфер под именем 'synth:имя'; колбэки ждут конца загрузки. */
        const waiting = {};
        const fetchBaked = (name, cb) => {
            if (A._have[name]) { if (cb) cb(); return; }
            const rec = baked[name];
            if (!rec) return;
            if (waiting[name]) { if (cb) waiting[name].push(cb); return; }
            waiting[name] = cb ? [cb] : [];
            Sound.load(rec[0]).then(buf => {
                const list = waiting[name];
                delete waiting[name];
                if (!buf) { A._bad[name] = true; return; }
                Sound.putBuffer(name, buf);
                if (rec[1] > 0) Sound.loopPts.set('synth:' + name, [PAD + CODEC, PAD + CODEC + rec[1]]);
                A._have[name] = true;
                A._synUrls = {};
                for (const f of list) { try { f(); } catch (e) { /* тишина */ } }
            });
        };
        A._need = function (name) { if (!A._have[name]) fetchBaked(name); return !!A._have[name]; };
        A._needAsync = function (name, prio, cb) { fetchBaked(name, cb); };
        A._warm = function () {};
        const reg = A._register;
        A._register = function () {
            reg.call(A);
            // короткие голоса — сразу, в фоне; музыка и фон — по запросу
            for (const name in baked) if (!/^ga-(mus|amb)-/.test(name)) fetchBaked(name);
        };
    }

    /** Вкл/выкл только музыку (настройка «Музыка»; звук эффектов не трогает). */
    A.musicOff = false;
    A.setMusicOn = function (on) {
        A.musicOff = !on;
        if (!on) { const had = A._wantMusic; A._musicKind = ''; if (typeof Sound !== 'undefined' && Sound.music) Sound.music(null, { fade: 0.4 }); A._wantMusic = had; }
        else if (A._wantMusic) { const w = A._wantMusic; A._musicKind = ''; A.music(w); }
    };
    /** Удар сердца: зовёт HUD при малом здоровье. */
    A.heartbeat = function () {
        if (typeof Sound === 'undefined' || !Sound.play) return;
        A._needAsync('ga-heart', 0, () => Sound.play(['synth:ga-heart'], { volume: 0.75 }));
    };
})();
