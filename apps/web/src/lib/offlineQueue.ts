// Lightweight IndexedDB queue for punches that fail to reach the server
// (e.g. flaky 4G on a construction site). The queue persists across reloads;
// drainQueue() is called when navigator.onLine flips back to true.

const DB_NAME = 'attendance-offline'
const STORE = 'punches'
const VERSION = 1

interface QueuedItem<T = unknown> {
  id?: number
  payload: T
  queuedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

export async function enqueuePunch<T>(payload: T): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add({ payload, queuedAt: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('enqueue failed'))
  })
  db.close()
}

export async function listQueue<T = unknown>(): Promise<QueuedItem<T>[]> {
  const db = await openDb()
  const items = await new Promise<QueuedItem<T>[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as QueuedItem<T>[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('list failed'))
  })
  db.close()
  return items
}

export async function deleteQueued(id: number): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('delete failed'))
  })
  db.close()
}

export async function queueLength(): Promise<number> {
  try {
    return (await listQueue()).length
  } catch {
    return 0
  }
}

export type DrainHandler<T> = (payload: T) => Promise<{ ok: boolean }>

export async function drainQueue<T = unknown>(handler: DrainHandler<T>): Promise<{
  drained: number
  failed: number
}> {
  const items = await listQueue<T>()
  let drained = 0
  let failed = 0
  for (const item of items) {
    if (item.id == null) continue
    try {
      const result = await handler(item.payload)
      if (result.ok) {
        await deleteQueued(item.id)
        drained++
      } else {
        failed++
      }
    } catch {
      failed++
    }
  }
  return { drained, failed }
}
