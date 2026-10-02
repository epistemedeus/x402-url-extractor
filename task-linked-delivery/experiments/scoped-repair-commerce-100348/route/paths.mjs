import { ROUTE } from '../src/contracts.mjs';
export const isScopedRepairPath = value => ['deliver','reuse','accept','review'].some(command => value === ROUTE + '/' + command);
