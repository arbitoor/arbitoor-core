import { TokenInfo } from '@tonic-foundation/token-list'
import Big from 'big.js'
import _ from 'lodash'
import { AccountProvider } from '../AccountProvider'
import { STABLE_TOKEN_IDS, STABLE_TOKEN_USN_IDS, BTCIDS, CUSDIDS, REF } from '../constants'
import { scientificNotationToString, toNonDivisibleNumber, toPrecision, toReadableNumber } from '../numbers'
import { filterPoolsWithBothTokens, findPoolWithId, getPoolEstimate, RefFork } from './ref-utils'
import { getSwappedAmount, isStablePool, STABLE_LP_TOKEN_DECIMALS } from './stable-swap'
import { FormattedPool, PoolMode, StablePool, EstimateSwapView } from './swap-service'

export const isStableToken = (id: string) => {
  return (
    STABLE_TOKEN_IDS.includes(id) ||
    STABLE_TOKEN_USN_IDS.includes(id) ||
    BTCIDS.includes(id) ||
    CUSDIDS.includes(id)
  )
}

export const getStablePoolEstimate = ({
  tokenIn,
  tokenOut,
  amountIn,
  stablePoolInfo
}: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  stablePoolInfo: StablePool;
}) => {
  console.log('token in', tokenIn, 'out', tokenOut, 'amt in', amountIn, 'pool', stablePoolInfo)

  // wrong token pair for pool 3020. The pool is USN<>USDT, but passed tokens are USDT and USDC/
  // Issue comes from Ref
  const [amount_swapped, _fee, dy] = getSwappedAmount(
    tokenIn,
    tokenOut,
    amountIn,
    stablePoolInfo
  )
  console.log('amt swapped', amount_swapped)

  const amountOut =
    amount_swapped < 0
      ? '0'
      : toPrecision(scientificNotationToString(amount_swapped.toString()), 0)

  console.log('amount out', amountOut)

  const dyOut =
    amount_swapped < 0
      ? '0'
      : toPrecision(scientificNotationToString(dy.toString()), 0)

  return {
    estimate: toReadableNumber(STABLE_LP_TOKEN_DECIMALS, amountOut), // gives NaN result
    noFeeAmountOut: toReadableNumber(STABLE_LP_TOKEN_DECIMALS, dyOut),
    pool: { ...stablePoolInfo, dex: REF },
    outputToken: tokenOut,
    inputToken: tokenIn
  }
}

const FEE_DIVISOR = 10000

