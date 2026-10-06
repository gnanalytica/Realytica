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
  isVoiceNote,
  meetingNotesFor,
  pictureOrPaper,
  questionnaireDepartment,
  questionnaireOrPaper,
  questionnaireSaid,
  type ChatChoice,
  type ChatIngestFile,
  type DdProject,
  type Questionnaire,
} from '@realytica/shared';
import { QUESTIONNAIRE_FILE, QuestionnaireTooLarge, readQuestionnaireFile, type ReadQuestionnaire } from './questionnaire-file';

/** Whether a questionnaire is read from a file of this name at all. */
export function mayBeQuestionnaire(fileName: string): boolean {
  return QUESTIONNAIRE_FILE.test(fileName);
}

/** What a dropped file is. */
export type Dropped =
  /** A paper about the property: read, and put on the register. `why` where it might have been a questionnaire and could not be opened as one. */
  | { as: 'paper'; why?: string }
  /** The notes of a meeting, or words that may be (`sure` false): the chat's meeting rules keep them, or ask. */
  | { as: 'notes'; sure: boolean }
  /** A list of questions to answer: taken in as a questionnaire. */
  | { as: 'questionnaire'; read: ReadQuestionnaire }
  /** Sound: a voice note, to be put into words and proposed as a site entry. */
  | { as: 'voice' }
  /** A picture of the site: filed to Progress with its date. */
  | { as: 'photo' }
  /** One of two things, and the file does not say which: the person is asked. `between` is what it may be instead of a paper. */
  | { as: 'unsure'; between: 'questionnaire' | 'photo'; read: ReadQuestionnaire | null };

