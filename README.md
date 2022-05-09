# Game plan

1. Single DEX swaps for REF and Jumbo
    - Study REF's router
    - Study the provider object returned by the wallet adapter.
    - Study Jupiter's SDK. Follow its naming conventions.
    - Write SDK
        1. Constructor
        2. Low level functions to return single exchange TX objects. Check whether wallet adapter allows sending multiple instructions together.
        3. Find best route- initially client side (see REF implementation).

2. Split routes (v2): The wallet can sign multiple TXs directed to different contracts using https://github.com/ref-finance/ref-ui/blob/19d5bee1c40e0b98686965e19a590a7f3ea27ac0/src/utils/sender-wallet.ts#L163. Eg. for adding liquidity in REF, you first call `ft_transfer_call()` for each token, then call the `add_liquidity` function on REF.

3. Multi leg swaps and Orderbook based swaps- todo

# DEX aggregator test setup

1. Single DEX swap
    - Best route tests are not immediate priority. We can setup local pools and compare results.
    - No tests for returned TX structure.

2. Multi leg swaps
    1. Deploy an instance of test-token for every token needed by pools.
    2. Deploy pools for every token pair
    3. Test cases:
        1. Ref- single and double swap
        3. Combination of Ref and Jumbo

        Stableswap has the same swap interface as regular pools, so we do not need separate tests. Mainnet stableswap pool ID is 1910.

    4. Have separate unit tests to find best route

# Execution plan
1. Call `ft_transfer_call` on the input token with `v1.comet.near` as the destination.
2. The args are

```jsonc
{
    "receiver_id": "v1.comet.near",
    "amount" : "100000",
    "msg": {
        "referral_id": "vault.comet.near",
        "dexes": [
            {
                "dex": "v2.ref-finance.near",
                "token_in": "wrap.near",

                // Do not decode
                "actions": [{
                    "pool_id": 0,
                    "token_in": "wrap.near",
                    "token_out": "dai.near",
                    "amount_in": "100000",
                    "min_amount_out": "5000",
                }],
            },
            {
                "dex": "spot.spin-fi.testnet",
                "token_in": "dai.near",

                // do not decode
                "actions": [{
                    "market_id": 1,
                    "drop": ["23"],
                    "place": [
                        {
                        "price": "2000000000000000000000000",
                        "quantity": "1000000000000000000000000",
                        "ttl": 604800,
                        "market_order": true,
                        "order_type": "Bid",
                        "client_order_id": 1
                        }
                    ]
                }]
            }
        ]
    }
}
```

3. `v1.comet.near` will get this message through `ft_on_transfer`.
4. For each dex
    1. Read the `dex` and `token_in`.
    2. Call `token_in::ft_transfer_call`, with `dex` as the `reciever_id`. The message format should be

    ```jsonc
    {
        "force": 0,
        "actions": {}, // decoded actions array
        "referral_id": "" // the passed reciever ID
    }
    ```
5. Keep a whitelist of allowed DEXes to prevent fund loss.
6. Spin needs 3 calls
    1. Deposit input token with `ft_transfer_call`
    2. Place market orders with `place_bid` or `place_ask`. Market orders are executed immediately. Multi-market swaps can be atomically performed using `batch_ops`.
    3. Withdraw tokens with `withdraw` function

## Gas research

- 1 TGas = 10^12 gas

- 3 pool swap on REF: 47 TGas
    - Tx to reciept conversion: 2 Tgas
    - Transfer wNEAR to Ref: 10 TGas
    - Ref swap: 22 TGas
    - Transfer output token to user: 5 TGas
    - Withdraw callback: 3 Tgas
    - Token transfer callback: 2 Tgas

- Max gas per call: 300 TGas. This should be sufficient for 3 REF-like swaps.

- swap() based method: takes 139 TGas.

- Instant swap method: 121 TGas
    - 100 TGas if ft_balance_of and callback is removed
    - Instant swap without outbound transfer: 84
