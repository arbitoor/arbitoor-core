# Game plan

1. Single DEX swaps for REF and Jumbo
    - Study REF's router
    - Study the provider object returned by the wallet adapter.
    - Study Jupiter's SDK. Follow its naming conventions.
    - Write SDK: wrapper on a graphQL API
        1. `/quote`: Get a ranked list of possible routes
        2. `/swap`: Get serialized TX to swap

2. Split routes (v2): Use `NearWalletSelector.signAndSendTransactions`. The wallet can sign multiple TXs directed to different contracts using https://github.com/ref-finance/ref-ui/blob/19d5bee1c40e0b98686965e19a590a7f3ea27ac0/src/utils/sender-wallet.ts#L163. Eg. for adding liquidity in REF, you first call `ft_transfer_call()` for each token, then call the `add_liquidity` function on REF.

3. Multi leg swaps and Orderbook based swaps- todo

4. Aurora based swaps- Copy code from REF's UI. This is an add-on for the aggregator.

    - https://wallet.near.org/sign?transactions=DQAAAG1vbmtleWlzLm5lYXIAo66hZ5Dg8T%2BGyeY8sttBfvZM8K0%2BezAfHsJRsv1SCmzSdszH8DkAADwAAABhMGI4Njk5MWM2MjE4YjM2YzFkMTlkNGEyZTllYjBjZTM2MDZlYjQ4LmZhY3RvcnkuYnJpZGdlLm5lYXJJUaTRXjHERt4bKVYvKl%2BFUCuCxKA20xI6biy9KTTeTAEAAAACDwAAAHN0b3JhZ2VfZGVwb3NpdDcAAAB7InJlZ2lzdHJhdGlvbl9vbmx5Ijp0cnVlLCJhY2NvdW50X2lkIjoibW9ua2V5aXMubmVhciJ9AOBX60gbAAAAAID2SuHHAi0VAAAAAAAA%2CDQAAAG1vbmtleWlzLm5lYXIAo66hZ5Dg8T%2BGyeY8sttBfvZM8K0%2BezAfHsJRsv1SCmzTdszH8DkAAAkAAAB3cmFwLm5lYXJJUaTRXjHERt4bKVYvKl%2BFUCuCxKA20xI6biy9KTTeTAEAAAACEAAAAGZ0X3RyYW5zZmVyX2NhbGx3AAAAeyJyZWNlaXZlcl9pZCI6ImF1cm9yYSIsImFtb3VudCI6IjUwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCIsIm1lbW8iOiIiLCJtc2ciOiIxNjFlNkEyZmZGMGI4N0ZEQjFlNGIxZUM2Y0RjOWU3OTQ4OGQzMzM0In0AYCIlqj8AAAEAAAAAAAAAAAAAAAAAAAA%3D%2CDQAAAG1vbmtleWlzLm5lYXIAo66hZ5Dg8T%2BGyeY8sttBfvZM8K0%2BezAfHsJRsv1SCmzUdszH8DkAAAYAAABhdXJvcmFJUaTRXjHERt4bKVYvKl%2BFUCuCxKA20xI6biy9KTTeTAEAAAACBAAAAGNhbGx9AAAAAMQsMKxswV%2Bsm9k4YYvKoaH66FAdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABEAAAAOVCTUQAAAAAAAAAAAAAAACy0XttFF9WUev3jvqv5WlglBoWLAAAAAAAAAAAAAAAAAAAAAAAAAAAAANPCG87M7aEAAAAAYLeYbIgAAAAAAAAAAAAAAAAAAAAAAAA%3D%2CDQAAAG1vbmtleWlzLm5lYXIAo66hZ5Dg8T%2BGyeY8sttBfvZM8K0%2BezAfHsJRsv1SCmzVdszH8DkAAAYAAABhdXJvcmFJUaTRXjHERt4bKVYvKl%2BFUCuCxKA20xI6biy9KTTeTAEAAAACBAAAAGNhbGw9AQAAACy0XttFF9WUev3jvqv5WlglBoWLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAQAAOO0XOQAAAAAAAAAAAAAAAAAAAAAAAAAAAABp4Q3nZnbQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABJE0wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAAAABYeai%2F%2FC4f9seSx7GzcnnlIjTM0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGJ57P8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAMQsMKxswV%2Bsm9k4YYvKoaH66FAdAAAAAAAAAAAAAAAAsSv8paVYBqr2TplSGRikvw%2FECAIAYLeYbIgAAAAAAAAAAAAAAAAAAAAAAAA%3D%2CDQAAAG1vbmtleWlzLm5lYXIAo66hZ5Dg8T%2BGyeY8sttBfvZM8K0%2BezAfHsJRsv1SCmzWdszH8DkAAAYAAABhdXJvcmFJUaTRXjHERt4bKVYvKl%2BFUCuCxKA20xI6biy9KTTeTAEAAAACBAAAAGNhbGy9AAAAALEr%2FKWlWAaq9k6ZUhkYpL8PxAgCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACEAAAAazUYSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABJE0wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADW1vbmtleWlzLm5lYXIAAAAAAAAAAAAAAAAAAAAAAAAAAGC3mGyIAAAAAAAAAAAAAAAAAAAAAAAA&callbackUrl=https%3A%2F%2Fapp.ref.finance%2F

    - TXs
        1. Token storage deposit: https://explorer.mainnet.near.org/transactions/AVdCHhFM46mYdAUes4EqbXEMfDo8sYfMqC6oCKF5qspT
        2. Transfer token to Aurora: https://explorer.mainnet.near.org/transactions/84kGefNaj3ZKZeFGJi5pW7NBjHAfPMtLvHXVdDP47xNN
        3. Opaque messages sent to Aurora: https://explorer.mainnet.near.org/transactions/5oFCN1aLrCCGJXLi2PEAWB7xwJ1ZnUiGrQGMTSvap2E9, https://explorer.mainnet.near.org/transactions/8TC2XcdUsKNqSnsWQfkkx5WUkmkmXLx6KM9MoGkvzwdA, https://explorer.mainnet.near.org/transactions/5KnMNnaswMULq2b4MiKrveUJDecaNKgZ4LtoeFgA37Jw


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

