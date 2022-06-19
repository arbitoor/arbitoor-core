import _ from 'lodash'
import { toNonDivisibleNumber } from '../numbers'
import { StablePool } from './swap-service'

export const STABLE_POOL_IDS = [1910, 3020, 3364, 3433]

export const STABLE_LP_TOKEN_DECIMALS = 18

export const getStableTokenIndex = (stable_pool_id: string | number) => {
  return {
    'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near': 0,
    'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near': 1,
    '6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near': 2
  } as { [key: string]: number }
}

export const calc_d = (amp: number, c_amounts: number[]) => {
  const token_num = c_amounts.length
  const sum_amounts = _.sum(c_amounts)
  let d_prev = 0
  let d = sum_amounts
  for (let i = 0; i < 256; i++) {
    let d_prod = d
    for (const c_amount of c_amounts) {
      d_prod = (d_prod * d) / (c_amount * token_num)
    }
    d_prev = d
    const ann = amp * token_num ** token_num
    const numerator = d_prev * (d_prod * token_num + ann * sum_amounts)
    const denominator = d_prev * (ann - 1) + d_prod * (token_num + 1)
    d = numerator / denominator
    if (Math.abs(d - d_prev) <= 1) break
  }
  return d
}

export const calc_y = (
  amp: number,
  x_c_amount: number,
  current_c_amounts: number[],
  index_x: number,
  index_y: number
) => {
  const token_num = current_c_amounts.length
  const ann = amp * token_num ** token_num
  const d = calc_d(amp, current_c_amounts)
  let s = x_c_amount
  let c = (d * d) / x_c_amount
  for (let i = 0; i < token_num; i++) {
    if (i != index_x && i != index_y) {
      s += current_c_amounts[i]!
      c = (c * d) / current_c_amounts[i]!
    }
  }
  c = (c * d) / (ann * token_num ** token_num)
  const b = d / ann + s
  let y_prev = 0
  let y = d
  for (let i = 0; i < 256; i++) {
    y_prev = y
    const y_numerator = y ** 2 + c
    const y_denominator = 2 * y + b - d
    y = y_numerator / y_denominator
    if (Math.abs(y - y_prev) <= 1) break
  }

  return y
}

const FEE_DIVISOR = 10000

const tradeFee = (amount: number, trade_fee: number) => {
  return (amount * trade_fee) / FEE_DIVISOR
}

export const calc_swap = (
  amp: number,
  in_token_idx: number,
  in_c_amount: number,
  out_token_idx: number,
  old_c_amounts: number[],
  trade_fee: number
) => {
  const y = calc_y(
    amp,
    in_c_amount + old_c_amounts[in_token_idx]!,
    old_c_amounts,
    in_token_idx,
    out_token_idx
  )
  const dy = old_c_amounts[out_token_idx]! - y
  const fee = tradeFee(dy, trade_fee)
  const amount_swapped = dy - fee
  return [amount_swapped, fee, dy]
}

export const getSwappedAmount = (
  tokenInId: string,
  tokenOutId: string,
  amountIn: string,
  stablePool: StablePool
) => {
  const amp = stablePool.amp
  const trade_fee = stablePool.total_fee

  const STABLE_TOKEN_INDEX = getStableTokenIndex(stablePool.id)

  const in_token_idx = STABLE_TOKEN_INDEX[tokenInId]!
  const out_token_idx = STABLE_TOKEN_INDEX[tokenOutId]!
  const old_c_amounts = stablePool.c_amounts.map((amount) => Number(amount))
  const in_c_amount = Number(
    toNonDivisibleNumber(STABLE_LP_TOKEN_DECIMALS, amountIn)
  )

  const [amount_swapped, fee, dy] = calc_swap(
    amp,
    in_token_idx,
    in_c_amount,
    out_token_idx,
    old_c_amounts,
    trade_fee
  )

  return [amount_swapped, fee, dy]
}
