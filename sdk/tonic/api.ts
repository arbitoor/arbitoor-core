import { MarketViewV1 } from '@tonic-foundation/tonic/lib/types/v1'
import { Provider, CodeResult } from 'near-workspaces'
import { TONIC } from '../constants'

// Fields returned by RPC but missing in Tonic SDK
export interface TonicMarket extends MarketViewV1 {
  state: 'Active' | 'Uninitialized',
}

export async function getTonicMarkets (
  provider: Provider,
  fromIndex: number = 0,
  limit: number = 100
): Promise<TonicMarket[]> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: TONIC,
    method_name: 'list_markets',
    args_base64: Buffer.from(JSON.stringify({
      from_index: fromIndex,
      limit
    })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString())
}
