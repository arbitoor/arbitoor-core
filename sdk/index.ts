import { Provider } from 'near-api-js/lib/providers'
import { CodeResult } from 'near-workspaces'

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

  constructor ({ provider, user, routeCacheDuration } : {
    provider: Provider,
    user: string,
    routeCacheDuration: number,
  }) {
    this.provider = provider
    this.user = user
    this.routeCacheDuration = routeCacheDuration
  }

  /**
   *
   * @param param0
   */
  async computeRoutes ({
    inputToken,
    outputToken,
    inputAmount,
    slippage,
    forceFetch = false
  }: ComputeRoutes) {
    // provider test
    const msg = await this.provider.query<CodeResult>({
      request_type: 'call_function',
      account_id: 'guest-book.testnet',
      method_name: 'getMessages',
      args_base64: '',
      finality: 'optimistic'
    }).then((res) => JSON.parse(Buffer.from(res.result).toString()))
    console.log('got msg', msg)

    console.log(inputToken, outputToken, inputAmount, slippage, forceFetch)

    // 1. Find all pool combinations for input and output tokens. Eg. (NEAR, USDC), (NEAR, USN, USDC)
    // 2. Rank these pools
  }
}
