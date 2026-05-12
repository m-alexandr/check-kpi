import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DatasetService {
  readonly fileName = signal<string>('');
  readonly columnDescription = signal<string>('');
  readonly columns = signal<string[]>([]);

  setDataset(params: { fileName: string; description: string; columns: string[] }): void {
    this.fileName.set(params.fileName);
    this.columnDescription.set(params.description);
    this.columns.set(params.columns);
  }

  clear(): void {
    this.fileName.set('');
    this.columnDescription.set('');
    this.columns.set([]);
  }
}
