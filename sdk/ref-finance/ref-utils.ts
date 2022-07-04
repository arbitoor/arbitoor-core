import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { TokenInfo } from '@tonic-foundation/token-list'
import Big from 'big.js'
import { Market as SpinMarket } from '@spinfi/core'
import { CodeResult, Provider } from 'near-workspaces'
import { AccountProvider } from '../AccountProvider'
import { REF, SPIN, STORAGE_TO_REGISTER_WITH_MFT } from '../constants'
import { toReadableNumber, scientificNotationToString, getPoolAllocationPercents } from '../numbers'
import { SpinRouteInfo } from '../spin'
import { getStablePoolEstimate } from './hybridStableSmart'
import { isStablePool } from './stable-swap'
import { FormattedPool, RefPool, StablePool, EstimateSwapView, RouteInfo, RefRouteInfo, Pool } from './swap-service'

const FEE_DIVISOR = 10000

export enum RefFork {
  REF = 'REF',
  JUMBO = 'JUMBO',
}

export function separateRoutes (
  actions: EstimateSwapView[],
  outputToken: string
) {
  const res = []
  let curRoute = []

  for (const i in actions) {
    curRoute.push(actions[i]!)
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
    pool.reserves[tokenIn.address]?.toString()
  )
  const out_balance = toReadableNumber(
    tokenOut.decimals,
    pool.reserves[tokenOut.address]?.toString()
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

export async function getStablePool (provider: Provider, exchange: string, poolId: number) {
  const pool = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: exchange,
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
 * Fetch a rated pool. Rated pools are an improved version of stable pools.
 * @param provider
 * @param poolId
 * @returns
 */
export async function getRatedPool (provider: Provider, poolId: number) {
  const pool = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: REF,
    method_name: 'get_rated_pool',
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
      [x: string]: Big;
    } = {}
    for (let i = 0; i < refPool.token_account_ids.length; ++i) {
      reserves[refPool.token_account_ids[i]!] = new Big(refPool.amounts[i]!)
    }
    const formattedPool = {
      ...refPool,
      id: index,
      reserves,
      dex: exchange
    }

    ++index

    return formattedPool
  })

  return formattedPools
}

/**
 * Gets the estimated swap output for a given token pair and liquidity pool.
 * The pool can be xy=k or stableswap.
 *
 * @param param0
 * @returns Swap estimate
 */
export const getPoolEstimate = ({
  tokenIn,
  tokenOut,
  amountIn,
  pool,
  exchange
}: {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  pool: FormattedPool | StablePool;
  exchange: RefFork;
}) => {
  if (isStablePool(pool.id, exchange)) {
    return getStablePoolEstimate({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn: toReadableNumber(tokenIn.decimals, amountIn),
      stablePoolInfo: pool as StablePool
    })
  } else {
    return getSinglePoolEstimate(tokenIn, tokenOut, pool, amountIn)
  }
}

export interface RouteLeg {
  tokens: [string, string] | [string, string, string];
  percentage: string;
  pools: (StablePool | Pool | SpinMarket)[];
  dex: string;
}

/**
 * Returns a JS object representing a swap path. Each route can have one or more pools.
 * The percentage split across each route is also returned.
 *
 * Reference- https://github.com/ref-finance/ref-ui/blob/807dad2e1aa786adcb4cb7750de38258480b75d8/src/components/swap/CrossSwapCard.tsx#L160
 *
 * @param routeInfo
 * @returns Dex name, tokens, percentage split and pools per route.
 */
export function getRoutePath (routeInfo: RouteInfo): RouteLeg[] {
  if ((routeInfo as SpinRouteInfo).market) {
    const { inputToken, outputToken, market } = routeInfo as SpinRouteInfo
    return [{
      tokens: [inputToken, outputToken],
      percentage: '100',
      pools: [market],
      dex: SPIN
    }]
  } else {
    const { view: swapsToDo, dex } = routeInfo as RefRouteInfo

    if (swapsToDo.length === 0) {
      return []
    }

    const inputToken = swapsToDo.at(0)!.inputToken!
    const outputToken = swapsToDo.at(-1)!.outputToken!
    // A route can have two hops at max
    const routes = separateRoutes(
      swapsToDo,
      swapsToDo.at(-1)!.outputToken!
    ) as ([EstimateSwapView] | [EstimateSwapView, EstimateSwapView])[]

    const firstPools = routes?.map((route) => route[0]!.pool)
    const percents = getPoolAllocationPercents(firstPools)
    return routes.map((route, index) => {
      const tokens: [string, string] | [string, string, string] = route.length === 1
        ? [inputToken, outputToken]
        : [inputToken, route[0].outputToken!, outputToken]

      return {
        tokens,
        percentage: percents[index]!,
        pools: route.map(routePool => routePool.pool),
        dex
      }
    })
  }
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

/**
 * Returns a create storage transaction if the user is not registered on the token
 * @param provider
 * @param tokenId
 * @param user
 * @returns
 */
export function registerToken (provider: AccountProvider, tokenId: string, user: string): Transaction | undefined {
  const tokenOutActions = new Array<FunctionCallAction>()
  const tokenRegistered = provider.ftGetStorageBalance(tokenId, user)

  if (tokenRegistered) {
    return undefined
  }

  tokenOutActions.push({
    type: 'FunctionCall',
    params: {
      methodName: 'storage_deposit',
      args: {
        registration_only: true,
        account_id: user
      },
      gas: '30000000000000',
      deposit: STORAGE_TO_REGISTER_WITH_MFT
    }
  })

  return {
    receiverId: tokenId,
    signerId: user,
    actions: tokenOutActions
  }
}
