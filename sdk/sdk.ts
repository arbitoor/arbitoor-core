import Big from 'big.js'
import { Provider } from 'near-api-js/lib/providers'
import { CodeResult } from 'near-workspaces'
import { ONE_YOCTO_NEAR, STORAGE_TO_REGISTER_WITH_MFT } from './constants'
import { ftGetStorageBalance, ftGetTokenMetadata, round, TokenMetadata } from './ft-contract'
import { RefFiFunctionCallOptions, Transaction } from './near'
import { percentLess, toReadableNumber, scientificNotationToString, toNonDivisibleNumber } from './numbers'
import { FormattedPool, RefPool } from './ref-utils'
import { stableSmart } from './smartRouteLogic.js'
import { EstimateSwapView, Pool, PoolMode } from './swap-service'

export interface ComputeRoutes {
  inputToken: string,
  outputToken: string,
  inputAmount: string,
  slippage: number,
  forceFetch?: boolean,
}

export interface SwapOptions {
  exchange: string,
  useNearBalance?: boolean;
  swapsToDo: EstimateSwapView[];
  tokenIn: TokenMetadata;
  tokenOut: TokenMetadata;
  amountIn: string;
  slippageTolerance: number;
}

export class Comet {
  // NEAR provider to fetch data
  provider: Provider
  // User address for swaps
  user: string
  // Data is refreshed priodically after this many milliseconds elapse
  routeCacheDuration: number

