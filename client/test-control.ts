// ─── DOM Elements ───
const serverIp = document.getElementById('server-ip') as HTMLInputElement;
const clientIdInput = document.getElementById('client-id') as HTMLInputElement;
const paramDistance = document.getElementById('param-distance') as HTMLInputElement;
const paramAngle = document.getElementById('param-angle') as HTMLInputElement;
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedVal = document.getElementById('speed-val') as HTMLElement;
const logEl = document.getElementById('log') as HTMLDivElement;

// ─── Logging ───
function log(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const entry = document.createElement('div');
  entry.className = `entry ${type}`;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;
  logEl.insertBefore(entry, logEl.firstChild);
  // Keep max 50 entries
  while (logEl.children.length > 50) {
    logEl.removeChild(logEl.lastChild!);
  }
}

// ─── Speed Slider ───
speedSlider.addEventListener('input', () => {
  speedVal.textContent = parseFloat(speedSlider.value).toFixed(2);
});

// ─── Send Command ───
function sendCommand(action: string, extraParams?: Record<string, string>) {
  const baseUrl = serverIp.value.trim() || 'localhost:3003';
  const protocol = baseUrl.startsWith('http') ? '' : 'http://';
  const url = new URL(`${protocol}${baseUrl}/api/control`);

  url.searchParams.set('action', action);
  url.searchParams.set('speed', speedSlider.value);

  const cid = clientIdInput.value.trim();
  if (cid) {
    url.searchParams.set('clientId', cid);
  }

  if (extraParams) {
    for (const [key, val] of Object.entries(extraParams)) {
      url.searchParams.set(key, val);
    }
  }

  const urlStr = url.toString();
  log(`Sending: ${urlStr}`, 'info');

  fetch(urlStr)
    .then(res => res.json())
    .then(data => {
      log(`OK: ${JSON.stringify(data)}`, 'success');
    })
    .catch(err => {
      log(`Error: ${err.message}`, 'error');
    });
}

// ─── Button Events ───
document.getElementById('btn-up')!.addEventListener('click', () => {
  const dist = paramDistance.value;
  sendCommand('up', { distance: dist });
});

document.getElementById('btn-down')!.addEventListener('click', () => {
  const dist = paramDistance.value;
  sendCommand('down', { distance: dist });
});

document.getElementById('btn-left')!.addEventListener('click', () => {
  const angle = paramAngle.value;
  sendCommand('left', { angle });
});

document.getElementById('btn-right')!.addEventListener('click', () => {
  const angle = paramAngle.value;
  sendCommand('right', { angle });
});

document.getElementById('btn-stop')!.addEventListener('click', () => {
  sendCommand('stop');
});

document.getElementById('btn-grab')!.addEventListener('click', () => {
  sendCommand('grab');
});

document.getElementById('btn-release')!.addEventListener('click', () => {
  sendCommand('release');
});

// ─── Keyboard Shortcuts ───
window.addEventListener('keydown', (e) => {
  // Ignore when typing in inputs
  if (document.activeElement instanceof HTMLInputElement) return;

  switch (e.key) {
    case 'ArrowUp':
    case 'w':
      e.preventDefault();
      document.getElementById('btn-up')!.click();
      break;
    case 'ArrowDown':
    case 's':
      e.preventDefault();
      document.getElementById('btn-down')!.click();
      break;
    case 'ArrowLeft':
    case 'a':
      e.preventDefault();
      document.getElementById('btn-left')!.click();
      break;
    case 'ArrowRight':
    case 'd':
      e.preventDefault();
      document.getElementById('btn-right')!.click();
      break;
    case ' ':
      e.preventDefault();
      document.getElementById('btn-stop')!.click();
      break;
    case 'q':
      document.getElementById('btn-grab')!.click();
      break;
    case 'e':
      document.getElementById('btn-release')!.click();
      break;
  }
});
