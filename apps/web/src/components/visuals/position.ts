/**
 * The class list's own `position`, if the caller supplied one.
 *
 * Every drawing in this directory needs a positioned root: the caption, the
 * scrim and the overlays inside them are absolutely positioned and need a
 * containing block. So each one wrote `relative` into its own class list — and
 * then a caller that wanted to place the drawing itself wrote `absolute
 * inset-0`, leaving both classes on one element.
 *
 * Which one wins is not decided by the order they appear in the attribute. It
 * is decided by the order Tailwind happens to emit the two rules in its
 * stylesheet, and Tailwind emits `.relative` after `.absolute`. So `relative`
 * won, `inset-0` had nothing to resolve against, and the element fell back to
 * its intrinsic aspect ratio — which is how a 116px card strip ended up
 * containing a 262px drawing, cropped by `overflow-hidden` to whichever slice
 * of it happened to be at the top.
 *
 * Nothing errored and nothing looked broken. It just quietly drew the wrong
 * part of every picture.
 *
 * The fix is to stop emitting two. A caller who has said where the element
 * goes has said it; anything else defaults to `relative`, which is what these
 * components need when nobody has an opinion.
 */
const POSITION = /(^|\s)(absolute|fixed|sticky|static|relative)(\s|$)/;

export function positionClass(className?: string): string {
  return className && POSITION.test(className) ? '' : 'relative';
}
