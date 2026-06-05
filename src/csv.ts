// Minimal, dependency-free RFC-4180 CSV reader/writer.
//
// Supported: quoted fields, embedded quotes (doubled), embedded commas and
// newlines inside quotes, and both CRLF and LF line endings. A single trailing
// newline does not produce a spurious empty final row.

/** Parse CSV text into a grid of rows × fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    switch (ch) {
      case '"':
        inQuotes = true;
        break;
      case ",":
        row.push(field);
        field = "";
        break;
      case "\r":
        // Swallow CR; the following LF (if any) ends the row.
        break;
      case "\n":
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        break;
      default:
        field += ch;
    }
  }

  // Flush any trailing content (file without a final newline, or text after it).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Quote a single field if it contains a comma, quote, or newline. */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Serialise a grid of rows × fields back to CSV text (LF, trailing newline). */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quoteField).join(",")).join("\n") + "\n";
}
