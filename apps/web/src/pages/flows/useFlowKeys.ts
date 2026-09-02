import { useEffect } from 'react';

/**
 * The shortcuts anybody who has touched a canvas tries first.
 *
 * Undo, redo and delete existed only as buttons in the toolbar. That is fine
 * for a form and wrong for a canvas: the first thing a person does after
 * dragging a node to the wrong place is press the undo chord, and the first
 * thing they do to a selected node they do not want is press Delete. Both did
 * nothing, so the canvas felt broken in a way nobody would file a bug about.
 *
 * ## Not stealing keys from a field
 *
 * Every handler bails when the event came from somewhere text is being typed.
 * Without that, renaming a node and pressing Backspace at the start of the
 * name would delete the node — the single worst possible outcome of a
 * keystroke. `isTyping` checks the element rather than a focus flag the
 * component would have to remember to set, because the element is the truth.
 *
 * ## Why Cmd+S is here despite autosave
 *
 * Because people press it anyway, and a browser's own save dialog appearing
 * over a canvas is a jarring answer to "I want to make sure this is kept".
 * It saves, which is what they meant.
 */

export interface FlowKeyActions {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** The selected node, or null. Delete and duplicate act on it. */
  selected: string | null;
  /** Refused for the trigger, which a flow cannot be without. */
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onDeselect: () => void;
  onSave: () => void;
  /** True for the trigger node, so Delete does not silently do nothing. */
  isProtected: (nodeId: string) => boolean;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useFlowKeys(actions: FlowKeyActions): void {
  // Every field is read through the ref-free closure below, so the effect is
  // re-registered when they change. One listener either way — this is cheaper
  // than the ref dance and cannot go stale.
  const { undo, redo, canUndo, canRedo, selected, onDelete, onDuplicate, onDeselect, onSave, isProtected } = actions;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.metaKey || event.ctrlKey;

      // Escape is the one key that works from inside a field: it is how you
      // leave, and every other app on the machine agrees.
      if (event.key === 'Escape') {
        if (isTyping(event.target)) (event.target as HTMLElement).blur();
        else onDeselect();
        return;
      }

      if (isTyping(event.target)) return;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          if (canRedo) redo();
        } else if (canUndo) {
          undo();
        }
        return;
      }

      // Windows and Linux redo, which nobody expresses as Shift+Z there.
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        if (canRedo) redo();
        return;
      }

      if (mod && event.key.toLowerCase() === 's') {
        // Otherwise the browser offers to save the page, which is never what
        // anybody meant on a canvas.
        event.preventDefault();
        onSave();
        return;
      }

      if (mod && event.key.toLowerCase() === 'd') {
        if (!selected) return;
        event.preventDefault();
        onDuplicate(selected);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selected || isProtected(selected)) return;
        event.preventDefault();
        onDelete(selected);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, canUndo, canRedo, selected, onDelete, onDuplicate, onDeselect, onSave, isProtected]);
}
