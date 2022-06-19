import Big from 'big.js'
import _ from 'lodash'
import { STABLE_TOKEN_IDS, STABLE_TOKEN_USN_IDS, BTCIDS, CUSDIDS } from './constants'
import { TokenMetadata } from './ft-contract'
import { toNonDivisibleNumber, toReadableNumber } from './numbers'
import { getPoolEstimate } from './ref-utils'
import { Pool, PoolMode } from './swap-service'

export const isStableToken = (id: string) => {
  return (
    STABLE_TOKEN_IDS.includes(id) ||
    STABLE_TOKEN_USN_IDS.includes(id) ||
    BTCIDS.includes(id) ||
    CUSDIDS.includes(id)
  )
}

// hybrid stable pool
// export async function getHybridStableSmart(
//   tokenIn: TokenMetadata,
//   tokenOut: TokenMetadata,
//   amountIn: string,
//   loadingTrigger: boolean,
// ) {
//   const parsedAmountIn = toNonDivisibleNumber(tokenIn.decimals, amountIn);

//   // Pools having token 1
//   let pools1: Pool[] = [];
//   // Pools having token 2
//   let pools2: Pool[] = [];

//   let pools1Right: Pool[] = [];
//   let pools2Right: Pool[] = [];

//   // Stable pools- 1910 (3 pool), 3020, 3364, 3433
//   // read stable pool from Account Provider
//   const { allStablePools, allStablePoolsById, allStablePoolsInfo } =
//     await getAllStablePoolsFromCache(loadingTrigger);

//   let candidatePools: Pool[][] = [];

//   /**
//    * find possible routes for this pair
//    *
//    *
//    */
//   if (isStableToken(tokenIn.id)) {
//     // first hop will be through stable pool.
//     pools1 = allStablePools.filter((pool) =>
//       pool.tokenIds.includes(tokenIn.id)
//     );

//     const otherStables = pools1
//       .map((pool) => pool.tokenIds.filter((id) => id !== tokenIn.id))
//       .flat();

//     for (var otherStable of otherStables) {
//       let stablePools = getStablePoolThisPair({
//         tokenInId: otherStable,
//         tokenOutId: tokenOut.id,
//         stablePools: allStablePools,
//       });

//       // Read from AccountProvider
//       let tmpPools = await getPoolsByTokens({
//         tokenInId: otherStable,
//         tokenOutId: tokenOut.id,
//         amountIn: parsedAmountIn,
//         loadingTrigger: false,
//       });
//       const tobeAddedPools = tmpPools.concat(stablePools);
//       pools2.push(
//         ...tobeAddedPools.filter((p) => {
//           const supplies = Object.values(p.supplies);
//           return new Big(supplies[0]).times(new Big(supplies[1])).gt(0);
//         })
//       );
//     }
//   }

//   if (isStableToken(tokenOut.id)) {
//     // second hop will be through stable pool.
//     pools2Right = allStablePools.filter((pool) =>
//       pool.tokenIds.includes(tokenOut.id)
//     );

//     const otherStables = pools2Right
//       .map((pool) => pool.tokenIds.filter((id) => id !== tokenOut.id))
//       .flat();
//     for (var otherStable of otherStables) {
//       let stablePools = getStablePoolThisPair({
//         tokenInId: tokenIn.id,
//         tokenOutId: otherStable,
//         stablePools: allStablePools,
//       });

//       let tmpPools = await getPoolsByTokens({
//         tokenInId: tokenIn.id,
//         tokenOutId: otherStable,
//         amountIn: parsedAmountIn,
//         loadingTrigger: false,
//       });

//       const tobeAddedPools = tmpPools.concat(stablePools);

//       pools1Right.push(
//         ...tobeAddedPools.filter((p) => {
//           const supplies = Object.values(p.supplies);
//           return new Big(supplies[0]).times(new Big(supplies[1])).gt(0);
//         })
//       );
//     }
//   }

//   // find candidate pools

//   for (let p1 of pools1) {
//     let middleTokens = p1.tokenIds.filter((id: string) => id !== tokenIn.id);
//     for (let middleToken of middleTokens) {
//       let p2s = pools2.filter(
//         (p) =>
//           p.tokenIds.includes(middleToken) &&
//           p.tokenIds.includes(tokenOut.id) &&
//           middleToken !== tokenOut.id
//       );
//       let p2 = _.maxBy(p2s, (p) =>
//         Number(
//           new Big(toReadableNumber(tokenOut.decimals, p.supplies[tokenOut.id]))
//         )
//       );

//       if (middleToken === tokenOut.id) {
//         p2 = p1;
//       }

//       if (p1 && p2) {
//         if (p1.id === p2.id) candidatePools.push([p1]);
//         else candidatePools.push([p1, p2]);
//       }
//     }
//   }
//   for (let p1 of pools1Right) {
//     let middleTokens = p1.tokenIds.filter((id: string) => id !== tokenIn.id);
//     for (let middleToken of middleTokens) {
//       let p2s = pools2Right.filter(
//         (p) =>
//           p.tokenIds.includes(middleToken) &&
//           p.tokenIds.includes(tokenOut.id) &&
//           middleToken !== tokenOut.id
//       );
//       let p2 = _.maxBy(p2s, (p) =>
//         Number(
//           new Big(toReadableNumber(tokenOut.decimals, p.supplies[tokenOut.id]))
//         )
//       );

//       if (middleToken === tokenOut.id) {
//         p2 = p1;
//       }

//       if (p1 && p2) {
//         if (p1.id === p2.id) candidatePools.push([p1]);
//         else candidatePools.push([p1, p2]);
//       }
//     }
//   }

