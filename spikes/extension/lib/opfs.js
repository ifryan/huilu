// OPFS 工具：录制分片按「录制 id / 轨道 / 序号」逐个写成独立文件，崩溃时已写完的分片都完整可用

export async function dirAt(path, create = true) {
  let dir = await navigator.storage.getDirectory()
  for (const name of path) dir = await dir.getDirectoryHandle(name, { create })
  return dir
}

export async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
}

export async function readText(dir, name) {
  try {
    const fh = await dir.getFileHandle(name)
    return await (await fh.getFile()).text()
  } catch {
    return undefined
  }
}

export async function listRecordings() {
  const root = await dirAt(['recordings'])
  const out = []
  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== 'directory') continue
    const meta = await readText(handle, 'meta.json')
    out.push({ id: name, meta: meta ? JSON.parse(meta) : null })
  }
  return out.sort((a, b) => b.id.localeCompare(a.id))
}

/** 按序号读出某条轨道的全部分片（File 对象是惰性的，不会把内容读进内存） */
export async function readParts(recId, track) {
  const dir = await dirAt(['recordings', recId, track], false)
  const files = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.endsWith('.part')) files.push(await handle.getFile())
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

/** 分片直接按顺序拼接：MediaRecorder 的 timeslice 输出本身就是一条连续字节流 */
export async function assemble(recId, track, type) {
  return new Blob(await readParts(recId, track), { type })
}

export async function removeRecording(recId) {
  const root = await dirAt(['recordings'])
  await root.removeEntry(recId, { recursive: true })
}
