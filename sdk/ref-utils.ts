import { TokenInfo } from '@tonic-foundation/token-list'
import BigNumber from 'bignumber.js'
import { CodeResult, Provider } from 'near-workspaces'
import { REF, STABLE_POOL_ID } from './constants'
import { TokenMetadata } from './ft-contract'
import { toReadableNumber, scientificNotationToString, toPrecision } from './numbers'
import { getSwappedAmount, StablePool, StablePoolResponse, STABLE_LP_TOKEN_DECIMALS } from './stable-swap'
import { FormattedPool, Pool, RefPool, SwapActions } from './swap-service'

const FEE_DIVISOR = 10000

const getStablePoolEstimate = ({
  tokenIn,
  tokenOut,
  amountIn,
  stablePoolInfo,
  stablePool
}: {
  tokenIn: TokenMetadata;
  tokenOut: TokenMetadata;
  amountIn: string;
  stablePoolInfo: StablePool;
  stablePool: Pool;
}) => {
  const [amount_swapped, fee, dy] = getSwappedAmount(
    tokenIn.id,
    tokenOut.id,
    amountIn,
    stablePoolInfo
  ) as [number, number, number]

  const amountOut =
    amount_swapped < 0
      ? '0'
      : toPrecision(scientificNotationToString(amount_swapped.toString()), 0)

  const dyOut =
    amount_swapped < 0
      ? '0'
      : toPrecision(scientificNotationToString(dy.toString()), 0)

  return {
    estimate: toReadableNumber(STABLE_LP_TOKEN_DECIMALS, amountOut),
    noFeeAmountOut: toReadableNumber(STABLE_LP_TOKEN_DECIMALS, dyOut),
    pool: { ...stablePool, Dex: 'ref' },
    token: tokenIn,
    outputToken: tokenOut.id,
    inputToken: tokenIn.id
  }
}

const getSinglePoolEstimate = (
  tokenIn: TokenMetadata,
  tokenOut: TokenMetadata,
  pool: Pool,
  tokenInAmount: string
) => {
  const allocation = toReadableNumber(
    tokenIn.decimals,
    scientificNotationToString(tokenInAmount)
  )

  const amount_with_fee = Number(allocation) * (FEE_DIVISOR - pool.fee)
  const in_balance = toReadableNumber(
    tokenIn.decimals,
    pool.supplies[tokenIn.id]
  )
  const out_balance = toReadableNumber(
    tokenOut.decimals,
    pool.supplies[tokenOut.id]
  )
  const estimate = new BigNumber(
    (
      (amount_with_fee * Number(out_balance)) /
      (FEE_DIVISOR * Number(in_balance) + amount_with_fee)
    ).toString()
  ).toFixed()

  return {
    token: tokenIn,
    estimate,
    pool,
    outputToken: tokenOut.id,
    inputToken: tokenIn.id
  }
}

export async function getPool (provider: Provider, poolId: number) {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: REF,
    method_name: 'get_stable_pool',
    args_base64: Buffer.from(JSON.stringify({ pool_id: poolId })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString())
}

export async function getStablePool (provider: Provider) {
  // TODO filter out illiquid pools. There are only 20 liquid pools out of 3k total
  const pool = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: REF,
    method_name: 'get_pool',
    args_base64: Buffer.from(JSON.stringify({ pool_id: STABLE_POOL_ID })).toString('base64'),
    finality: 'optimistic'
  }).then((res) => JSON.parse(Buffer.from(res.result).toString())) as StablePoolResponse

  return pool
}

/**
  * Fetches a number of REF pools
  * @param provider The RPC provider
  * @param index Start index for pagination
  * @param limit Number of pools to fetch
  * @returns
  */
export async function getPools (provider: Provider, exchange: string, index: number, limit: number) {
  // TODO filter out illiquid pools. There are only 20 liquid pools out of 3k total
  const pools = await provider.query<CodeResult>({
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
      token_account_ids: refPool.token_account_ids,
      amounts: refPool.amounts,
      total_fee: refPool.total_fee,
      // retain for now
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

// not called in our case
export const getPoolEstimate = ({
  tokenIn,
  tokenOut,
  amountIn,
  Pool
}: {
  tokenIn: TokenMetadata;
  tokenOut: TokenMetadata;
  amountIn: string;
  Pool: Pool;
}) => {
  // TODO fix stable pool
  return getSinglePoolEstimate(tokenIn, tokenOut, Pool, amountIn)

  // if (Number(Pool.id) === STABLE_POOL_ID) {
  //   // read stable pool from cache, instead of provider
  //   // const stablePoolInfo = (await getStablePoolFromCache())[1];
  //   const stablePoolInfo = await getStablePool(provider)
  //   const stableEstimate = getStablePoolEstimate({
  //     tokenIn,
  //     tokenOut,
  //     amountIn: toReadableNumber(tokenIn.decimals, amountIn),
  //     stablePoolInfo,
  //     stablePool: Pool
  //   })
  //   console.log('got stable estimate', stableEstimate)
  //   return stableEstimate
  // } else {
  //   return getSinglePoolEstimate(tokenIn, tokenOut, Pool, amountIn)
  // }
}

/**
 * Returns a string representation of swap path
 *
 * Example: USDC -> USDT, USDC -> WNEAR, USDT
 * @param actions
 * @returns
 */
export function getRoutePath (actions: SwapActions[], tokenList: TokenInfo[]) {
  const routes: string[] = []

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!
    const route = action
      .nodeRoute!.map((token) => {
        const saved = tokenList.find((savedToken) => {
          return savedToken.address == token
        })

        return saved ? saved.symbol : token.slice(0, 10)
      })
      .join(' -> ')

    if (i === 0 || routes[routes.length - 1] !== route) {
      routes.push(route)
    }
  }

  return routes
}
