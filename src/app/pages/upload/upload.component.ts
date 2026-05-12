import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DatasetService } from '../../services/dataset.service';
import { parseCsvHeaderLine } from '../../utils/csv-header';

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
      const columns = await this.readHeaderColumns(file);
      if (columns.length === 0) {
        this.parseError.set('Не удалось прочитать заголовок CSV (нет столбцов).');
        return;
      }
      this.dataset.setDataset({
        fileName: file.name,
        description: this.form.controls.description.value.trim(),
        columns,
      });
      await this.router.navigate(['/columns']);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка чтения файла';
      this.parseError.set(msg);
    }
  }

  private async readHeaderColumns(file: File): Promise<string[]> {
    const maxBytes = Math.min(file.size, 512 * 1024);
    const chunk = file.slice(0, maxBytes);
    const text = await chunk.text();
    const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
    if (!firstLine.trim()) {
      throw new Error('Файл пустой или не содержит строки заголовка.');
    }
    return parseCsvHeaderLine(firstLine);
  }
}
