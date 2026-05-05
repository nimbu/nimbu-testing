import { createHash, randomUUID } from 'node:crypto'
import NimbuSDK from 'nimbu-js-sdk'
import Debug from 'debug'
import fetchMock from '@fetch-mock/jest'
import { EventType, ViewType } from './types'

jest.mock('localStorage', () => ({ getItem: jest.fn(), setItem: jest.fn() }), { virtual: true })

global.localStorage = require('localStorage')

fetchMock.config.allowRelativeUrls = true

const NimbuSDKAny = NimbuSDK as any
const debug = Debug('nimbu:console.log')

type JsonObject = Record<string, any>
type Handler = (...args: any[]) => any
type CallbackType = 'before' | 'after'

export type CloudCallbackDefinition = {
  type: CallbackType
  event: string
  target?: string
  handler: Handler
  sha: string
}

export type CloudRouteDefinition = {
  verb: string
  path: string
  handler: Handler
  sha: string
  order: number
  constraints?: object
}

export type CloudNamedDefinition = {
  name: string
  handler: Handler
  sha: string
}

export type CloudExtensionDefinition = {
  view: string
  type: string
  name: string
  handler: Handler
  scope?: string
  sha: string
}

export type CloudHandlers = {
  callbacks: CloudCallbackDefinition[]
  routes: CloudRouteDefinition[]
  functions: CloudNamedDefinition[]
  jobs: CloudNamedDefinition[]
  extensions: CloudExtensionDefinition[]
}

export type SetupOptions = {
  customer?: any
  user?: any
  siteEnv?: JsonObject
  locale?: string
  host?: string
  simulating?: boolean
  endpoint?: string
  accessToken?: string
  installationId?: string
  fixtures?: Record<string, any[]>
  modules?: Record<string, any>
}

const availableCallbacks = new Set(Object.values(EventType))
const scopeableCallbacks = new Set([
  'channel.entries.created',
  'channel.entries.updated',
  'channel.entries.deleted',
  'order.created',
  'order.updated',
  'order.paid',
  'order.fulfilled',
  'order.canceled',
  'order.reopened',
  'product.created',
  'product.updated',
  'product.deleted',
  'customer.created',
  'customer.updated',
  'customer.deleted',
])

const extensionTypes = new Set(['action', 'link', 'bulk_action'])

const store = new Map<string, Map<string, any>>()
const deletedStore = new Map<string, JsonObject[]>()
const moduleMocks = new Map<string, any>()
let currentContext: Required<Pick<SetupOptions, 'locale' | 'host' | 'simulating'>> &
  Pick<SetupOptions, 'customer' | 'user' | 'siteEnv'> = {
  locale: 'en',
  host: 'nimbu.test',
  simulating: false,
  customer: undefined,
  user: undefined,
  siteEnv: {},
}

function mapValues<T, U>(object: Record<string, T>, iteratee: (value: T, key: string) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, iteratee(value, key)]))
}

function sha(input: string) {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function clone<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Date) return new Date(value.getTime()) as T
  return JSON.parse(JSON.stringify(value))
}

function isNimbuObjectLike(value: any) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.get === 'function' &&
    typeof value.set === 'function' &&
    typeof value._getSaveJSON === 'function'
  )
}

function readField(object: any, field: string) {
  if (isNimbuObjectLike(object)) {
    if (field === 'id') return object.id
    if (field === 'className') return object.className
    return object.get(field)
  }
  return object[field]
}

function ensureClassStore(className: string) {
  let classStore = store.get(className)
  if (!classStore) {
    classStore = new Map()
    store.set(className, classStore)
  }
  return classStore
}

function serializeObject(object: any): JsonObject {
  const json = typeof object.toJSON === 'function' ? object.toJSON() : { ...object.attributes }
  if (object.id != null) json.id = object.id
  if (object.className != null) json.className = object.className
  return clone(json)
}

function objectFromStore(className: string, data: any) {
  if (isNimbuObjectLike(data)) return patchObjectPersistence(data)

  const object = new NimbuSDKAny.Object(className)
  object._finishFetch(clone({ className, ...data }), true)
  patchObjectPersistence(object)
  return object
}

