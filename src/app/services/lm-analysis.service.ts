import { Injectable } from '@angular/core';
import { Observable, delay, of } from 'rxjs';

export interface LmAnalysisPayload {
  selectedColumns: string[];
  columnDescription: string;
  fileName: string;
}

/**
 * Анализ выбранных столбцов через LLM.
 * Реальный endpoint: POST http://127.0.0.1:1234/api/v1/chat
 * Сейчас используется только заглушка (без сетевого запроса).
 */
@Injectable({ providedIn: 'root' })
export class LmAnalysisService {
  analyze(payload: LmAnalysisPayload): Observable<string> {
    return of(this.stubResponse(payload)).pipe(delay(800));
  }

  private stubResponse(p: LmAnalysisPayload): string {
    const cols = p.selectedColumns.map((c) => `• ${c}`).join('\n');
    return [
      '## Результат анализа (заглушка)',
      '',
      `**Файл:** ${p.fileName}`,
      '',
      '**Выбранные столбцы для улучшения:**',
      cols,
      '',
      '### Краткие рекомендации',
      '',
      '1. Зафиксируйте определение метрики и единицу измерения (например, часы vs рабочие часы), чтобы исключить смещение трендов.',
      '2. Проверьте полноту данных: доля пропусков и выбросов по выбранным полям; при необходимости введите правила заполнения или отсечения.',
      '3. Разделите факторы «процесс / люди / инструменты»: сопоставьте изменения показателя с релизами, нагрузкой и изменениями регламентов.',
      '4. Для временных рядов стройте контрольные диаграммы и сравнение «до/после» по внедрённым инициативам.',
      '',
      '_Ответ сформирован локальной заглушкой вместо вызова POST /api/v1/chat на LM-сервере._',
    ].join('\n');
  }
}
