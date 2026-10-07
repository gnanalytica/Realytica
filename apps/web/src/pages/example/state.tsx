import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import { useToast } from '../../components/ui/kit';
import type { MapLayer } from './MapBlock';
import type { Act, ChatMessage } from './chat';
import { fnId, type CheckMark, type MarkKind, type Marks } from './engine';
import { certifiedToday } from './spec';
import type { CertifiedStanding, Department, FunctionSpec } from './types';

/**
 * Everything a person does to the example project, held in memory.
 *
 * Nothing is saved: the example is the same for everybody, and a reload
 * starts it again. One reducer, so that a change made in the chat, on a field
 * and in the proof pane is the same change.
 */

/** What is picked, and the page it was picked on: its proof shows only there. */
export interface Picked {
  kind: 'field' | 'photo' | 'flag';
  id: string;
  at: string;
  /** Goes up each time something is shown, so showing the same thing again brings it back into view. */
  visit: number;
}

/** The paper opened over the workspace, by the id of its original, and the page it was opened on. */
export interface Viewing {
  id: string;
  at: string;
}

export type ProofTab = 'source' | 'links' | 'history';

export interface State extends Marks {
  picked: Picked | null;
  proofTab: ProofTab;
  viewing: Viewing | null;
  chat: ChatMessage[];
}

export type Action =
  | { type: 'mark'; what: MarkKind; ids: string[] }
  /** A value typed or chosen. It goes on the record as the person's own, whatever was suggested or left out before. */
  | { type: 'value'; id: string; value: string }
  | { type: 'check'; id: string; mark: CheckMark }
  /** A professional signs a function's result. */
  | { type: 'certify'; fn: string; standing: CertifiedStanding }
  /** Switch one layer of a map. `initial` is what the map shows before anybody has touched it. */
  | { type: 'layer'; map: string; layer: MapLayer; initial: MapLayer[] }
  | { type: 'pick'; picked: Omit<Picked, 'visit'> }
  | { type: 'close' }
  | { type: 'tab'; tab: ProofTab }
  | { type: 'view'; viewing: Viewing | null }
  | { type: 'say'; messages: ChatMessage[] }
  /** Approve or dismiss the card at `index` of the thread. */
  | { type: 'settle'; index: number; state: 'yes' | 'no'; shown?: Act };

const START: State = {
  accepted: {},
  rejected: {},
  asked: {},
  raised: {},
  dismissed: {},
  drafted: {},
  filed: {},
  sent: {},
  chosen: {},
  opened: {},
  values: {},
  checks: {},
  certified: {},
  layers: {},
  picked: null,
  proofTab: 'source',
  viewing: null,
  chat: [],
};

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'mark': {
      const added = Object.fromEntries(action.ids.map((id): [string, true] => [id, true]));
      return { ...state, [action.what]: { ...state[action.what], ...added } };
    }
    case 'value': {
      const { [action.id]: _undone, ...rejected } = state.rejected;
      return { ...state, rejected, values: { ...state.values, [action.id]: action.value }, accepted: { ...state.accepted, [action.id]: true } };
    }
    case 'check':
      return { ...state, checks: { ...state.checks, [action.id]: action.mark } };
    case 'certify':
      return { ...state, certified: { ...state.certified, [action.fn]: action.standing } };
    case 'layer': {
      const on = state.layers[action.map] ?? action.initial;
      return { ...state, layers: { ...state.layers, [action.map]: on.includes(action.layer) ? on.filter((l) => l !== action.layer) : [...on, action.layer] } };
    }
    case 'pick':
      return { ...state, picked: { ...action.picked, visit: (state.picked?.visit ?? 0) + 1 }, proofTab: 'source', viewing: null };
    case 'close':
      return state.picked ? { ...state, picked: null } : state;
    case 'tab':
      return { ...state, proofTab: action.tab };
    case 'view':
      return { ...state, viewing: action.viewing };
    case 'say':
      return { ...state, chat: [...state.chat, ...action.messages] };
    case 'settle':
      return { ...state, chat: state.chat.map((m, i) => (i === action.index && m.kind === 'card' ? { ...m, state: action.state, shown: action.shown } : m)) };
  }
}

const ExampleContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function ExampleProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, START);
  return <ExampleContext.Provider value={{ state, dispatch }}>{children}</ExampleContext.Provider>;
}

export function useExample(): { state: State; dispatch: Dispatch<Action> } {
  const value = useContext(ExampleContext);
  if (!value) throw new Error('useExample is used inside the example project page');
  return value;
}

/**
 * Signs a function's result. It is the one change behind "Add certified
 * result" and behind filing the result a function is certified by, so the
 * standing strip, the list of results and the department's Summary cannot
 * come to disagree.
 */
export function useCertify(dept: Department, fn: FunctionSpec): () => void {
  const { dispatch } = useExample();
  const toast = useToast();
  return () => {
    dispatch({ type: 'certify', fn: fnId(dept, fn), standing: certifiedToday(dept, fn) });
    toast('Files the signed result.');
  };
}
