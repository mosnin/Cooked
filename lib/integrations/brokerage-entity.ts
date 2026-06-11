/**
 * Composio entity-id namespacing for brokerage-level connections.
 *
 * Composio scopes connections per "entity". The realtor flow uses the bare
 * Clerk userId as the entity, which means a realtor's personal Gmail and the
 * SAME person's brokerage-level Gmail would collide on one Composio entity if
 * we reused the userId. Namespacing the brokerage entity keeps the two
 * connections distinct, so a broker can connect one inbox personally and a
 * different one at the brokerage level.
 *
 * The shape is `brokerage:<brokerageId>:<userId>` — deterministic, so the
 * connect route and the callback resolve to the same entity.
 */

const PREFIX = 'brokerage';

export function brokerageEntityId(args: { brokerageId: string; userId: string }): string {
  return `${PREFIX}:${args.brokerageId}:${args.userId}`;
}
