(() => {
  'use strict';

  // ==================== 共通: 音名/周波数ユーティリティ ====================

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const A4 = 440;

  // 周波数 -> { noteName, octave, cents, midi }
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

  // ==================== プリセット定義 ====================
  // TAB譜面と同じ並び：配列の先頭が1弦（一番上に表示される）。

  const PRESETS = {
    guitar: [
      { label: '1弦', note: 'E4', midi: 64 },
      { label: '2弦', note: 'B3', midi: 59 },
      { label: '3弦', note: 'G3', midi: 55 },
      { label: '4弦', note: 'D3', midi: 50 },
      { label: '5弦', note: 'A2', midi: 45 },
      { label: '6弦', note: 'E2', midi: 40 },
    ],
    bass: [
      { label: '1弦', note: 'G2', midi: 43 },
      { label: '2弦', note: 'D2', midi: 38 },
      { label: '3弦', note: 'A1', midi: 33 },
      { label: '4弦', note: 'E1', midi: 28 },
    ],
    ukulele: [
      { label: '1弦', note: 'A4', midi: 69 },
      { label: '2弦', note: 'E4', midi: 64 },
      { label: '3弦', note: 'C4', midi: 60 },
      { label: '4弦', note: 'G4', midi: 67 },
    ],
    chromatic: (() => {
      // 管楽器向け、高い音から低い音の順（B5 〜 C3）
      const arr = [];
      for (let m = 83; m >= 48; m--) {
        const name = NOTE_NAMES[((m % 12) + 12) % 12];
        const oct = Math.floor(m / 12) - 1;
        arr.push({ label: `${name}${oct}`, note: `${name}${oct}`, midi: m });
      }
      return arr;
    })(),
  };

  // ==================== モード切替（下部固定コントロール） ====================

  const screenMic = document.getElementById('screen-mic');
  const screenTone = document.getElementById('screen-tone');
  const btnStartMic2 = document.getElementById('btnStartMic2');
  const btnToneMode = document.getElementById('btnToneMode');
  const btnStopMic2 = document.getElementById('btnStopMic2');

  let currentMode = 'mic';

  function setMode(mode) {
    currentMode = mode;
    screenMic.hidden = mode !== 'mic';
    screenTone.hidden = mode !== 'tone';

    btnStartMic2.classList.toggle('is-active', mode === 'mic');
    btnToneMode.classList.toggle('is-active', mode === 'tone');

    if (mode !== 'tone') stopTone();

    // マイクモードに切り替えたときは、許可済みなら継続、未許可ならパーミッション画面のまま
    if (mode !== 'mic' && micStream) {
      // 発信音モード中もバックグラウンドでマイクは動かさない（音の干渉防止）
      stopMic();
    }
    updateBottomStopBtn();
  }

  function updateBottomStopBtn() {
    // マイク稼働中のみ「停止」ボタンを表示
    btnStopMic2.hidden = !(currentMode === 'mic' && micStream);
  }

  btnStartMic2.addEventListener('click', () => {
    setMode('mic');
    if (!micStream) startMic();
  });
  btnToneMode.addEventListener('click', () => setMode('tone'));
  btnStopMic2.addEventListener('click', () => stopMic());

  // ==================== マイクチューナー ====================

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
      micErrorNote.textContent = 'マイクへのアクセスが許可されませんでした';
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
    centsDisplay.textContent = '音を鳴らしてください';
    meterWrap.removeAttribute('data-state');
    updateBottomStopBtn();
  }

  btnStartMic.addEventListener('click', startMic);

  // 自己相関法によるピッチ検出
  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.008) return -1; // 無音判定

    // トリミング: 音量が小さい端を除去
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

    // 放物線補間で精度向上
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
  const SILENCE_RESET_FRAMES = 45; // 約0.75秒無音が続いたら待機表示に戻す

  function tickMic() {
    micRafId = requestAnimationFrame(tickMic);
    analyser.getFloatTimeDomainData(dataBuf);
    const freq = autoCorrelate(dataBuf, micAudioCtx.sampleRate);

    if (freq === -1 || freq < 30 || freq > 2000) {
      micSilenceFrames++;
      if (micSilenceFrames === SILENCE_RESET_FRAMES) {
        noteDisplay.textContent = '—';
        freqValue.textContent = '0.0';
        centsDisplay.textContent = '音を鳴らしてください';
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

    // 針: -50cent 〜 +50cent を -90deg 〜 +90deg にマッピング
    const clamped = Math.max(-50, Math.min(50, cents));
    const angle = (clamped / 50) * 80;
    needle.style.transform = `rotate(${angle}deg)`;

    let state = 'in';
    if (cents < -6) state = 'flat';
    else if (cents > 6) state = 'sharp';
    meterWrap.dataset.state = state;
  }

  // ==================== 発信音（音叉） ====================

  const presetTabs = document.getElementById('presetTabs');
  const stringList = document.getElementById('stringList');
  const toneNow = document.getElementById('toneNow');
  const toneNowNote = document.getElementById('toneNowNote');
  const toneNowFreq = document.getElementById('toneNowFreq');
  const btnStopTone = document.getElementById('btnStopTone');

  let toneAudioCtx = null;
  let toneOsc = null;
  let toneGain = null;
  let currentPreset = 'guitar';
  let playingRow = null;

  function renderStringList(presetKey) {
    stringList.innerHTML = '';
    const items = PRESETS[presetKey];
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
      row.addEventListener('click', () => playTone(freq, item.note, row));
      stringList.appendChild(row);
    });
  }

  presetTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.preset-tab');
    if (!tab) return;
    document.querySelectorAll('.preset-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    currentPreset = tab.dataset.preset;
    stopTone();
    renderStringList(currentPreset);
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
    // サイン波は倍音がなく小型スピーカーでは聞き取りにくいため、
    // 基音を少し含む三角波にして聞こえやすくする
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

  // 初期描画
  renderStringList(currentPreset);

})();
