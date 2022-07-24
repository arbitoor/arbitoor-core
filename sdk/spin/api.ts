import { Provider, CodeResult } from 'near-workspaces'
import {
  Market as SpinMarket,
  GetOrderbookResponse as SpinOrderbook
} from '@spinfi/core'
import { SPIN } from '../constants'

export async function getSpinMarkets (provider: Provider): Promise<SpinMarket[]> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'get_markets',
    args_base64: '',
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinMarket[]
}

export interface SpinDryRunResult {
  /**
   * Input tokens are refunded so that slippage limit is not crossed.
   */
  refund: string;
  /**
   * The output amount. It includes the exchange fees.
   */
  received: string;

  /**
   * The exchange fee. Subtract fees from received to get the output amount for the user.
   */
  fee: string;
}

/**
 * Get swap estimate from RPC
 * @param param0
 * @returns
 */
export async function getDryRunSwap ({
  provider,
  marketId,
  price,
  token,
  amount
}: {
  provider: Provider,
  marketId: number,
  price: string,
  // input token
  token: string,
  amount: string
}): Promise<SpinDryRunResult> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'dry_run_swap',
    args_base64: Buffer.from(JSON.stringify({
      swap: {
        market_id: marketId,
        price
      },
      token,
      amount
    })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinDryRunResult
}

/**
 * Fetch a Spin orderbook from RPC
 * @param provider
 * @param marketId
 * @param limit
 * @returns
 */
export async function getSpinOrderbook (
  provider: Provider,
  marketId: number,
  limit: number = 50
): Promise<SpinOrderbook> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'get_orderbook',
    args_base64: Buffer.from(JSON.stringify({
      market_id: marketId,
      limit
    })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinOrderbook
}