function saveToStore(object: any) {
  const className = object.className
  if (!className) throw new Error('Cannot save a Nimbu object without a className')
  if (!object.id) object.id = randomUUID()

  const classStore = ensureClassStore(className)
  if (isNimbuObjectLike(object)) {
    classStore.set(object.id, object)
    return object
  }

  classStore.set(object.id, serializeObject(object))
  return objectFromStore(className, classStore.get(object.id)!)
}

function destroyFromStore(object: any) {
  if (!object.className || !object.id) return object

  const classStore = ensureClassStore(object.className)
  const deleted = classStore.get(object.id)
  if (deleted) {
    classStore.delete(object.id)
    const deletedForClass = deletedStore.get(object.className) || []
    deletedForClass.push({ id: object.id, deleted_at: new Date().toISOString() })
    deletedStore.set(object.className, deletedForClass)
  }
  return object
}

function patchObjectPersistence(object: any) {
  object.save = jest.fn(async (arg1?: any, arg2?: any, arg3?: any) => {
    if (typeof arg1 === 'string') {
      object.set(arg1, arg2, arg3)
    } else if (arg1 && typeof arg1 === 'object') {
      object.set(arg1, arg2)
    }
    const saved = saveToStore(object)
    object._finishFetch(serializeObject(saved), true)
    return object
  })

  object.destroy = jest.fn(async () => destroyFromStore(object))
  object.fetch = jest.fn(async () => {
    if (!object.id) throw new NimbuSDKAny.Error(101, 'Object not found.')
    const data = store.get(object.className)?.get(object.id)
    if (!data) throw new NimbuSDKAny.Error(101, 'Object not found.')
    object._finishFetch(clone(data), true)
    return object
  })

  return object
}

class TestingQuery {
  className: string
  private filters: Array<(object: JsonObject) => boolean> = []
  private sorters: Array<{ field: string; direction: 'asc' | 'desc' }> = []
  private skipCount = 0
  private limitCount = -1

  equalTo = jest.fn((field: string, value: any) => {
    this.filters.push((object) => readField(object, field) === value)
    return this
  })

  notEqualTo = jest.fn((field: string, value: any) => {
    this.filters.push((object) => readField(object, field) !== value)
    return this
  })

  lessThan = jest.fn((field: string, value: any) => {
    this.filters.push((object) => readField(object, field) < value)
    return this
  })

  greaterThan = jest.fn((field: string, value: any) => {
    this.filters.push((object) => readField(object, field) > value)
    return this
  })

  lessThanOrEqualTo = jest.fn((field: string, value: any) => {
    this.filters.push((object) => readField(object, field) <= value)
    return this
  })

  greaterThanOrEqualTo = jest.fn((field: string, value: any) => {
    this.filters.push((object) => readField(object, field) >= value)
    return this
  })

  containedIn = jest.fn((field: string, values: any[]) => {
    this.filters.push((object) => values.includes(readField(object, field)))
    return this
  })

  notContainedIn = jest.fn((field: string, values: any[]) => {
    this.filters.push((object) => !values.includes(readField(object, field)))
    return this
  })

  containsAll = jest.fn((field: string, values: any[]) => {
    this.filters.push((object) => {
      const fieldValue = readField(object, field)
      return Array.isArray(fieldValue) && values.every((value) => fieldValue.includes(value))
    })
    return this
  })

  exists = jest.fn((field: string) => {
    this.filters.push((object) => readField(object, field) != null)
    return this
  })

  doesNotExist = jest.fn((field: string) => {
    this.filters.push((object) => readField(object, field) == null)
    return this
  })

