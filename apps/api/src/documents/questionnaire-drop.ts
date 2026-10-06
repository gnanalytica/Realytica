/**
 * What a file dropped in the chat is, and a questionnaire among them.
 *
 * A file dropped in the chat was always filed as a paper. A list of questions
 * somebody sent to be answered is not a paper about the property: it is taken
 * in as a questionnaire, and answers are suggested from what stands on the
 * file, each with the paper and page behind it. A suggestion waits for a
 * person, as every suggested answer does. The notes of a meeting are no paper
 * either, and are the meeting rules' to keep.
 *
 * Which of them a file is, is decided in one place (`whatWasDropped`). Where
 * a file may be a questionnaire and does not say, nothing is assumed: it
 * stays noted as not read, and the chat asks, with the two answers to press.
 */
import {
  DEPARTMENTS,
  meetingNotesFor,
  namesQuestionnaire,
  questionnaireDepartment,
  questionnaireOrPaper,
  questionnaireSaid,
  type ChatChoice,
  type ChatIngestFile,
  type DdProject,
  type Questionnaire,
} from '@realytica/shared';
import { QUESTIONNAIRE_FILE, readQuestionnaireFile, type ReadQuestionnaire } from './questionnaire-file';

/** Whether a questionnaire is read from a file of this name at all. */
export function mayBeQuestionnaire(fileName: string): boolean {
  return QUESTIONNAIRE_FILE.test(fileName);
}

/** What a dropped file is. */
export type Dropped =
  /** A paper about the property: read, and put on the register. */
  | { as: 'paper' }
  /** The notes of a meeting, or words that may be (`sure` false): the chat's meeting rules keep them, or ask. */
  | { as: 'notes'; sure: boolean }
  /** A list of questions to answer: taken in as a questionnaire. */
  | { as: 'questionnaire'; read: ReadQuestionnaire }
  /** A questionnaire or a paper, and the file does not say which: the person is asked. */
  | { as: 'unsure'; read: ReadQuestionnaire | null };

/**
 * What a file dropped in the chat is. The one place it is decided.
 *
 * A dropped file is a paper, the notes of a meeting, or a questionnaire, and
 * each goes somewhere else: the register, the meetings, the questions. Two
 * rules that each looked for their own kind would both claim a page of notes
 * with questions in it, or both ask about it. So they are asked here, in this
 * order, and a file gets one answer and at most one question:
 *
 * 1. What a person said it is, where they were asked.
 * 2. A paper the reader recognises (a deed, a khata, an order) is a paper.
 *    Both rules hold to that themselves.
 * 3. A file that says it is a questionnaire, by its name or by a sheet's
 *    Question column, is one.
 * 4. Notes of a meeting (`meetingNotesFor`), where their words say so.
 * 5. A list most of whose items read as questions is a questionnaire.
 * 6. Words that may be notes: the meeting rules ask.
 * 7. A file with some questions in it and nothing else to go on: asked here.
 * 8. Anything else is a paper.
 *
 * `paper` is the file as this server read it: its words, and what the rules
 * took it for. Only for somebody working on the whole project (`whole`): an
 * outside collaborator's file is a paper. A filed document read again
 * (`fresh` false) is never a questionnaire.
 */
export async function whatWasDropped(input: {
  project: DdProject;
  paper: ChatIngestFile;
  file: { originalname: string; buffer: Buffer };
  said?: 'questionnaire' | 'paper';
  fresh: boolean;
  whole: boolean;
  /** A PDF's words page by page, where they were read. */
  pages?: readonly string[];
}): Promise<Dropped> {
  const { paper, file } = input;
  if (input.said === 'paper' || !input.whole) return { as: 'paper' };
  const questions = async (): Promise<ReadQuestionnaire | null> => {
    if (!mayBeQuestionnaire(file.originalname)) return null;
    try {
      return await readQuestionnaireFile(file, input.pages);
    } catch {
      // A file that will not open as a questionnaire is a paper like any other.
      return null;
    }
  };
  if (input.said === 'questionnaire') {
    const read = await questions();
    return read ? { as: 'questionnaire', read } : { as: 'paper' };
  }
  const recognised = Boolean(paper.read && paper.read.type !== 'other' && paper.read.confidence >= 0.35);
  if (recognised) return { as: 'paper' };
  const read = input.fresh ? await questions() : null;
  const asQuestions = questionnaireOrPaper({ fileName: file.originalname, parsed: read?.parsed ?? null, namedColumn: read?.namedColumn });
  const saysSo = namesQuestionnaire(file.originalname) || Boolean(read?.namedColumn);
  if (read && asQuestions === 'questionnaire' && saysSo) return { as: 'questionnaire', read };
  const notes = meetingNotesFor(input.project, paper);
  if (notes === 'yes') return { as: 'notes', sure: true };
  if (read && asQuestions === 'questionnaire') return { as: 'questionnaire', read };
  if (notes === 'maybe') return { as: 'notes', sure: false };
  if (asQuestions === 'unsure') return { as: 'unsure', read };
  return { as: 'paper' };
}

/** The two answers to "is it a questionnaire or a paper?", as sentences the chat reads back (`droppedAnswer`). */
export function droppedChoices(fileName: string, n: number): ChatChoice[] {
  return [
    { id: `drop-questionnaire-${n}`, label: 'A questionnaire', detail: fileName, send: `Take in “${fileName}” as a questionnaire` },
    { id: `drop-paper-${n}`, label: 'A paper to file', detail: fileName, send: `File “${fileName}” as a paper` },
  ];
}

/** A pressed answer, read back: which file, and what it is. Null for any other sentence. */
export function droppedAnswer(question: string): { fileName: string; as: 'questionnaire' | 'paper' } | null {
  const said = /^\s*(?:take in|file)\s+[“"](.+?)[”"]\s+as a (questionnaire|paper)\s*\.?\s*$/i.exec(question);
  return said ? { fileName: said[1]!, as: said[2]!.toLowerCase() as 'questionnaire' | 'paper' } : null;
}

/** What the chat says of a questionnaire it took in: its count, how it stands, and where it is. */
export function takenInSaid(questionnaire: Questionnaire): string {
  const department = DEPARTMENTS.find((d) => d.key === questionnaireDepartment(questionnaire))?.label ?? 'its department';
  return `${questionnaireSaid(questionnaire)} It is on the Questions page of ${department}.`;
}

/** What the chat asks of a file it could not tell. */
export function unsureSaid(fileName: string): string {
  return `I could not tell whether ${fileName} is a questionnaire to answer or a paper to file. Which is it?`;
}
