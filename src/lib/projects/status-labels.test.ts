import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PROJECT_STATUS_LABELS, projectStatusLabel, projectStatusStyle } from './status-labels'

const sql = fs
  .readFileSync(path.join(process.cwd(), 'supabase/migrations/20261004100002_project_live_status.sql'), 'utf-8')
  .replace(/\r\n/g, '\n')

describe('project live status', () => {
  it('allows live alongside every existing status', () => {
    for (const status of ['draft', 'active', 'review', 'completed', 'live', 'archived']) {
      expect(sql).toContain(`'${status}'::text`)
    }
    expect(sql).toMatch(/drop constraint if exists projects_status_check/)
  })

  it('labels every stored status, Approved as awaiting the client', () => {
    expect(PROJECT_STATUS_LABELS.completed).toBe('Approved · awaiting client')
    expect(projectStatusLabel('live')).toBe('Live · maintenance')
    expect(projectStatusLabel('active')).toBe('Working on it')
  })

  it('falls back to the raw value for an unknown status', () => {
    expect(projectStatusLabel('mystery')).toBe('mystery')
    expect(projectStatusStyle('mystery')).toBe('bg-zinc-100 text-zinc-700')
  })
})