  matches = jest.fn((field: string, pattern: RegExp | string) => {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern)
    this.filters.push((object) => regex.test(String(readField(object, field) ?? '')))
    return this
  })

  startsWith = jest.fn((field: string, value: string) => {
    this.filters.push((object) => String(readField(object, field) ?? '').startsWith(value))
    return this
  })

  endsWith = jest.fn((field: string, value: string) => {
    this.filters.push((object) => String(readField(object, field) ?? '').endsWith(value))
    return this
  })

  ascending = jest.fn((field: string) => {
    this.sorters.push({ field, direction: 'asc' })
    return this
  })

  descending = jest.fn((field: string) => {
    this.sorters.push({ field, direction: 'desc' })
    return this
  })

  include = jest.fn(() => this)
  only = jest.fn(() => this)
  geoIntersects = jest.fn(() => this)
  geoWithin = jest.fn(() => this)
  near = jest.fn(() => this)
  nearCoordinates = jest.fn(() => this)

  skip = jest.fn((count: number) => {
    this.skipCount = count
    return this
  })

  page = jest.fn((page: number) => {
    if (this.limitCount > 0) this.skipCount = (page - 1) * this.limitCount
    return this
  })

  per = jest.fn((count: number) => {
    this.limitCount = count
    return this
  })

  limit = jest.fn((count: number) => {
    this.limitCount = count
    return this
  })

  constructor(className: string) {
    this.className = className
  }

  private rawResults() {
    let results = Array.from(ensureClassStore(this.className).values())
    results = results.filter((object) => this.filters.every((filter) => filter(object)))
    for (const { field, direction } of this.sorters) {
      results.sort((left, right) => {
        const leftValue = readField(left, field)
        const rightValue = readField(right, field)
        if (leftValue === rightValue) return 0
        const comparison = leftValue > rightValue ? 1 : -1
        return direction === 'asc' ? comparison : -comparison
      })
    }
    if (this.skipCount > 0) results = results.slice(this.skipCount)
    if (this.limitCount >= 0) results = results.slice(0, this.limitCount)
    return results
  }

  find = jest.fn(async () => this.rawResults().map((data) => objectFromStore(this.className, data)))

  findAll = jest.fn(async () => this.find())

  first = jest.fn(async () => {
    const [first] = await this.limit(1).find()
    return first
  })

  get = jest.fn(async (id: string) => {
    const data = ensureClassStore(this.className).get(id)
    if (!data) throw new NimbuSDKAny.Error(101, 'Object not found.')
    return objectFromStore(this.className, data)
  })

  count = jest.fn(async () => this.rawResults().length)

  findDeleted = jest.fn(async () => clone(deletedStore.get(this.className) || []))

  eachBatch = jest.fn(async (callback: (objects: any[]) => any, options: { batchSize?: number } = {}) => {
    const batchSize = options.batchSize || 100
    const results = await this.find()
    for (let index = 0; index < results.length; index += batchSize) {
      await Promise.resolve(callback(results.slice(index, index + batchSize)))
    }
  })

  collection = jest.fn((items: any[] = []) => {
    const collection = {
      models: items,
      fetch: jest.fn(async () => {
        collection.models = await this.find()
        return collection
      }),
    }
    return collection
  })
}

const queryHistory: Record<string, TestingQuery[]> = {}
const configuredQueryQueues: Record<string, TestingQuery[]> = {}

function createQuery(className: string) {
  const queued = configuredQueryQueues[className]?.shift()
  if (queued) return queued

  const query = new TestingQuery(className)
  queryHistory[className] ||= []
  queryHistory[className].push(query)
  return query
}

const handlers: CloudHandlers = {
  callbacks: [],
  routes: [],
  functions: [],
  jobs: [],
  extensions: [],
}

function resetHandlers() {
  handlers.callbacks = []
  handlers.routes = []
  handlers.functions = []
  handlers.jobs = []
  handlers.extensions = []
  Nimbu.Cloud.internal.schedules = []
}

function registerCallback(type: CallbackType, ...args: any[]) {
  const handler = args.pop()
  const candidates = args.filter((arg) => arg != null)
  const events = candidates.filter((arg) => scopeableCallbacks.has(arg) || String(arg).includes('.'))
  const target = candidates.find((arg) => !events.includes(arg))

  for (const event of events) {
    handlers.callbacks.push({
      type,
      event,
      target,
      handler,
      sha: sha(`${event}.${type}.${target ?? ''}.${handler.toString()}`),
    })
  }
}

