export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.engineNodes = new Map();
    this.windGain = null;
    this.masterGain = null;
  }

  start() {
    if (this.started) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.55;
    this.masterGain.connect(this.ctx.destination);

    const bufferSize = 2 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer; noise.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 800;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(windFilter).connect(this.windGain).connect(this.masterGain);
    noise.start();

    this.started = true;
  }

  ensureEngine(carId, isPlayer) {
    if (!this.started || this.engineNodes.has(carId)) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'square';
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    osc.connect(filter); osc2.connect(filter);
    filter.connect(gain).connect(this.masterGain);
    osc.start(); osc2.start();
    this.engineNodes.set(carId, { osc, osc2, gain, filter, isPlayer });
  }

  updateEngine(carId, rpm01, speedKmh, isPlayer) {
    if (!this.started) return;
    this.ensureEngine(carId, isPlayer);
    const node = this.engineNodes.get(carId);
    const baseFreq = 70 + rpm01 * 260;
    node.osc.frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.03);
    node.osc2.frequency.setTargetAtTime(baseFreq * 1.5, this.ctx.currentTime, 0.03);
    node.filter.frequency.setTargetAtTime(500 + rpm01 * 3500, this.ctx.currentTime, 0.05);
    const vol = isPlayer ? 0.16 + rpm01 * 0.12 : 0;
    node.gain.gain.setTargetAtTime(isPlayer ? vol : 0.03 + rpm01 * 0.02, this.ctx.currentTime, 0.05);
    if (isPlayer && this.windGain) {
      this.windGain.gain.setTargetAtTime(Math.min(0.18, speedKmh / 900), this.ctx.currentTime, 0.1);
    }
  }

  playCrash() {
    if (!this.started) return;
    const bufferSize = this.ctx.sampleRate * 0.3;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(gain).connect(this.masterGain);
    src.start();
  }

  playPitBeep() {
    if (!this.started) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = 880;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.2;
    osc.connect(gain).connect(this.masterGain);
    osc.start();
    gain.gain.setTargetAtTime(0, this.ctx.currentTime + 0.08, 0.05);
    osc.stop(this.ctx.currentTime + 0.3);
  }
}