# wNEAR -> USDT issue

1. REF UI returns
    wrap.near -> DAI (6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near) -> USDT

2. SDK returns
    wrap.near -> USDC (a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near) -> USDT

    It's using uni v2 algorithm on the stable pool 1910.

# Stableswap support

- Rated pools
    1. Filter them in stableSmart, but include in hybrid smart.

# Spin integration

1. Read output amount with

```sh
near view spot.spin-fi.near dry_run_swap '{"swap":{"market_id":1,"price":"3267000"},"token":"near.near","amount":"1000000000000000000000000000"}'
```

Result
```js
{
  refund: '251170000000000000000000000',
  received: '2470760500',
  fee: '2470760'
}
```

    - Only single hops are supported
    - Save a JSON file of spin markets
    - Dealing with refunds- if refund amount is large, the swap is not competitive and will be subsumed by another DEX. We can skip this field.
    - Market 1 (NEAR/USDC) deals with NEAR, not wNEAR. We need wrapper logic before this pool can be supported.
    - `price` field is for slippage. It's needed for swaps and dry runs.


2. Read markets with

```sh
NEAR_ENV=mainnet near view spot.spin-fi.near get_markets
```

```js
[
  {
    id: 1,
    ticker: 'NEAR/USDC',
    base: { id: 1, symbol: 'NEAR', decimal: 24, address: 'near.near' },
    quote: {
      id: 2,
      symbol: 'USDC',
      decimal: 6,
      address: 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near'
    },
    fees: {
      maker_fee: '500',
      taker_fee: '1000',
      decimals: 6,
      is_rebate: true
    },
    availability: { allow_place: true, allow_cancel: true },
    limits: {
      tick_size: '10000',
      step_size: '10000000000000000000000',
      min_base_quantity: '100000000000000000000000',
      max_base_quantity: '20000000000000000000000000',
      min_quote_quantity: '500000',
      max_quote_quantity: '100000000',
      max_bid_count: 20,
      max_ask_count: 20
    }
  }
]
```

3. Read orderbooks with

```sh
NEAR_ENV=mainnet near view spot.spin-fi.near get_orderbook '{ "market_id": 1, "limit": 4 }'
```

```js
{
  ask_orders: [
    { price: '3290000', quantity: '461670000000000000000000000' },
    { price: '3300000', quantity: '24290000000000000000000000' },
    { price: '3700000', quantity: '5050000000000000000000000' },
    { price: '3750000', quantity: '5000000000000000000000000' }
  ],
  bid_orders: [
    { price: '3270000', quantity: '720890000000000000000000000' },
    { price: '3260000', quantity: '38220000000000000000000000' },
    { price: '3000000', quantity: '14000000000000000000000000' },
    { price: '2900000', quantity: '20000000000000000000000000' }
  ]
}
```

    - bid = buy, ask = sell
    - Quantity is in terms of base.
    - Price: units of base currency (NEAR), per unit of quote currency with decimal places included (USDC)

4. Swap TX

    1. Price field is for slippage
    2. Run `ft_transfer_call()` on the input token

```json
{
  "receiver_id": "spot.spin-fi.near",
  "amount": "500000",
  "msg": "{\"market_id\":2,\"price\":\"1100000\"}"
}
```

5. Swap fees
    - Dry run returns fee amount. `fee` is a part of `received`, and must be subtracted to get the output amount for the user.

    ```sh
    NEAR_ENV=mainnet near view spot.spin-fi.near dry_run_swap '{"swap":{"market_id":2,"price":"0"},"token":"usn","amount":"1000000000000000000"}'

    { refund: '0', received: '1000000', fee: '400' }
    ```