function registerRoute(verb: string, path: string, constraintsOrHandler: object | Handler, maybeHandler?: Handler) {
  const constraints = typeof constraintsOrHandler === 'function' ? undefined : constraintsOrHandler
  const handler = (typeof constraintsOrHandler === 'function' ? constraintsOrHandler : maybeHandler) as
    | Handler
    | undefined
  if (typeof handler !== 'function') throw new Error('Invalid route handler')

  handlers.routes.push({
    verb,
    path,
    constraints,
    handler,
    order: handlers.routes.length,
    sha: sha(`${verb}.${path}.${handler.toString()}`),
  })
}

function registerExtension(...args: any[]) {
  const view = args.shift()
  const handler = args.pop()
  const maybeOptions = args[args.length - 1]
  const options =
    maybeOptions != null && typeof maybeOptions === 'object' && !Array.isArray(maybeOptions) ? args.pop() : {}
  const scopes = args
  const name = options.name
  if (name == null) throw new Error(`Invalid extension name given for view '${view}'`)
  const type = extensionTypes.has(options.type) ? options.type : 'action'
  const targets = scopes.length > 0 ? scopes : [undefined]

  for (const scope of targets) {
    handlers.extensions.push({
      view,
      type,
      name,
      handler,
      scope,
      sha: sha([view, type, name, scope].filter(Boolean).join('.')),
    })
  }
}

function cloudMethod<T extends (...args: any[]) => any>(implementation: T) {
  return jest.fn(implementation)
}

const Cloud = {
  internal: {
    schedules: [] as Array<{ name: string; timing: any; data: any; sha: string }>,
    handlers,
    hash64: sha,
    availableCallbacks: () => Array.from(availableCallbacks),
    scopeableCallbacks: () => Array.from(scopeableCallbacks),
    availableExtensionViews: () => Object.values(ViewType),
    scopeableExtensionViews: () => ['channel.entries.list', 'channel.entries.show'],
    availableExtensionTypes: () => Array.from(extensionTypes),
    testCrontab: () => true,
    require: (name: string) => getModuleMock(name),
  },
  extend: cloudMethod(registerExtension),
  job: cloudMethod((name: string, handler: Handler) => {
    handlers.jobs.push({ name, handler, sha: sha(`${name}.${handler.toString()}`) })
  }),
  schedule: cloudMethod((name: string, data = {}, timing: any = {}) => {
    Cloud.internal.schedules.push({
      name,
      data,
      timing: timing.every ?? timing,
      sha: sha(`${name}.${timing.every ?? ''}`),
    })
  }),
  unschedule: cloudMethod(jest.fn()),
  define: cloudMethod((name: string, handler: Handler) => {
    handlers.functions.push({ name, handler, sha: sha(`${name}.${handler.toString()}`) })
  }),
  route: cloudMethod(registerRoute),
  get: cloudMethod((path: string, constraintsOrHandler: object | Handler, maybeHandler?: Handler) =>
    registerRoute('get', path, constraintsOrHandler, maybeHandler),
  ),
  post: cloudMethod((path: string, constraintsOrHandler: object | Handler, maybeHandler?: Handler) =>
    registerRoute('post', path, constraintsOrHandler, maybeHandler),
  ),
  put: cloudMethod((path: string, constraintsOrHandler: object | Handler, maybeHandler?: Handler) =>
    registerRoute('put', path, constraintsOrHandler, maybeHandler),
  ),
  patch: cloudMethod((path: string, constraintsOrHandler: object | Handler, maybeHandler?: Handler) =>
    registerRoute('patch', path, constraintsOrHandler, maybeHandler),
  ),
  delete: cloudMethod((path: string, constraintsOrHandler: object | Handler, maybeHandler?: Handler) =>
    registerRoute('delete', path, constraintsOrHandler, maybeHandler),
  ),
  before: cloudMethod((...args: any[]) => registerCallback('before', ...args)),
  after: cloudMethod((...args: any[]) => registerCallback('after', ...args)),
  run: jest.fn(),
}

