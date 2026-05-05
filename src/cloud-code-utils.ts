import { randomUUID } from 'node:crypto'
import Nimbu, { getTestingContext } from './js-sdk-utils'
import { EventType, ViewType } from './types'

type CloudCodeRouteTypes = 'route' | 'get' | 'post' | 'put' | 'patch' | 'delete' | Uppercase<string>
type CloudCodeCallbackTypes = 'before' | 'after'
type CloudCodeJobType = 'job'
type CloudCodeFunctionType = 'define'

const allEventTypes = Object.values(EventType)
const allViewTypes = Object.values(ViewType)

function matchesSpec<T extends Record<string, any>>(spec: Partial<T>) {
  return (candidate: T) => Object.entries(spec).every(([key, value]) => candidate[key] === value)
}

function convert(value: any) {
  if (value != null && typeof value.toJSON === 'function') {
    try {
      return value.toJSON()
    } catch {
      return value
    }
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

export enum CloudCodeHandleType {
  Route,
  Callback,
  Job,
  Function,
  Extension,
}

type ExtensionSpec = {
  view: ViewType | string
  name: string
  slug?: string
  scope?: string
}

type CallbackSpec = {
  event: EventType | string
  slug?: string
  target?: string
}

function getNamedHandler(type: CloudCodeFunctionType | CloudCodeJobType, nameSpec: string) {
  const registryType = type === 'define' ? 'functions' : 'jobs'
  const definition = Nimbu.Cloud.internal.handlers[registryType].find(({ name }: { name: string }) => name === nameSpec)
  if (!definition) throw new Error(`no ${type} handler found matching ${JSON.stringify(nameSpec)}`)
  return definition.handler
}

function getCallbackDefinition(type: CloudCodeCallbackTypes, spec: CallbackSpec) {
  if (spec != null && spec.event != null && !allEventTypes.includes(spec.event as EventType)) {
    throw new Error(`invalid event type "${spec.event}"`)
  }

  const matcher = matchesSpec({ type, event: spec.event, target: spec.slug ?? spec.target })
  const definition = Nimbu.Cloud.internal.handlers.callbacks.find(matcher)
  if (!definition) throw new Error(`no ${type} callback handler found matching ${JSON.stringify(spec)}`)
  return definition
}

function getCallbackHandler(type: CloudCodeCallbackTypes, spec: CallbackSpec) {
  return getCallbackDefinition(type, spec).handler
}

function getExtensionDefinition(spec: ExtensionSpec) {
  if (spec != null && spec.view != null && !allViewTypes.includes(spec.view as ViewType)) {
    throw new Error(`invalid view type "${spec.view}"`)
  }

  const matcher = matchesSpec({
    view: spec.view,
    scope: spec.slug ?? spec.scope,
    name: spec.name,
  })
  const definition = Nimbu.Cloud.internal.handlers.extensions.find(matcher)
  if (!definition) throw new Error(`no extend handler found matching ${JSON.stringify(spec)}`)
  return definition
}

export function getExtendHandler(spec: ExtensionSpec) {
  return getExtensionDefinition(spec).handler
}

function getRouteDefinition(verb: CloudCodeRouteTypes, routeSpec: string) {
  const normalizedVerb = verb.toLowerCase() === 'route' ? undefined : verb.toLowerCase()
  const definition = Nimbu.Cloud.internal.handlers.routes.find(
    ({ verb: candidateVerb, path }: { verb: string; path: string }) =>
      path === routeSpec && (normalizedVerb == null || candidateVerb.toLowerCase() === normalizedVerb),
  )
  if (!definition) throw new Error(`no route handler found matching ${verb} ${JSON.stringify(routeSpec)}`)
  return definition
}

export function getRouteHandler(verb: CloudCodeRouteTypes, routeSpec: string) {
  return getRouteDefinition(verb, routeSpec).handler
}

export function getJobHandler(name: string) {
  return getNamedHandler('job', name)
}

export function getCloudFunctionHandler(name: string) {
  return getNamedHandler('define', name)
}

export function getBeforeCallbackHandler(spec: CallbackSpec) {
  return getCallbackHandler('before', spec)
}

export function getAfterCallbackHandler(spec: CallbackSpec) {
  return getCallbackHandler('after', spec)
}

type NimbuBackendUser = {
  id: string
  firstname: string
  lastname: string
  username: string
  name: string
  email: string
  role: string
  language: string
  timezone: string
  website?: string
  bio?: string
  two_factor_enabled: boolean
}

type CloudCodeCallbackRequest = {
  object: any
  actor?: any
  user?: NimbuBackendUser
  customer?: any
  changes: {
    [field: string]: any[]
  }
  lastUpdatedAt?: Date
  processors: {
    resize_image: jest.Mock
    resizeImage: jest.Mock
  }
}

class CallbackResponse {
  _error = false
  _validation_errors: Record<string, string[]> = {}
  _message?: string

  success = jest.fn((message?: string) => {
    this._error = false
    this._message = message
    return Promise.resolve(undefined)
  })

  error = jest.fn((fieldOrMessage: string, message: string | null = null) => {
    this._error = true
    if (message != null) {
      this._validation_errors[fieldOrMessage] ||= []
      this._validation_errors[fieldOrMessage].push(message)
    } else {
      this._message = fieldOrMessage
    }
    return Promise.reject(message ?? fieldOrMessage)
  })
}

type CallbackMockRequestAttributes = Pick<CloudCodeCallbackRequest, 'object'> &
  Partial<Omit<CloudCodeCallbackRequest, 'object'>>

export function mockCallbackRequest(attributes: CallbackMockRequestAttributes) {
  const context = getTestingContext()
  const resizeImage = jest.fn()
  const request: CloudCodeCallbackRequest = {
    changes: {},
    customer: context.customer,
    processors: {
      resize_image: resizeImage,
      resizeImage,
    },
    ...attributes,
  }
  const response = new CallbackResponse()

  return { request, response }
}

type CloudCodeRouteRequest = {
  customer?: any
  locale?: string
  path: string
  simulating?: boolean
  host?: string
  body?: any
  params?: {
    [param: string]: any
  }
  headers: {
    [header: string]: string
  }
  get: (key: string, options?: { encoding?: string }) => any
}

class RouteResponse {
  _action = 'raw'
  _status = 200
  _body: any
  _headers: any = {}
  _variables: any
  _flash: Record<string, any> = {}
  _template?: string
  _redirect_to?: string
  _rendering_options: any = {}
  _error = false

  render = jest.fn((template: string, variables = {}, options = {}) => {
    this._action = 'render'
    this._template = template
    this._variables = variables
    this._rendering_options = options
    return Promise.resolve(undefined)
  })

  success = jest.fn((body: any = undefined, options: { status?: number } = {}) => {
    this._action = body != null && typeof body === 'object' ? 'json' : 'raw'
    this._status = options.status ?? 200
    this._body = body
    return Promise.resolve(body)
  })

  error = jest.fn((statusOrMessage: number | string, message?: any) => {
    this._error = true
    this._action = 'raw'
    this._status = typeof statusOrMessage === 'number' ? statusOrMessage : 500
    const body = message ?? 'An error occurred'
    this._body = body != null && typeof body === 'object' ? JSON.stringify(body) : body
    return Promise.reject(this._body)
  })

  redirectTo = jest.fn((path: string, options: { success?: string; error?: string } = {}) => {
    this._action = 'redirect'
    this._redirect_to = path
    if (options.success != null) this._flash.success = options.success
    if (options.error != null) this._flash.error = options.error
    return Promise.resolve(undefined)
  })

  redirect_to = jest.fn((path: string, options?: { success?: string; error?: string }) =>
    this.redirectTo(path, options),
  )

  json = jest.fn((object: object, options: { status?: number } = {}) => {
    this._action = 'json'
    this._body = object
    this._status = options.status ?? 200
    return Promise.resolve(undefined)
  })

  send = jest.fn((variables: string, options: { filename?: string; type?: string; status?: number } = {}) => {
    this._action = 'send'
    this._variables = variables
    this._template = options.filename
    this._headers = options.type
    this._status = options.status ?? 200
    return Promise.resolve(undefined)
  })

  renderPageWith = jest.fn((data: any, options: { success?: string; error?: string } = {}) => {
    this._action = 'page'
    this._variables = data
    if (options.success != null) this._flash.success = options.success
    if (options.error != null) this._flash.error = options.error
    return Promise.resolve(undefined)
  })
}

type RouteMockRequestAttributes = Pick<CloudCodeRouteRequest, 'path'> & Partial<Omit<CloudCodeRouteRequest, 'path'>>

export function mockRouteRequest(attributes: RouteMockRequestAttributes) {
  const context = getTestingContext()
  const params = attributes.params ?? {}
  const request: CloudCodeRouteRequest = {
    locale: context.locale,
    simulating: context.simulating,
    host: context.host,
    customer: context.customer,
    params,
    headers: {},
    get: (key: string) => params[key],
    ...attributes,
  }
  const response = new RouteResponse()

  return { request, response }
}

type CloudCodeJobRequest = {
  params: {
    [param: string]: any
  }
}

class JobResponse {
  _error = false
  _message?: string
  _messages: string[] = []
  result: any

  success = jest.fn((message?: string) => {
    this._error = false
    this._message = message
    return Promise.resolve(this.result)
  })

  error = jest.fn((message: string) => {
    this._error = true
    this._message = message
    return Promise.reject(message)
  })

  message = jest.fn((message: string) => {
    this._messages.push(message)
    return Promise.resolve(message)
  })
}

type JobMockRequestAttributes = Partial<CloudCodeJobRequest>

export function mockJobRequest(attributes: JobMockRequestAttributes = {}) {
  const request: CloudCodeJobRequest = {
    params: {},
    ...attributes,
  }
  const response = new JobResponse()

  return { request, response }
}

type CloudCodeFunctionRequest = {
  params: {
    [param: string]: any
  }
  customer?: any
  meta: {
    installation_id: string
    request_id: string
  }
}

class FunctionResponse {
  _error = false
  _message = 'Running Cloud Function failed'
  _status?: number
  _result: any

  success = jest.fn((result: any) => {
    this._error = false
    this._result = result
    return Promise.resolve(result)
  })

  error = jest.fn((statusOrMessage: number | string, message: string | null = null) => {
    this._error = true
    if (message != null) {
      this._status = parseInt(String(statusOrMessage), 10)
      this._message = message
    } else if (Number.isInteger(statusOrMessage)) {
      this._status = statusOrMessage as number
    } else {
      this._message = statusOrMessage as string
    }
    return Promise.reject(message ?? statusOrMessage)
  })

  toPayload() {
    return {
      result: convert(this._result),
      message: convert(this._message),
      error: this._error,
      status: this._status,
    }
  }
}

type FunctionMockRequestAttributes = Partial<CloudCodeFunctionRequest>

export function mockFunctionRequest(attributes: FunctionMockRequestAttributes = {}) {
  const context = getTestingContext()
  const metaFromAttributes = attributes.meta || {}

  const request: CloudCodeFunctionRequest = {
    params: {},
    customer: context.customer,
    meta: {
      installation_id: randomUUID(),
      request_id: randomUUID(),
      ...metaFromAttributes,
    },
    ...attributes,
  }
  const response = new FunctionResponse()

  return { request, response }
}

type CloudCodeExtensionRequest = {
  params: {
    [param: string]: any
  }
  object?: any
  actor?: NimbuBackendUser
  user?: NimbuBackendUser
}

type DispositionType = 'inline' | 'attachment'
class ExtensionResponse {
  _error = false
  _message?: string
  _result: any
  _redirect_to?: string
  _action?: string
  _data: any

  success = jest.fn((message: any = null) => {
    this._error = false
    this._message = message ?? "You're extension ran successfully."
    return Promise.resolve(this._result)
  })

  error = jest.fn((message: any = null) => {
    this._error = true
    this._message = message ?? 'Running your cloud extension failed. Check the logs for more info.'
    return Promise.reject(this._message)
  })

  modal = jest.fn((config: any) => {
    if (config == null || typeof config !== 'object') throw new Error('Invalid modal config')
    this._action = 'modal'
    this._data = config
    return Promise.resolve(undefined)
  })

  send = jest.fn((data: string, options: { filename?: string; type?: string; disposition?: DispositionType } = {}) => {
    this._action = 'send'
    this._data = {
      filename: options.filename,
      type: options.type,
      disposition: options.disposition ?? 'inline',
      data,
    }
    return Promise.resolve(undefined)
  })

  redirectTo = jest.fn((path: string, options: { success?: string; error?: string } = {}) => {
    this._action = 'redirect'
    this._redirect_to = path
    if (options.success != null) this._message = options.success
    if (options.error != null) {
      this._error = true
      this._message = options.error
    }
    return Promise.resolve(undefined)
  })

  redirect_to = jest.fn((path: string, options?: { success?: string; error?: string }) =>
    this.redirectTo(path, options),
  )
}

type ExtensionMockRequestAttributes = Partial<CloudCodeExtensionRequest>

export function mockExtensionRequest(attributes: ExtensionMockRequestAttributes = {}) {
  const context = getTestingContext()
  const actor = attributes.actor ?? attributes.user ?? context.user
  const request: CloudCodeExtensionRequest = {
    params: {},
    actor,
    user: actor,
    ...attributes,
  }
  const response = new ExtensionResponse()

  return { request, response }
}

async function invokeHandler(handler: (...args: any[]) => any, request: any, response: any) {
  try {
    await Promise.resolve(handler(request, response))
  } catch (error) {
    if (!response._error) throw error
  }
}

export async function runCloudFunction(name: string, attributes: FunctionMockRequestAttributes = {}) {
  const handler = getCloudFunctionHandler(name)
  const { request, response } = mockFunctionRequest(attributes)
  try {
    await invokeHandler(handler, request, response)
  } catch (error: any) {
    response.error(error?.message ?? error ?? 'Unknown error').catch(() => undefined)
  }
  return response.toPayload()
}

export async function runJob(name: string, attributes: JobMockRequestAttributes = {}) {
  const handler = getJobHandler(name)
  const { request, response } = mockJobRequest(attributes)
  try {
    await invokeHandler(handler, request, response)
  } catch (error: any) {
    response.error(error?.message ?? error ?? 'Unknown error').catch(() => undefined)
  }
  return {
    error: response._error,
    message: response._message,
    messages: response._messages,
  }
}

export async function runCallback(
  type: CloudCodeCallbackTypes,
  spec: CallbackSpec,
  attributes: CallbackMockRequestAttributes,
) {
  const handler = getCallbackHandler(type, spec)
  const { request, response } = mockCallbackRequest(attributes)
  await invokeHandler(handler, request, response)
  return {
    object: request.object._getSaveJSON(),
    message: convert(response._message),
    success: !response._error,
    error: response._error,
    validation_errors: response._validation_errors,
  }
}

function prepareRoutePayload(response: RouteResponse) {
  switch (response._action) {
    case 'raw':
      return { status: response._status, headers: response._headers, body: response._body }
    case 'redirect':
      return { target: response._redirect_to, flash: response._flash }
    case 'render':
      return {
        template: response._template,
        data: response._variables,
        options: response._rendering_options,
        flash: response._flash,
      }
    case 'send':
      return { filename: response._template, data: response._variables, type: response._headers }
    case 'json':
      return { status: response._status, json: response._body }
    case 'page':
      return { data: response._variables, flash: response._flash }
    default:
      return {}
  }
}

export async function runRoute(
  method: CloudCodeRouteTypes,
  path: string,
  attributes: Partial<RouteMockRequestAttributes> = {},
) {
  const handler = getRouteHandler(method, path)
  const { request, response } = mockRouteRequest({ path, ...attributes })
  try {
    await invokeHandler(handler, request, response)
  } catch (error: any) {
    response.error(error?.message ?? error ?? 'Unknown error').catch(() => undefined)
  }
  return prepareRoutePayload(response)
}

function extensionData(response: ExtensionResponse) {
  if (response._action === 'send') return response._data
  if (response._action === 'modal') return response._data
  return null
}

export async function runExtension(spec: ExtensionSpec, attributes: ExtensionMockRequestAttributes = {}) {
  const handler = getExtendHandler(spec)
  const { request, response } = mockExtensionRequest(attributes)
  try {
    await invokeHandler(handler, request, response)
  } catch (error: any) {
    response.error(error?.message ?? error ?? 'Unknown error').catch(() => undefined)
  }
  return {
    result: convert(response._result),
    message: convert(response._message),
    error: response._error,
    redirect_to: response._redirect_to,
    action: response._action,
    data: extensionData(response),
  }
}

export function mockRequest(
  type: CloudCodeHandleType.Callback,
  attributes: CallbackMockRequestAttributes,
): { request: CloudCodeCallbackRequest; response: CallbackResponse }

export function mockRequest(
  type: CloudCodeHandleType.Route,
  attributes: RouteMockRequestAttributes,
): { request: CloudCodeRouteRequest; response: RouteResponse }

export function mockRequest(
  type: CloudCodeHandleType.Job,
  attributes: JobMockRequestAttributes,
): { request: CloudCodeJobRequest; response: JobResponse }

export function mockRequest(
  type: CloudCodeHandleType.Function,
  attributes?: FunctionMockRequestAttributes,
): { request: CloudCodeFunctionRequest; response: FunctionResponse }

export function mockRequest(
  type: CloudCodeHandleType.Extension,
  attributes: ExtensionMockRequestAttributes,
): { request: CloudCodeExtensionRequest; response: ExtensionResponse }

export function mockRequest(type: CloudCodeHandleType, attributes?: any): any {
  switch (type) {
    case CloudCodeHandleType.Callback:
      return mockCallbackRequest(attributes)
    case CloudCodeHandleType.Route:
      return mockRouteRequest(attributes)
    case CloudCodeHandleType.Job:
      return mockJobRequest(attributes)
    case CloudCodeHandleType.Function:
      return mockFunctionRequest(attributes)
    case CloudCodeHandleType.Extension:
      return mockExtensionRequest(attributes)
  }
}
