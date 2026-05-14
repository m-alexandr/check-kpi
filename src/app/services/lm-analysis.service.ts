import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  catchError,
  map,
  mergeMap,
  Observable,
  of,
  retryWhen,
  tap,
  throwError,
  timer,
} from 'rxjs';

export interface LmAnalysisPayload {
  selectedColumns: string[];
  columnDescription: string;
  fileName: string;
}

export interface LmDatasetOverviewPayload {
  fileName: string;
  columnDescription: string;
  columns: string[];
  /** Фрагмент CSV: заголовок + первые строки данных для эвристик качества */
  sampleCsv: string;
}

/** Ответ OpenAI-совместимого POST /v1/chat/completions (LM Studio и т.п.) */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** LM Studio иногда отдаёт 200 + JSON `{ "error": "Model reloaded." }` при перезагрузке модели. */
function isTransientLmPayload(res: unknown): boolean {
  if (!res || typeof res !== 'object') {
    return false;
  }
  const o = res as Record<string, unknown>;
  if (typeof o['error'] !== 'string') {
    return false;
  }
  const t = o['error'].toLowerCase();
  if (!t.includes('reload')) {
    return false;
  }
  const choices = o['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    return false;
  }
  return true;
}

function errorText(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const e = err.error;
    if (e && typeof e === 'object' && typeof (e as { error?: unknown })['error'] === 'string') {
      return (e as { error: string })['error'];
    }
    if (typeof e === 'string') {
      return e;
    }
    return err.message ?? '';
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isTransientModelReload(err: unknown): boolean {
  return errorText(err).toLowerCase().includes('model reloaded') || errorText(err).toLowerCase().includes('reloaded');
}

/**
 * В `ng serve` запросы идут на тот же origin; `proxy.conf.json` пересылает
 * `/v1/*` → `http://127.0.0.1:1234/v1/*` (обход CORS). Префикс `/lm-api` тоже поддержан.
 */
@Injectable({ providedIn: 'root' })
export class LmAnalysisService {
  private readonly http = inject(HttpClient);

  /** Путь относительно текущего origin; в проде нужен такой же префикс на бэкенде/nginx. */
  private readonly chatUrl = '/v1/chat/completions';

  analyze(payload: LmAnalysisPayload): Observable<string> {
    return this.postChat([
      {
        role: 'system' as const,
        content:
          'Ты эксперт по анализу данных и бизнес-процессов. Отвечай только валидным JSON без markdown и пояснений снаружи.',
      },
      {
        role: 'user' as const,
        content: this.buildMainUserPrompt(payload),
      },
    ]);
  }

  /**
   * Первичный анализ датасета: проблемы качества данных, процесса (например много незакрытых задач),
   * и предлагаемые меры. Вызывается сразу после загрузки файла.
   */
  analyzeDatasetOverview(payload: LmDatasetOverviewPayload): Observable<string> {
    return this.postChat(
      [
        {
          role: 'system' as const,
          content:
            'Эксперт по качеству данных и процессам. Только JSON без markdown. ' +
            'Поля: summary (строка), risks (массив строк — проблемы), recommendations (массив строк — меры). ' +
            'По-русски; неподтверждимое — «возможно…».',
        },
        {
          role: 'user' as const,
          content: this.buildDatasetOverviewUserPrompt(payload),
        },
      ],
      { maxTokens: 768*10 },
    );
  }

  private postChat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: { maxTokens?: number },
  ): Observable<string> {
    const body = {
      model: 'deepseek-r1-distill-qwen-1.5b',
      messages,
      temperature: 0.25,
      max_tokens: options?.maxTokens ?? 2048,
    };

    return this.http.post<unknown>(this.chatUrl, body).pipe(
      map((res) => {
        if (isTransientLmPayload(res)) {
          throw new Error((res as { error: string })['error']);
        }
        return JSON.stringify(res as ChatCompletionResponse);
      }),
      retryWhen((errors) =>
        errors.pipe(
          mergeMap((err, index) => {
            if (index >= 6) {
              return throwError(() => err);
            }
            if (!isTransientModelReload(err)) {
              return throwError(() => err);
            }
            return timer(900 + index * 450);
          }),
        ),
      ),
      tap((json) => console.log('LM response bytes', json.length)),
      catchError((err: unknown) => {
        const msg = errorText(err) || 'Не удалось выполнить запрос к LM';
        return of(`Ошибка: ${msg}`);
      }),
    );
  }

  private buildDatasetOverviewUserPrompt(p: LmDatasetOverviewPayload): string {
    const maxColsChars = 1800;
    const maxDescChars = 2200;
    const maxSampleChars = 3200;
    const maxTotalUserChars = 6200;

    let cols = p.columns.join(', ');
    if (cols.length > maxColsChars) {
      cols = `${cols.slice(0, maxColsChars)}\n[…список столбцов обрезан…]`;
    }
    let desc = p.columnDescription;
    if (desc.length > maxDescChars) {
      desc = `${desc.slice(0, maxDescChars)}\n[…описание обрезано…]`;
    }
    let sample = p.sampleCsv;
    if (sample.length > maxSampleChars) {
      sample = `${sample.slice(0, maxSampleChars)}\n[…CSV обрезан…]`;
    }
    const body = [
      `Файл: ${p.fileName}`,
      '',
      'Столбцы:',
      cols,
      '',
      'Описание столбцов:',
      desc,
      '',
      'Фрагмент CSV (заголовок + строки). Найди проблемы качества (NaN, пусто, типы, дубликаты, выбросы) и процесса (например много незакрытых задач).',
      'В recommendations — конкретные шаги (валидация, ETL, мониторинг, регламенты).',
      '',
      '```csv',
      sample,
      '```',
    ].join('\n');
    if (body.length > maxTotalUserChars) {
      return `${body.slice(0, maxTotalUserChars)}\n\n[…весь запрос обрезан по лимиту контекста…]`;
    }
    return body;
  }

  private buildMainUserPrompt(p: LmAnalysisPayload): string {
    const maxDesc = 3500;
    const desc =
      p.columnDescription.length > maxDesc
        ? `${p.columnDescription.slice(0, maxDesc)}\n[…описание обрезано…]`
        : p.columnDescription;
    const cols = p.selectedColumns.join(', ');
    return [
      `Файл датасета: ${p.fileName}`,
      '',
      'Описание столбцов:',
      desc,
      '',
      `Пользователь хочет улучшить показатели по столбцам: ${cols}.`,
      '',
      'Дай структурированный JSON с полями: summary (кратко), risks (массив строк), recommendations (массив строк).',
    ].join('\n');
  }
}