const ObjectFactory = jest.fn((...args: any[]) => patchObjectPersistence(new NimbuSDKAny.Object(...args)))
Object.assign(ObjectFactory, NimbuSDKAny.Object)

const QueryFactory: any = (className: string) => createQuery(className)
QueryFactory.or = jest.fn((...queries: TestingQuery[]) => {
  const query = createQuery(queries[0]?.className)
  ;(query as any).filters.push((object: JsonObject) =>
    queries.some((candidate) =>
      (candidate as any).filters.every((filter: (value: JsonObject) => boolean) => filter(object)),
    ),
  )
  return query
})

function installSdkFactories() {
  ObjectFactory.mockImplementation((...args: any[]) => patchObjectPersistence(new NimbuSDKAny.Object(...args)))
  Nimbu.Query = QueryFactory
}

const Nimbu: any = {
  ...NimbuSDKAny,
  Cloud,
  Object: ObjectFactory,
  Query: QueryFactory,
  Site: {
    env: new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'get') return (key: string) => currentContext.siteEnv?.[key]
          if (property === 'has')
            return (key: string) => Object.prototype.hasOwnProperty.call(currentContext.siteEnv || {}, key)
          if (property === 'keys') return () => Object.keys(currentContext.siteEnv || {})
          return currentContext.siteEnv?.[String(property)]
        },
      },
    ),
  },
}

delete Nimbu.Future

function seedFixture(className: string, entries: any[]) {
  const classStore = ensureClassStore(className)
  for (const entry of entries) {
    if (entry == null) continue

    if (isNimbuObjectLike(entry)) {
      if (!entry.id) entry.id = randomUUID()
      patchObjectPersistence(entry)
      classStore.set(entry.id, entry)
    } else {
      const id = entry.id ?? randomUUID()
      classStore.set(id, clone({ ...entry, id, className }))
    }
  }
}

function resetStore() {
  store.clear()
  deletedStore.clear()
  for (const key of Object.keys(queryHistory)) delete queryHistory[key]
  for (const key of Object.keys(configuredQueryQueues)) delete configuredQueryQueues[key]
}

function resetCloudMocks() {
  Object.values(Cloud).forEach((value) => {
    if (jest.isMockFunction(value)) value.mockClear()
  })
}

function parseRequestBody(data: any) {
  if (typeof data !== 'string') return data
  if (!data) return undefined
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

function handleStoreAPI(method: string, url: string, data: any) {
  const parsedUrl = new URL(url, 'https://api.nimbu.io')
  const path = parsedUrl.pathname.replace(/^\/+/, '')
  const channelMatch = path.match(/^channels\/([^/]+)\/entries(?:\/([^/]+))?$/)
  const pageMatch = path.match(/^pages\/(.+)$/)

  if (channelMatch) {
    const [, className, id] = channelMatch
    const classStore = ensureClassStore(className)
    if (method === 'GET' && id) {
      const entry = classStore.get(id)
      return entry == null ? undefined : serializeObject(entry)
    }
    if (method === 'GET') return Array.from(classStore.values()).map(serializeObject)
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && id) {
      const body = parseRequestBody(data) || {}
      const existing = classStore.get(id)
      if (isNimbuObjectLike(existing)) {
        existing.set(body)
        classStore.set(id, existing)
        return serializeObject(existing)
      }
      const entry = { ...(existing || {}), ...body, id, className }
      classStore.set(id, entry)
      return clone(entry)
    }
    if (method === 'POST') {
      const body = parseRequestBody(data) || {}
      const newId = body.id ?? randomUUID()
      const entry = { ...body, id: newId, className }
      classStore.set(newId, entry)
      return clone(entry)
    }
    if (method === 'DELETE' && id) {
      classStore.delete(id)
      return ''
    }
  }

  if (pageMatch && method === 'GET') {
    const page = store.get('pages')?.get(pageMatch[1])
    return page == null ? undefined : serializeObject(page)
  }

  return undefined
}

