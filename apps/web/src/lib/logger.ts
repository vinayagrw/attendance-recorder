// App-wide error / event logger.
// - Persists to IndexedDB so admins can inspect failures after the fact
// - Mirrors to console with structured context for live debugging
// - Dispatches `app:log` window events so UI surfaces (toast, error bar) can react
// - Caps at MAX_ENTRIES so we don't grow forever; also auto-prunes by age.
//
// Use:
//   import { logger } from '@/lib/logger'
//   logger.error(e, { module: 'WorkerPunch', action: 'submit', workerId })
//   logger.warn('GPS permission denied', { module: 'Register' })
//   logger.info('punch verified', { attendanceId })

const DB_NAME = 'attendance-logs'
const STORE = 'entries'
const VERSION = 1
const MAX_ENTRIES = 500
const MAX_AGE_DAYS = 14

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogContext {
  module?: string
  action?: string
  userId?: string
  workerId?: string
  siteId?: string
  attendanceId?: string
  status?: number | string
  // free-form tags
  [key: string]: unknown
}

export interface LogEntry {
  id?: number
  level: LogLevel
  message: string
  errorName?: string
  errorStack?: string
  context?: LogContext
  url: string
  userAgent: string
  timestamp: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('timestamp', 'timestamp')
        store.createIndex('level', 'level')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('logger: IDB open failed'))
  })
}

async function persist(entry: LogEntry): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).add(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Swallow IDB errors — logging should never break the app
  }
}

// Best-effort prune old entries
async function pruneOnce() {
  try {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const idx = store.index('timestamp')
    const range = IDBKeyRange.upperBound(cutoff)
    idx.openCursor(range).onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    await new Promise((r) => (tx.oncomplete = r as () => void))
    // Also cap total count
    const all: LogEntry[] = await new Promise((resolve) => {
      const tx2 = db.transaction(STORE, 'readonly')
      const req = tx2.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result as LogEntry[]) ?? [])
    })
    if (all.length > MAX_ENTRIES) {
      const toDelete = all
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, all.length - MAX_ENTRIES)
      const txDel = db.transaction(STORE, 'readwrite')
      for (const e of toDelete) if (e.id != null) txDel.objectStore(STORE).delete(e.id)
      await new Promise((r) => (txDel.oncomplete = r as () => void))
    }
    db.close()
  } catch {
    // best-effort
  }
}

let prunedThisSession = false

function dispatchLogEvent(entry: LogEntry) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('app:log', { detail: entry }))
}

function consoleEcho(entry: LogEntry) {
  const tag = `[${entry.level.toUpperCase()}]${entry.context?.module ? ` ${entry.context.module}` : ''}${entry.context?.action ? ` · ${entry.context.action}` : ''}`
  if (entry.level === 'error') {
    console.error(tag, entry.message, entry.context, entry.errorStack)
  } else if (entry.level === 'warn') {
    console.warn(tag, entry.message, entry.context)
  } else {
    console.info(tag, entry.message, entry.context)
  }
}

function buildEntry(
  level: LogLevel,
  message: string,
  err: Error | null,
  context?: LogContext,
): LogEntry {
  return {
    level,
    message,
    errorName: err?.name,
    errorStack: err?.stack,
    context,
    url: typeof location !== 'undefined' ? location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    timestamp: Date.now(),
  }
}

async function record(
  level: LogLevel,
  message: string,
  err: Error | null,
  context?: LogContext,
) {
  const entry = buildEntry(level, message, err, context)
  consoleEcho(entry)
  dispatchLogEvent(entry)
  await persist(entry)
  if (!prunedThisSession) {
    prunedThisSession = true
    void pruneOnce()
  }
}

export const logger = {
  info(message: string, context?: LogContext) {
    void record('info', message, null, context)
  },
  warn(message: string, context?: LogContext) {
    void record('warn', message, null, context)
  },
  error(err: unknown, context?: LogContext) {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err))
    void record('error', e.message, e, context)
  },

  async listRecent(limit = 100): Promise<LogEntry[]> {
    try {
      const db = await openDb()
      const all: LogEntry[] = await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).getAll()
        req.onsuccess = () => resolve((req.result as LogEntry[]) ?? [])
      })
      db.close()
      return all
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit)
    } catch {
      return []
    }
  },

  async clearAll(): Promise<void> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      await new Promise((r) => (tx.oncomplete = r as () => void))
      db.close()
    } catch {
      // best-effort
    }
  },
}

// Catch unhandled errors at the window level too, so a stray throw still gets logged.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    logger.error(e.error ?? e.message, {
      module: 'window.onerror',
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    logger.error(e.reason ?? 'unhandled promise rejection', {
      module: 'window.onunhandledrejection',
    })
  })
}
