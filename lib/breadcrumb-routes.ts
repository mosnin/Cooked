export type BreadcrumbRoute = {
  label: string;
  /** exact: true means pathname must equal the path exactly */
  exact?: boolean;
};

/** Maps route prefixes to display labels, ordered from most-specific to least-specific */
export const BREADCRUMB_ROUTES: Array<{ path: string; label: string; exact?: boolean }> = [
  // Agent/realtor routes
  { path: '/contacts/', label: 'Contacts' },
  { path: '/contacts', label: 'Contacts', exact: true },
  { path: '/leads', label: 'Leads', exact: true },
  { path: '/leads/', label: 'Leads' },
  { path: '/deals', label: 'Pipeline' },
  { path: '/calendar', label: 'Calendar' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/activity', label: 'Activity' },
  { path: '/settings/brokerage', label: 'Brokerage' },
  { path: '/settings', label: 'Settings' },
  { path: '/chippi', label: 'Chippi' },
  { path: '/team', label: 'Team' },
  { path: '/profile', label: 'Profile' },
  // Broker routes
  { path: '/broker/brief', label: 'Brief' },
  { path: '/broker/forecast', label: 'Forecast' },
  { path: '/broker/people', label: 'People' },
  { path: '/broker/deals', label: 'Deals' },
  { path: '/broker/properties', label: 'Properties' },
  { path: '/broker/integrations', label: 'Integrations' },
  { path: '/broker/usage', label: 'Usage' },
  { path: '/broker/realtors', label: 'Realtors' },
  { path: '/broker/members', label: 'Members' },
  { path: '/broker/leads', label: 'Leads' },
  { path: '/broker/analytics', label: 'Analytics' },
  { path: '/broker/agent-activity', label: 'Agent activity' },
  { path: '/broker/activity', label: 'Activity' },
  { path: '/broker/reviews', label: 'Reviews' },
  { path: '/broker/templates', label: 'Templates' },
  { path: '/broker/leaderboard', label: 'Leaderboard' },
  { path: '/broker/billing', label: 'Billing' },
  { path: '/broker/invitations', label: 'Invitations' },
  { path: '/broker/settings/form-builder', label: 'Form Builder' },
  { path: '/broker/settings/auto-assignment', label: 'Auto-assignment' },
  { path: '/broker/settings/routing-rules', label: 'Routing rules' },
  { path: '/broker/settings/mcp', label: 'MCP' },
  { path: '/broker/settings/profile', label: 'Profile' },
  { path: '/broker/settings', label: 'Settings' },
  { path: '/broker', label: 'Chippi', exact: true },
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
