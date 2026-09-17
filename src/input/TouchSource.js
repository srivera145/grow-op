/**
 * Input from the on-screen buttons, in exactly the shape Player.readInput() builds from the keyboard:
 * { left, right, jumpHeld, jumpPressed, attackPressed }. The player ORs the two together, so touch never
 * replaces the keyboard, and with no finger on the screen every value here is false.
 *
 * TouchScene reports which buttons are down; the player reads once per frame. jumpPressed and
 * attackPressed are true for the one read that follows a press and are cleared by that read, the same way
 * Phaser's JustDown consumes a key. jumpHeld stays true for as long as the finger is down, which is what
 * lets a quick tap give a short hop and a long press a full jump. A tap that starts and ends between two
 * frames still registers as pressed, because the flag waits to be read rather than being cleared on release.
 */
class TouchSource {
  constructor() {
    this.reset();
  }

  /** Everything up, nothing pending. Called when the buttons go away or the game is paused. */
  reset() {
    this.held = { left: false, right: false, jump: false, attack: false };
    this.justPressed = { jump: false, attack: false };
  }

  /**
   * Reports one button's state. It may be called as often as convenient: only a change from up to down
   * counts as a press. Pass silent = true to record a finger that was already resting on the button when
   * the controls appeared, without treating it as a fresh press.
   */
  setButton(name, down, silent = false) {
    if (down && !this.held[name] && !silent && name in this.justPressed) {
      this.justPressed[name] = true;
    }
    this.held[name] = down;
  }

  /** Whether a button is down right now, without consuming anything. */
  isHeld(name) {
    return this.held[name];
  }

  /** This frame's input. Consumes the pressed flags. */
  read() {
    const input = {
      left: this.held.left,
      right: this.held.right,
      jumpHeld: this.held.jump,
      jumpPressed: this.justPressed.jump,
      attackPressed: this.justPressed.attack,
    };
    this.justPressed.jump = false;
    this.justPressed.attack = false;
    return input;
  }
}

/** The one touch source: TouchScene writes to it, the player reads from it. */
export const touchSource = new TouchSource();

const touchFlag = () => new URLSearchParams(window.location.search).get('touch');

// Has a finger actually touched the screen this session? Pointer events are used because desktop Chrome
// switches the older touch events off, yet still reports a finger as a pointer of type "touch".
let touchUsed = false;
window.addEventListener(
  'pointerdown',
  (event) => {
    if (event.pointerType === 'touch') touchUsed = true;
  },
  { capture: true, passive: true },
);

/** True when the device says it has a touchscreen. A laptop with a touchscreen counts. */
export function hasTouchSupport() {
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/** True on phones and tablets, where the main way of pointing is a finger. A touchscreen laptop does not count. */
export function isHandheld() {
  return hasTouchSupport() && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Whether to show the on-screen controls.
 *  - A phone or tablet: yes, from the start.
 *  - A laptop or desktop that happens to have a touchscreen: not until the screen is actually touched. Such a
 *    machine reports touch support all the time, and showing buttons to someone playing with a keyboard
 *    would change desktop play. The first real touch brings them up for the rest of the session.
 *  - ?touch=1 forces them on (to try them with a mouse); ?touch=0 forces them off.
 */
export function touchControlsWanted() {
  const flag = touchFlag();
  if (flag === '1') return true;
  if (flag === '0') return false;
  return isHandheld() || (hasTouchSupport() && touchUsed);
}

/** Whether to guard against portrait: handhelds, plus ?touch=1 so the overlay can be tried on desktop. */
export function rotateGuardWanted() {
  const flag = touchFlag();
  if (flag === '0') return false;
  return flag === '1' || isHandheld();
}
