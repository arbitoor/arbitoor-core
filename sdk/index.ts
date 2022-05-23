import { Provider } from 'near-api-js/lib/providers'
import { CodeResult } from 'near-workspaces'
import { ftGetTokenMetadata } from './ft-contract'
import { FormattedPool, RefPool } from './ref-utils'
import { stableSmart } from './smartRouteLogic.js'
import { EstimateSwapView, Pool } from './swap-service'

interface ComputeRoutes {
  inputToken: string,
  outputToken: string,
  inputAmount: string,
  slippage: number,
  forceFetch?: boolean,
}

export class Comet {
  // NEAR provider to fetch data
  provider: Provider
  // User address for swaps
  user: string
  // Data is refreshed priodically after this many milliseconds elapse
  routeCacheDuration: number

  constructor({ provider, user, routeCacheDuration }: {
    provider: Provider,
    user: string,
    routeCacheDuration: number,
  }) {
    this.provider = provider
    this.user = user
    this.routeCacheDuration = routeCacheDuration
  }

  /**
   * Fetch a number of REF pools
   * @param index Start index for pagination
   * @param limit Number of pools to fetch
   * @returns
   */
  async getRefPools(index: number, limit: number) {
    // TODO filter out illiquid pools. There are only 20 liquid pools out of 3k total

    const refPools = await this.provider.query<CodeResult>({
      request_type: 'call_function',
      account_id: 'v2.ref-finance.near',
      method_name: 'get_pools',
      args_base64: Buffer.from(JSON.stringify({ from_index: index, limit, })).toString("base64"),
      finality: 'optimistic'
    }).then((res) => JSON.parse(Buffer.from(res.result).toString()) as RefPool[])

    // TODO remove redundant fields
    const formattedPools = refPools.map(refPool => {
      const formattedPool = {
        id: index,
        token1Id: refPool.token_account_ids[0]!,
        token2Id: refPool.token_account_ids[1]!,
        token1Supply: refPool.amounts[0]!,
        token2Supply: refPool.amounts[1]!,
        fee: refPool.total_fee,
        shares: refPool.shares_total_supply,
        update_time: 100,
        token0_price: '0',
        Dex: 'ref',
        amounts: refPool.amounts,
        reserves: {
          [refPool.token_account_ids[0]!]: refPool.amounts[0]!,
          [refPool.token_account_ids[1]!]: refPool.amounts[1]!
        }
      } as FormattedPool
      ++index

      return formattedPool
    })

    return formattedPools
  }

  /**
   * Get REF pools having one of the tokens
   * @param token1
   * @param token2
   * @returns
   */
  async getPoolsWithEitherToken(token1: string, token2: string) {
    // TODO
    const pools = [
      ...await this.getRefPools(0, 500),
      ...await this.getRefPools(500, 500),
      ...await this.getRefPools(1000, 500),
      ...await this.getRefPools(1500, 500),
      ...await this.getRefPools(2000, 500),
      ...await this.getRefPools(2500, 500),
    ]
    return pools.filter(pool => {
      return pool.token1Id === token1 || pool.token1Id === token1
        || pool.token2Id === token2 || pool.token2Id === token2
    })
  }

  /**
   * Find trade routes from the input to output token, ranked by output amount.
   * @param param0
   */
  async computeRoutes({
    inputToken,
    outputToken,
    inputAmount,
    slippage,
    forceFetch = false
  }: ComputeRoutes) {
    const pools = await this.getPoolsWithEitherToken(inputToken, outputToken)

    return stableSmart(
      this.provider,
      pools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as Promise<EstimateSwapView[]> // works

    // item 1 and 2 can be part of the same route. Need another step to get output amounts


    // Convert into TX format. Look at SignedTransaction and Action objects
    //

  }
}
