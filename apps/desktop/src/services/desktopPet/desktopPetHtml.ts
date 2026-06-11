import { CODEX_PET_ANIMATIONS, CODEX_PET_COLUMNS, CODEX_PET_ROWS } from "./types.js";

export function desktopPetHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Pi PET</title>
<style>
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; color: #f4efe4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { -webkit-app-region: drag; display: grid; place-items: center; user-select: none; }
  .pet { width: calc(410px * var(--scale, 1)); min-height: calc(172px * var(--scale, 1)); display: grid; grid-template-columns: calc(128px * var(--scale, 1)) minmax(0, 1fr) auto; gap: calc(10px * var(--scale, 1)); align-items: end; padding: calc(8px * var(--scale, 1)); }
  .sprite-wrap { width: calc(var(--frame-width, 96px) * var(--scale, 1)); height: calc(var(--frame-height, 96px) * var(--scale, 1)); display: grid; place-items: end center; overflow: hidden; filter: drop-shadow(0 14px 24px rgba(0,0,0,0.34)); }
  .sprite { width: var(--frame-width, 96px); height: var(--frame-height, 96px); transform: scale(var(--scale, 1)); transform-origin: bottom center; background-image: var(--spritesheet); background-repeat: no-repeat; background-size: calc(var(--frame-width, 96px) * ${CODEX_PET_COLUMNS}) calc(var(--frame-height, 96px) * ${CODEX_PET_ROWS}); animation: codex-pet-frames var(--duration, 1000ms) steps(${CODEX_PET_COLUMNS}) infinite; background-position: 0 calc(-1 * var(--row, 0) * var(--frame-height, 96px)); }
  .bubble { min-width: 0; align-self: center; border: 1px solid rgba(244,239,228,0.13); border-radius: calc(18px * var(--scale, 1)); background: rgba(28,27,25,0.66); box-shadow: 0 12px 32px rgba(0,0,0,0.24); backdrop-filter: blur(14px); padding: calc(9px * var(--scale, 1)) calc(10px * var(--scale, 1)); display: grid; gap: calc(4px * var(--scale, 1)); }
  strong { overflow: hidden; font-size: calc(13px * var(--scale, 1)); line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; color: rgba(244,239,228,0.74); font-size: calc(11px * var(--scale, 1)); line-height: 1.36; }
  .badges { display: flex; gap: 4px; overflow: hidden; }
  .badges span { flex: none; max-width: calc(96px * var(--scale, 1)); overflow: hidden; border: 1px solid rgba(244,239,228,0.14); border-radius: 999px; color: rgba(244,239,228,0.66); font-size: calc(9px * var(--scale, 1)); line-height: 1.2; padding: 2px 6px; text-overflow: ellipsis; white-space: nowrap; }
  button { -webkit-app-region: no-drag; align-self: start; width: calc(24px * var(--scale, 1)); height: calc(24px * var(--scale, 1)); border: 1px solid rgba(244,239,228,0.14); border-radius: 999px; background: rgba(255,255,255,0.04); color: rgba(244,239,228,0.72); cursor: pointer; }
  button:hover { border-color: rgba(240,171,86,0.58); color: #f4efe4; }
  @keyframes codex-pet-frames { from { background-position-x: 0; } to { background-position-x: calc(-1 * var(--frame-width, 96px) * ${CODEX_PET_COLUMNS}); } }
  @media (prefers-reduced-motion: reduce) { .sprite { animation: none !important; } }
</style>
</head>
<body>
  <main id="pet" class="pet" aria-label="Pi PET desktop companion">
    <span class="sprite-wrap" aria-hidden="true"><span id="sprite" class="sprite"></span></span>
    <span class="bubble"><strong id="title">Pi PET</strong><p id="detail">等待 Pi GUI 状态…</p><span id="badges" class="badges"></span></span>
    <button type="button" id="close" title="关闭桌宠" aria-label="关闭桌宠">×</button>
  </main>
<script>
  const animationRows = ${JSON.stringify(Object.fromEntries(CODEX_PET_ANIMATIONS.map((name, index) => [name, index])))};
  const durations = { idle: 1200, 'running-right': 760, 'running-left': 760, waving: 900, jumping: 820, failed: 1100, waiting: 980, running: 760, review: 980 };
  const root = document.documentElement;
  const sprite = document.getElementById('sprite');
  const title = document.getElementById('title');
  const detail = document.getElementById('detail');
  const badges = document.getElementById('badges');
  let fallbackAnimation = 'idle';
  let onceTimer;
  function applySnapshot(snapshot) {
    const display = snapshot?.display || {};
    const bundle = snapshot?.bundle || {};
    const preferences = snapshot?.preferences || {};
    const scale = Number.isFinite(preferences.scale) ? preferences.scale : 1;
    root.style.setProperty('--scale', String(scale));
    if (bundle.spritesheetUrl) loadSpritesheet(bundle.spritesheetUrl);
    title.textContent = display.title || 'Pi PET';
    detail.textContent = display.detail || '';
    badges.replaceChildren(...(display.badges || []).slice(0, 2).map((badge) => {
      const item = document.createElement('span');
      item.textContent = badge;
      return item;
    }));
    const animation = animationRows[display.animation] === undefined ? 'idle' : display.animation;
    const status = display.status || 'message';
    fallbackAnimation = status === 'running' ? 'running' : status === 'waiting' ? 'waiting' : status === 'review' ? 'review' : status === 'failed' ? 'failed' : 'idle';
    playAnimation(animation, status === 'done');
  }
  function loadSpritesheet(url) {
    if (sprite.dataset.url === url) return;
    sprite.dataset.url = url;
    root.style.setProperty('--spritesheet', 'url("' + url.replaceAll('"', '%22') + '")');
    const image = new Image();
    image.onload = () => {
      root.style.setProperty('--frame-width', (image.naturalWidth / ${CODEX_PET_COLUMNS}) + 'px');
      root.style.setProperty('--frame-height', (image.naturalHeight / ${CODEX_PET_ROWS}) + 'px');
    };
    image.src = url;
  }
  function playAnimation(animation, once) {
    window.clearTimeout(onceTimer);
    root.style.setProperty('--row', String(animationRows[animation] ?? 0));
    root.style.setProperty('--duration', String(durations[animation] || 1000) + 'ms');
    sprite.style.animationName = 'none';
    void sprite.offsetWidth;
    sprite.style.animationName = 'codex-pet-frames';
    if (once) onceTimer = window.setTimeout(() => playAnimation(fallbackAnimation, false), durations[animation] || 1000);
  }
  window.__PI_GUI_DESKTOP__?.onDesktopPetDisplay(applySnapshot);
  document.getElementById('close').addEventListener('click', () => window.__PI_GUI_DESKTOP__?.setDesktopPetVisible(false));
</script>
</body>
</html>`;
}
