import { Injectable, signal } from '@angular/core';
import type { ParsedAnalysis } from '../utils/lm-analysis-result.parser';

@Injectable({ providedIn: 'root' })
export class DatasetService {
  readonly fileName = signal<string>('');
  readonly columnDescription = signal<string>('');
  readonly columns = signal<string[]>([]);

  /** Автоанализ датасета после загрузки (POST к LM). */
  readonly overviewLoading = signal(false);
  readonly overviewResult = signal<ParsedAnalysis | null>(null);
  readonly overviewError = signal<string | null>(null);

  setDataset(params: { fileName: string; description: string; columns: string[] }): void {
    this.fileName.set(params.fileName);
    this.columnDescription.set(params.description);
    this.columns.set(params.columns);
  }

  resetOverviewState(): void {
    this.overviewLoading.set(false);
    this.overviewResult.set(null);
    this.overviewError.set(null);
  }

  beginOverviewRequest(): void {
    this.overviewLoading.set(true);
    this.overviewError.set(null);
    this.overviewResult.set(null);
  }

  setOverviewSuccess(result: ParsedAnalysis): void {
    this.overviewResult.set(result);
    this.overviewLoading.set(false);
    this.overviewError.set(null);
  }

  setOverviewFailure(message: string): void {
    this.overviewError.set(message);
    this.overviewLoading.set(false);
    this.overviewResult.set(null);
  }

  clear(): void {
    this.fileName.set('');
    this.columnDescription.set('');
    this.columns.set([]);
    this.resetOverviewState();
  }
}
