/**
 * Client-side types for the practice surface. These mirror the server shapes in
 * lib/mock-calls/* but live here so the client components never import server
 * code (and the heavy OpenAI/Supabase modules it pulls in). Kept in sync by
 * hand — the API responses are the contract.
 */

export interface IcpPersona {
  industry: string;
  company_size: string;
  role: string;
  pain_points: string[];
  objections: string[];
  budget_band: string;
  buying_process: string;
  temperament: string;
}

export interface Icp {
  id: string;
  spaceId: string | null;
  name: string;
  description: string | null;
  persona: IcpPersona;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TurnRole = 'rep' | 'prospect';

export interface Turn {
  role: TurnRole;
  content: string;
  at: string;
}

export type MockCallStatus = 'queued' | 'live' | 'completed' | 'abandoned';

export const RUBRIC_DIMENSIONS = [
  'discovery',
  'objection_handling',
  'value_articulation',
  'closing',
  'talk_ratio',
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export type Rubric = Record<RubricDimension, number>;

export interface MockCallScore {
  rubric: Rubric;
  overall: number;
  tips: string[];
  best_moment: string;
  worst_moment: string;
}

export interface MockCall {
  id: string;
  spaceId: string;
  userId: string | null;
  icpId: string | null;
  scenario: string | null;
  status: MockCallStatus;
  transcript: Turn[];
  score: number | null;
  feedback: MockCallScore | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Human labels for the rubric bars, in display order. */
export const RUBRIC_LABELS: Record<RubricDimension, string> = {
  discovery: 'Discovery',
  objection_handling: 'Objection handling',
  value_articulation: 'Value articulation',
  closing: 'Closing',
  talk_ratio: 'Talk ratio',
};

/** Empty persona for a fresh ICP form. */
export const EMPTY_PERSONA: IcpPersona = {
  industry: '',
  company_size: '',
  role: '',
  pain_points: [],
  objections: [],
  budget_band: '',
  buying_process: '',
  temperament: '',
};
