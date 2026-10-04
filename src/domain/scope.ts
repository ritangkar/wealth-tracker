import type { OwnerId, ViewScope } from './types';
export const inScope = (owner: OwnerId, scope: ViewScope): boolean => scope === 'household' || owner === scope;
export const scopeLabelKey = (s: ViewScope) => s;
