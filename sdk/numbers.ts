import * as math from 'mathjs';
import { EstimateSwapView } from './swap-service';

export const convertToPercentDecimal = (percent: number) => {
  return math.divide(percent, 100);
};

export const percentOf = (percent: number, num: number | string) => {
  return math.evaluate(`${convertToPercentDecimal(percent)} * ${num}`);
};

export const percentLess = (percent: number, num: number | string) => {
  return math.format(math.evaluate(`${num} - ${percentOf(percent, num)}`), {
    notation: 'fixed',
  });
};

export function separateRoutes(
  actions: EstimateSwapView[],
  outputToken: string
) {
  const res = [];
  let curRoute = [];

  for (let i in actions) {
    curRoute.push(actions[i]);
    if (actions[i]!.outputToken === outputToken) {
      res.push(curRoute);
      curRoute = [];
    }
  }

  return res;
}

export const toNonDivisibleNumber = (
  decimals: number,
  number: string
): string => {
  if (decimals === null || decimals === undefined) return number;
  const [wholePart, fracPart = ''] = number.split('.');

  return `${wholePart}${fracPart.padEnd(decimals, '0').slice(0, decimals)}`
    .replace(/^0+/, '')
    .padStart(1, '0');
};