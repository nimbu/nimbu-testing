import { matches } from 'lodash'
import Nimbu from './js-sdk-utils'
import { ViewType, EventType } from './types'
import { v4 as uuid } from 'uuid'

type CloudCodeRouteTypes = 'route' | 'get' | 'post' | 'put' | 'patch' | 'delete'
type CloudCodeCallbackTypes = 'before' | 'after'
type CloudCodeJobType = 'job'
type CloudCodeFunctionType = 'define'

const allEventTypes = Object.values(EventType)
const allViewTypes = Object.values(ViewType)

export enum CloudCodeHandleType {
  Route,
  Callback,
  Job,
  Function,
  Extension,
}

type ExtensionSpec = {
  view: ViewType
  name: string
  slug?: string
}

type CallbackSpec = {
  event: EventType
  slug?: string
}

function getNamedHandler(type: CloudCodeFunctionType | CloudCodeJobType, nameSpec: string) {
  const call = Nimbu.Cloud[type].mock.calls.find(([name]) => name === nameSpec)
  if (!call) throw new Error(`no ${type} handler found matching ${JSON.stringify(nameSpec)}`)
  return call[1]
}

function getCallbackHandler(type: CloudCodeCallbackTypes, spec: CallbackSpec) {
  if (spec == null || !allEventTypes.includes(spec.event)) {
    throw new Error(`invalid event type "${spec.event}"`)
  }

  const matcher = matches(spec)
  const call = Nimbu.Cloud[type].mock.calls.find(([event, slug]) => matcher({ event, slug }))
  if (!call) throw new Error(`no ${type} callback handler found matching ${JSON.stringify(spec)}`)
  return call[2]
}

export function getExtendHandler(spec: ExtensionSpec) {
  if (spec == null || !allViewTypes.includes(spec.view)) {
    throw new Error(`invalid view type "${spec.view}"`)
  }

  const matcher = matches(spec)
  const call = Nimbu.Cloud.extend.mock.calls.find(([view, slug, { name }]) => matcher({ view, slug, name }))
  if (!call) throw new Error(`no extend handler found matching ${JSON.stringify(spec)}`)
  return call[3]
}