/**
 * What a file dropped in the chat is. The one place it is decided.
 *
 * A dropped file is a paper, the notes of a meeting, or a questionnaire, and
 * each goes somewhere else: the register, the meetings, the questions. Two
 * rules that each looked for their own kind would both claim a page of notes
 * with questions in it, or both ask about it. So they are asked here, in this
 * order, and a file gets one answer and at most one question:
 *
 * 0. Sound is a voice note, whatever it is called.
 * 1. What a person said it is, where they were asked.
 * 1a. A picture with a page of words on it is a paper that was photographed.
 *    One with few or none is a photograph of the site only where it plainly
 *    is a view (the page that sent it measured that it is not mostly one flat
 *    tone, as a sheet of paper is). Otherwise it is asked about here: a page
 *    too dark or too blurred for OCR reads as no words at all.
 * 2. A paper the reader recognises (a deed, a khata, an order) is a paper,
 *    unless it is laid out as the notes of a meeting, and then the chat asks.
 * 3. A sheet that names a Question column is a questionnaire. A file's name
 *    alone is not enough: it is asked about (rule 7).
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
  said?: 'questionnaire' | 'paper' | 'photo';
  fresh: boolean;
  whole: boolean;
  /** A PDF's words page by page, where they were read. */
  pages?: readonly string[];
  /** For a picture: how much of it is one flat tone, as the page that sent it measured. Absent when nobody measured. */
  view?: number;
}): Promise<Dropped> {
  const { paper, file } = input;
  if (input.said === 'paper' || !input.whole) return { as: 'paper' };
  if (isVoiceNote(paper)) return { as: 'voice' };
  if (input.said === 'photo') return { as: 'photo' };
  /** Why the file could not be opened as a questionnaire, where it was too large to be: said to the person, since it is then filed as a paper. */
  let why: string | undefined;
  const questions = async (): Promise<ReadQuestionnaire | null> => {
    if (!mayBeQuestionnaire(file.originalname)) return null;
    try {
      return await readQuestionnaireFile(file, input.pages);
    } catch (err) {
      // A file that will not open as a questionnaire is a paper like any other.
      if (err instanceof QuestionnaireTooLarge) why = err.message;
      return null;
    }
  };
  if (input.said === 'questionnaire') {
    const read = await questions();
    return read?.parsed.questions.length ? { as: 'questionnaire', read } : { as: 'paper', ...(why ? { why } : {}) };
  }
  const recognised = Boolean(paper.read && paper.read.type !== 'other' && paper.read.confidence >= 0.35);
  // A picture just dropped: of the site, or of a paper. A filed picture read again stays what it was filed as.
  if (input.fresh && (/^image\//i.test(paper.mimeType) || /\.(?:jpe?g|png|webp|heic|heif)$/i.test(paper.fileName))) {
    const picture = pictureOrPaper({ recognised, words: paper.excerpt ?? '', view: input.view });
    if (picture === 'photo') return { as: 'photo' };
    if (picture === 'unsure') return { as: 'unsure', between: 'photo', read: null };
    return { as: 'paper' };
  }
  // Notes about a property use a paper's own words ("the earlier survey sketch"): recognised and laid out as notes, it is asked about.
  if (recognised && meetingNotesFor(input.project, paper) === 'no') return { as: 'paper' };
  const read = input.fresh ? await questions() : null;
  const asQuestions = questionnaireOrPaper({ fileName: file.originalname, parsed: read?.parsed ?? null, namedColumn: read?.namedColumn });
  // What is in the file, never its name alone: a letter named "Reply to queries" is asked about (`questionnaireOrPaper`).
  const saysSo = Boolean(read?.namedColumn);
  if (read && asQuestions === 'questionnaire' && saysSo) return { as: 'questionnaire', read };
  const notes = meetingNotesFor(input.project, paper);
  if (notes === 'yes') return { as: 'notes', sure: true };
  if (read && asQuestions === 'questionnaire') return { as: 'questionnaire', read };
  if (notes === 'maybe') return { as: 'notes', sure: false };
  if (asQuestions === 'unsure') return { as: 'unsure', between: 'questionnaire', read };
  return { as: 'paper', ...(why ? { why } : {}) };
}

/** The two answers to "what is it?", as sentences the chat reads back (`droppedAnswer`). */
export function droppedChoices(fileName: string, n: number, between: 'questionnaire' | 'photo' = 'questionnaire'): ChatChoice[] {
  return [
    between === 'photo'
      ? { id: `drop-photo-${n}`, label: 'A site photograph', detail: fileName, send: `File “${fileName}” as a site photograph` }
      : { id: `drop-questionnaire-${n}`, label: 'A questionnaire', detail: fileName, send: `Take in “${fileName}” as a questionnaire` },
    { id: `drop-paper-${n}`, label: 'A paper to file', detail: fileName, send: `File “${fileName}” as a paper` },
  ];
}

/** A pressed answer, read back: which file, and what it is. Null for any other sentence. */
export function droppedAnswer(question: string): { fileName: string; as: 'questionnaire' | 'paper' | 'photo' } | null {
  const said = /^\s*(?:take in|file)\s+[“"](.+?)[”"]\s+as a (questionnaire|paper|site photograph)\s*\.?\s*$/i.exec(question);
  if (!said) return null;
  const what = said[2]!.toLowerCase();
  return { fileName: said[1]!, as: what === 'site photograph' ? 'photo' : (what as 'questionnaire' | 'paper') };
}

/** What the chat says of a questionnaire it took in: its count, how it stands, and where it is. */
export function takenInSaid(questionnaire: Questionnaire): string {
  const department = DEPARTMENTS.find((d) => d.key === questionnaireDepartment(questionnaire))?.label ?? 'its department';
  return `${questionnaireSaid(questionnaire)} It is on the Questions page of ${department}.`;
}

/** What the chat asks of a file it could not tell. */
export function unsureSaid(fileName: string, between: 'questionnaire' | 'photo' = 'questionnaire'): string {
  return `I could not tell whether ${fileName} is ${between === 'photo' ? 'a photograph of the site' : 'a questionnaire to answer'} or a paper to file. Which is it?`;
}
