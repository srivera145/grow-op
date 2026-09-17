/**
 * Fits an Arcade body of a fixed size to whatever frame the sprite is showing, and moves the sprite's
 * origin to the middle of that body. Two things follow from that:
 *
 *  - sprite.x / sprite.y always mean "centre of the physics body", whatever the frame size. Spawn points,
 *    teleports, tweens and camera follow keep working when 32px placeholders become 64px art.
 *  - switching between frames of different sizes never moves the body.
 *
 * anchor 'bottom' pins the body to the bottom edge of the frame (characters drawn with their feet on
 * the frame's bottom edge); 'center' centres it (flyers, pickups). Call again whenever the frame size changes.
 *
 * Pass live = true when re-fitting a body that is already in play (the player changing form). Arcade only
 * re-derives a body's position from its sprite at the start of the next physics step, so a resize would
 * otherwise leave the body hanging from its old top-left corner for one frame. Live mode keeps the pinned
 * point (feet or centre) where it was, and shifts the body's previous positions by the same amount so the
 * step in progress still sees the same movement.
 */
export function alignBodyToFrame(sprite, size, anchor = 'bottom', live = false) {
  const body = sprite.body;
  const pinX = body.center.x;
  const pinY = anchor === 'bottom' ? body.bottom : body.center.y;

  const frameWidth = sprite.frame.realWidth;
  const frameHeight = sprite.frame.realHeight;
  const offsetX = (frameWidth - size.width) / 2;
  const offsetY = anchor === 'bottom' ? frameHeight - size.height : (frameHeight - size.height) / 2;

  sprite.setOrigin(0.5, (offsetY + size.height / 2) / frameHeight);
  body.setSize(size.width, size.height, false);
  body.setOffset(offsetX, offsetY);

  if (live) {
    const dx = pinX - size.width / 2 - body.position.x;
    const dy = (anchor === 'bottom' ? pinY - size.height : pinY - size.height / 2) - body.position.y;
    for (const point of [body.position, body.prev, body.prevFrame]) {
      point.x += dx;
      point.y += dy;
    }
    body.updateCenter();
  } else {
    // Not in play yet (just created, or asleep with its body disabled): nothing else will refresh the
    // body's position until a physics step runs for it, so place it from the sprite right now.
    body.updateFromGameObject();
  }
}
