import { mapValues, isString } from 'lodash'
import NimbuSDK from 'nimbu-js-sdk'
import Debug from 'debug'
import { v4 as uuid } from 'uuid'
import fetchMock from 'fetch-mock-jest'

jest.mock('localStorage', () => ({ getItem: jest.fn(), setItem: jest.fn() }), { virtual: true })

global.localStorage = require('localStorage')

export const mockAPI = fetchMock.sandbox()
const debug = Debug('nimbu:console.log')
const Nimbu = {
  ...NimbuSDK,
  Cloud: {
    // cloud code dsl
    extend: jest.fn(),
    job: jest.fn(),
    schedule: jest.fn(),
    unschedule: jest.fn(),
    define: jest.fn(),
    route: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    before: jest.fn(),
    after: jest.fn(),

    // nimbu-js-sdk method to invoke a cloud function
    run: jest.fn(),
  },
  Object: (...args: any[]) => {
    const result = new NimbuSDK.Object(...args)
    result.save = jest.fn()
    return result
  },
}

jest.spyOn(Nimbu, 'Object')

// beforeEach(() => Nimbu.Object.mockClear())
type ISetupOptions = {}

Nimbu.setAjax(
  (
    method: 'GET' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    data: any,
    headers: any,
    success: (args: any) => void,
    error: (args: any) => void,
  ) => {
    const future = new NimbuSDK.Future()
    const futureOptions = {
      success: success,
      error: error,
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    }

    if (data && method !== 'GET') {
      fetchOptions.body = JSON.stringify(data)
    }

    mockAPI(url, fetchOptions)
      .then(async (response: any) => {
        const body = await response.json()
        future.resolve(body)
      })
      .catch((error: any) => {
        future.reject(error)
      })

    return future._thenRunCallbacks(futureOptions)
  },
)

export async function setup(options: ISetupOptions = {}) {
  global.Nimbu = Nimbu

  // silence console.log in tests, but allow to be visible using DEBUG=nimbu
  console.log = debug

  await Nimbu.initialize(uuid())
}

const createMockQuery = (result: any) => ({
  equalTo: jest.fn().mockReturnThis(),
  first: () => NimbuSDK.Future.as(result),
})

export function mockQueryResults(resultsPerSlug: { [k: string]: any }) {
  const queriesPerSlug = mapValues(resultsPerSlug, (results) => results.map(createMockQuery))

  const mockPerSlug = mapValues(queriesPerSlug, (queries) =>
    queries.reduce(
      (mock, query) => mock.mockImplementation(() => query),
      jest.fn(() => createMockQuery(null)),
    ),
  )

  Nimbu.Query = function (slug: string) {
    if (!mockPerSlug[slug]) return createMockQuery(null)
    return mockPerSlug[slug]()
  }

  return queriesPerSlug
}

export function objectFromFixture(type: string, json: string | Object) {
  if (type == null) {
    throw new Error('type is required')
  }

  const data = isString(json) ? JSON.parse(json) : json
  const object = new NimbuSDK.Object(type)
  object._finishFetch(data, true)
  return object
}

export function customerFromFixture(json: string | Object) {
  return objectFromFixture('customer', json)
}

export default Nimbu
