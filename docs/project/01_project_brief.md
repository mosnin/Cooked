# 01 Project Brief

## Product Summary

Koala is a web application that helps solo reps capture, qualify, and manage prospect leads from a single shareable intake link. It replaces the spreadsheet-plus-DMs workflow with a purpose-built CRM featuring AI-powered lead scoring, a deal pipeline, demo scheduling, and an AI assistant — all optimized for speed and clarity over feature breadth.

## Primary User

New solo reps in the U.S. who handle prospect and leasing leads. They have a growing but manageable volume of prospects, value fast setup and clear prioritization, and do not want enterprise CRM complexity.

## Core Problem

Solo reps lose leads and miss follow-ups because they manage prospect inquiries across scattered channels (DMs, email, spreadsheets) with no structured qualification or prioritization system. By the time they sort through the chaos, hot leads have gone cold.

## First Value Event

Rep shares their intake link, a prospect submits an application, and it appears in the leads view with an AI-generated priority tier (hot/warm/cold) and a plain-language summary explaining why.

## V1 Summary

V1 delivers the full lead-to-deal lifecycle: shareable intake form, AI lead scoring with explainable tiers, contacts CRM with activity tracking, Kanban deal pipeline, demo scheduling with public booking pages, an AI assistant with RAG context, manager portal for team oversight, analytics dashboard, workspace settings, billing, and admin panel. Marketing pages (pricing, features, FAQ, legal) are included. All pages are mobile responsive with dark mode support.

## Non Goals

Multi-currency, CRM integration, document signing, email/SMS campaigns, property offering management, multi-user workspaces, white-label branding, public API, and team collaboration beyond team membership are explicitly out of scope for v1.

## Technical Summary

Next.js 15 (app router) with TypeScript and Tailwind CSS v4. Clerk for authentication. Supabase (PostgreSQL) for database. OpenAI for AI lead scoring, embeddings, and AI assistant. Resend for transactional email. Upstash Redis for rate limiting. Amplitude for product analytics. shadcn/ui components with Lucide icons. Framer Motion for animations. Recharts for charts. react-hook-form + Zod for forms. Deployed on Vercel.
