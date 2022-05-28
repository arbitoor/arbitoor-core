import BigNumber from 'bignumber.js'
import { CodeResult, Provider } from 'near-workspaces'
import { TokenMetadata } from './ft-contract'
import { toReadableNumber, scientificNotationToString, toPrecision } from './numbers'
import { getSwappedAmount, StablePool, STABLE_LP_TOKEN_DECIMALS, STABLE_POOL_ID } from './stable-swap'
import { Pool } from './swap-service'

const FEE_DIVISOR = 10000

// Type returned from smart contract
export interface RefPool {
  pool_kind: string,
  token_account_ids: string[],
  amounts: string[],
  total_fee: number,
  shares_total_supply: string,
  amp: number,
}

// Type required for math
export interface FormattedPool {
  id: number;
  token1Id: string;
  token2Id: string;
  token1Supply: string;
  token2Supply: string;
  fee: number;
  shares: string;
  update_time: number;
  token0_price: string;
  Dex: string;
  amounts: string[];
  reserves: {
      [key: string]: string,
  }
}

const getStablePoolEstimate = ({
  tokenIn,
  tokenOut,
  amountIn,
  stablePoolInfo,
  stablePool,
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
  ) as [number, number, number];

  const amountOut =
    amount_swapped < 0
      ? '0'
      : toPrecision(scientificNotationToString(amount_swapped.toString()), 0);

  const dyOut =
    amount_swapped < 0
      ? '0'
      : toPrecision(scientificNotationToString(dy.toString()), 0);

  return {
    estimate: toReadableNumber(STABLE_LP_TOKEN_DECIMALS, amountOut),
    noFeeAmountOut: toReadableNumber(STABLE_LP_TOKEN_DECIMALS, dyOut),
    pool: { ...stablePool, Dex: 'ref' },
    token: tokenIn,
    outputToken: tokenOut.id,
    inputToken: tokenIn.id,
  };
};

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

export async function getStablePool(provider: Provider) {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: 'v2.ref-finance.near',
    method_name: 'get_stable_pool',
    args_base64: Buffer.from(JSON.stringify({ pool_id: STABLE_POOL_ID })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString())
}

export const getPoolEstimate = async ({
  provider,
  tokenIn,
  tokenOut,
  amountIn,
  Pool
}: {
  provider: Provider,
  tokenIn: TokenMetadata;
  tokenOut: TokenMetadata;
  amountIn: string;
  Pool: Pool;
}) => {
  console.log('pool id', Pool.id)
  // TODO fix stable pool
  // return getSinglePoolEstimate(tokenIn, tokenOut, Pool, amountIn)
  if (Number(Pool.id) === STABLE_POOL_ID) {
    console.log('got stable pool')
    // const stablePoolInfo = (await getStablePoolFromCache())[1];
    const stablePoolInfo = await getStablePool(provider)
    const stableEstimate = getStablePoolEstimate({
      tokenIn,
      tokenOut,
      amountIn: toReadableNumber(tokenIn.decimals, amountIn),
      stablePoolInfo,
      stablePool: Pool,
    });
    console.log('got stable estimate', stableEstimate)
    return stableEstimate
  } else {
    return getSinglePoolEstimate(tokenIn, tokenOut, Pool, amountIn);
  }
}
