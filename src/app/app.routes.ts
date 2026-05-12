import { Routes } from '@angular/router';
import { datasetReadyGuard } from './guards/dataset-ready.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/upload/upload.component').then((m) => m.UploadComponent),
  },
  {
    path: 'columns',
    loadComponent: () => import('./pages/columns/columns.component').then((m) => m.ColumnsComponent),
    canActivate: [datasetReadyGuard],
  },
  { path: '**', redirectTo: '' },
];
