export type BreadcrumbRoute = {
  label: string;
  /** exact: true means pathname must equal the path exactly */
  exact?: boolean;
};

/** Maps route prefixes to display labels, ordered from most-specific to least-specific */
export const BREADCRUMB_ROUTES: Array<{ path: string; label: string; exact?: boolean }> = [
  // Agent/rep routes
  { path: '/contacts/', label: 'Contacts' },
  { path: '/contacts', label: 'Contacts', exact: true },
  { path: '/leads', label: 'Leads', exact: true },
  { path: '/leads/', label: 'Leads' },
  { path: '/deals', label: 'Pipeline' },
  { path: '/calendar', label: 'Calendar' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/activity', label: 'Activity' },
  { path: '/settings/team', label: 'Team' },
  { path: '/settings', label: 'Settings' },
  { path: '/koala', label: 'Koala' },
  { path: '/team', label: 'Team' },
  { path: '/profile', label: 'Profile' },
  // Manager routes
  { path: '/manager/brief', label: 'Brief' },
  { path: '/manager/forecast', label: 'Forecast' },
  { path: '/manager/people', label: 'People' },
  { path: '/manager/deals', label: 'Deals' },
  { path: '/manager/properties', label: 'Properties' },
  { path: '/manager/integrations', label: 'Integrations' },
  { path: '/manager/usage', label: 'Usage' },
  { path: '/manager/reps', label: 'Reps' },
  { path: '/manager/members', label: 'Members' },
  { path: '/manager/leads', label: 'Leads' },
  { path: '/manager/analytics', label: 'Analytics' },
  { path: '/manager/agent-activity', label: 'Agent activity' },
  { path: '/manager/activity', label: 'Activity' },
  { path: '/manager/reviews', label: 'Reviews' },
  { path: '/manager/templates', label: 'Templates' },
  { path: '/manager/leaderboard', label: 'Leaderboard' },
  { path: '/manager/billing', label: 'Billing' },
  { path: '/manager/invitations', label: 'Invitations' },
  { path: '/manager/settings/form-builder', label: 'Form Builder' },
  { path: '/manager/settings/auto-assignment', label: 'Auto-assignment' },
  { path: '/manager/settings/routing-rules', label: 'Routing rules' },
  { path: '/manager/settings/mcp', label: 'MCP' },
  { path: '/manager/settings/profile', label: 'Profile' },
  { path: '/manager/settings', label: 'Settings' },
  { path: '/manager', label: 'Koala', exact: true },
];

/**
 * Returns the breadcrumb label for a given pathname and optional base path.
 * Tries to match from most-specific (longest path) to least-specific.
 */
export function getBreadcrumbLabel(pathname: string, base = ''): string {
  const relative = base ? pathname.replace(base, '') || '/' : pathname;

  // Sort by path length descending so longest (most specific) matches first
  const sorted = [...BREADCRUMB_ROUTES].sort((a, b) => b.path.length - a.path.length);

  for (const route of sorted) {
    if (route.exact) {
      if (relative === route.path || pathname === route.path) return route.label;
    } else {
      if (relative.startsWith(route.path) || pathname.startsWith(route.path)) return route.label;
    }
  }

  return 'Dashboard';
}
