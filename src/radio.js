// The dashboard radio. A retro walnut-and-chrome head unit that tunes the
// world: stations are landscapes, knobs set volume and cruise speed, button
// rows pick the time of day and the weather. AUTO/SCAN hands it all back to
// the music. The markup and styles live in index.html; this wires it up.
import { TIME_NAMES, WEATHER_NAMES, LAND_NAMES, STATION_FREQS, SPEED_LEVELS } from './environment.js';

const WX_SHORT = ['CLR', 'CLD', 'FOG', 'RN', 'SNW', 'STM'];
const TIME_SHORT = ['DAWN', 'DAY', 'DUSK', 'NITE'];

export function makeRadio(handlers) {
  const el = document.getElementById('radio');
  const $ = (sel) => el.querySelector(sel);
  const click = () => handlers.onClickSound && handlers.onClickSound();

  const button = (parent, text, cls, onClick) => {
    const b = document.createElement('button');
    if (cls) b.className = cls;
    b.textContent = text;
    b.addEventListener('click', () => { click(); onClick(); });
    parent.appendChild(b);
    return b;
  };

  // stations row + SCAN
  const stationsEl = $('#r-stations');
  const stBtns = LAND_NAMES.map((name, i) => {
    const b = document.createElement('button');
    b.className = 'r-st';
    const f = document.createElement('b');
    f.textContent = STATION_FREQS[i];
    b.appendChild(f);
    b.appendChild(document.createTextNode(name));
    b.addEventListener('click', () => { click(); handlers.onLandscape(i); });
    stationsEl.appendChild(b);
    return b;
  });
  const scanBtn = button(stationsEl, 'SCAN', 'r-st r-auto', () => handlers.onLandscape('auto'));

  // time + weather rows
  const timeEl = $('#r-time');
  const timeBtns = TIME_SHORT.map((name, i) => button(timeEl, name, '', () => handlers.onTime(i)));
  const timeAuto = button(timeEl, 'AUTO', 'r-auto', () => handlers.onTime('auto'));

  const wxEl = $('#r-wx');
  const wxBtns = WX_SHORT.map((name, i) => button(wxEl, name, '', () => handlers.onWeather(i)));
  const wxAuto = button(wxEl, 'AUTO', 'r-auto', () => handlers.onWeather('auto'));

  // track row: prev / next / auto
  const trkEl = $('#r-trk');
  button(trkEl, '◂', '', () => handlers.onTrack(-1));
  button(trkEl, '▸', '', () => handlers.onTrack(1));
  const trkAuto = button(trkEl, 'AUTO', 'r-auto', () => handlers.onTrack('auto'));

  // ---- knobs ----
  const volKnob = $('#r-vol');
  const volCap = volKnob.querySelector('.r-knob-cap');
  let volume = 0.9;
  const setVolVisual = () => { volCap.style.transform = `rotate(${-135 + volume * 270}deg)`; };
  setVolVisual();
  volKnob.addEventListener('pointerdown', (e) => {
    let dragged = false;
    const startY = e.clientY;
    const startV = volume;
    const move = (ev) => {
      if (Math.abs(ev.clientY - startY) > 3) dragged = true;
      volume = Math.max(0, Math.min(1, startV + (startY - ev.clientY) * 0.008));
      setVolVisual();
      handlers.onVolume(volume);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragged) { click(); handlers.onToggleMute(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  });
  volKnob.addEventListener('wheel', (e) => {
    e.preventDefault();
    volume = Math.max(0, Math.min(1, volume - Math.sign(e.deltaY) * 0.06));
    setVolVisual();
    handlers.onVolume(volume);
  }, { passive: false });

  const spdKnob = $('#r-spd');
  const spdCap = spdKnob.querySelector('.r-knob-cap');
  let speedIdx = 1;
  const setSpdVisual = () => { spdCap.style.transform = `rotate(${-120 + speedIdx * 80}deg)`; };
  setSpdVisual();
  const bumpSpeed = (dir) => {
    speedIdx = Math.max(0, Math.min(SPEED_LEVELS.length - 1, speedIdx + dir));
    setSpdVisual();
    click();
    handlers.onSpeed(speedIdx);
  };
  spdKnob.addEventListener('click', () => bumpSpeed(speedIdx === SPEED_LEVELS.length - 1 ? -3 : 1));
  spdKnob.addEventListener('wheel', (e) => {
    e.preventDefault();
    bumpSpeed(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // tuner strip: click to tune to the nearest station
  const tuner = $('#r-tuner');
  const STOPS = [0.08, 0.29, 0.5, 0.71, 0.92];
  tuner.addEventListener('click', (e) => {
    const r = tuner.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    let best = 0;
    for (let i = 1; i < 5; i++) if (Math.abs(x - STOPS[i]) < Math.abs(x - STOPS[best])) best = i;
    click();
    handlers.onLandscape(best);
  });

  $('#r-tab').addEventListener('click', () => { click(); el.classList.toggle('closed'); });

  // EQ bars dance with the music
  const eqBars = el.querySelectorAll('.r-eq i');
  const eqLevels = [0.3, 0.5, 0.4, 0.6, 0.35];
  (function eqTick() {
    const pulse = handlers.getPulse ? handlers.getPulse() : 0.2;
    for (let i = 0; i < eqBars.length; i++) {
      const target = 0.15 + pulse * (0.4 + Math.random() * 0.6);
      eqLevels[i] += (target - eqLevels[i]) * 0.25;
      eqBars[i].style.height = `${Math.round(3 + eqLevels[i] * 11)}px`;
    }
    requestAnimationFrame(eqTick);
  })();

  const needle = $('#r-needle');
  const freqEl = $('#r-freq');
  const stationEl = $('#r-station');
  const subEl = $('#r-sub');
  const trackEl = $('#r-track');

  function setState(s) {
    needle.style.left = `${(s.needle01 * 100).toFixed(2)}%`;
    freqEl.textContent = STATION_FREQS[s.landIdx];
    stationEl.textContent = s.tuned ? LAND_NAMES[s.landIdx] : 'TUNING···';
    subEl.textContent =
      `${TIME_NAMES[s.timeIdx]} · ${WEATHER_NAMES[s.weatherIdx]} · CRUISE ${SPEED_LEVELS[s.speedIdx].label}` +
      (s.muted ? ' · MUTE' : '');
    stBtns.forEach((b, i) => b.classList.toggle('on', s.tuned && i === s.landIdx && !s.autoLand));
    scanBtn.classList.toggle('on', s.autoLand);
    timeBtns.forEach((b, i) => b.classList.toggle('on', !s.autoTime && i === s.timeIdx));
    timeAuto.classList.toggle('on', s.autoTime);
    wxBtns.forEach((b, i) => b.classList.toggle('on', !s.autoWeather && i === s.weatherIdx));
    wxAuto.classList.toggle('on', s.autoWeather);
    trackEl.textContent = `♪ ${s.trackName}`;
    trkAuto.classList.toggle('on', s.autoTrack);
    if (s.speedIdx !== speedIdx) { speedIdx = s.speedIdx; setSpdVisual(); }
  }

  return {
    el,
    setState,
    show() { el.classList.add('show'); },
    toggle() { el.classList.toggle('closed'); },
  };
}
