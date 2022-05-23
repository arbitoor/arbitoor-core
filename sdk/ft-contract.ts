import { Provider } from 'near-api-js/lib/providers'
import { CodeResult } from 'near-workspaces'

export interface TokenMetadata {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string;
  ref?: number | string;
  near?: number | string;
  aurora?: number | string;
  total?: number;
  onRef?: boolean;
  onTri?: boolean;
  amountLabel?: string;
  amount?: number;
  nearNonVisible?: number | string;
}

export const ftGetTokenMetadata = async (
  provider: Provider,
  id: string
): Promise<TokenMetadata> => {
  const metadata = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: id,
    method_name: 'ft_metadata',
    args_base64: '',
    finality: 'optimistic'
  }).then((res) => JSON.parse(Buffer.from(res.result).toString()))

  return {
    id,
    ...metadata
  }
}
