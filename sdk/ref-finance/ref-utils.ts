import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { TokenInfo } from '@tonic-foundation/token-list'
import Big from 'big.js'
import { CodeResult, Provider } from 'near-workspaces'
import { AccountProvider } from '../AccountProvider'
import { MEMO, REF, STORAGE_TO_REGISTER_WITH_MFT } from '../constants'
import { toReadableNumber, scientificNotationToString, percentLess, toNonDivisibleNumber, round } from '../numbers'
import { getStablePoolEstimate } from './hybridStableSmart'
import { isStablePool } from './stable-swap'
import { FormattedPool, RefPool, StablePool, EstimateSwapView, RefRouteInfo, PoolMode } from './swap-service'

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

/**
 * Get transactions to swap on Ref and its forks
 * @param param0
 * @returns
 */
export async function getRefTransactions ({
  accountProvider,
  user,
  routeInfo,
  slippageTolerance,
  referral
} : {
  accountProvider: AccountProvider,
  user: string,
  routeInfo: RefRouteInfo,
  slippageTolerance: number,
  referral: string
}) {
  const transactions = new Array<Transaction>()
  const tokenInActions = new Array<FunctionCallAction>()

  const { dex, view: swapsToDo, inputAmount } = routeInfo as RefRouteInfo

  if (swapsToDo.length === 0) {
    return transactions
  }

  const inputToken = swapsToDo.at(0)!.inputToken!
  const outputToken = swapsToDo.at(-1)!.outputToken!

  const tokenInDecimals = (await accountProvider.getTokenMetadata(inputToken))!.decimals
  const tokenOutDecimals = (await accountProvider.getTokenMetadata(outputToken))!.decimals

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
        tokenInDecimals,
        scientificNotationToString(s2d.pool.partialAmountIn!)
      )

      return {
        pool_id: s2d.pool.id,
        token_in: inputToken,
        token_out: outputToken,
        amount_in: round(
          tokenInDecimals,
          toNonDivisibleNumber(tokenInDecimals, allocation)
        ),
        min_amount_out: round(
          tokenOutDecimals,
          toNonDivisibleNumber(tokenOutDecimals, minTokenOutAmount)
        )
      }
    })

    const registerTx = registerToken(accountProvider, outputToken, user)
    if (registerTx) {
      transactions.push(registerTx)
    }

    tokenInActions.push({
      type: 'FunctionCall',
      params: {
        methodName: 'ft_transfer_call',
        args: {
          receiver_id: dex,
          amount: inputAmount,
          msg: JSON.stringify({
            force: 0,
            actions: swapActions,
            referral_id: referral
          }),
          memo: MEMO
        },
        gas: '180000000000000',
        deposit: '1'
      }
    })

    transactions.push({
      receiverId: inputToken,
      signerId: user,
      actions: tokenInActions
    })
  } else if (isSmartRouteV1Swap) {
    // making sure all actions get included for hybrid stable smart.
    const registerTx = registerToken(accountProvider, outputToken, user)
    if (registerTx) {
      transactions.push(registerTx)
    }
    var actionsList = []

    const swap1 = swapsToDo[0]!
    actionsList.push({
      pool_id: swap1.pool.id,
      token_in: swap1.inputToken,
      token_out: swap1.outputToken,
      amount_in: inputAmount,
      min_amount_out: '0'
    })
    const swap2 = swapsToDo[1]
    if (swap2) {
      actionsList.push({
        pool_id: swap2.pool.id,
        token_in: swap2.inputToken,
        token_out: swap2.outputToken,
        min_amount_out: round(
          tokenOutDecimals,
          toNonDivisibleNumber(
            tokenOutDecimals,
            percentLess(slippageTolerance, swapsToDo[1]!.estimate)
          )
        )
      })
    }

    transactions.push({
      receiverId: inputToken,
      signerId: user,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: dex,
              amount: inputAmount,
              msg: JSON.stringify({
                force: 0,
                actions: actionsList,
                referral_id: referral
              }),
              memo: MEMO
            },
            gas: '180000000000000',
            deposit: '1'
          }

        }
      ]
    })
  } else {
    // making sure all actions get included.
    const registerTx = registerToken(accountProvider, outputToken, user)
    if (registerTx) {
      transactions.push(registerTx)
    }
    var actionsList = []
    const allSwapsTokens = swapsToDo.map((s) => [s.inputToken, s.outputToken]) // to get the hop tokens
    for (const i in allSwapsTokens) {
      const swapTokens = allSwapsTokens[i]
      if (swapTokens![0] == inputToken && swapTokens![1] == outputToken) {
        // parallel, direct hop route.
        actionsList.push({
          pool_id: swapsToDo[i]!.pool.id,
          token_in: inputToken,
          token_out: outputToken,
          amount_in: swapsToDo[i]!.pool.partialAmountIn,
          min_amount_out: round(
            tokenOutDecimals,
            toNonDivisibleNumber(
              tokenOutDecimals,
              percentLess(slippageTolerance, swapsToDo[i]!.estimate)
            )
          )
        })
      } else if (swapTokens![0] == inputToken) {
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
            tokenOutDecimals,
            toNonDivisibleNumber(
              tokenOutDecimals,
              percentLess(slippageTolerance, swapsToDo[i]!.estimate)
            )
          )
        })
      }
    }

    transactions.push({
      receiverId: inputToken,
      signerId: user,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: dex,
              amount: inputAmount,
              msg: JSON.stringify({
                force: 0,
                actions: actionsList,
                referral_id: referral
              }),
              memo: MEMO
            },
            gas: '180000000000000',
            deposit: '1'
          }

        }
      ]
    })
  }

  return transactions
}
