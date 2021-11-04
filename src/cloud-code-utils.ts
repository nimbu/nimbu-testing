import { matches } from 'lodash'
import Nimbu from './js-sdk-utils'

export function getExtendHandler(spec) {
  const matcher = matches(spec)
  const call = Nimbu.Cloud.extend.mock.calls.find(([view, slug, { name }]) => matcher({ view, slug, name }))
  if (!call) throw new Error(`no extend handler found matching ${JSON.stringify(spec)}`)
  return call[3]
}

export const getJobHandler = (nameSpec: string) => {
  const call = Nimbu.Cloud.job.mock.calls.find(([name]) => name === nameSpec)
  if (!call) throw new Error(`no job found matching ${JSON.stringify(nameSpec)}`)
  return call[1]
}
