import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DatasetService } from '../../services/dataset.service';
import { LmAnalysisService } from '../../services/lm-analysis.service';
import { parseCsvHeaderLine } from '../../utils/csv-header';
import { parseAnalysisInput } from '../../utils/lm-analysis-result.parser';

@Component({
  selector: 'app-upload',
  imports: [ReactiveFormsModule],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.scss',
})
export class UploadComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dataset = inject(DatasetService);
  private readonly router = inject(Router);
  private readonly lm = inject(LmAnalysisService);

  readonly parseError = signal<string | null>(null);
  readonly selectedFile = signal<File | null>(null);

  readonly form = this.fb.nonNullable.group({
    description: ['', [Validators.required, Validators.minLength(20)]],
  });

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
    this.parseError.set(null);
  }

  async submit(): Promise<void> {
    this.parseError.set(null);
    const file = this.selectedFile();
    if (!file) {
      this.parseError.set('Выберите CSV-файл с датасетом.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.parseError.set('Ожидается файл с расширением .csv');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    try {
      const { columns, sampleCsv } = await this.readCsvPreview(file);
      if (columns.length === 0) {
        this.parseError.set('Не удалось прочитать заголовок CSV (нет столбцов).');
        return;
      }
      const description = this.form.controls.description.value.trim();
      this.dataset.setDataset({
        fileName: file.name,
        description,
        columns,
      });
      this.dataset.beginOverviewRequest();
      this.lm
        .analyzeDatasetOverview({
          fileName: file.name,
          columnDescription: description,
          columns,
          sampleCsv,
        })
        .subscribe({
          next: (raw) => {
            const parsed = parseAnalysisInput(raw);
            if (parsed.kind === 'fallback' && parsed.text.trimStart().startsWith('Ошибка:')) {
              this.dataset.setOverviewFailure(parsed.text);
            } else {
              this.dataset.setOverviewSuccess(parsed);
            }
          },
          error: () => {
            this.dataset.setOverviewFailure('Не удалось связаться с сервером модели.');
          },
        });
      await this.router.navigate(['/columns']);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка чтения файла';
      this.parseError.set(msg);
    }
  }

  /** Заголовок + первые строки данных (усечённо под контекст LM, обычно n_ctx 4096). */
  private async readCsvPreview(file: File): Promise<{ columns: string[]; sampleCsv: string }> {
    const maxBytes = Math.min(file.size, 48 * 1024);
    const text = await file.slice(0, maxBytes).text();
    const lines = text.split(/\r?\n/);
    const firstIdx = lines.findIndex((l) => l.trim().length > 0);
    if (firstIdx < 0) {
      throw new Error('Файл пустой или не содержит строки заголовка.');
    }
    const headerLine = lines[firstIdx] ?? '';
    const columns = parseCsvHeaderLine(headerLine);
    const maxDataRows = 25;
    const picked: string[] = [headerLine];
    for (let i = firstIdx + 1; i < lines.length && picked.length <= maxDataRows; i++) {
      const line = lines[i];
      if (line !== undefined && line.trim().length > 0) {
        picked.push(line);
      }
    }
    return { columns, sampleCsv: picked.join('\n') };
  }
}
