import { migrateMeeting, type Meeting } from '@huilu/core'
import { IdbJobStore } from '@huilu/pipeline/jobs'
import { extensionForMime, type LocalRecording } from '@huilu/recorder'
import {
  IdbHandleStore,
  LocalFolderStorageAdapter,
  editMeeting,
  type MeetingEdit,
  type FolderHandle,
  MeetingIndex,
  readMeetingDocument,
  scanMeetings,
  type MeetingDocument,
  type MeetingEntry,
} from '@huilu/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { opfs } from '@/platform/storage'
import { listRecordings, openRecordingTrack, useLocalRecordings } from './library'
import { dataFolderAuthorizedSetting } from './settings'

const index = new MeetingIndex()
const handles = new IdbHandleStore()
const jobs = new IdbJobStore()
let lastRoot: FolderHandle | undefined
async function currentRoot(): Promise<FolderHandle | undefined> {
  const root = await handles.get()
  if (root && lastRoot && (await root.isSameEntry(lastRoot))) return lastRoot
  lastRoot = root
  return root
}
export const meetingLibraryKey = ['meetingLibrary'] as const
export interface LibraryItem {
  key: string
  id?: string
  title: string
  meeting?: Meeting
  folder?: MeetingEntry
  local?: LocalRecording
  available: boolean
  root?: FolderHandle
}
export interface LibrarySnapshot {
  items: LibraryItem[]
  folderUnavailable: boolean
  scanFailed: boolean
}

async function loadFolderLibrary() {
  const [root, cached] = await Promise.all([currentRoot(), index.read().catch(() => undefined)])
  let entries: MeetingEntry[] = []
  let available = false
  let scanFailed = false
  if (root) {
    try {
      if (cached && Array.isArray(cached.entries) && (await root.isSameEntry(cached.root))) {
        entries = cached.entries.map((entry) => {
          if (
            !entry ||
            typeof entry.key !== 'string' ||
            typeof entry.dir !== 'string' ||
            (entry.issue !== undefined &&
              entry.issue !== 'damaged' &&
              entry.issue !== 'duplicate') ||
            (!entry.meeting && entry.issue !== 'damaged')
          )
            throw new Error('invalidIndex')
          return { ...entry, meeting: entry.meeting ? migrateMeeting(entry.meeting) : undefined }
        })
      }
    } catch {
      // The index is disposable: invalid handles or old cache shapes cannot block source reads.
      entries = []
    }
    const folder = LocalFolderStorageAdapter.forHandle(root)
    if (await folder.isReady()) {
      try {
        entries = await scanMeetings(folder)
        available = true
        await index.replace({ root, entries }).catch(() => {
          scanFailed = true
        })
      } catch {
        scanFailed = true
      }
    }
  }
  return { entries, root, available, scanFailed }
}

function combineLibrary(
  { entries, root, available, scanFailed }: Awaited<ReturnType<typeof loadFolderLibrary>>,
  local: LocalRecording[],
): LibrarySnapshot {
  const byId = new Map(local.map((r) => [r.id, r]))
  const items: LibraryItem[] = entries.map((entry) => {
    const recording = entry.meeting && byId.get(entry.meeting.id)
    if (entry.meeting) byId.delete(entry.meeting.id)
    return {
      key: `folder:${entry.key}`,
      id: entry.meeting?.id,
      title: entry.meeting?.title ?? entry.dir,
      meeting: entry.meeting,
      folder: entry,
      local: recording,
      available,
      root,
    }
  })
  for (const recording of byId.values())
    items.push({
      key: `local:${recording.id}`,
      id: recording.id,
      title: recording.title,
      local: recording,
      available: true,
    })
  items.sort(
    (a, b) =>
      (b.meeting ? Date.parse(b.meeting.createdAt) : (b.local?.startedAt ?? 0)) -
      (a.meeting ? Date.parse(a.meeting.createdAt) : (a.local?.startedAt ?? 0)),
  )
  return { items, folderUnavailable: !!root && !available, scanFailed }
}

