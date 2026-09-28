import { InvalidPathError } from './errors'

/** 把 'a/b/c.json' 拆成 ['a', 'b', 'c.json']；拒绝空路径、'.'、'..'，保证只能写在根目录之内 */
export function splitPath(path: string): string[] {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) {
    throw new InvalidPathError(path)
  }
  return parts
}
