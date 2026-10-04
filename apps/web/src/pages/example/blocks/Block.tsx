import type { BlockAt } from '../engine';
import type { Block } from '../types';
import { BoardBlock } from './BoardBlock';
import { CalendarBlock } from './CalendarBlock';
import { FieldsBlock } from './FieldsBlock';
import { FigureBlock } from './FigureBlock';
import { GridBlock } from './GridBlock';
import { OutputsBlock } from './OutputsBlock';
import { PhotosBlock } from './PhotosBlock';
import { QaBlock } from './QaBlock';
import { SearchBlock } from './SearchBlock';
import { SiteMap } from './SiteMap';
import { SlotsBlock } from './SlotsBlock';
import { TableBlock } from './TableBlock';
import { TimelineBlock } from './TimelineBlock';

/** One block of a section, drawn by the component for its type. */
export function BlockView({ at, block }: { at: BlockAt; block: Block }) {
  switch (block.type) {
    case 'slots':
      return <SlotsBlock at={at} block={block} />;
    case 'fields':
      return <FieldsBlock at={at} block={block} />;
    case 'table':
      return <TableBlock at={at} block={block} />;
    case 'photos':
      return <PhotosBlock at={at} block={block} />;
    case 'map':
      return <SiteMap at={at} block={block} />;
    case 'search':
      return <SearchBlock at={at} block={block} />;
    case 'timeline':
      return <TimelineBlock at={at} block={block} />;
    case 'figure':
      return <FigureBlock block={block} />;
    case 'board':
      return <BoardBlock block={block} />;
    case 'calendar':
      return <CalendarBlock block={block} />;
    case 'grid':
      return <GridBlock block={block} />;
    case 'qa':
      return <QaBlock at={at} block={block} />;
    case 'outputs':
      return <OutputsBlock at={at} />;
  }
}
