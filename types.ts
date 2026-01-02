 export type ChangeType = 
  | 'spelling'
  | 'grammar'
  | 'punctuation'
  | 'capitalization'
  | 'hyphenation'
  | 'numbers'
  | 'consistency'
  | 'citation_format'
  | 'other'

export type Severity = 'required' | 'recommended' | 'optional' | 'uncertain'

export interface Change {
  change_id: string
  type: ChangeType
  before: string
  after: string
  reason: string
  severity: Severity
  context_before: string
  context_after: string
  loc?: {
    start: number
    end: number
  }
}

export interface RewriteResponse {
  revised_text: string
  changes: Change[]
}


