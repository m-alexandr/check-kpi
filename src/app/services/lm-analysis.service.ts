import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, of, tap } from 'rxjs';

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
      /** Меньше вывода — больше места под промпт при n_ctx 4096 в LM Studio */
      { maxTokens: 4096 },
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
      max_tokens: options?.maxTokens ?? 4096*2,
    };
    return this.http.post<ChatCompletionResponse>(this.chatUrl, body).pipe(
      tap((v) => console.log(v)),
      map((res) => JSON.stringify(res)),
      catchError((err: unknown) => {
        const httpErr = err as { error?: { error?: { message?: string } }; message?: string };
        const msg =
          httpErr?.error?.error?.message ?? httpErr?.message ?? 'Не удалось выполнить запрос к LM';
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
    // if (sample.length > maxSampleChars) {
    //   sample = `${sample.slice(0, maxSampleChars)}\n[…CSV обрезан…]`;
    // }
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
