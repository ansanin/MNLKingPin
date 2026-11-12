// A small PDF writer for the admin reports: a title block, summary boxes and
// tables that continue across pages with the header row repeated. It uses the
// built-in Helvetica fonts, so no font files or libraries are needed.

// Helvetica and Helvetica-Bold character widths (1/1000 em) for ASCII 32-126.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Characters outside Latin-1 that WinAnsiEncoding still has, with their byte.
const WIN_ANSI_EXTRA = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

const COLORS = {
    text: [0.13, 0.13, 0.13],
    muted: [0.42, 0.42, 0.42],
    brand: [0.12, 0.31, 0.47],
    header: [0.12, 0.31, 0.47],
    headerText: [1, 1, 1],
    zebra: [0.95, 0.96, 0.97],
    group: [0.86, 0.91, 0.95],
    subtotal: [0.93, 0.95, 0.97],
    border: [0.78, 0.83, 0.87],
    boxFill: [0.97, 0.98, 0.99]
};

// Text as WinAnsi bytes. The peso sign is not in the built-in fonts, so it is
// written as "PHP". Other characters the fonts cannot show become "?".
function toWinAnsi(value) {
    const text = String(value ?? '')
        .replace(/₱\s?/g, 'PHP ')
        .replace(/[​-‍️]/g, '')
        .replace(/\s+/g, ' ');
    const bytes = [];
    for (const character of text) {
        const code = character.codePointAt(0);
        if ((code >= 32 && code < 127) || (code >= 160 && code <= 255)) bytes.push(code);
        else if (WIN_ANSI_EXTRA[character]) bytes.push(WIN_ANSI_EXTRA[character]);
        else if (code >= 0x1f000) continue; // emoji
        else bytes.push(63);
    }
    return bytes;
}

function byteWidth(byte, bold) {
    const table = bold ? HELVETICA_BOLD : HELVETICA;
    if (byte >= 32 && byte <= 126) return table[byte - 32];
    if (byte === 0x95) return 350;
    if (byte === 0x97) return 1000;
    return 556;
}

function textWidth(text, size, bold = false) {
    return toWinAnsi(text).reduce((sum, byte) => sum + byteWidth(byte, bold), 0) * size / 1000;
}

function pdfString(text) {
    return toWinAnsi(text).map(byte => {
        if (byte === 40 || byte === 41 || byte === 92) return `\\${String.fromCharCode(byte)}`;
        if (byte < 32 || byte > 126) return `\\${byte.toString(8).padStart(3, '0')}`;
        return String.fromCharCode(byte);
    }).join('');
}

