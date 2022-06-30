# CHANGELOG.md

## 1.0.12

### Features

- Add support for Ref Finance stableswap pools (aka sauce). The result is not returned a separate route. REF's result is overwritten if the new algorithm provides a better rate.


### Fixes

- Store `reserves` as `Big` instead of `string`. Hack to fix the stable pool algorithm.  The old algorithm replaces string fields with Big in the cache.

### Breaking

- SDK object renamed from comet to arbitoor.

- Transactions `txs` are no longer returned from `computeRoutes()`. You need generate them by manually calling `generateTransactions()`. This function was earlier named `nearInstantSwap()`.

- Stableswap has a different way to find a visual route. Use the new `getRoutePath()` function, which returns an object having the token path, pools and percentage split across different routes.

## 1.0.12

### Fixes

- Return empty path if no swaps are present.