function installAjax(useStoreFallback: boolean) {
  Nimbu.setAjax(async (method: string, url: string, data: any, headers: any = {}) => {
    const fetchOptions: RequestInit = { method, headers }
    if (data && method !== 'GET') fetchOptions.body = typeof data === 'string' ? data : JSON.stringify(data)

    try {
      const response = await mockAPI(url, fetchOptions)
      const body = response.status !== 204 ? await response.json() : ''
      return { body, status: response.status, xhr: response }
    } catch (error) {
      if (useStoreFallback) {
        const body = handleStoreAPI(method, url, data)
        if (body !== undefined) return { body, status: method === 'POST' ? 201 : 200 }
      }
      throw error
    }
  })
}

export const mockAPI: any = new Proxy(
  (url: string | URL | Request, init?: RequestInit) => fetchMock.fetchHandler(url, init),
  {
    get(_target, property) {
      const value = (fetchMock as any)[property]
      return typeof value === 'function' ? value.bind(fetchMock) : value
    },
    set(_target, property, value) {
      ;(fetchMock as any)[property] = value
      return true
    },
  },
)

export async function setup(options: SetupOptions = {}) {
  ;(globalThis as any).Nimbu = Nimbu
  console.log = debug

  installSdkFactories()
  resetHandlers()
  resetCloudMocks()
  resetStore()
  moduleMocks.clear()
  if (typeof mockAPI.reset === 'function') mockAPI.reset()

  currentContext = {
    locale: options.locale ?? 'en',
    host: options.host ?? 'nimbu.test',
    simulating: options.simulating ?? false,
    customer: options.customer,
    user: options.user,
    siteEnv: options.siteEnv ?? {},
  }

  Object.entries(options.fixtures || {}).forEach(([className, entries]) => seedFixture(className, entries))
  Object.entries(options.modules || {}).forEach(([name, mock]) => mockModule(name, mock))

  const endpoint = options.endpoint ?? 'https://api.nimbu.io'
  installAjax(false)
  await Nimbu.initialize(options.accessToken ?? randomUUID(), endpoint, options.installationId ?? randomUUID())

  return Nimbu
}

export function getTestingContext() {
  return currentContext
}

export function getStoreSnapshot(className: string) {
  return Array.from(ensureClassStore(className).values()).map(serializeObject)
}

export function mockNimbuAPI() {
  installAjax(true)
  return mockAPI
}

export function mockQueryResults(resultsPerSlug: { [k: string]: any[] } = {}) {
  installSdkFactories()
  if (Object.keys(resultsPerSlug).length === 0) {
    resetStore()
    return {}
  }

  Object.entries(resultsPerSlug).forEach(([slug, entries]) => {
    ensureClassStore(slug).clear()
    deletedStore.delete(slug)
    configuredQueryQueues[slug] = []
    queryHistory[slug] = []
    seedFixture(slug, entries)
  })

  return mapValues(resultsPerSlug, (_results, slug) => {
    const query = new TestingQuery(slug)
    if (_results.length > 0 && _results[0] == null) {
      query.first.mockResolvedValue(_results[0])
    }
    configuredQueryQueues[slug] = [query]
    queryHistory[slug] ||= []
    queryHistory[slug].push(query)
    return [query]
  })
}

export function objectFromFixture(type: string, json: string | object) {
  if (type == null) {
    throw new Error('type is required')
  }

  const data = typeof json === 'string' ? JSON.parse(json) : json
  return objectFromStore(type, { ...(data as JsonObject), className: type })
}

export function customerFromFixture(json: string | object) {
  return objectFromFixture('customer', json)
}

export function mockModule(name: string, implementation: any) {
  moduleMocks.set(name, implementation)
  return implementation
}

export function getModuleMock(name: string) {
  if (!moduleMocks.has(name)) throw new Error(`No mock registered for Cloud Code module '${name}'`)
  return moduleMocks.get(name)
}

export function clearModuleMocks() {
  moduleMocks.clear()
}

export default Nimbu
