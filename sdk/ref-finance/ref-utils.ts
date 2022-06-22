import { TokenInfo } from '@tonic-foundation/token-list'
import Big from 'big.js'
import { CodeResult, Provider } from 'near-workspaces'
import { REF } from '../constants'
import { TokenMetadata } from '../ft-contract'
import { toReadableNumber, scientificNotationToString, toPrecision } from '../numbers'
import { getStablePoolEstimate } from './hybridStableSmart'
import { getSwappedAmount, isStablePool, STABLE_LP_TOKEN_DECIMALS } from './stable-swap'
import { FormattedPool, Pool, RefPool, StablePool, SwapActions } from './swap-service'

const FEE_DIVISOR = 10000

export function separateRoutes (
  actions: SwapActions[],
  outputToken: string
) {
  const res = []
  let curRoute = []

  for (const i in actions) {
    curRoute.push(actions[i])
    if (actions[i]!.outputToken === outputToken) {
      res.push(curRoute)
      curRoute = []
    }
  }

  return res
}

const getSinglePoolEstimate = (
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
  pool: FormattedPool | StablePool,
  tokenInAmount: string
) => {
  const allocation = toReadableNumber(
    tokenIn.decimals,
    scientificNotationToString(tokenInAmount)
  )

  const amount_with_fee = Number(allocation) * (FEE_DIVISOR - pool.total_fee)
  const in_balance = toReadableNumber(
    tokenIn.decimals,
    pool.reserves[tokenIn.address]
  )
  const out_balance = toReadableNumber(
    tokenOut.decimals,
    pool.reserves[tokenOut.address]
  )

  const estimate = new Big(
    (
      (amount_with_fee * Number(out_balance)) /
      (FEE_DIVISOR * Number(in_balance) + amount_with_fee)
    ).toString()
  ).toFixed()

  return {
    token: tokenIn,
    estimate,
    pool,
    outputToken: tokenOut.address,
    inputToken: tokenIn.address
  }
}

// Fetches a pool from RPC
export async function getPool (provider: Provider, exchange: string, poolId: number) {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: exchange,
    method_name: 'get_pool',
    args_base64: Buffer.from(JSON.stringify({ pool_id: poolId })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as RefPool
}

export async function getStablePool (provider: Provider, poolId: number) {
  const pool = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: REF,
    method_name: 'get_stable_pool',
    args_base64: Buffer.from(JSON.stringify({ pool_id: poolId })).toString('base64'),
    finality: 'optimistic'
  }).then((res) => JSON.parse(Buffer.from(res.result).toString()))

  const reserves: {
    [x: string]: string;
  } = {}
  for (let i = 0; i < pool.token_account_ids.length; ++i) {
    reserves[pool.token_account_ids[i]!] = pool.amounts[i]!
  }

  return {
    id: poolId,
    reserves,
    ...pool
  } as StablePool
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

  const formattedPools = pools.map(refPool => {
    const reserves: {
      [x: string]: string;
    } = {}
    for (let i = 0; i < refPool.token_account_ids.length; ++i) {
      reserves[refPool.token_account_ids[i]!] = refPool.amounts[i]!
    }
    const formattedPool = {
      ...refPool,
      id: index,
      reserves
    }

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
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  Pool: FormattedPool | StablePool;
}) => {
  // TODO fix stable pool
  // return getSinglePoolEstimate(tokenIn, tokenOut, Pool, amountIn)

  if (isStablePool(Pool.id)) {
    return getStablePoolEstimate({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn: toReadableNumber(tokenIn.decimals, amountIn),
      stablePoolInfo: Pool as StablePool
      // stablePool: Pool,
    })
  } else {
    return getSinglePoolEstimate(tokenIn, tokenOut, Pool, amountIn)
  }
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

/**
 * Filter pools having one of the tokens
 * @param token1
 * @param token2
 * @returns
 */
export function filterPoolsWithEitherToken (pools: FormattedPool[], token1: string, token2: string) {
  // filter cached pools
  return pools.filter(pool => {
    return pool.token_account_ids.includes(token1) || pool.token_account_ids.includes(token2)
  })
}

/**
 * Filter pools having one of the tokens
 * @param token1
 * @param token2
 * @returns
 */
export function filterPoolsWithBothTokens (pools: (RefPool | StablePool)[], token1: string, token2: string) {
  return pools.filter(pool =>
    pool.token_account_ids.includes(token1) &&
    pool.token_account_ids.includes(token2) &&
    token1 !== token2
  )
}

/**
 * Find the pool with matching ID
 * @param pools Array of pools
 * @param id Pool ID
 * @returns
 */
export function findPoolWithId (pools: (FormattedPool | StablePool)[], id: number) {
  return pools.find(pool => pool.id === id)
}
