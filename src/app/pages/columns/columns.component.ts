import { Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Modal } from 'bootstrap';
import { DatasetService } from '../../services/dataset.service';
import { LmAnalysisService } from '../../services/lm-analysis.service';

@Component({
  selector: 'app-columns',
  imports: [],
  templateUrl: './columns.component.html',
  styleUrl: './columns.component.scss',
})
export class ColumnsComponent implements OnDestroy {
  private readonly dataset = inject(DatasetService);
  private readonly lm = inject(LmAnalysisService);
  private readonly router = inject(Router);

  readonly modalRoot = viewChild.required<ElementRef<HTMLElement>>('resultModal');

  readonly selected = signal<Set<string>>(new Set());
  readonly loading = signal(false);
  readonly resultMarkdown = signal('');

  private modal: Modal | null = null;

  readonly fileName = this.dataset.fileName;
  readonly columns = this.dataset.columns;
  readonly description = this.dataset.columnDescription;

  toggleColumn(name: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) {
      next.add(name);
    } else {
      next.delete(name);
    }
    this.selected.set(next);
  }

  isSelected(name: string): boolean {
    return this.selected().has(name);
  }

  onColumnChange(name: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.toggleColumn(name, checked);
  }

  requestAnalysis(): void {
    const cols = [...this.selected()];
    if (cols.length === 0) {
      return;
    }
    this.loading.set(true);
    this.lm
      .analyze({
        selectedColumns: cols,
        columnDescription: this.dataset.columnDescription(),
        fileName: this.dataset.fileName(),
      })
      .subscribe({
        next: (text) => {
          this.resultMarkdown.set(text);
          this.loading.set(false);
          queueMicrotask(() => this.openModal());
        },
        error: () => {
          this.loading.set(false);
          this.resultMarkdown.set('Произошла ошибка при получении ответа (заглушка не должна падать).');
          queueMicrotask(() => this.openModal());
        },
      });
  }

  restart(): void {
    this.dataset.clear();
    void this.router.navigate(['/']);
  }

  ngOnDestroy(): void {
    this.modal?.dispose();
    this.modal = null;
  }

  private openModal(): void {
    const el = this.modalRoot().nativeElement;
    this.modal = Modal.getOrCreateInstance(el);
    this.modal.show();
  }
}
