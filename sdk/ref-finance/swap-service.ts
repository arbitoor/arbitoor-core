import Big from 'big.js'
import { TokenMetadata } from '../ft-contract'

export interface ReservesMap {
  [index: string]: string;
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
}

export interface Pool {
  id: number;
  tokenIds: string[];
  supplies: { [key: string]: string };
  fee: number;
  shareSupply: string;

  // unknown fields
  tvl: number;
  partialAmountIn?: string;
}

// eliminate. Store stable pools in separate variable
export interface StablePool {
  // Read from pool state
  amounts: string[];
  total_fee: number;
  shares_total_supply: string;
  amp: number;
  token_account_ids: string[];

  // Derived fields
  id: number;
  // LP token decimals?
  decimals: number[];
  // ?
  c_amounts: string[];
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

export interface SwapActions {
  estimate: string;
  pool: Pool;
  intl?: any;
  dy?: string;
  status?: PoolMode;
  noFeeAmountOut?: string;
  inputToken?: string;
  outputToken?: string;
  nodeRoute?: string[];
  tokens?: TokenMetadata[]; // redundant
  routeInputToken?: string;
  routeOutputToken?: string;
  route?: RoutePool[];
  allRoutes?: RoutePool[][];
  allNodeRoutes?: string[][];
  totalInputAmount?: string;
  overallPriceImpact?: string;
}
