import { describe, expect, it } from 'vitest'
import { MEETING_SCHEMA_VERSION, Registry, migrateMeeting } from './index'

const meeting = {
  schemaVersion: 1,
  id: 'm1',
  title: '需求评审',
  createdAt: '2026-09-24T06:30:00Z',
  durationMs: 60_000,
  mode: 'video',
  videoSource: 'tab',
  language: 'zh',
  status: 'ready',
}

describe('migrateMeeting', () => {
  it('parses a current-version meeting and fills defaults', () => {
    const m = migrateMeeting(meeting)
    expect(m.schemaVersion).toBe(MEETING_SCHEMA_VERSION)
    expect(m.speakers).toEqual([])
    expect(m.providers).toEqual({})
  })

  it('rejects data from a newer version', () => {
    expect(() => migrateMeeting({ ...meeting, schemaVersion: 999 })).toThrow(/高于当前支持/)
  })

  it('rejects invalid data', () => {
    expect(() => migrateMeeting({ ...meeting, mode: 'gif' })).toThrow()
    expect(() => migrateMeeting(null)).toThrow()
  })
})

describe('Registry', () => {
  it('registers, lists and rejects duplicates', () => {
    const r = new Registry<{ id: string }>('thing')
    r.register({ id: 'a' })
    expect(r.get('a')).toEqual({ id: 'a' })
    expect(r.list()).toHaveLength(1)
    expect(() => r.register({ id: 'a' })).toThrow(/已注册/)
    expect(() => r.get('b')).toThrow(/未找到/)
  })
})
