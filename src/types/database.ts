export type CandidateStatus = 'in_progress' | 'submitted' | 'auto_submitted' | 'reset';

export interface UserRole {
  id: string;
  user_id: string;
  role: string;
}

export interface Question {
  id: string;
  section: string;
  order_number: number;
  type: string;
  display_text: string | null;
  audio_path: string | null;
  time_limit_seconds: number;
  active: boolean;
}

export interface QuestionScript {
  question_id: string;
  script_text: string;
}

export interface TestCode {
  id: string;
  code: string;
  candidate_name: string | null;
  used: boolean;
  created_at: string;
}

export interface Candidate {
  id: string;
  user_id: string | null;
  full_name: string;
  test_code: string;
  status: CandidateStatus;
  warning_count: number;
  current_question: number;
  started_at: string;
  submitted_at: string | null;
  total_score: number | null;
  overall_notes: string | null;
}

export interface Response {
  id: string;
  candidate_id: string;
  question_id: string;
  audio_path: string;
  duration_seconds: number | null;
  recorded_at: string;
}

export interface Score {
  id: string;
  response_id: string;
  pronunciation: number | null;
  fluency: number | null;
  accuracy: number | null;
  content: number | null;
  notes: string | null;
}

export interface ProctorEvent {
  id: string;
  candidate_id: string;
  event_type: 'tab_switch' | 'fullscreen_exit' | 'auto_submit' | string;
  question_id: string | null;
  created_at: string;
}