export function getRouteHandler(verb: CloudCodeRouteTypes, routeSpec: string) {
  const type = verb.toLowerCase()
  let call = Nimbu.Cloud[type].mock.calls.find(([route]) => route === routeSpec)
  if (call != null) {
    return call[1]
  }

  // TODO: also match Nimbu.Cloud.route('GET', '/path', ...) routes

  if (!call) throw new Error(`no route handler found matching ${verb} ${JSON.stringify(routeSpec)}`)
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

/************************/
// Cloud Code Callbacks //
/************************/

type CloudCodeCallbackRequest = {
  object: typeof Nimbu.Object
  actor?: typeof Nimbu.Customer
  user?: NimbuBackendUser
  changes: {
    [field: string]: any[]
  }
  lastUpdatedAt?: Date
}

type CloudCodeCallbackResponse = {
  success: (message: string) => void
  error: (fieldOrMessage: string, messageForField?: string) => void
}

type CallbackMockRequestAttributes = Pick<CloudCodeCallbackRequest, 'object'> &
  Partial<Omit<CloudCodeCallbackRequest, 'object'>>

export function mockCallbackRequest(attributes: CallbackMockRequestAttributes) {
  const request: CloudCodeCallbackRequest = {
    changes: {},
    ...attributes,
  }
  const response: CloudCodeCallbackResponse = {
    success: jest.fn(),
    error: jest.fn((...args) => Nimbu.Future.error(...args)),
  }

  return { request, response }
}

/*********************/
// Cloud Code Routes //
/*********************/

type CloudCodeRouteRequest = {
  customer?: typeof Nimbu.Customer
  locale?: string
  path: string
  simulating?: boolean
  host?: string
  params?: {
    [param: string]: any
  }
  headers: {
    [header: string]: string
  }
}

type CloudCodeRouteResponse = {
  render: (template: string, variables?: any, options?: any) => void
  redirect_to: (path: string, options?: { success?: string; error?: string }) => void
  success: (args: any, options?: any) => void
  error: (status: number, message?: any) => void
  json: (object: Object, options?: { status?: number }) => void
  send: (variables: string, options?: { filename?: string; type?: string; status?: number }) => void
}

type RouteMockRequestAttributes = Pick<CloudCodeRouteRequest, 'path'> & Partial<Omit<CloudCodeRouteRequest, 'path'>>

export function mockRouteRequest(attributes: RouteMockRequestAttributes) {
  const request: CloudCodeRouteRequest = {
    locale: 'en',
    simulating: false,
    host: 'nimbu.test',
    params: {},
    headers: {},
    ...attributes,
  }
  const response: CloudCodeRouteResponse = {
    render: jest.fn(),
    redirect_to: jest.fn(),
    success: jest.fn(),
    error: jest.fn((...args) => Nimbu.Future.error(...args)),
    json: jest.fn(),
    send: jest.fn(),
  }

  return { request, response }
}

/******************************/
// Cloud Code Background Jobs //
/******************************/

type CloudCodeJobRequest = {
  params: {
    [param: string]: any
  }
}

type CloudCodeJobResponse = {
  success: (message: string) => void
  error: (message: string) => void
}

type JobMockRequestAttributes = Partial<CloudCodeJobRequest>

export function mockJobRequest(attributes: JobMockRequestAttributes = {}) {
  const request: CloudCodeJobRequest = {
    params: {},
    ...attributes,
  }
  const response: CloudCodeJobResponse = {
    success: jest.fn(),
    error: jest.fn((...args) => Nimbu.Future.error(...args)),
  }

  return { request, response }
}

/************************/
// Cloud Code Functions //
/************************/

type CloudCodeFunctionRequest = {
  params: {
    [param: string]: any
  }
  customer?: typeof Nimbu.Customer
  meta: {
    installation_id: string
    request_id: string
  }
}

type ErrorResponseWithStatus = (status: number, message: string) => void
type ErrorResponseWithMessage = (message: string) => void

type CloudCodeFunctionResponse = {
  success: (result: string | Object) => void
  error: ErrorResponseWithStatus | ErrorResponseWithMessage
}

type FunctionMockRequestAttributes = Partial<CloudCodeFunctionRequest>

export function mockFunctionRequest(attributes: FunctionMockRequestAttributes = {}) {
  const metaFromAttributes = attributes.meta || {}

  const request: CloudCodeJobRequest = {
    params: {},
    meta: {
      installation_id: uuid(),
      request_id: uuid(),
      ...metaFromAttributes,
    },
    ...attributes,
  }
  const response: CloudCodeJobResponse = {
    success: jest.fn(),
    error: jest.fn((...args) => Nimbu.Future.error(...args)),
  }

  return { request, response }
}

/*************************/
// Cloud Code Extensions //
/*************************/

type CloudCodeExtensionRequest = {
  params: {
    [param: string]: any
  }
  object?: typeof Nimbu.Object
  actor?: NimbuBackendUser
  user?: NimbuBackendUser
}

type DispositionType = 'inline' | 'attachment'
type CloudCodeExtensionResponse = {
  success: (args: any, options?: any) => void
  error: (status: number, message?: any) => void
  send: (variables: string, options?: { filename?: string; type?: string; disposition?: DispositionType }) => void
  redirect_to: (path: string, options?: { success?: string; error?: string }) => void
}

type ExtensionMockRequestAttributes = Partial<CloudCodeExtensionRequest>

export function mockExtensionRequest(attributes: ExtensionMockRequestAttributes = {}) {
  const request: CloudCodeExtensionRequest = {
    params: {},
    ...attributes,
  }
  const response: CloudCodeExtensionResponse = {
    success: jest.fn(),
    error: jest.fn((...args) => Nimbu.Future.error(...args)),
    send: jest.fn(),
    redirect_to: jest.fn(),
  }

  return { request, response }
}

/***********************/
// Everything together //
/***********************/

export function mockRequest(
  type: CloudCodeHandleType.Callback,
  attributes: CallbackMockRequestAttributes,
): { request: CloudCodeCallbackRequest; response: CloudCodeCallbackResponse }

export function mockRequest(
  type: CloudCodeHandleType.Route,
  attributes: RouteMockRequestAttributes,
): { request: CloudCodeRouteRequest; response: CloudCodeRouteResponse }

export function mockRequest(
  type: CloudCodeHandleType.Job,
  attributes: JobMockRequestAttributes,
): { request: CloudCodeJobRequest; response: CloudCodeJobResponse }

export function mockRequest(
  type: CloudCodeHandleType.Function,
  attributes?: FunctionMockRequestAttributes,
): { request: CloudCodeFunctionRequest; response: CloudCodeFunctionResponse }

export function mockRequest(
  type: CloudCodeHandleType.Extension,
  attributes: ExtensionMockRequestAttributes,
): { request: CloudCodeExtensionRequest; response: CloudCodeExtensionResponse }

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
