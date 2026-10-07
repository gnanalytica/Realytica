import {
  engagementForReport,
  REPORT_KIND_LABEL,
  readReportBlock,
  reportIsFrozen,
  reportSummaryLine,
  type DdProject,
  type GeneratedReport,
  type ReportTable,
} from '@realytica/shared';
import { evidenceFileUrl, fetchWithAuth } from './api';
import { photosOfTable } from '../components/report/ReportTableView';

/**
 * The report as a Word document, in a plain firm template.
 *
 * Built in the browser from the same blocks the editor shows, so the file is
 * exactly what the screen says: live sections as they read now (or as they
 * were frozen, once issued), a person's words as written. A draft says it is
 * a draft on its first page and in its footer; only an issued report carries
 * a signature.
 *
 * The library is loaded on the click, not with the app.
 */
export async function exportReportDocx(project: DdProject, report: GeneratedReport): Promise<void> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    HeadingLevel,
    ImageRun,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx');

  const frozen = reportIsFrozen(report.status);
  const issued = report.status === 'issued';
  const summary = frozen ? report.body.summary : reportSummaryLine(project);
  const dated = new Date(issued && report.signedAt ? report.signedAt : Date.now()).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  /** A section's table, as a Word table with a shaded header row. */
  const tableOf = (table: ReportTable) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: table.columns.map(
            (c) => new TableCell({ shading: { type: ShadingType.CLEAR, fill: 'EDEDED' }, children: [new Paragraph({ children: [new TextRun({ text: c, bold: true, size: 20 })] })] }),
          ),
        }),
        ...table.rows.map(
          (row) =>
            new TableRow({
              cantSplit: true,
              children: table.columns.map((_, i) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.cells[i] ?? '', size: 20 })] })] })),
            }),
        ),
      ],
    });

  /**
   * The photographs a table's rows cite, each under its caption. A photograph
   * that cannot be fetched is named rather than dropped: a caption with no
   * picture tells the reader something is missing, an absence tells them nothing.
   */
  const photosOf = async (table: ReportTable): Promise<InstanceType<typeof Paragraph>[]> => {
    const out: InstanceType<typeof Paragraph>[] = [];
    for (const photo of photosOfTable(project, table)) {
      const row = project.evidence.find((e) => e.id === photo.evidenceId);
      const shot = row?.attachments.find((a) => a.mimeType.startsWith('image/'));
      if (!row || !shot) continue;
      const kind = shot.mimeType === 'image/png' ? 'png' : shot.mimeType === 'image/jpeg' ? 'jpg' : null;
      let picture: InstanceType<typeof ImageRun> | null = null;
      if (kind) {
        try {
          const res = await fetchWithAuth(evidenceFileUrl(project.id, row.id, shot.id, { inline: true }));
          if (res.ok) picture = new ImageRun({ type: kind, data: await res.arrayBuffer(), transformation: { width: 300, height: 225 } });
        } catch {
          picture = null;
        }
      }
      if (picture) out.push(new Paragraph({ keepNext: true, spacing: { before: 160 }, children: [picture] }));
      out.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: `${photo.caption}: ${row.title}${picture ? '' : ' (photograph not included in this file)'}`, italics: true, size: 18, color: '555555' })],
        }),
      );
    }
    return out;
  };

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: report.title })] }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: project.name, bold: true, size: 26 })],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: [project.siteAddress || project.location, project.city].filter(Boolean).join(', '),
          color: '555555',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 6 } },
      children: [
        new TextRun({ text: `${REPORT_KIND_LABEL[report.kind]} · ${project.reference} · ${dated}`, color: '555555' }),
        ...(engagementForReport(project, report.id)?.client ? [new TextRun({ text: ` · For ${engagementForReport(project, report.id)!.client}`, color: '555555' })] : []),
      ],
    }),
  ];

  if (!issued) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({ text: 'DRAFT. ', bold: true, color: 'B42318' }),
          new TextRun({ text: 'Not issued and not signed. Sections that read the project registers show what they say today.', color: 'B42318' }),
        ],
      }),
    );
  }

  if (summary) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Summary')] }));
    children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun(summary)] }));
  }

  for (const block of report.body.blocks) {
    const resolved = readReportBlock(project, block, frozen);
    const heading = block.heading ?? 'Section';
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(heading)] }));
    if (block.origin === 'derived') {
      if (resolved.lines.length === 0) {
        children.push(
          new Paragraph({
            spacing: { after: 160 },
            children: [new TextRun({ text: resolved.note ?? 'Nothing recorded for this section.', italics: true, color: '666666' })],
          }),
        );
      } else if (resolved.table) {
        children.push(tableOf(resolved.table));
        const photos = await photosOf(resolved.table);
        if (photos.length) {
          children.push(new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: 'Photographs', bold: true })] }));
          children.push(...photos);
        }
        if (resolved.note) {
          children.push(new Paragraph({ spacing: { before: 120, after: 160 }, children: [new TextRun({ text: resolved.note, italics: true, color: '666666' })] }));
        }
      } else {
        for (const line of resolved.lines) {
          children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(line)] }));
        }
        if (resolved.note) {
          children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: resolved.note, italics: true, color: '666666' })] }));
        }
      }
    } else {
      const paragraphs = (block.text ?? '').split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
      if (paragraphs.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'Not yet written.', italics: true, color: '666666' })] }));
      }
      for (const text of paragraphs) {
        children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun(text)] }));
      }
    }
  }

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 360 }, children: [new TextRun('Sign-off')] }));
  if (issued) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Signed: ', bold: true }),
          new TextRun(`${report.signedBy ?? report.reviewer ?? ''}${report.signedRole ? `, ${report.signedRole}` : ''}`),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: 'Date: ', bold: true }), new TextRun(dated)] }),
    );
  } else {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'Not signed. This draft has not been issued.', italics: true, color: '666666' })],
      }),
    );
  }

  const doc = new Document({
    creator: 'Realytica',
    title: report.title,
    description: `${REPORT_KIND_LABEL[report.kind]} for ${project.name}`,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${project.reference} · ${report.title}${issued ? '' : ' · DRAFT'} · page `, size: 16, color: '777777' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '777777' }),
                  new TextRun({ text: ' of ', size: 16, color: '777777' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '777777' }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.reference} ${report.title}${issued ? '' : ' (draft)'}.docx`.replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
