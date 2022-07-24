import { Market as SpinMarket } from '@spinfi/core'
import { JUMBO, REF, SPIN, TONIC, WRAPPED_NEAR } from './constants'
import { getPoolAllocationPercents } from './numbers'
import { StablePool, EstimateSwapView, RouteInfo, RefRouteInfo, Pool, separateRoutes, RefFork } from './ref-finance'
import { Currency, FungibleToken, Near, WrappedNearToken } from './sdk'
import { SpinRouteInfo } from './spin'
import { TonicMarket, TonicRouteInfo } from './tonic'
import { WNearRouteInfo } from './wrapped-near'

export interface RefLeg {
  dex: typeof REF | typeof JUMBO
  tokens: [string, string] | [string, string, string],
  percentage: string;
  pools: (StablePool | Pool)[];
}

export interface SpinLeg {
  dex: typeof SPIN
  tokens: [string, string],
  percentage: '100';
  pools: [SpinMarket];
}

export interface TonicLeg {
  dex: typeof TONIC
  tokens: [string, string] | [string, string, string],
  percentage: '100';
  pools: [TonicMarket] | [TonicMarket, TonicMarket];
}

export interface WrapNearLeg {
  dex: typeof WRAPPED_NEAR
  tokens: [Near, WrappedNearToken]
  percentage: '100'
}

export interface UnwrapNearLeg {
  dex: typeof WRAPPED_NEAR
  tokens: [WrappedNearToken, Near]
  percentage: '100'
}

// export interface

export type RouteLeg = RefLeg | SpinLeg | TonicLeg | WrapNearLeg | UnwrapNearLeg

/**
 * Returns a JS object representing a swap path. Each route can have one or more pools.
 * The percentage split across each route is also returned.
 *
 * Reference- https://github.com/ref-finance/ref-ui/blob/807dad2e1aa786adcb4cb7750de38258480b75d8/src/components/swap/CrossSwapCard.tsx#L160
 *
 * @param routeInfo
 * @returns Dex name, tokens, percentage split and pools per route.
 */
export function getRoutePath (routeInfo: RouteInfo): RouteLeg[] {
  if (routeInfo.dex === WRAPPED_NEAR) {
    const { wrap } = routeInfo as WNearRouteInfo
    if (wrap) {
      return [{
        dex: WRAPPED_NEAR,
        tokens: [{
          type: 'near'
        }, {
          type: 'ft',
          accountId: WRAPPED_NEAR
        }],
        percentage: '100'
      }] as WrapNearLeg[]
    } else {
      return [{
        dex: WRAPPED_NEAR,
        tokens: [{
          type: 'ft',
          accountId: WRAPPED_NEAR
        }, {
          type: 'near'
        }],
        percentage: '100'
      }] as UnwrapNearLeg[]
    }
  } else if (routeInfo.dex === SPIN) {
    const { inputToken, outputToken, market } = routeInfo as SpinRouteInfo
    return [{
      tokens: [inputToken, outputToken],
      percentage: '100',
      pools: [market],
      dex: SPIN
    }]
  } else if (routeInfo.dex === TONIC) {
    const tonicRoute = routeInfo as TonicRouteInfo

    const leg0 = tonicRoute.legs[0]
    const baseToken0 = leg0.market.base_token.token_type as {
      type: 'ft';
      account_id: string;
    }
    const quoteToken0 = leg0.market.quote_token.token_type as {
      type: 'ft';
      account_id: string;
    }

    const tokens: [string, string] | [string, string, string] = tonicRoute.legs[0].isBid
      ? [quoteToken0.account_id, baseToken0.account_id]
      : [baseToken0.account_id, quoteToken0.account_id]

    if (tonicRoute.legs.length === 2) {
      const leg1 = tonicRoute.legs[1]
      const baseToken1 = leg1.market.base_token.token_type as {
        type: 'ft';
        account_id: string;
      }
      const quoteToken1 = leg1.market.quote_token.token_type as {
        type: 'ft';
        account_id: string;
      }

      tokens.push(leg1.isBid ? baseToken1.account_id : quoteToken1.account_id)
    }
    return [{
      tokens,
      percentage: '100',
      pools: (routeInfo as TonicRouteInfo).legs.map(leg => leg.market),
      dex: TONIC
    }] as TonicLeg[]
  } else if ([REF, JUMBO].includes(routeInfo.dex)) {
    const { view: swapsToDo, dex } = routeInfo as RefRouteInfo

    if (swapsToDo.length === 0) {
      return []
    }

    const inputToken = swapsToDo.at(0)!.inputToken!
    const outputToken = swapsToDo.at(-1)!.outputToken!
    // A route can have two hops at max
    const routes = separateRoutes(
      swapsToDo,
      swapsToDo.at(-1)!.outputToken!
    ) as ([EstimateSwapView] | [EstimateSwapView, EstimateSwapView])[]

    const firstPools = routes?.map((route) => route[0]!.pool)
    const percents = getPoolAllocationPercents(firstPools)
    return routes.map((route, index) => {
      const tokens: [string, string] | [string, string, string] = route.length === 1
        ? [inputToken, outputToken]
        : [inputToken, route[0].outputToken!, outputToken]

      return {
        tokens,
        percentage: percents[index]!,
        pools: route.map(routePool => routePool.pool),
        dex
      }
    }) as RefLeg[]
  } else {
    throw Error('Unimplemented DEX')
  }
}