  constructor ({ provider, user, routeCacheDuration }: {
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
  async getPools (exchange: string, index: number, limit: number) {
    // TODO filter out illiquid pools. There are only 20 liquid pools out of 3k total

    const pools = await this.provider.query<CodeResult>({
      request_type: 'call_function',
      account_id: exchange,
      method_name: 'get_pools',
      args_base64: Buffer.from(JSON.stringify({ from_index: index, limit })).toString('base64'),
      finality: 'optimistic'
    }).then((res) => JSON.parse(Buffer.from(res.result).toString()) as RefPool[])

    // TODO remove redundant fields
    const formattedPools = pools.map(refPool => {
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
        Dex: exchange,
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
  async getPoolsWithEitherToken (exchange: string, token1: string, token2: string) {
    // TODO
    const pools = [
      ...await this.getPools(exchange, 0, 500),
      ...await this.getPools(exchange, 500, 500),
      ...await this.getPools(exchange, 1000, 500),
      ...await this.getPools(exchange, 1500, 500),
      ...await this.getPools(exchange, 2000, 500),
      ...await this.getPools(exchange, 2500, 500)
    ]

    return pools.filter(pool => {
      return pool.token1Id === token1 || pool.token1Id === token2 ||
        pool.token2Id === token1 || pool.token2Id === token2
    })
  }

  async nearInstantSwap ({
    exchange,
    tokenIn,
    tokenOut,
    amountIn,
    swapsToDo,
    slippageTolerance
  }: // minAmountOut,
  SwapOptions) {
    const transactions: Transaction[] = []
    const tokenInActions: RefFiFunctionCallOptions[] = []
    const tokenOutActions: RefFiFunctionCallOptions[] = []

    const registerToken = async (token: TokenMetadata) => {
      const tokenRegistered = await ftGetStorageBalance(this.provider, token.id, this.user).catch(() => {
        throw new Error(`${token.id} doesn't exist.`)
      })

      if (tokenRegistered === null) {
        tokenOutActions.push({
          methodName: 'storage_deposit',
          args: {
            registration_only: true,
            account_id: this.user
          },
          gas: '30000000000000',
          amount: STORAGE_TO_REGISTER_WITH_MFT
        })

        transactions.push({
          receiverId: token.id,
          functionCalls: tokenOutActions
        })
      }
    }

    const isParallelSwap = swapsToDo.every(
      (estimate) => estimate.status === PoolMode.PARALLEL
    )
    const isSmartRouteV1Swap = swapsToDo.every(
      (estimate) => estimate.status === PoolMode.SMART
    )

    if (isParallelSwap) {
      const swapActions = swapsToDo.map((s2d) => {
        const minTokenOutAmount = s2d.estimate
          ? percentLess(slippageTolerance, s2d.estimate)
          : '0'
        const allocation = toReadableNumber(
          tokenIn.decimals,
          scientificNotationToString(s2d.pool.partialAmountIn!)
        )

        return {
          pool_id: s2d.pool.id,
          token_in: tokenIn.id,
          token_out: tokenOut.id,
          amount_in: round(
            tokenIn.decimals,
            toNonDivisibleNumber(tokenIn.decimals, allocation)
          ),
          min_amount_out: round(
            tokenOut.decimals,
            toNonDivisibleNumber(tokenOut.decimals, minTokenOutAmount)
          )
        }
      })

      await registerToken(tokenOut)

      tokenInActions.push({
        methodName: 'ft_transfer_call',
        args: {
          receiver_id: exchange,
          amount: toNonDivisibleNumber(tokenIn.decimals, amountIn),
          msg: JSON.stringify({
            force: 0,
            actions: swapActions
          })
        },
        gas: '180000000000000',
        amount: ONE_YOCTO_NEAR
        // deposit: '1',
      })

      transactions.push({
        receiverId: tokenIn.id,
        functionCalls: tokenInActions
      })
    } else if (isSmartRouteV1Swap) {
      // making sure all actions get included for hybrid stable smart.
      await registerToken(tokenOut)
      var actionsList = []
      // let allSwapsTokens = swapsToDo.map((s) => [s.inputToken, s.outputToken]); // to get the hop tokens
      const amountInInt = new Big(amountIn)
        .times(new Big(10).pow(tokenIn.decimals))
        .toString()
      const swap1 = swapsToDo[0]!
      actionsList.push({
        pool_id: swap1.pool.id,
        token_in: swap1.inputToken,
        token_out: swap1.outputToken,
        amount_in: amountInInt,
        min_amount_out: '0'
      })
      const swap2 = swapsToDo[1]!
      actionsList.push({
        pool_id: swap2.pool.id,
        token_in: swap2.inputToken,
        token_out: swap2.outputToken,
        min_amount_out: round(
          tokenOut.decimals,
          toNonDivisibleNumber(
            tokenOut.decimals,
            percentLess(slippageTolerance, swapsToDo[1]!.estimate)
          )
        )
      })

      transactions.push({
        receiverId: tokenIn.id,
        functionCalls: [
          {
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: exchange,
              amount: toNonDivisibleNumber(tokenIn.decimals, amountIn),
              msg: JSON.stringify({
                force: 0,
                actions: actionsList
              })
            },
            gas: '180000000000000',
            amount: ONE_YOCTO_NEAR
          }
        ]
      })
    } else {
      // making sure all actions get included.
      await registerToken(tokenOut)
      var actionsList = []
      const allSwapsTokens = swapsToDo.map((s) => [s.inputToken, s.outputToken]) // to get the hop tokens
      for (const i in allSwapsTokens) {
        const swapTokens = allSwapsTokens[i]
        if (swapTokens![0] == tokenIn.id && swapTokens![1] == tokenOut.id) {
          // parallel, direct hop route.
          actionsList.push({
            pool_id: swapsToDo[i]!.pool.id,
            token_in: tokenIn.id,
            token_out: tokenOut.id,
            amount_in: swapsToDo[i]!.pool.partialAmountIn,
            min_amount_out: round(
              tokenOut.decimals,
              toNonDivisibleNumber(
                tokenOut.decimals,
                percentLess(slippageTolerance, swapsToDo[i]!.estimate)
              )
            )
          })
        } else if (swapTokens![0] == tokenIn.id) {
          // first hop in double hop route
          // TODO -- put in a check to make sure this first hop matches with the next (i+1) hop as a second hop.
          actionsList.push({
            pool_id: swapsToDo[i]!.pool.id,
            token_in: swapTokens![0],
            token_out: swapTokens![1],
            amount_in: swapsToDo[i]!.pool.partialAmountIn,
            min_amount_out: '0'
          })
        } else {
          // second hop in double hop route.
          // TODO -- put in a check to make sure this second hop matches with the previous (i-1) hop as a first hop.
          actionsList.push({
            pool_id: swapsToDo[i]!.pool.id,
            token_in: swapTokens![0],
            token_out: swapTokens![1],
            min_amount_out: round(
              tokenOut.decimals,
              toNonDivisibleNumber(
                tokenOut.decimals,
                percentLess(slippageTolerance, swapsToDo[i]!.estimate)
              )
            )
          })
        }
      }

      transactions.push({
        receiverId: tokenIn.id,
        functionCalls: [
          {
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: exchange,
              amount: toNonDivisibleNumber(tokenIn.decimals, amountIn),
              msg: JSON.stringify({
                force: 0,
                actions: actionsList
              })
            },
            gas: '180000000000000',
            amount: ONE_YOCTO_NEAR
          }
        ]
      })
    }

    return transactions
  };

  /**
   * Find trade routes from the input to output token, ranked by output amount.
   * @param param0
   */
  async computeRoutes ({
    inputToken,
    outputToken,
    inputAmount,
    slippage,
    forceFetch = false
  }: ComputeRoutes) {
    const refPools = await this.getPoolsWithEitherToken('v2.ref-finance.near', inputToken, outputToken)
    const jumboPools = await this.getPoolsWithEitherToken('v1.jumbo_exchange.near', inputToken, outputToken)

    const refActions = await stableSmart(
      this.provider,
      refPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    const jumboActions = await stableSmart(
      this.provider,
      jumboPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    return {
      ref: refActions,
      jumbo: jumboActions
    }
  }
}