const getSinglePoolEstimate = (
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
  pool: FormattedPool | StablePool,
  tokenInAmount: string // NaN passed
) => {
  // console.log('pool', pool, 'token in', tokenInAmount)
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

// hybrid stable pool
export async function getHybridStableSmart (
  accountProvider: AccountProvider,
  exchange: RefFork,
  tokenIn: string,
  tokenOut: string,
  parsedAmountIn: string
): Promise<{
  actions: EstimateSwapView[],
  estimate: string,
}> {
  const tokenInInfo = (await accountProvider.getTokenMetadata(tokenIn))!
  const tokenOutInfo = (await accountProvider.getTokenMetadata(tokenOut))!
  const amountIn = toReadableNumber(tokenInInfo.decimals, parsedAmountIn)

  // read stable pool from Account Provider
  const [allStablePools, regularPools] = exchange === RefFork.REF
    ? [accountProvider.getRefStablePools(), accountProvider.getRefPools()]
    : [accountProvider.getJumboStablePools(), accountProvider.getJumboPools()]
  // const allStablePools = accountProvider.getRefStablePools() // good, no Big
  // const regularPools = accountProvider.getRefPools()
  const candidatePools: (FormattedPool | StablePool)[][] = []

  function getPools (input: boolean) {
    const token = input ? tokenIn : tokenOut

    let pools1: (FormattedPool | StablePool)[] = []
    const pools2: (FormattedPool | StablePool)[] = []

    if (isStableToken(token)) {
      // pools2right
      pools1 = allStablePools.filter((pool) =>
        pool.token_account_ids.includes(token)
      )

      const otherStables = pools1
        .map((pool) => pool.token_account_ids.filter((id) => id !== token))
        .flat()

      for (const otherStable of otherStables) {
        const [stablePools, tmpPools] = input
          ? [
            filterPoolsWithBothTokens(allStablePools, otherStable, tokenOut) as StablePool[],
            filterPoolsWithBothTokens(regularPools, otherStable, tokenOut) as FormattedPool[]
            ]
          : [
            filterPoolsWithBothTokens(allStablePools, tokenIn, otherStable) as StablePool[],
            filterPoolsWithBothTokens(regularPools, tokenIn, otherStable) as FormattedPool[]
            ]

        // various pools have Big
        const tobeAddedPools = [...tmpPools, ...stablePools]

        // pools1right
        pools2.push(
          ...tobeAddedPools.filter((p) => {
            const supplies = Object.values(p.amounts) as [string, string]
            const result = new Big(supplies[0]).times(new Big(supplies[1])).gt(0)
            return result
          })
        )
      }
    }
    if (input) {
      return { pools1, pools2 }
    }
    return { pools1: pools2, pools2: pools1 }
  }

  const { pools1, pools2 } = getPools(true)
  const { pools1: pools1Right, pools2: pools2Right } = getPools(false)

  // find candidate pools

  function generateCandidatePools (pools: (FormattedPool | StablePool)[], pools2: (StablePool | FormattedPool)[]) {
    for (const p1 of pools) {
      const middleTokens = p1.token_account_ids.filter((id: string) => id !== tokenIn)
      for (const middleToken of middleTokens) {
        // why is reserveMap returning Big instead of string?
        const p2s = pools2.filter(
          (p) =>
            p.token_account_ids.includes(middleToken) &&
            p.token_account_ids.includes(tokenOut) &&
            middleToken !== tokenOut
        )
        let p2 = _.maxBy(p2s, (p) => {
          return Number(
            toReadableNumber(tokenOutInfo.decimals, p.reserves[tokenOut]!.toString())
          )
        }
        )

        if (middleToken === tokenOut) {
          p2 = p1
        }

        if (p1 && p2) {
          if (p1.id === p2.id) candidatePools.push([p1])
          else candidatePools.push([p1, p2])
        }
      }
    }
  }
  generateCandidatePools(pools1, pools2)
  generateCandidatePools(pools1Right, pools2Right)

  if (candidatePools.length > 0) {
    const BestPoolPair =
      candidatePools.length === 1
        ? candidatePools[0]
        : _.maxBy(candidatePools, async (poolPair) => {
          // only one pool case, only for stable tokens
          if (poolPair.length === 1) {
            if (isStablePool(poolPair[0]!.id, exchange)) {
              return Number(
                getStablePoolEstimate({
                  tokenIn,
                  tokenOut,
                  stablePoolInfo: filterPoolsWithBothTokens(allStablePools, tokenIn, tokenOut)[0] as StablePool,
                  amountIn
                }).estimate
              )
            } else {
              return Number(
                getSinglePoolEstimate(
                  tokenInInfo,
                  tokenOutInfo,
                  poolPair[0]!,
                  parsedAmountIn
                ).estimate
              )
            }
          }

          const [tmpPool1, tmpPool2] = poolPair as [StablePool | FormattedPool, StablePool | FormattedPool]
          const tokenMidId = poolPair[0]!.token_account_ids.find((t: string) =>
            poolPair[1]!.token_account_ids.includes(t)
          )!

          const tokenMidMeta = (await accountProvider.getTokenMetadata(tokenMidId))!

          const stablePoolWithBothTokens = filterPoolsWithBothTokens(allStablePools, tokenIn, tokenOut)[0]

          // estimate 1.estimate is NaN
          // console.log('For estimate 1')
          // console.log('is stable', isStablePool(tmpPool1.id, exchange))
          // console.log('stable pool with both tokens', stablePoolWithBothTokens)
          const estimate1 = {
            ...(isStablePool(tmpPool1.id, exchange) && stablePoolWithBothTokens
              ? getStablePoolEstimate({
                tokenIn,
                tokenOut: tokenMidId,
                amountIn,
                stablePoolInfo: stablePoolWithBothTokens as StablePool
              })
              : getSinglePoolEstimate(
                tokenInInfo,
                tokenMidMeta,
                tmpPool1!,
                parsedAmountIn
              )),
            status: PoolMode.SMART
          }

          // console.log('decimals', tokenMidMeta.decimals, '1 estimate', estimate1.estimate)
          const estimate2Amount = toNonDivisibleNumber(
            tokenMidMeta.decimals,
            estimate1.estimate
          )
          // console.log('estimate 2 amt', estimate2Amount)

          const estimate2 = {
            ...(isStablePool(tmpPool2.id, exchange)
              ? getStablePoolEstimate({
                tokenIn: tokenMidId,
                tokenOut,
                amountIn: estimate1.estimate,
                stablePoolInfo: findPoolWithId(allStablePools, tmpPool2.id) as StablePool
              })
              : getSinglePoolEstimate(
                tokenMidMeta,
                tokenOutInfo,
                tmpPool2,
                toNonDivisibleNumber(
                  tokenMidMeta.decimals,
                  estimate1.estimate
                )
              )),
            status: PoolMode.SMART
          }

          return Number(estimate2.estimate)
        })

    // one pool case only get best price

    if (!BestPoolPair) return { actions: [], estimate: '0' }

    if (BestPoolPair.length === 1) {
      const bestPool = BestPoolPair[0]!
      const estimate = getPoolEstimate({
        tokenIn: tokenInInfo,
        tokenOut: tokenOutInfo,
        amountIn: parsedAmountIn,
        pool: bestPool,
        exchange
      })

      return {
        actions: [ // fix missing fields
          {
            ...estimate,
            status: PoolMode.STABLE,
            tokens: [tokenInInfo, tokenOutInfo],
            inputToken: tokenIn,
            outputToken: tokenOut,
            totalInputAmount: toNonDivisibleNumber(tokenInInfo.decimals, amountIn)
          }
        ] as EstimateSwapView[],
        estimate: estimate.estimate
      }
    }

    // two pool case get best price
    const [pool1, pool2] = BestPoolPair as [StablePool | FormattedPool, StablePool | FormattedPool]

    const tokenMidId = pool1.token_account_ids.find((t: string) =>
      pool2.token_account_ids.includes(t)
    )!

    const tokenMidMeta = (await accountProvider.getTokenMetadata(tokenMidId))!

    const estimate1 = {
      ...(isStablePool(pool1.id, exchange)
        ? getStablePoolEstimate({
          tokenIn,
          tokenOut: tokenMidId,
          amountIn,
          stablePoolInfo: findPoolWithId(allStablePools, pool1.id) as StablePool
        })
        : getSinglePoolEstimate(tokenInInfo, tokenMidMeta, pool1, parsedAmountIn)),
      status: PoolMode.SMART,
      tokens: [tokenInInfo, tokenMidMeta, tokenOutInfo],
      inputToken: tokenIn,
      outputToken: tokenMidMeta.address
    }

    const estimate2 = {
      ...(isStablePool(pool2.id, exchange)
        ? getStablePoolEstimate({
          tokenIn: tokenMidId,
          tokenOut,
          amountIn: estimate1.estimate,
          stablePoolInfo: findPoolWithId(allStablePools, pool2.id) as StablePool
        })
        : getSinglePoolEstimate(
          tokenMidMeta,
          tokenOutInfo,
          pool2,
          toNonDivisibleNumber(tokenMidMeta.decimals, estimate1.estimate)
        )),

      status: PoolMode.SMART,
      tokens: [tokenInInfo, tokenMidMeta, tokenOutInfo],
      inputToken: tokenMidMeta.address,
      outputToken: tokenOut
    }

    return { actions: [estimate1, estimate2] as EstimateSwapView[], estimate: estimate2.estimate }
  }

  // if none present
  return { actions: [], estimate: '0' }
}
