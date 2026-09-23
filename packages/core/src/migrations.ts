import { MEETING_SCHEMA_VERSION, Meeting } from './schema/meeting'

type Migration = (data: Record<string, unknown>) => Record<string, unknown>

/**
 * key 为「迁移前」的版本号：migrations[1] 把 v1 数据升级为 v2。
 * 修改 Meeting 结构时：MEETING_SCHEMA_VERSION +1，并在这里补一条迁移。
 */
const migrations: Record<number, Migration> = {}

/** 读取任意版本的 meeting.json，逐级迁移到当前版本并校验 */
export function migrateMeeting(raw: unknown): Meeting {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('meeting.json 格式无效')
  }
  let data = raw as Record<string, unknown>
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
  if (version > MEETING_SCHEMA_VERSION) {
    throw new Error(
      `meeting.json 版本 v${version} 高于当前支持的 v${MEETING_SCHEMA_VERSION}，请升级插件`,
    )
  }
  while (version < MEETING_SCHEMA_VERSION) {
    const migrate = migrations[version]
    if (!migrate) throw new Error(`缺少 v${version} 的迁移`)
    data = { ...migrate(data), schemaVersion: version + 1 }
    version += 1
  }
  return Meeting.parse({ ...data, schemaVersion: version })
}
