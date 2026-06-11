# 03 User Flows

## Flow: Visitor To Signup

1. Visitor lands on `/` (home page / sign-in page)
2. Sees "Welcome to Koala" with Clerk sign-in component
3. Creates account via email/password or OAuth through Clerk
4. Clerk creates user → webhook or first-visit creates User row in Supabase
5. User is now authenticated and redirected back to `/`

Branch: If visitor is a manager, clicks "Team login" link → `/login/manager` for manager-specific sign-in.
Branch: If user is already signed in, visiting `/sign-in` or `/sign-up` redirects to `/`.

## Flow: Signup To Onboarding

1. Authenticated user arrives at `/` → OnboardingFlow component renders inline
2. System checks if user has a workspace (Space record)
3. If no workspace → multi-step onboarding flow:
   - Step 1: Account type selection (rep / manager)
   - Step 2: Workspace name + emoji selection
   - Step 3: Profile basics
   - Step 4+: Additional setup steps (intake link config, etc.)
4. Progress tracked via User.onboardingCurrentStep
5. On completion → Space created, User.onboard set to true
6. Redirect to `/s/[slug]` (workspace dashboard)

Branch: If manager-only account type selected → redirect to `/manager` after team creation.
Branch: If user already has a space → redirect directly to `/s/[slug]` via `/dashboard`.

## Flow: Onboarding To First Value

1. Rep lands on workspace dashboard `/s/[slug]`
2. Dashboard shows intake link card with "Live" badge
3. Rep copies intake link and shares it (bio, DMs, ads, email)
4. Prospect visits `/apply/[slug]` and completes 9-step application
5. Application creates Contact with tags=['application-link', 'new-lead']
6. AI lead scoring runs asynchronously → score, tier, summary generated
7. Rep sees new application in leads view with "New" badge and score
8. **First value event achieved** — structured lead with AI context in CRM

## Flow: Repeat Usage (Daily Workflow)

1. Rep logs in → `/dashboard` redirects to `/s/[slug]`
2. Reviews dashboard: new applications count, follow-ups due, upcoming demos
3. Checks leads view for new applications, reviews AI scores
4. Follows up on hot leads — adds notes, schedules follow-up dates
5. Promotes qualified leads to contacts
6. Schedules demos via demos view or shares booking link
7. Creates deals for progressing contacts, moves through pipeline stages
8. Checks AI assistant for insights on their pipeline
9. Reviews analytics for trends

## Flow: Demo Booking (Prospect)

1. Prospect receives demo booking link `/book/[slug]`
2. Selects property profile (if multiple)
3. Views available dates and time slots
4. Fills in guest name, email, phone, notes
5. Confirms booking → Demo created with status='scheduled'
6. Confirmation email sent to prospect via Resend
7. Rep sees demo in demos view and dashboard widget

Branch: If all slots full → prospect added to waitlist, notified when slot opens.
Branch: If date is blocked or outside hours → slot not shown.

## Flow: Manager Onboarding

1. Manager signs up and selects "manager" account type
2. Creates team (name, optional logo, website)
3. Receives join code for self-service rep joining
4. Sends email invitations to reps via `/manager/invitations`
5. Invited rep clicks invite link `/invite/[token]` → accepts invitation
6. Rep's Space linked to Team via teamId
7. Manager sees rep in `/manager/reps` list

Branch: Rep can also join via join code at `/join/[code]`.

## Flow: Billing Upgrade

1. Rep navigates to `/s/[slug]/billing`
2. Views current plan status and subscription details
3. Clicks upgrade → redirected to Stripe Checkout
4. Completes payment → webhook updates subscription
5. Returns to billing page with updated plan

Branch: If payment fails → stays on current plan with error message.

## Flow: Admin Support

1. Admin logs in → middleware checks publicMetadata.role or DB platformRole
2. Admin sees admin nav in sidebar
3. Navigates to `/admin` → overview dashboard
4. `/admin/users` → view all users, click into individual user detail
5. `/admin/teams` → view all teams, click into detail with members
6. `/admin/invitations` → view all pending/accepted/expired invitations
7. Admin actions logged to AuditLog table
