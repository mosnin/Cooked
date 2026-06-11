/**
 * Composio entity-id namespacing for team-level connections.
 *
 * Composio scopes connections per "entity". The rep flow uses the bare
 * Clerk userId as the entity, which means a rep's personal Gmail and the
 * SAME person's team-level Gmail would collide on one Composio entity if
 * we reused the userId. Namespacing the team entity keeps the two
 * connections distinct, so a manager can connect one inbox personally and a
 * different one at the team level.
 *
 * The shape is `team:<teamId>:<userId>` — deterministic, so the
 * connect route and the callback resolve to the same entity.
 */

const PREFIX = 'team';

export function teamEntityId(args: { teamId: string; userId: string }): string {
  return `${PREFIX}:${args.teamId}:${args.userId}`;
}
