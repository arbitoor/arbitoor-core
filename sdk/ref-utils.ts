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
