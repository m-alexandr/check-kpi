export interface LmResultMeta {
  model?: string;
  finishReason?: string;
  /** Ответ обрезан по лимиту токенов (finish_reason === length) */
  truncated: boolean;
  reasoning?: string;
}

export type ParsedAnalysis =
  | {
      kind: 'structured';
      summary: string;
      risks: string[];
      recommendations: string[];
      meta?: LmResultMeta;
    }
  | { kind: 'fallback'; text: string; meta?: LmResultMeta };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Разбор внешнего ответа chat.completion (целиком JSON от LM Studio). */
function parseChatEnvelope(raw: string): {
  inner: string;
  meta: LmResultMeta;
} | null {
  const t = raw.trim();
  if (!t.startsWith('{')) {
    return null;
  }
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const choices = o['choices'];
    if (!Array.isArray(choices) || choices.length === 0) {
      return null;
    }
    const ch0 = asRecord(choices[0]);
    if (!ch0) {
      return null;
    }
    const msg = asRecord(ch0['message']);
    const content = typeof msg?.['content'] === 'string' ? msg['content'] : '';
    const reasoning =
      typeof msg?.['reasoning_content'] === 'string' ? msg['reasoning_content'] : undefined;
    const finishReason =
      typeof ch0['finish_reason'] === 'string' ? ch0['finish_reason'] : undefined;
    const model = typeof o['model'] === 'string' ? o['model'] : undefined;
    return {
      inner: content,
      meta: {
        model,
        finishReason,
        truncated: finishReason === 'length',
        reasoning,
      },
    };
  } catch {
    return null;
  }
}

/** Если пришла только строка content без обёртки API — оставляем как есть. */
function unwrapOrUseRaw(raw: string): { inner: string; meta: LmResultMeta } {
  const env = parseChatEnvelope(raw);
  if (env) {
    return env;
  }
  return { inner: raw, meta: { truncated: false } };
}

/** Убирает обёртку ```json ... ```; если блок не закрыт (обрезка) — возвращает всё после открытия. */
function extractJsonPayload(assistantText: string): string | null {
  const t = assistantText.trim();
  const open = t.match(/```(?:json)?\s*\r?\n?/i);
  if (open && open.index !== undefined) {
    const afterOpen = t.slice(open.index + open[0].length);
    const close = afterOpen.indexOf('```');
    if (close >= 0) {
      return afterOpen.slice(0, close).trim();
    }
    return afterOpen.trim();
  }
  if (t.startsWith('{') || t.startsWith('[')) {
    return t;
  }
  return null;
}

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/** Проще: заменить типичные escape-последовательности в «грязной» строке. */
function softenEscapes(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function stringifyListItem(x: unknown): string {
  if (typeof x === 'string') {
    return x;
  }
  const o = asRecord(x);
  if (!o) {
    try {
      return JSON.stringify(x, null, 2);
    } catch {
      return String(x);
    }
  }
  if (typeof o['description'] === 'string') {
    const key = typeof o['key'] === 'string' ? o['key'] : '';
    return key ? `${key}: ${o['description']}` : o['description'];
  }
  const action = typeof o['action'] === 'string' ? o['action'] : '';
  const reason = typeof o['reason'] === 'string' ? o['reason'] : '';
  if (action && reason) {
    return `${action} — ${reason}`;
  }
  if (action) {
    return action;
  }
  if (reason) {
    return reason;
  }
  const keyOnly = typeof o['key'] === 'string' ? o['key'] : '';
  if (keyOnly) {
    return keyOnly;
  }
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(stringifyListItem).filter((s) => s.length > 0);
}

function summaryFromParsedData(data: Record<string, unknown>): string {
  const s = data['summary'];
  if (typeof s === 'string') {
    return s.trim();
  }
  if (typeof data['Summary'] === 'string') {
    return (data['Summary'] as string).trim();
  }
  const obj = asRecord(s);
  if (obj) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim()) {
        parts.push(`${k}: ${v.trim()}`);
      }
    }
    if (parts.length) {
      return parts.join('\n');
    }
  }
  return '';
}

/** Извлекает пары "description" из фрагмента (в т.ч. при битом JSON). */
function collectDescriptions(fragment: string): string[] {
  const out: string[] = [];
  const re = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const t = softenEscapes(m[1]).replace(/\s+/g, ' ').trim();
    if (t.length > 0) {
      out.push(t);
    }
  }
  return out;
}

/** Ищет начало массива risks / recommendations в «грязном» JSON (битые кавычки, обрезка). */
function findArrayKey(s: string, key: 'risks' | 'recommendations'): number {
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*\\[`, 'i'),
    new RegExp(`,\\s*${key}"\\s*:\\s*\\[`, 'i'),
    new RegExp(`,\\s*${key}\\s*:\\s*\\[`, 'i'),
    new RegExp(`${key}\\s*"\\s*:\\s*\\[`, 'i'),
  ];
  let best = -1;
  for (const p of patterns) {
    const i = s.search(p);
    if (i >= 0 && (best < 0 || i < best)) {
      best = i;
    }
  }
  return best;
}

