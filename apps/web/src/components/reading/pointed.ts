/**
 * Whether a pointer on a row is pointing at it.
 *
 * Pointing at a value shows it on the page. A list of values often opens
 * under the press that asked for one of them, so a row lands under a pointer
 * that never moved onto it. A hand does not keep still through a press
 * either, and the first thing that row hears is a move of a pixel or two.
 * That is not pointing, and it took the page from the value asked for.
 *
 * A row is pointed at once the pointer has travelled on it, or has come onto
 * it in one stride: a pen set down on it, a pointer placed by a script. Kept
 * apart from the drawing, so a test can hold it.
 */

/** Where the pointer was first seen on the row it is on. A row keeps it until the pointer leaves. */
export type SeenAt = { x: number; y: number };

/** How far a hand moves without meaning to, and a little more. */
const TRAVEL_PX = 8;

export function pointsAt(seenAt: SeenAt, move: { clientX: number; clientY: number; movementX: number; movementY: number }): boolean {
  return Math.hypot(move.clientX - seenAt.x, move.clientY - seenAt.y) >= TRAVEL_PX || Math.hypot(move.movementX, move.movementY) >= TRAVEL_PX;
}
