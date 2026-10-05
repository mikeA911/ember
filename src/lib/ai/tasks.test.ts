import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AI_TASKS } from './tasks'

describe('AI task list', () => {
  it('gives every task a label', () => {
    for (const label of Object.values(AI_TASKS)) expect(label.trim()).not.toBe('')
  })

  it('migration adds the task and cached-token columns', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261010100001_ai_operation_logs_task.sql'), 'utf-8')
    expect(sql).toMatch(/add column if not exists task text;/)
    expect(sql).toMatch(/add column if not exists cached_input_tokens integer/)
  })
})
