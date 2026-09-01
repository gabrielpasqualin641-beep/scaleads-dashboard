/**
 * Parser de CSV mínimo, mas correto para o que a exportação do Google Sheets
 * produz: campos com vírgula decimal ficam entre aspas (ex.: `"24,41"`), então
 * um `split(',')` ingênuo quebraria esses valores ao meio.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // ignorado; a quebra real vem do \n
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

/**
 * Números em formato brasileiro (vírgula decimal, ponto de milhar opcional).
 * Campo vazio vira 0 — na planilha do Adveronix, uma célula em branco significa
 * "zero naquele dia para aquele anúncio", não "dado ausente".
 */
export function parseBrNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}