//   if (candidatePools.length > 0) {
//     const tokensMedata = await ftGetTokensMetadata(
//       candidatePools.map((cp) => cp.map((p) => p.tokenIds).flat()).flat()
//     );

//     const BestPoolPair =
//       candidatePools.length === 1
//         ? candidatePools[0]
//         : _.maxBy(candidatePools, (poolPair) => {
//             // only one pool case, only for stable tokens
//             if (poolPair.length === 1) {
//               if (isStablePool(poolPair[0].id)) {
//                 return Number(
//                   getStablePoolEstimate({
//                     tokenIn,
//                     tokenOut,
//                     stablePool: getStablePoolThisPair({
//                       tokenInId: tokenIn.id,
//                       tokenOutId: tokenOut.id,
//                       stablePools: allStablePools,
//                     })[0],
//                     amountIn,
//                     stablePoolInfo: getStablePoolInfoThisPair({
//                       tokenInId: tokenIn.id,
//                       tokenOutId: tokenOut.id,
//                       stablePoolsInfo: allStablePoolsInfo,
//                     })[0],
//                   }).estimate
//                 );
//               } else {
//                 return Number(
//                   getSinglePoolEstimate(
//                     tokenIn,
//                     tokenOut,
//                     poolPair[0],
//                     parsedAmountIn
//                   ).estimate
//                 );
//               }
//             }

//             const [tmpPool1, tmpPool2] = poolPair;
//             const tokenMidId = poolPair[0].tokenIds.find((t: string) =>
//               poolPair[1].tokenIds.includes(t)
//             );

//             const tokenMidMeta = tokensMedata[tokenMidId];

//             const estimate1 = {
//               ...(isStablePool(tmpPool1.id)
//                 ? getStablePoolEstimate({
//                     tokenIn,
//                     tokenOut: tokenMidMeta,
//                     amountIn,
//                     stablePoolInfo: allStablePoolsById[tmpPool1.id][1],
//                     stablePool: allStablePoolsById[tmpPool1.id][0],
//                   })
//                 : getSinglePoolEstimate(
//                     tokenIn,
//                     tokenMidMeta,
//                     tmpPool1,
//                     parsedAmountIn
//                   )),
//               status: PoolMode.SMART,
//             };

//             const estimate2 = {
//               ...(isStablePool(tmpPool2.id)
//                 ? getStablePoolEstimate({
//                     tokenIn: tokenMidMeta,
//                     tokenOut,
//                     amountIn: estimate1.estimate,
//                     stablePoolInfo: allStablePoolsById[tmpPool2.id][1],
//                     stablePool: allStablePoolsById[tmpPool2.id][0],
//                   })
//                 : getSinglePoolEstimate(
//                     tokenMidMeta,
//                     tokenOut,
//                     tmpPool2,
//                     toNonDivisibleNumber(
//                       tokenMidMeta.decimals,
//                       estimate1.estimate
//                     )
//                   )),
//               status: PoolMode.SMART,
//             };

//             return Number(estimate2.estimate);
//           });

//     // one pool case only get best price

//     if (!BestPoolPair) return { actions: [], estimate: '0' };

//     if (BestPoolPair.length === 1) {
//       const bestPool = BestPoolPair[0];
//       const estimate = await getPoolEstimate({
//         tokenIn,
//         tokenOut,
//         amountIn: parsedAmountIn,
//         Pool: bestPool,
//       });

//       return {
//         actions: [
//           {
//             ...estimate,
//             status: PoolMode.STABLE,
//             tokens: [tokenIn, tokenOut],
//             inputToken: tokenIn.id,
//             outputToken: tokenOut.id,
//             totalInputAmount: toNonDivisibleNumber(tokenIn.decimals, amountIn),
//           },
//         ],
//         estimate: estimate.estimate,
//       };
//     }

//     // two pool case get best price
//     const [pool1, pool2] = BestPoolPair;

//     const tokenMidId = BestPoolPair[0].tokenIds.find((t: string) =>
//       BestPoolPair[1].tokenIds.includes(t)
//     );

//     const tokenMidMeta = await ftGetTokenMetadata(tokenMidId);

//     const estimate1 = {
//       ...(isStablePool(pool1.id)
//         ? getStablePoolEstimate({
//             tokenIn,
//             tokenOut: tokenMidMeta,
//             amountIn,
//             stablePoolInfo: allStablePoolsById[pool1.id][1],
//             stablePool: allStablePoolsById[pool1.id][0],
//           })
//         : getSinglePoolEstimate(tokenIn, tokenMidMeta, pool1, parsedAmountIn)),
//       status: PoolMode.SMART,
//       tokens: [tokenIn, tokenMidMeta, tokenOut],
//       inputToken: tokenIn.id,
//       outputToken: tokenMidMeta.id,
//     };

//     const estimate2 = {
//       ...(isStablePool(pool2.id)
//         ? getStablePoolEstimate({
//             tokenIn: tokenMidMeta,
//             tokenOut,
//             amountIn: estimate1.estimate,
//             stablePoolInfo: allStablePoolsById[pool2.id][1],
//             stablePool: allStablePoolsById[pool2.id][0],
//           })
//         : getSinglePoolEstimate(
//             tokenMidMeta,
//             tokenOut,
//             pool2,
//             toNonDivisibleNumber(tokenMidMeta.decimals, estimate1.estimate)
//           )),

//       status: PoolMode.SMART,
//       tokens: [tokenIn, tokenMidMeta, tokenOut],
//       inputToken: tokenMidMeta.id,
//       outputToken: tokenOut.id,
//     };

//     return { actions: [estimate1, estimate2], estimate: estimate2.estimate };
//   }

//   // if none present
//   return { actions: [], estimate: '0' };
// }
