// Keeps the main window inside the usable screen area (the display minus the Windows taskbar).
//
// Frameless windows with a title-bar overlay can end up larger than the screen after display
// changes (docking/undocking, resolution or scaling changes, taskbar moves) or on small laptops
// where a minimum size exceeds the work area — the bottom of the app then sits under the taskbar.
// We re-validate on every state change and fix the bounds when they don't fit.
const { screen } = require('electron');

const DEFAULT = { width: 1440, height: 920 };
const MIN = { width: 960, height: 560 }; // fits 1280x720 @100% and 1366x768 laptops with a taskbar

function workAreaFor(bounds) {
  return screen.getDisplayMatching(bounds).workArea;
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Initial bounds: last saved bounds if they are still on a connected display, else centred default.
function initialBounds(saved) {
  if (saved && saved.bounds && screen.getAllDisplays().some((d) => intersects(d.workArea, saved.bounds))) {
    return clampToWorkArea(saved.bounds, workAreaFor(saved.bounds));
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(DEFAULT.width, Math.max(MIN.width, wa.width - 48));
  const height = Math.min(DEFAULT.height, Math.max(MIN.height, wa.height - 32));
  return clampToWorkArea({ x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height }, wa);
}

function clampToWorkArea(b, wa) {
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
  return { x, y, width, height };
}

// Returns a description of what was wrong (for logs/tests), or null when the window already fits.
function ensureFits(win) {
  if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible() || win.isFullScreen()) return null;
  const content = win.getContentBounds();
  const wa = workAreaFor(content);
  const tol = 2; // px rounding tolerance at fractional scale factors
  if (win.isMaximized()) {
    const ok = Math.abs(content.x - wa.x) <= tol && Math.abs(content.y - wa.y) <= tol
      && Math.abs(content.width - wa.width) <= tol && Math.abs(content.height - wa.height) <= tol;
    if (ok) return null;
    // Re-maximising makes Windows recompute the frame against the current work area.
    win.unmaximize();
    win.setBounds(wa);
    win.maximize();
    return `maximized window ${content.width}x${content.height}@${content.x},${content.y} ≠ work area ${wa.width}x${wa.height}`;
  }
  const b = win.getBounds();
  const overflow = b.x < wa.x - tol || b.y < wa.y - tol || b.x + b.width > wa.x + wa.width + tol || b.y + b.height > wa.y + wa.height + tol;
  if (!overflow) return null;
  win.setBounds(clampToWorkArea(b, wa));
  return `window ${b.width}x${b.height}@${b.x},${b.y} exceeded work area ${wa.width}x${wa.height}`;
}

// Wires all the events after which the window could have stopped fitting.
function attach(win, { onSave, log = () => {} } = {}) {
  let t = null;
  const check = (why) => {
    clearTimeout(t);
    t = setTimeout(() => {
      const fixed = ensureFits(win);
      if (fixed) log(`window fit (${why}): ${fixed}`);
      if (onSave && !win.isDestroyed() && !win.isMinimized()) {
        onSave({ bounds: win.isMaximized() ? (win.getNormalBounds ? win.getNormalBounds() : win.getBounds()) : win.getBounds(), maximized: win.isMaximized() });
      }
    }, 150);
  };
  for (const ev of ['show', 'restore', 'maximize', 'unmaximize', 'resize', 'move', 'focus']) win.on(ev, () => check(ev));
  const onDisplay = () => check('display-change');
  screen.on('display-metrics-changed', onDisplay);
  screen.on('display-added', onDisplay);
  screen.on('display-removed', onDisplay);
  win.on('closed', () => {
    screen.removeListener('display-metrics-changed', onDisplay);
    screen.removeListener('display-added', onDisplay);
    screen.removeListener('display-removed', onDisplay);
  });
  return check;
}

// Bring the window back from tray/minimised without losing its maximised state.
function reveal(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

module.exports = { MIN, initialBounds, ensureFits, attach, reveal, clampToWorkArea };
