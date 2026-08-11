export type AppRoute =
  | 'dashboard'
  | 'categories'
  | 'transactions'
  | 'automation'
  | 'analytics'
  | 'settings'
  | 'import-export';

export function getInitialRoute(): AppRoute {
  return 'dashboard';
}
