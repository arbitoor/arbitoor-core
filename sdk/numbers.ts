import { sortBy } from 'lodash'
import * as math from 'mathjs'
import { Pool, StablePool } from './ref-finance'

export const convertToPercentDecimal = (percent: number) => {
  return math.divide(percent, 100)
}

export const percentOf = (percent: number, num: number | string) => {
  return math.evaluate(`${convertToPercentDecimal(percent)} * ${num}`)
}

export const percentLess = (percent: number, num: number | string) => {
  return math.format(math.evaluate(`${num} - ${percentOf(percent, num)}`), {
    notation: 'fixed'
  })
}

export const toNonDivisibleNumber = (
  decimals: number,
  number: string
): string => {
  if (decimals === null || decimals === undefined) return number
  const [wholePart, fracPart = ''] = number.split('.')

  return `${wholePart}${fracPart.padEnd(decimals, '0').slice(0, decimals)}`
    .replace(/^0+/, '')
    .padStart(1, '0')
}

export function formatWithCommas (value: string): string {
  const pattern = /(-?\d+)(\d{3})/
  while (pattern.test(value)) {
    value = value.replace(pattern, '$1,$2')
  }
  return value
}

export const toPrecision = (
  number: string,
  precision: number,
  withCommas: boolean = false,
  atLeastOne: boolean = true
): string => {
  const [whole, decimal = ''] = number.split('.')

  let str = `${withCommas ? formatWithCommas(whole!) : whole}.${decimal.slice(
    0,
    precision
  )}`.replace(/\.$/, '')
  if (atLeastOne && Number(str) === 0 && str.length > 1) {
    const n = str.lastIndexOf('0')
    str = str.slice(0, n) + str.slice(n).replace('0', '1')
  }

  return str
}

export const toReadableNumber = (
  decimals: number,
  number: string = '0'
): string => {
  if (!decimals) return number
  const wholeStr = number.substring(0, number.length - decimals) || '0'
  const fractionStr = number
    .substring(number.length - decimals)
    .padStart(decimals, '0')
    .substring(0, decimals)

  return `${wholeStr}.${fractionStr}`.replace(/\.?0+$/, '')
}

export function scientificNotationToString (strParam: string) {
  const flag = /e/.test(strParam)
  if (!flag) return strParam

  let sysbol = true
  if (/e-/.test(strParam)) {
    sysbol = false
  }

  const negative = Number(strParam) < 0 ? '-' : ''

  const index = Number(strParam.match(/\d+$/)![0])

  const basis = strParam.match(/[\d\.]+/)![0]!

  const ifFraction = basis.includes('.')

  let wholeStr
  let fractionStr

  if (ifFraction) {
    wholeStr = basis.split('.')[0]
    fractionStr = basis.split('.')[1]
  } else {
    wholeStr = basis
    fractionStr = ''
  }

  if (sysbol) {
    if (!ifFraction) {
      return negative + wholeStr!.padEnd(index + wholeStr!.length, '0')
    } else {
      if (fractionStr!.length <= index) {
        return negative + wholeStr + fractionStr!.padEnd(index, '0')
      } else {
        return (
          negative +
          wholeStr +
          fractionStr!.substring(0, index) +
          '.' +
          fractionStr!.substring(index)
        )
      }
    }
  } else {
    if (!ifFraction) {
      return (
        negative +
        wholeStr!.padStart(index + wholeStr!.length, '0').replace(/^0/, '0.')
      )
    } else {
      return (
        negative +
        wholeStr!.padStart(index + wholeStr!.length, '0').replace(/^0/, '0.') +
        fractionStr
      )
    }
  }
}

export const percent = (numerator: string, denominator: string) => {
  return math.evaluate(`(${numerator} / ${denominator}) * 100`)
}

export const subtraction = (initialValue: string, toBeSubtract: string) => {
  return math.format(math.evaluate(`${initialValue} - ${toBeSubtract}`), {
    notation: 'fixed'
  })
}

export function getPoolAllocationPercents (pools: (Pool | StablePool)[]) {
  if (pools.length === 1) return ['100']

  if (pools) {
    const partialAmounts = pools.map((pool) => {
      return math.bignumber(pool.partialAmountIn)
    })

    const ps: string[] = new Array(partialAmounts.length).fill('0')

    const sum =
      partialAmounts.length === 1
        ? partialAmounts[0]
        : math.sum(...partialAmounts)

    const sortedAmount = sortBy(partialAmounts, (p) => Number(p))

    const minIndexes: number[] = []

    for (let k = 0; k < sortedAmount.length - 1; k++) {
      let minIndex = -1

      for (let j = 0; j < partialAmounts.length; j++) {
        if (partialAmounts[j]!.eq(sortedAmount[k]!) && !minIndexes.includes(j)) {
          minIndex = j
          minIndexes.push(j)
          break
        }
      }
      const res = math
        .round(percent(partialAmounts[minIndex]!.toString(), sum))
        .toString()

      if (Number(res) === 0) {
        ps[minIndex] = '1'
      } else {
        ps[minIndex] = res
      }
    }

    const finalPIndex = ps.indexOf('0')

    ps[finalPIndex] = subtraction(
      '100',
      ps.length === 1 ? Number(ps[0]) : math.sum(...ps.map((p) => Number(p)))
    ).toString()

    return ps
  } else {
    return []
  }
}