export async function loadLibrary(): Promise<LibrarySnapshot> {
  const [folder, local] = await Promise.all([loadFolderLibrary(), listRecordings()])
  return combineLibrary(folder, local)
}

export function useMeetingLibrary() {
  const client = useQueryClient()
  // Folder scans happen on entry/focus, explicit refresh, and invalidation.
  // The polling query only reads OPFS recordings; it never rebuilds the folder index.
  const folder = useQuery({ queryKey: meetingLibraryKey, queryFn: loadFolderLibrary })
  const local = useLocalRecordings()
  useEffect(
    () =>
      dataFolderAuthorizedSetting.watch(() => {
        void client.invalidateQueries({ queryKey: meetingLibraryKey })
      }),
    [client],
  )
  const data = useMemo(
    () => (folder.data && local.data ? combineLibrary(folder.data, local.data) : undefined),
    [folder.data, local.data],
  )
  return {
    data,
    isLoading: folder.isLoading || local.isLoading,
    isFetching: folder.isFetching || local.isFetching,
    error: folder.error ?? local.error,
    refetch: () => Promise.all([folder.refetch(), local.refetch()]),
  }
}
export interface ResultDocument extends MeetingDocument {
  dir: string
  source: 'folder' | 'local'
  local?: LocalRecording
  readOnly: boolean
  root?: FolderHandle
}
export async function loadResult(id: string): Promise<ResultDocument> {
  const library = await loadLibrary()
  const item = library.items.find((r) => r.id === id)
  if (item?.folder?.issue === 'duplicate') throw new Error('duplicateMeeting')
  const job = await jobs.get(id)
  if (item?.folder || job?.folderCommitted || job?.state === 'done') {
    const root = item?.root ?? (await currentRoot())
    if (!root) throw new Error('folderUnavailable')
    const folder = LocalFolderStorageAdapter.forHandle(root)
    if (!(await folder.isReady())) throw new Error('folderUnavailable')
    // Never silently substitute stale intermediate text for a missing/corrupt final record.
    const dir = item?.folder?.dir ?? job?.folderDir
    if (!dir) throw new Error('missingMeeting')
    return {
      ...(await readMeetingDocument(folder, dir, id)),
      dir,
      source: 'folder',
      root,
      local: item?.local,
      readOnly: !!item?.folder?.issue,
    }
  }
  if (!item?.local) throw new Error('missingMeeting')
  return {
    ...(await readMeetingDocument(opfs, id, id)),
    dir: id,
    source: 'local',
    local: item.local,
    readOnly: true,
  }
}

/** Use the metadata of the actual media source, including legacy OPFS recordings. */
export function resultMediaInfo(doc: ResultDocument, kind: 'audio' | 'video') {
  if (doc.source === 'folder') return doc.meeting.media?.[kind]
  const track = doc.local?.tracks[kind]
  return track && track.chunks > 0 ? track : undefined
}

export async function resultMedia(
  doc: ResultDocument,
  kind: 'audio' | 'video',
): Promise<Blob | undefined> {
  const info = resultMediaInfo(doc, kind)
  if (!info) return undefined
  if (doc.source === 'folder') {
    if (!doc.root) throw new Error('folderUnavailable')
    const folder = LocalFolderStorageAdapter.forHandle(doc.root)
    const blob = await folder.readFile(`${doc.dir}/${kind}.${extensionForMime(info.mimeType)}`)
    return blob?.slice(0, blob.size, info.mimeType.split(';')[0])
  }
  return doc.local ? openRecordingTrack(doc.local, kind) : undefined
}

export async function saveResultEdit(doc: ResultDocument, edit: MeetingEdit): Promise<Meeting> {
  const current = await handles.get()
  if (doc.readOnly || !doc.root || !current || !(await current.isSameEntry(doc.root)))
    throw new Error('folderChanged')
  return editMeeting(LocalFolderStorageAdapter.forHandle(doc.root), doc.dir, doc.meeting.id, edit)
}
