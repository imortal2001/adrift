// ── Input ────────────────────────────────────────────────────────────────────
// Held keys vs. keys tapped this frame, and look deltas from whichever mouse
// mode is available:
//
//   locked    — pointer lock granted: raw deltas, cursor captured and hidden.
//   free look — pointer lock refused (embedded frames, some kiosk setups):
//               the same raw deltas, no button needed. The one thing lock
//               gives that this cannot is an unbounded cursor, so when the
//               pointer reaches the edge of the window we keep turning at a
//               steady rate instead of stopping dead.
//
// Arrow keys turn the view in either mode, so the game is playable even with
// no usable mouse at all.

const EDGE_MARGIN = 0.11;     // fraction of the viewport that counts as "edge"
const EDGE_RATE = 2.5;        // rad/s at the very edge

export class Input {
  constructor(target) {
    this.target = target;
    this.held = new Set();
    this.tapped = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.clicks = [];          // mouse buttons pressed this frame
    this.buttons = new Set();  // mouse buttons held down now
    this.ups = [];             // mouse buttons released this frame
    this.locked = false;
    this.lockDenied = false;   // set by the game when a lock request is refused
    this.sensitivity = 0.0022;
    this.enabled = true;
    this.allowLook = true;     // false while a panel wants the cursor

    this.cursorX = innerWidth / 2;
    this.cursorY = innerHeight / 2;
    this.overCanvas = false;   // free look only applies over the world itself

    const NO_DEFAULT = ['Space', 'Tab', 'KeyE', 'KeyB', 'KeyC', 'KeyI', 'Backspace',
                        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    addEventListener('keydown', e => {
      if (e.repeat || !this.enabled) return;
      // Let the browser keep its own shortcuts. Nothing is bound to Ctrl for
      // exactly this reason: a Ctrl-held WASD would have been swallowed here,
      // and Ctrl+W closes the tab before a game could see it anyway.
      if (e.metaKey || e.ctrlKey) return;
      this.held.add(e.code);
      this.tapped.add(e.code);
      if (NO_DEFAULT.includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.held.delete(e.code));
    addEventListener('blur', () => {
      this.held.clear();
      this.overCanvas = false;
      // A button held when the window loses focus never sends its mouseup; let
      // it go, or a rod would reel forever.
      for (const b of this.buttons) this.ups.push(b);
      this.buttons.clear();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === target;
      if (!this.locked) this.held.clear();
    });

    addEventListener('mousemove', e => {
      this.cursorX = e.clientX;
      this.cursorY = e.clientY;
      this.overCanvas = e.target === target;
      if (!this.allowLook) return;
      // movementX/Y are reported with or without pointer lock, so the same
      // path drives both modes.
      if (this.locked || this.overCanvas) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });

    // Without a drag gesture to disambiguate, a press is a click outright.
    addEventListener('mousedown', e => {
      if (!this.allowLook) return;
      if (!this.locked && e.target !== target) return;
      this.clicks.push(e.button);
      this.buttons.add(e.button);
      if (!this.locked) e.preventDefault();   // no text-selection drag
    });

    // Released anywhere, not just over the canvas: drag off the edge of the
    // window mid-reel and the button still has to come back up.
    addEventListener('mouseup', e => {
      if (this.buttons.delete(e.button)) this.ups.push(e.button);
    });

    addEventListener('wheel', e => {
      if (!this.allowLook) return;
      if (this.locked || e.target === target) {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      }
    }, { passive: false });

    addEventListener('contextmenu', e => {
      if (this.locked || e.target === target) e.preventDefault();
    });
  }

  /** True when looking works without holding anything but pointer lock is off. */
  get freeLook() { return !this.locked && this.lockDenied; }

  /**
   * Radians to turn from the pointer resting against the edge of the window.
   * Only needed in free look: a captured pointer never runs out of room.
   */
  edgeLook(dt) {
    if (this.locked || !this.allowLook || !this.overCanvas) return null;
    const mx = Math.max(60, innerWidth * EDGE_MARGIN);
    const my = Math.max(60, innerHeight * EDGE_MARGIN);
    let x = 0, y = 0;
    if (this.cursorX < mx) x = -(1 - this.cursorX / mx);
    else if (this.cursorX > innerWidth - mx) x = 1 - (innerWidth - this.cursorX) / mx;
    if (this.cursorY < my) y = -(1 - this.cursorY / my);
    else if (this.cursorY > innerHeight - my) y = 1 - (innerHeight - this.cursorY) / my;
    if (!x && !y) return null;
    return [x * EDGE_RATE * dt, y * EDGE_RATE * dt * 0.7];
  }

  /** Radians to turn from the arrow keys this frame. */
  arrowLook(dt) {
    let x = 0, y = 0;
    if (this.down('ArrowLeft')) x -= 1;
    if (this.down('ArrowRight')) x += 1;
    if (this.down('ArrowUp')) y -= 1;
    if (this.down('ArrowDown')) y += 1;
    return (x || y) ? [x * 2.1 * dt, y * 1.5 * dt] : null;
  }

  down(code) { return this.held.has(code); }
  pressed(code) { return this.tapped.has(code); }
  clicked(button = 0) { return this.clicks.includes(button); }
  /** A mouse button held down right now — for the things you hold, not click. */
  mouseDown(button = 0) { return this.buttons.has(button); }
  released(button = 0) { return this.ups.includes(button); }

  endFrame() {
    this.tapped.clear();
    this.clicks.length = 0;
    this.ups.length = 0;
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }
}
