/** Парсит одну строку CSV (заголовок) с учётом кавычек и удвоенных кавычек. */
export function parseCsvHeaderLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(trimField(cur));
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(trimField(cur));
  return out;
}

function trimField(s: string): string {
  return s.trim().replace(/^"|"$/g, '').trim();
}