/** Пытается вытащить сводку из сломанного тела (вложенный summary, обрывы, лишние escape). */
function looseSummaryFromText(s: string): string {
  const soft = softenEscapes(s);
  const mStr = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(soft);
  if (mStr?.[1]) {
    return mStr[1].replace(/\s+/g, ' ').trim();
  }
  const mNested = /"summary"\s*:\s*\{([\s\S]*?)\}\s*,\s*"/i.exec(soft);
  if (mNested?.[1]) {
    const inner = mNested[1];
    const kv = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const parts: string[] = [];
    let km: RegExpExecArray | null;
    while ((km = kv.exec(inner)) !== null) {
      parts.push(`${km[1]}: ${km[2].replace(/\s+/g, ' ').trim()}`);
    }
    if (parts.length) {
      return parts.join('\n');
    }
  }
  const sm = /"summary"\s*:\s*\{/i.exec(soft);
  const rk = findArrayKey(soft, 'risks');
  if (sm && rk > sm.index) {
    const blob = soft.slice(sm.index + sm[0].length, rk);
    const kv2 = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const parts2: string[] = [];
    let km2: RegExpExecArray | null;
    while ((km2 = kv2.exec(blob)) !== null) {
      parts2.push(`${km2[1]}: ${km2[2].replace(/\s+/g, ' ').trim()}`);
    }
    if (parts2.length) {
      return parts2.join('\n');
    }
  }
  const mPlain = /The goal is[\s\S]{10,800}?/.exec(soft);
  if (mPlain?.[0]) {
    return mPlain[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

function looseStructuredFromBrokenJson(jsonStr: string): ParsedAnalysis | null {
  const soft = softenEscapes(jsonStr);
  const riskIdx = findArrayKey(soft, 'risks');
  const recIdx = findArrayKey(soft, 'recommendations');

  let risksPart = soft;
  let recsPart = '';
  if (riskIdx >= 0 && recIdx > riskIdx) {
    risksPart = soft.slice(riskIdx, recIdx);
    recsPart = soft.slice(recIdx);
  } else if (recIdx >= 0 && riskIdx > recIdx) {
    recsPart = soft.slice(recIdx, riskIdx);
    risksPart = soft.slice(riskIdx);
  } else if (riskIdx >= 0) {
    risksPart = soft.slice(riskIdx);
  } else if (recIdx >= 0) {
    recsPart = soft.slice(recIdx);
  }

  const risks = collectDescriptions(risksPart);
  let recommendations = collectDescriptions(recsPart);

  const recActions = [...soft.matchAll(/"action"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  if (recActions.length) {
    recommendations = recActions.map((x) => `${softenEscapes(x[1])} — ${softenEscapes(x[2])}`);
  }

  const summary = looseSummaryFromText(soft);
  if (summary || risks.length || recommendations.length) {
    return {
      kind: 'structured',
      summary: summary || '—',
      risks,
      recommendations,
    };
  }
  return null;
}

function tryParseStructuredJson(jsonStr: string): ParsedAnalysis {
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    const summary = summaryFromParsedData(data);
    const risks = normalizeStringArray(data['risks'] ?? data['Risks']);
    const recommendations = normalizeStringArray(
      data['recommendations'] ?? data['Recommendations'],
    );
    if (summary || risks.length || recommendations.length) {
      return {
        kind: 'structured',
        summary: summary || '—',
        risks,
        recommendations,
      };
    }
    return { kind: 'fallback', text: JSON.stringify(data, null, 2) };
  } catch {
    const loose = looseStructuredFromBrokenJson(jsonStr);
    if (loose) {
      return loose;
    }
    return { kind: 'fallback', text: softenEscapes(jsonStr).trim() };
  }
}

/** Парсит ответ модели / полный chat.completion в вид для UI. */
export function parseAnalysisInput(raw: string): ParsedAnalysis {
  const { inner, meta } = unwrapOrUseRaw(raw);
  const innerTrim = inner.trim();
  const jsonStr = extractJsonPayload(innerTrim);
  if (!jsonStr) {
    const reasoningOnly =
      meta.reasoning && !innerTrim
        ? meta.reasoning.trim()
        : meta.reasoning && innerTrim.length < 20
          ? `${innerTrim}\n\n---\n\n${meta.reasoning}`
          : innerTrim;
    return {
      kind: 'fallback',
      text: reasoningOnly || 'Пустой ответ модели.',
      meta,
    };
  }

  const parsed = tryParseStructuredJson(jsonStr);
  return { ...parsed, meta: { ...meta, ...(parsed.meta ?? {}) } };
}
