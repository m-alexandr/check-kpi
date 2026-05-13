import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, of, tap } from 'rxjs';

export interface LmAnalysisPayload {
  selectedColumns: string[];
  columnDescription: string;
  fileName: string;
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
    const body = {
      model: 'deepseek-r1-distill-qwen-1.5b',
      messages: [
        {
          role: 'system' as const,
          content:
            'Ты эксперт по анализу данных. Отвечай только в формате JSON, без лишнего текста.',
        },
        {
          role: 'user' as const,
          content: this.buildUserPrompt(payload),
        },
      ],
      temperature: 0.3,
      max_tokens: 2048,
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

  private buildUserPrompt(p: LmAnalysisPayload): string {
    const cols = p.selectedColumns.join(', ');
    return [
      `Файл датасета: ${p.fileName}`,
      '',
      'Описание столбцов:',
      p.columnDescription,
      '',
      `Пользователь хочет улучшить показатели по столбцам: ${cols}.`,
      '',
      'Дай структурированный JSON с полями: summary (кратко), risks (массив строк), recommendations (массив строк).',
    ].join('\n');
  }
}
