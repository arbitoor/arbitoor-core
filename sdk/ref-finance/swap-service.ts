import { TokenInfo } from '@tonic-foundation/token-list'
import Big from 'big.js'
import { SpinRouteInfo } from '../spin/spin-api'

export interface ReservesMap {
  [index: string]: Big;
}

export enum PoolMode {
  PARALLEL = 'parallel swap',
  SMART = 'smart routing',
  SMART_V2 = 'stableSmart',
  STABLE = 'stable swap',
}

// Eliminate redundant pool types

// Type returned from smart contract. It does not hold ID
export interface RefPool {
  pool_kind: string,
  token_account_ids: string[],
  amounts: string[],
  total_fee: number,
  shares_total_supply: string,
  amp: number,
}

// Returned from getPools(). Replace it with RefPool
// Used in cache, which is read by math library
export interface FormattedPool extends RefPool {
  id: number;
  reserves: ReservesMap;
  dex: string;
}

// Stable pools have a separate view function
export interface StablePool extends Omit<RefPool, 'pool_kind'> {
  id: number;
  decimals: number[];
  c_amounts: string[];
  reserves: ReservesMap;
  partialAmountIn?: string; // needed to generate TX
  dex: string;
}

export interface Pool {
  id: number;
  tokenIds: string[];
  supplies: { [key: string]: string };
  fee: number;
  shareSupply: string;

  // unknown fields
  tvl: number;
  partialAmountIn?: string; // needed to generate TX
}

// Holds parameters to find best route
export interface RoutePool {
  amounts: string[];
  fee: number;
  id: number;
  reserves: ReservesMap;
  shares: string;
  updateTime: number;
  partialAmountIn?: string | number | Big;
  gamma_bps?: Big;
  supplies?: ReservesMap;
  tokenIds?: string[];
  x?: string;
  y?: string;
}

export interface RefRouteInfo {
  dex: string;
  view: EstimateSwapView[];
  inputAmount: Big;
  output: Big;
}

// A route to reach token 1 to token 2
export type RouteInfo = RefRouteInfo | SpinRouteInfo

export interface RefForkSwap {
  exchange: string,
  views: EstimateSwapView[],
  amountIn: string,
}

export interface SpinSwap {
  marketId: number,
  inputToken: string,
}

export type SwapView = RefForkSwap | SpinSwap

export interface EstimateSwapView {
  estimate: string;
  pool: Pool | StablePool;
  intl?: any;
  dy?: string;
  status?: PoolMode;
  noFeeAmountOut?: string;
  inputToken?: string;
  outputToken?: string;
  nodeRoute?: string[];
  // hybrid swap uses TokenInfo
  tokens?: TokenInfo[];
  // tokens?: TokenMetadata[]; // to generate token path on UI
  routeInputToken?: string;
  routeOutputToken?: string;
  route?: RoutePool[];
  allRoutes?: RoutePool[][];
  allNodeRoutes?: string[][];
  totalInputAmount?: string;
  overallPriceImpact?: string;
}