// Splits text into lines no wider than maxWidth. Long words are broken.
function wrapText(text, maxWidth, size, bold = false) {
    const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let line = '';
    const pushWord = word => {
        let rest = word;
        while (textWidth(rest, size, bold) > maxWidth && rest.length > 1) {
            let cut = rest.length - 1;
            while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
            lines.push(rest.slice(0, cut));
            rest = rest.slice(cut);
        }
        return rest;
    };
    for (const word of words) {
        if (!word) continue;
        const candidate = line ? `${line} ${word}` : word;
        if (textWidth(candidate, size, bold) <= maxWidth) {
            line = candidate;
        } else {
            if (line) lines.push(line);
            line = pushWord(word);
        }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
}

const color = (rgb, stroke = false) => `${rgb.map(value => Number(value).toFixed(3)).join(' ')} ${stroke ? 'RG' : 'rg'}`;
const num = value => Number(value).toFixed(2);

class PdfReport {
    constructor({ title, subtitle = '', landscape = true } = {}) {
        this.width = landscape ? 842 : 595;
        this.height = landscape ? 595 : 842;
        this.margin = 36;
        this.footerSpace = 40;
        this.title = title || 'Report';
        this.subtitle = subtitle;
        this.pages = [];
        this.onNewPage = null;
        this.addPage();
    }

    get contentWidth() { return this.width - this.margin * 2; }
    get bottom() { return this.height - this.margin - this.footerSpace; }

    addPage() {
        this.page = [];
        this.pages.push(this.page);
        this.y = this.margin;
        if (this.pages.length > 1) {
            this.text(this.margin, this.y + 9, `${this.title} (continued)`, { size: 9, bold: true, rgb: COLORS.brand });
            this.y += 20;
        }
        if (this.onNewPage) this.onNewPage();
    }

    ensure(height) {
        if (this.y + height > this.bottom) this.addPage();
    }

    // y is measured from the top of the page (baseline of the text).
    text(x, y, value, { size = 9, bold = false, rgb = COLORS.text, align = 'left', width = 0 } = {}) {
        let left = x;
        if (align !== 'left' && width) {
            const used = textWidth(value, size, bold);
            left = align === 'right' ? x + width - used : x + (width - used) / 2;
        }
        this.page.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color(rgb)} ${num(left)} ${num(this.height - y)} Td (${pdfString(value)}) Tj ET`);
    }

    rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
        const ops = [];
        if (fill) ops.push(color(fill));
        if (stroke) ops.push(color(stroke, true), `${lineWidth} w`);
        ops.push(`${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
        this.page.push(ops.join(' '));
    }

    line(x1, y1, x2, y2, { rgb = COLORS.border, lineWidth = 0.5 } = {}) {
        this.page.push(`${color(rgb, true)} ${lineWidth} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`);
    }

    // Report title, the facts that identify it, and a rule underneath.
    header(lines) {
        this.text(this.margin, this.y + 16, 'KINGPIN CUSTOM PH - CAMSUR', { size: 9, bold: true, rgb: COLORS.muted });
        this.text(this.margin, this.y + 36, this.title, { size: 18, bold: true, rgb: COLORS.brand });
        this.y += 46;
        if (this.subtitle) {
            this.text(this.margin, this.y + 6, this.subtitle, { size: 10, rgb: COLORS.text });
            this.y += 14;
        }
        for (const [label, value] of lines) {
            this.text(this.margin, this.y + 8, `${label}:`, { size: 8.5, bold: true, rgb: COLORS.muted });
            this.text(this.margin + 92, this.y + 8, value, { size: 8.5, rgb: COLORS.text });
            this.y += 12;
        }
        this.y += 6;
        this.line(this.margin, this.y, this.width - this.margin, this.y, { rgb: COLORS.brand, lineWidth: 1.2 });
        this.y += 14;
    }

    heading(value) {
        // Keep a heading on the same page as the first rows under it.
        this.ensure(90);
        this.text(this.margin, this.y + 10, value, { size: 12, bold: true, rgb: COLORS.brand });
        this.y += 20;
    }

    note(value, { size = 8.5, rgb = COLORS.muted } = {}) {
        const lines = wrapText(value, this.contentWidth, size);
        this.ensure(lines.length * (size + 3) + 4);
        lines.forEach(line => { this.text(this.margin, this.y + size, line, { size, rgb }); this.y += size + 3; });
        this.y += 4;
    }

    // A row of boxes, each with a small label and a large value.
    summary(items) {
        const gap = 10;
        const perRow = Math.min(items.length, 5);
        const boxWidth = (this.contentWidth - gap * (perRow - 1)) / perRow;
        const boxHeight = 46;
        for (let start = 0; start < items.length; start += perRow) {
            this.ensure(boxHeight + 10);
            items.slice(start, start + perRow).forEach(([label, value], index) => {
                const x = this.margin + index * (boxWidth + gap);
                this.rect(x, this.y, boxWidth, boxHeight, { fill: COLORS.boxFill, stroke: COLORS.border });
                this.text(x + 10, this.y + 16, String(label).toUpperCase(), { size: 7.5, bold: true, rgb: COLORS.muted });
                this.text(x + 10, this.y + 36, value, { size: 14, bold: true, rgb: COLORS.text });
            });
            this.y += boxHeight + 10;
        }
        this.y += 4;
    }

    // columns: [{ header, width (share of the page width), align }]
    // rows: arrays of cell text, or { group: 'text' } for a full-width label
    // row, or { subtotal: true, cells: [...] } for a bold total row.
    table(columns, rows, { emptyText = 'No records.' } = {}) {
        const size = 8;
        const lineHeight = 10;
        const padX = 5;
        const padY = 5;
        const totalShare = columns.reduce((sum, column) => sum + (column.width || 1), 0);
        const widths = columns.map(column => this.contentWidth * (column.width || 1) / totalShare);

        const drawHeader = () => {
            const lines = columns.map((column, index) => wrapText(column.header, widths[index] - padX * 2, size, true));
            const height = Math.max(...lines.map(cell => cell.length)) * lineHeight + padY * 2;
            this.rect(this.margin, this.y, this.contentWidth, height, { fill: COLORS.header });
            let x = this.margin;
            lines.forEach((cell, index) => {
                cell.forEach((line, lineIndex) => this.text(x + padX, this.y + padY + 7.5 + lineIndex * lineHeight, line, { size, bold: true, rgb: COLORS.headerText, align: columns[index].align || 'left', width: widths[index] - padX * 2 }));
                x += widths[index];
            });
            this.y += height;
        };

        this.ensure(60);
        drawHeader();
        this.onNewPage = drawHeader;
        if (!rows.length) {
            this.rect(this.margin, this.y, this.contentWidth, 22, { stroke: COLORS.border });
            this.text(this.margin + padX, this.y + 14, emptyText, { size, rgb: COLORS.muted });
            this.y += 22;
        }
        rows.forEach((row, rowIndex) => {
            if (row && row.group !== undefined) {
                const height = lineHeight + padY * 2;
                if (this.y + height + lineHeight * 2 > this.bottom) this.addPage();
                this.rect(this.margin, this.y, this.contentWidth, height, { fill: COLORS.group, stroke: COLORS.border });
                this.text(this.margin + padX, this.y + padY + 7.5, row.group, { size, bold: true });
                this.y += height;
                return;
            }
            const cells = Array.isArray(row) ? row : row.cells;
            const bold = Boolean(row.subtotal);
            const lines = cells.map((cell, index) => wrapText(cell, widths[index] - padX * 2, size, bold));
            const height = Math.max(...lines.map(cell => cell.length)) * lineHeight + padY * 2;
            if (this.y + height > this.bottom) this.addPage();
            const fill = row.subtotal ? COLORS.subtotal : rowIndex % 2 ? COLORS.zebra : null;
            if (fill) this.rect(this.margin, this.y, this.contentWidth, height, { fill });
            this.line(this.margin, this.y + height, this.width - this.margin, this.y + height);
            let x = this.margin;
            lines.forEach((cell, index) => {
                cell.forEach((line, lineIndex) => this.text(x + padX, this.y + padY + 7.5 + lineIndex * lineHeight, line, { size, bold, align: columns[index].align || 'left', width: widths[index] - padX * 2 }));
                x += widths[index];
            });
            this.y += height;
        });
        this.onNewPage = null;
        this.y += 14;
    }

    // footer(pageNumber, pageCount) returns [leftText, secondLine].
    toBuffer({ footer = () => ['', ''], info = {} } = {}) {
        const pageCount = this.pages.length;
        this.pages.forEach((page, index) => {
            this.page = page;
            const [left, second] = footer(index + 1, pageCount);
            const top = this.height - this.margin - 22;
            this.line(this.margin, top, this.width - this.margin, top);
            this.text(this.margin, top + 11, left, { size: 7.5, rgb: COLORS.muted });
            this.text(this.margin, top + 21, second, { size: 7, rgb: COLORS.muted });
            this.text(this.width - this.margin - 80, top + 11, `Page ${index + 1} of ${pageCount}`, { size: 7.5, bold: true, rgb: COLORS.muted, align: 'right', width: 80 });
        });

        const objects = [];
        const add = value => { objects.push(value); return objects.length; };
        const catalogId = add('');
        const pagesId = add('');
        const regularId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        const pageIds = this.pages.map(page => {
            const stream = page.join('\n');
            const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
            return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        });
        objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
        objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
        const infoEntries = Object.entries(info).map(([key, value]) => `/${key} (${pdfString(value)})`).join(' ');
        const infoId = add(`<< ${infoEntries} >>`);

        let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
        const offsets = [];
        objects.forEach((object, index) => {
            offsets.push(Buffer.byteLength(pdf, 'latin1'));
            pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
        });
        const xref = Buffer.byteLength(pdf, 'latin1');
        pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
        pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
        return Buffer.from(pdf, 'latin1');
    }
}

module.exports = { PdfReport, textWidth, wrapText, toWinAnsi };
