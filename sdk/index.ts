import { Provider } from 'near-api-js/lib/providers'
import { CodeResult } from 'near-workspaces'
import { ftGetTokenMetadata } from './ft-contract'
import { stableSmart } from './smartRouteLogic.js'

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
   * Get all REF pools for a given token pair
   * @param inputToken
   * @param outputToken
   * @returns Array of pool data
   */
  async getPools(inputToken: string, outputToken: string) {
    // Must filter get_pools(). A subgraph would be good
    const pool = {
      "id": 0,
      "token1Id": "token.skyward.near",
      "token2Id": "wrap.near",
      "token1Supply": "75803389933388206770475",
      "token2Supply": "298359296296588325256362625360",
      "fee": 30,
      "shares": "10978869298293164291678580085",
      "update_time": 1652961867,
      "token0_price": "0",
      "Dex": "ref",
      "amounts": [
          "75803389933388206770475",
          "298359296296588325256362625360"
      ],
      "reserves": {
          "token.skyward.near": "75803389933388206770475",
          "wrap.near": "298359296296588325256362625360"
      }
  }

    return [pool]
  }
  /**
   *
   * @param param0
   */
  async computeRoutes({
    inputToken,
    outputToken,
    inputAmount,
    slippage,
    forceFetch = false
  }: ComputeRoutes) {
    // 1. Find all pool combinations for input and output tokens. Eg. (NEAR, USDC), (NEAR, USN, USDC)
    // 2. Rank these pools
    const pools = await this.getPools(inputToken, outputToken)

    const stableSmartResult = await stableSmart(
      this.provider,
      pools,
      "token.skyward.near",
      "wrap.near",
      "1000000000000000000",
      undefined
    ) // works
    console.log('best', stableSmartResult)

    // filter best pool- compare results of stableSmart() and getHybridStableSmart()
    // the later only works if either the input or output token is a stablecoin
  }
}
