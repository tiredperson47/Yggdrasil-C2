export const TAB_PATHS = {
  dashboard: '/dashboard',
  listeners: '/listeners',
  agents: '/agents',
  credentials: '/credentials',
  payloads: '/payloads',
  files: '/files',
  nmap: '/nmap',
  cli: '/cli',
  logs: '/logs',
  settings: '/settings',
} as const;

export type TabKey = keyof typeof TAB_PATHS;

const PATH_TO_TAB: Record<string, TabKey> = Object.entries(TAB_PATHS).reduce((acc, [tab, path]) => {
  acc[path] = tab as TabKey;
  return acc;
}, {} as Record<string, TabKey>);

export const getTabFromPath = (pathname: string): TabKey | null => {
  if (pathname === '/') return 'dashboard';
  return PATH_TO_TAB[pathname] ?? null;
};

export const getPathFromTab = (tab: TabKey) => TAB_PATHS[tab];
