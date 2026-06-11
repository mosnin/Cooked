# 00 App Idea

## App Name

Koala

## One Sentence Product Definition

Koala is a sales CRM for solo reps that turns a single intake link into qualified, AI-scored prospect leads with a clean pipeline for follow-up, demos, and deals.

## Core User

New solo reps in the U.S. handling prospect and leasing leads — early in their career or building a solo practice, needing a fast lightweight way to capture and qualify prospect leads without enterprise CRM complexity.

## Core Problem

Solo reps waste time switching between spreadsheets, email, social DMs, and generic CRMs to capture and qualify prospect leads. This leads to missed follow-ups, no lead prioritization, and poor pipeline visibility.

## Core Outcome

Reps go from sign-up to a live shareable intake link in under 5 minutes. Prospect applications flow in, get AI-scored with explainable context (hot/warm/cold + summary), and appear in a clean CRM where the rep can triage, follow up, schedule demos, and track deals — all from one place.

## First Value Event

Rep generates their intake link and shares it. The first prospect application arrives, is AI-scored, and appears in the leads view with a priority tier and plain-language summary.

## Main Product Workflow

Sign up → Create workspace → Generate intake link → Share link → Prospect submits application → AI scores and triages lead → Rep reviews in leads view → Promotes to contact → Schedules demo → Creates deal → Tracks through pipeline stages.

## Dashboard Definition

Summary stat cards: new applications (unread), total leads, clients in CRM, active deals (total value), upcoming demos, follow-ups due. Below: intake link card (copy/preview), demo booking link card, upcoming demos list, follow-up widget, recent applications list (with score badges), and pipeline stage breakdown by count and value.

## Onboarding Definition

Multi-step inline onboarding flow triggered on first sign-in at `/`. Steps include: account type selection (rep vs manager), workspace creation (name + emoji), profile basics, and intake link setup. Manager-only users redirect to `/manager`. After completing onboarding, user lands in their workspace at `/s/[slug]`.

## Required Internal Modules

- Analytics (lead volume, conversion rates, pipeline value)
- AI Assistant (chat with RAG context over contacts and deals)
- Demo scheduling (booking links, calendar management, availability)
- Activity Logs (contact and deal activity tracking)
- Notifications (manager notifications for team members)

## Product Specific Features

- Shareable public intake form (`/apply/[slug]`) with 9-step structured prospect application
- AI lead scoring using OpenAI gpt-4o-mini with explainable priority tiers (hot/warm/cold/unqualified) and plain-language summaries
- Leads view with score badges, new-lead indicators, and filtering
- Contact CRM with lifecycle types (QUALIFICATION, DEMO, APPLICATION), activity logs, follow-up scheduling
- Deal pipeline with Kanban board, drag-and-drop reordering, stages, values, and close dates
- Demo scheduling with public booking pages (`/book/[slug]`), property profiles, buffer times, availability overrides, waitlist
- AI assistant (Chip) with conversation history and RAG over contacts/deals using vector embeddings
- Manager portal for team owners/managers to oversee reps, send invitations, manage members
- Public application status page (`/apply/[slug]/status`)

## Product Specific Entities

- User (clerkId, email, name, platformRole, accountType, onboarding state)
- Space (slug, name, emoji, ownerId, teamId)
- SpaceSetting (demo config, intake page config, AI personalization, billing, timezone)
- Contact (name, email, phone, budget, preferences, type, tags, leadScore, scoreLabel, scoreSummary, scoreDetails, applicationData, followUpAt)
- Deal (title, value, address, priority, stageId, position, status, closeDate, sourceDemoId)
- DealStage (name, color, position per space)
- Demo (guestName, guestEmail, startsAt, endsAt, status, propertyProfileId, manageToken)
- DemoPropertyProfile (name, address, duration, hours, days, buffer)
- Conversation / Message (AI chat history per space)
- Team (name, ownerId, status, joinCode)
- TeamMembership (teamId, userId, role)
- Invitation (teamId, email, roleToAssign, token, status)
- DocumentEmbedding (vector embeddings for RAG)
- AuditLog, ManagerNotification, DemoAvailabilityOverride, DemoWaitlist

## Roles And Permissions

- **Platform Admin** (User.platformRole = 'admin'): Full access to `/admin` panel — user management, team management, invitations, system overview.
- **Manager Owner** (TeamMembership.role = 'manager_owner'): Owns a team. Access to `/manager` portal — view reps, manage members, send invitations, team settings.
- **Manager Manager** (TeamMembership.role = 'manager_admin'): Same as manager owner but cannot delete team.
- **Rep Member** (TeamMembership.role = 'rep_member'): Member of a team. Has their own workspace. Team name shown in sidebar.
- **Rep (solo)** (default): Own workspace at `/s/[slug]`. Full access to their space — leads, contacts, deals, demos, AI, analytics, settings, billing, profile.

## Integrations Or External Config

- Clerk (authentication, user management, session handling)
- Supabase (PostgreSQL database, RLS)
- OpenAI (lead scoring via gpt-4o-mini, embeddings via text-embedding-3-small, AI assistant)
- Resend (transactional email — demo confirmations, waitlist notifications, manager notifications)
- Upstash Redis (rate limiting)
- Amplitude (product analytics)
- Vercel (hosting, speed insights)
- Google Calendar (demo sync — OAuth tokens stored)

## Admin Requirements

- View all users with their account type, onboarding status, created date
- View individual user details and their space
- View all teams with owner, status, member count
- View individual team details and members
- Manage invitations across all teams
- Platform admin access enforced at middleware level (Clerk publicMetadata.role or DB User.platformRole)

## V1 Scope

Auth (Clerk), multi-step onboarding, public intake form, AI lead scoring with explainable tiers, leads/contacts/deals CRM, Kanban deal pipeline, demo scheduling with booking pages, AI assistant with RAG, manager portal, analytics dashboard, workspace settings, billing page, admin panel, marketing pages (pricing, features, FAQ, legal). All pages mobile responsive.

## Non Goals

- Multi-currency support
- CRM integration
- Document signing / transaction management
- Email/SMS campaign automation
- Property offering management
- Multi-user workspaces (one space per user currently)
- White-label branding
- Public API
- Team collaboration features beyond team membership

## UX Constraints

- Setup to live intake link must complete in under 5 minutes
- Dashboard should load within 2 seconds
- AI scoring must produce explainable labels (not opaque numbers)
- Mobile must support full read/triage workflow (not just viewing)
- UI tone: modern, calm, product-first — not cluttered or enterprise-y

## Technical Constraints

- Clerk for auth (already integrated deeply)
- Supabase for database (service_role key bypasses RLS)
- Must deploy to Vercel
- No self-hosted infrastructure — all managed services
- OpenAI for lead scoring and embeddings (API key required)

## Success Criteria

- Rep goes from signup to live intake link in under 5 minutes
- Intake link generates application submissions consistently
- Lead scoring produces meaningful hot/warm/cold triage with explainable summaries
- Reps return to check and act on leads (retention signal)
- Demo booking flow works end-to-end from public link to CRM
