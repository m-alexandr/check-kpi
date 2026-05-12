import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { DatasetService } from '../services/dataset.service';

export const datasetReadyGuard: CanActivateFn = () => {
  const dataset = inject(DatasetService);
  const router = inject(Router);
  if (dataset.columns().length === 0) {
    return router.createUrlTree(['/']);
  }
  return true;
};
