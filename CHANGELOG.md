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

## 1.0.14

### Fixes

- Return empty path if no swaps are present.

## 1.0.15

### Fixes

- Filter out `RATED_SWAP` pools from stablesmart algorithm. Fixes USN swaps on REF.

## 1.1.0

### Features

- Support Jumbo stableswap.

### Fixes

- Big number error in USDT to USN swaps on Ref.
- Fix broken max output function in hybrid swap. `_.maxBy` does not support async functions.

## 1.2.0

### Features

- Support Spin swaps.

### Breaking

- `slippageTolerance` field removed from `arbitoor.computeRoutes()`.
- `computeRoutes()` returns a new `RouteInfo` object that wraps Ref and Spin swap data structures. `generateTransactions()` and `getRoutePath()` need this object as input.
