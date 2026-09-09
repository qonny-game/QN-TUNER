(() => {
  'use strict';

  // ==================== Shared: note name / frequency utilities ====================

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const A4 = 440;

  // frequency -> { noteName, octave, cents, midi }
  function freqToNote(freq) {
    const midi = 69 + 12 * Math.log2(freq / A4);
    const roundedMidi = Math.round(midi);
    const cents = Math.round((midi - roundedMidi) * 100);
    const noteName = NOTE_NAMES[((roundedMidi % 12) + 12) % 12];
    const octave = Math.floor(roundedMidi / 12) - 1;
    return { noteName, octave, cents, midi: roundedMidi };
  }

  function noteToFreq(midi) {
    return A4 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToNoteName(midi) {
    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${name}${oct}`;
  }

  // ==================== Preset definitions ====================
  // Ordered like a TAB chart: the first array item is string 1 (shown at the top).
  // Base MIDI values are already one octave above standard tuning.

  const BASE_STRINGS = {
    guitar: [
      { label: 'String 1', midi: 76 }, // E5
      { label: 'String 2', midi: 71 }, // B4
      { label: 'String 3', midi: 67 }, // G4
      { label: 'String 4', midi: 62 }, // D4
      { label: 'String 5', midi: 57 }, // A3
      { label: 'String 6', midi: 52 }, // E3
    ],
    bass: [
      { label: 'String 1', midi: 55 }, // G3
      { label: 'String 2', midi: 50 }, // D3
      { label: 'String 3', midi: 45 }, // A2
      { label: 'String 4', midi: 40 }, // E2
    ],
    ukulele: [
      { label: 'String 1', midi: 69 }, // A4
      { label: 'String 2', midi: 64 }, // E4
      { label: 'String 3', midi: 60 }, // C4
      { label: 'String 4', midi: 67 }, // G4
    ],
  };

  // Tuning variants: an offset applied to all strings, plus an extra drop on the lowest string only
  const TUNING_VARIANTS = {
    guitar: [
      { key: 'regular', label: 'Regular',  allOffset: 0, dropLastOffset: 0 },
      { key: 'half',    label: 'Half Down', allOffset: -1, dropLastOffset: 0 },
      { key: 'whole',   label: 'Whole Down', allOffset: -2, dropLastOffset: 0 },
      { key: 'dropD',   label: 'Drop D',   allOffset: 0, dropLastOffset: -2 },
      { key: 'dropCs',  label: 'Drop C#',  allOffset: -1, dropLastOffset: -2 },
      { key: 'dropC',   label: 'Drop C',   allOffset: -2, dropLastOffset: -2 },
    ],
    bass: [
      { key: 'regular', label: 'Regular',  allOffset: 0, dropLastOffset: 0 },
      { key: 'half',    label: 'Half Down', allOffset: -1, dropLastOffset: 0 },
      { key: 'whole',   label: 'Whole Down', allOffset: -2, dropLastOffset: 0 },
      { key: 'dropD',   label: 'Drop D',   allOffset: 0, dropLastOffset: -2 },
      { key: 'dropCs',  label: 'Drop C#',  allOffset: -1, dropLastOffset: -2 },
      { key: 'dropC',   label: 'Drop C',   allOffset: -2, dropLastOffset: -2 },
    ],
  };

  function buildStringSet(instrumentKey, variantKey) {
    const base = BASE_STRINGS[instrumentKey];
    const variants = TUNING_VARIANTS[instrumentKey];
    const variant = (variants || []).find(v => v.key === variantKey) || { allOffset: 0, dropLastOffset: 0 };
    const lastIndex = base.length - 1;
    return base.map((s, i) => {
      const offset = variant.allOffset + (i === lastIndex ? variant.dropLastOffset : 0);
      const midi = s.midi + offset;
      return { label: s.label, note: midiToNoteName(midi), midi };
    });
  }

  const CHROMATIC_LIST = (() => {
    // For wind instruments, high to low (B5 down to C3)
    const arr = [];
    for (let m = 83; m >= 48; m--) {
      arr.push({ label: midiToNoteName(m), note: midiToNoteName(m), midi: m });
    }
    return arr;
  })();

  // ==================== Mode switch (bottom fixed control) ====================

  const screenMic = document.getElementById('screen-mic');
  const screenTone = document.getElementById('screen-tone');
  const btnStartMic2 = document.getElementById('btnStartMic2');
  const btnToneMode = document.getElementById('btnToneMode');
  const btnStopMic2 = document.getElementById('btnStopMic2');

  const MODE_STORAGE_KEY = 'qntuner_last_mode';
  const DESKTOP_BREAKPOINT = '(min-width: 901px)';

  function isDesktopLayout() {
    return window.matchMedia(DESKTOP_BREAKPOINT).matches;
  }

  // Default to Tone on first visit; after that, remember whichever mode was last open.
  // On desktop layout both screens are shown side by side, so mode only matters on mobile.
  let currentMode = 'tone';
  try {
    const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
    if (savedMode === 'mic' || savedMode === 'tone') currentMode = savedMode;
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) — fall back to the Tone default
  }

  function setMode(mode) {
    currentMode = mode;
    screenMic.hidden = mode !== 'mic';
    screenTone.hidden = mode !== 'tone';

    btnStartMic2.classList.toggle('is-active', mode === 'mic');
    btnToneMode.classList.toggle('is-active', mode === 'tone');

    // On mobile, mic and tone are mutually exclusive to avoid audio interference.
    // On desktop layout both panels are visible at once, so leave whichever is
    // already running (mic or tone) alone when the person interacts with the other.
    if (!isDesktopLayout()) {
      if (mode !== 'tone') stopTone();
      if (mode !== 'mic' && micStream) stopMic();
    }
    updateBottomStopBtn();

    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch (e) {
      // ignore if storage is unavailable
    }
  }

  function updateBottomStopBtn() {
    // Only show the "Stop" button while the mic is running
    btnStopMic2.hidden = !(currentMode === 'mic' && micStream);
  }

  btnStartMic2.addEventListener('click', () => {
    setMode('mic');
    if (!micStream) startMic();
  });
  btnToneMode.addEventListener('click', () => setMode('tone'));
  btnStopMic2.addEventListener('click', () => stopMic());

  // ==================== Mic tuner ====================

  const btnStartMic = document.getElementById('btnStartMic');
  const micPermission = document.getElementById('micPermission');
  const meterWrap = document.getElementById('meterWrap');
  const micErrorNote = document.getElementById('micErrorNote');
  const needle = document.getElementById('needle');
  const noteDisplay = document.getElementById('noteDisplay');
  const freqValue = document.getElementById('freqValue');
  const centsDisplay = document.getElementById('centsDisplay');

  let micAudioCtx = null;
  let micStream = null;
  let analyser = null;
  let micRafId = null;
  let dataBuf = null;

  async function startMic() {
    micErrorNote.textContent = '';
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
    } catch (err) {
      micErrorNote.textContent = 'Microphone access was not granted';
      return;
    }

    micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = micAudioCtx.createMediaStreamSource(micStream);
    analyser = micAudioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    dataBuf = new Float32Array(analyser.fftSize);

    micPermission.hidden = true;
    meterWrap.hidden = false;
    updateBottomStopBtn();

    tickMic();
  }

  function stopMic() {
    if (micRafId) cancelAnimationFrame(micRafId);
    micRafId = null;
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (micAudioCtx) {
      micAudioCtx.close();
      micAudioCtx = null;
    }
    meterWrap.hidden = true;
    micPermission.hidden = false;
    needle.style.transform = 'rotate(0deg)';
    noteDisplay.textContent = '—';
    freqValue.textContent = '0.0';
    centsDisplay.textContent = 'Play a note';
    meterWrap.removeAttribute('data-state');
    updateBottomStopBtn();
  }

  btnStartMic.addEventListener('click', startMic);

  const btnStopMicInline = document.getElementById('btnStopMicInline');
  if (btnStopMicInline) btnStopMicInline.addEventListener('click', stopMic);

  // Pitch detection via autocorrelation
  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.008) return -1; // treat as silence

    // Trim: drop the low-amplitude edges
    let r1 = 0, r2 = SIZE - 1;
    const threshold = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buf[i]) > threshold) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buf[SIZE - i]) > threshold) { r2 = SIZE - i; break; }
    }
    const trimmed = buf.slice(r1, r2);
    const n = trimmed.length;

    const c = new Array(n).fill(0);
    for (let lag = 0; lag < n; lag++) {
      for (let i = 0; i < n - lag; i++) {
        c[lag] += trimmed[i] * trimmed[i + lag];
      }
    }

    let d = 0;
    while (d < n - 1 && c[d] > c[d + 1]) d++;

    let maxVal = -1, maxPos = -1;
    for (let i = d; i < n; i++) {
      if (c[i] > maxVal) {
        maxVal = c[i];
        maxPos = i;
      }
    }
    let T0 = maxPos;

    // Parabolic interpolation for better precision
    if (T0 > 0 && T0 < n - 1) {
      const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
      const a = (x1 + x3 - 2 * x2) / 2;
      const b = (x3 - x1) / 2;
      if (a !== 0) T0 = T0 - b / (2 * a);
    }

    if (T0 <= 0) return -1;
    return sampleRate / T0;
  }

  let micSilenceFrames = 0;
  const SILENCE_RESET_FRAMES = 45; // reset to the waiting state after ~0.75s of silence

  function tickMic() {
    micRafId = requestAnimationFrame(tickMic);
    analyser.getFloatTimeDomainData(dataBuf);
    const freq = autoCorrelate(dataBuf, micAudioCtx.sampleRate);

    if (freq === -1 || freq < 30 || freq > 2000) {
      micSilenceFrames++;
      if (micSilenceFrames === SILENCE_RESET_FRAMES) {
        noteDisplay.textContent = '—';
        freqValue.textContent = '0.0';
        centsDisplay.textContent = 'Play a note';
        needle.style.transform = 'rotate(0deg)';
        meterWrap.removeAttribute('data-state');
      }
      return;
    }
    micSilenceFrames = 0;

    const { noteName, octave, cents } = freqToNote(freq);
    noteDisplay.textContent = `${noteName}${octave}`;
    freqValue.textContent = freq.toFixed(1);
    centsDisplay.textContent = `${cents > 0 ? '+' : ''}${cents} cent`;

    // Needle: map -50..+50 cents to -80..+80 degrees
    const clamped = Math.max(-50, Math.min(50, cents));
    const angle = (clamped / 50) * 80;
    needle.style.transform = `rotate(${angle}deg)`;

    let state = 'in';
    if (cents < -6) state = 'flat';
    else if (cents > 6) state = 'sharp';
    meterWrap.dataset.state = state;
  }

  // ==================== Tone generator ====================

  const presetTabs = document.getElementById('presetTabs');
  const tuningTabs = document.getElementById('tuningTabs');
  const stringList = document.getElementById('stringList');
  const toneNow = document.getElementById('toneNow');
  const toneNowNote = document.getElementById('toneNowNote');
  const toneNowFreq = document.getElementById('toneNowFreq');
  const btnStopTone = document.getElementById('btnStopTone');

  const PRESET_ORDER = ['guitar', 'bass', 'ukulele', 'chromatic'];

  let toneAudioCtx = null;
  let toneOsc = null;
  let toneGain = null;
  let currentPreset = 'guitar';
  let currentTuning = 'regular';
  let playingRow = null;

  function getCurrentStringSet() {
    if (currentPreset === 'chromatic') return CHROMATIC_LIST;
    if (currentPreset === 'ukulele') return buildStringSet('ukulele', 'regular');
    return buildStringSet(currentPreset, currentTuning);
  }

  function renderTuningTabs() {
    const variants = TUNING_VARIANTS[currentPreset];
    if (!variants) {
      tuningTabs.hidden = true;
      tuningTabs.innerHTML = '';
      return;
    }
    tuningTabs.hidden = false;
    tuningTabs.innerHTML = '';
    variants.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'tuning-tab' + (v.key === currentTuning ? ' is-active' : '');
      btn.textContent = v.label;
      btn.dataset.tuning = v.key;
      tuningTabs.appendChild(btn);
    });
  }

  function renderStringList() {
    stringList.innerHTML = '';
    const items = getCurrentStringSet();
    items.forEach((item, index) => {
      const row = document.createElement('button');
      row.className = 'string-row';
      const freq = noteToFreq(item.midi);
      row.innerHTML = `
        <span class="string-row-left">
          <span class="string-row-order">${index + 1}</span>
          <span class="string-row-note">${item.note}</span>
          <span class="string-row-label">${item.label}</span>
        </span>
        <span class="string-row-freq">${freq.toFixed(1)} Hz</span>
      `;
      row.addEventListener('click', () => {
        if (playingRow === row) {
          // Tapping the currently playing string again toggles it off
          stopTone();
        } else {
          playTone(freq, item.note, row);
        }
      });
      stringList.appendChild(row);
    });
  }

  function selectPreset(presetKey) {
    if (!PRESET_ORDER.includes(presetKey) || presetKey === currentPreset) return;
    document.querySelectorAll('.preset-tab').forEach(t => {
      t.classList.toggle('is-active', t.dataset.preset === presetKey);
    });
    currentPreset = presetKey;
    currentTuning = 'regular';
    stopTone();
    renderTuningTabs();
    renderStringList();
  }

  presetTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.preset-tab');
    if (!tab) return;
    selectPreset(tab.dataset.preset);
  });

  function selectTuning(tuningKey) {
    const variants = TUNING_VARIANTS[currentPreset];
    if (!variants || !variants.some(v => v.key === tuningKey) || tuningKey === currentTuning) return;
    document.querySelectorAll('.tuning-tab').forEach(t => {
      t.classList.toggle('is-active', t.dataset.tuning === tuningKey);
    });
    currentTuning = tuningKey;
    stopTone();
    renderStringList();
  }

  tuningTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tuning-tab');
    if (!tab) return;
    selectTuning(tab.dataset.tuning);
  });

  function playTone(freq, noteLabel, row) {
    stopTone();

    if (!toneAudioCtx) {
      toneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (toneAudioCtx.state === 'suspended') {
      toneAudioCtx.resume();
    }

    toneOsc = toneAudioCtx.createOscillator();
    toneGain = toneAudioCtx.createGain();
    // A pure sine wave has no harmonics and is hard to hear on small speakers,
    // so use a triangle wave, which carries a bit of the fundamental's overtones
    toneOsc.type = 'triangle';
    toneOsc.frequency.value = freq;
    toneGain.gain.setValueAtTime(0, toneAudioCtx.currentTime);
    toneGain.gain.linearRampToValueAtTime(0.7, toneAudioCtx.currentTime + 0.03);
    toneOsc.connect(toneGain);
    toneGain.connect(toneAudioCtx.destination);
    toneOsc.start();

    row.classList.add('is-playing');
    playingRow = row;

    toneNow.hidden = false;
    toneNowNote.textContent = noteLabel;
    toneNowFreq.textContent = freq.toFixed(1);
  }

  function stopTone() {
    if (toneGain && toneAudioCtx) {
      toneGain.gain.linearRampToValueAtTime(0, toneAudioCtx.currentTime + 0.03);
    }
    if (toneOsc) {
      const osc = toneOsc;
      setTimeout(() => { try { osc.stop(); } catch (e) {} }, 50);
      toneOsc = null;
    }
    if (playingRow) {
      playingRow.classList.remove('is-playing');
      playingRow = null;
    }
    toneNow.hidden = true;
  }

  btnStopTone.addEventListener('click', stopTone);

  // ==================== Keyboard shortcuts (Tone screen only) ====================
  // 1-9: toggle the string/note at that position in the currently displayed list
  //      (numbers beyond the list length do nothing)
  // Space: stop whatever is currently sounding
  // Left/Right: switch preset (Guitar / Bass / Ukulele / Wind)
  // Up/Down: cycle through tuning variants (Regular / Half Down / Whole Down / Drop D / ...)

  document.addEventListener('keydown', (e) => {
    // On mobile these shortcuts only make sense while the Tone screen is showing;
    // on desktop layout, Tone is always visible alongside Mic, so always allow them.
    if (!isDesktopLayout() && currentMode !== 'tone') return;
    if (e.repeat) return;

    // Space: stop current tone
    if (e.code === 'Space') {
      e.preventDefault();
      stopTone();
      return;
    }

    // Left/Right: cycle through presets
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const idx = PRESET_ORDER.indexOf(currentPreset);
      const dir = e.code === 'ArrowLeft' ? -1 : 1;
      const nextIdx = (idx + dir + PRESET_ORDER.length) % PRESET_ORDER.length;
      selectPreset(PRESET_ORDER[nextIdx]);
      return;
    }

    // Up/Down: cycle through tuning variants, when the current preset has any
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      const variants = TUNING_VARIANTS[currentPreset];
      if (!variants || variants.length === 0) return;
      e.preventDefault();
      const idx = variants.findIndex(v => v.key === currentTuning);
      const dir = e.code === 'ArrowUp' ? -1 : 1;
      const nextIdx = (idx + dir + variants.length) % variants.length;
      selectTuning(variants[nextIdx].key);
      return;
    }

    // 1-9: toggle the note at that position in the on-screen list, top to bottom.
    // Positions beyond the current list's length are simply ignored.
    if (/^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      const position = parseInt(e.code.replace('Digit', ''), 10);
      const rows = stringList.querySelectorAll('.string-row');
      const row = rows[position - 1];
      if (!row) return;
      row.click();
    }
  });

  // Initial render
  renderTuningTabs();
  renderStringList();

  // Apply the mode determined above (Tone by default, or whichever was last used)
  setMode(currentMode);


})();
