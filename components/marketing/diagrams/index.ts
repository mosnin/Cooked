/**
 * Animated UI diagrams that replace `<MarketingMediaSlot>` placeholders
 * on the hero / tick-tock surfaces. Each diagram demonstrates exactly
 * one thing about the real product, looping calmly on a 6–9s cadence.
 *
 * Apple-discipline contract (enforced in code, not in prose):
 *   - hairline borders, no shadows, no gradients
 *   - opacity + small translate only, no rotates, no scale-from-zero
 *   - 180–340ms beats with EASE_APPLE
 *   - one beat per surface
 *   - `useReducedMotion()` lands the diagram in its END state, no loop
 *   - real product vocabulary (typography, lead-tier dots, agent badge)
 *
 * Slot-in-place: every diagram accepts the same `aspect` prop the media
 * slot did so page swaps stay layout-neutral.
 */

export { ChippiDiagramShell } from './chippi-diagram-shell';
export { ComposerDraftDiagram } from './composer-draft-diagram';
export { KanbanDragDiagram } from './kanban-drag-diagram';
export { LeadScoreDiagram } from './lead-score-diagram';
export { CalendarBookingDiagram } from './calendar-booking-diagram';
export { LeadRoutingDiagram } from './lead-routing-diagram';
export { TimelineDiagram } from './timeline-diagram';
export { TemplateAdaptDiagram } from './template-adapt-diagram';
export { TeamLeaderboardDiagram } from './team-leaderboard-diagram';
export { TeamMembersDiagram } from './team-members-diagram';
export { TeamChatDiagram } from './team-chat-diagram';
export { InboxDiagram } from './inbox-diagram';
