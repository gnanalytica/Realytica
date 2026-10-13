/**
 * What a report states in rows, offered as it lands on the register.
 *
 * Most papers state single facts (a date, an extent, a number) and those are
 * offered to fields as the paper is filed. Two kinds state rows, and a row is
 * not a fact with a key:
 *
 * - **A cost report** states a line for each package. Its tables are read
 *   from the words this server got from each page (the paper's text layer,
 *   or OCR of a page that is a picture) and each row is offered to the Cost
 *   Report. Where pages gave no row and a model is set up, the model is shown
 *   those pages and answers in the ledger's column keys; each figure it gives
 *   is then looked for among this server's own words for that page.
 * - **A technical due diligence or condition report** states observations.
 *   Each is offered to Engineering › Technical as a record.
 *
 * Nothing here writes a figure onto a Cost Report or accepts a value: every
 * row waits for a person. Never throws: a paper whose rows could not be
 * offered is still filed.
 */

import { COST_ROWS_LIMIT_MS, costRowsModelSetUp, readCostRowsByModel, type CostRowsRead } from '@realytica/agents';
import { COST_LEDGER_COLUMNS, costPaperSaid, offerCostRowsFromModel, offerCostRowsFromPages, offerReportObservations, type ChatIngestFile, type CostPaper, type DdProject } from '@realytica/shared';
import { alternatesOf, layoutOf, pagesOf, picturesOf, type PaperPages } from './intake';

/** The reader of a cost report's pictures. Given in tests; a model in the product. */
export type CostRowsReader = (input: { fileBytes: Buffer; fileName: string; pages: readonly number[] }) => Promise<CostRowsRead | null>;

const byModel: CostRowsReader = (input) => readCostRowsByModel({ ...input, keys: COST_LEDGER_COLUMNS, timeoutMs: COST_ROWS_LIMIT_MS });

export interface RowsOffered {
  /** Rows of a cost table now offered to the Cost Report, and the one line to say where none could be read. */
  costRows?: { offered: number; said: string };
  /** Observations now offered to Technical. */
  observations?: number;
  /** The pages of a cost report that may hold a table nobody here could read, where a model is set up to be shown them. */
  askModel?: number[];
}

/** A paper's pages as this server read them, a page to an entry, `[0]` being page 1. Never a model's own quotes. */
function wordsRead(pages: PaperPages): Array<string | undefined> {
  const texts: Array<string | undefined> = Array.from({ length: pages.pagesInFile }, () => undefined);
  for (const page of pages.pages) if (page.reader !== 'model' && page.page >= 1) texts[page.page - 1] = page.text;
  return texts;
}

/**
 * Offers the rows a paper states, by what the rules took it for, from the
 * words this server read. `paper` is the file as it was just read, `kept`
 * its pages where they are handed in and not travelling with the row.
 */
export function offerRowsOfPaper(project: DdProject, evidenceId: string | undefined, paper: ChatIngestFile, opts: { kept?: PaperPages | null; modelSetUp?: boolean } = {}): RowsOffered {
  const type = paper.read?.type;
  if (!evidenceId || (type !== 'cost_report' && type !== 'technical_report')) return {};
  const pages = opts.kept ?? pagesOf(paper);
  if (!pages) return {};
  try {
    if (type === 'technical_report') return { observations: offerReportObservations(project, evidenceId, wordsRead(pages).map((text) => text ?? '')) };
    // A page is read by where its words sit, so a table set in cells keeps its columns, and by its lines; the reading the page's own totals hold is the one kept. A picture on a page of type has its own words' places.
    const layout = layoutOf(paper);
    const pictures = picturesOf(paper);
    const alternates = alternatesOf(paper);
    const placed = pages.pages.map((page) => {
      const words = (page.reader === 'ocr' ? pictures?.find((held) => held.page === page.page)?.words : undefined) ?? layout?.find((held) => held.page === page.page)?.words;
      const other = page.reader === 'ocr' ? alternates?.filter((held) => held.page === page.page).map((held) => ({ text: held.text, words: held.words })) : undefined;
      return { ...page, ...(words?.length ? { words } : {}), ...(other?.length ? { alternates: other } : {}) };
    });
    const read: CostPaper = offerCostRowsFromPages(project, evidenceId, placed, pages.pagesInFile);
    const modelSetUp = opts.modelSetUp ?? costRowsModelSetUp();
    return {
      costRows: { offered: read.offers.filter((offer) => offer.status === 'offered').length, said: costPaperSaid(read, modelSetUp) },
      ...(read.pictures.length && modelSetUp && /pdf/i.test(paper.mimeType) ? { askModel: read.pictures } : {}),
    };
  } catch (err) {
    console.warn(`[offers] the rows of ${paper.fileName} could not be offered: ${(err as Error).message}`);
    return {};
  }
}

/**
 * Shows a model the pages of a cost report nobody here got a row from, and
 * hands back what it gave, unchecked. Slow, and touches no project: what it
 * gives is laid on the record by `offerModelRowsOfPaper`. Null where no model
 * read anything.
 */
export async function readCostPictures(paper: ChatIngestFile, bytes: Buffer, pages: readonly number[], reader: CostRowsReader = byModel): Promise<CostRowsRead | null> {
  try {
    return await reader({ fileBytes: bytes, fileName: paper.fileName, pages });
  } catch {
    return null;
  }
}

/** Lays a model's rows on the record as offers, each figure held to the words this server read on the page the model named. */
export function offerModelRowsOfPaper(project: DdProject, evidenceId: string, paper: ChatIngestFile, answered: CostRowsRead, opts: { kept?: PaperPages | null } = {}): RowsOffered {
  const pages = opts.kept ?? pagesOf(paper);
  if (!pages) return {};
  try {
    const read = offerCostRowsFromModel(project, evidenceId, answered.rows, wordsRead(pages), pages.pagesInFile, { failure: answered.rows.length ? undefined : (answered.failure ?? 'It gave no row.') });
    return { costRows: { offered: read.offers.filter((offer) => offer.status === 'offered').length, said: costPaperSaid(read, true) } };
  } catch (err) {
    console.warn(`[offers] a model's rows of ${paper.fileName} could not be offered: ${(err as Error).message}`);
    return {};
  }
}

/** What became of a paper's rows, for the line that says a paper is on the file. Empty where it states none. */
export function rowsOfferedSaid(offered: RowsOffered): string {
  if (offered.costRows) return offered.costRows.offered ? `${offered.costRows.offered} ${offered.costRows.offered === 1 ? 'row' : 'rows'} offered to the Cost Report` : offered.costRows.said ? 'its tables are pictures and no row was read from them' : '';
  if (offered.observations) return `${offered.observations} ${offered.observations === 1 ? 'observation' : 'observations'} offered to Technical`;
  return '';
}
