import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import Big from 'big.js'
import { AccountProvider } from '../AccountProvider'
import { WRAPPED_NEAR } from '../constants'
import { registerToken } from '../ref-finance'

export interface WNearRouteInfo {
  dex: typeof WRAPPED_NEAR,
  wrap: boolean,
  output: Big,
}

/**
 * Get transactions to swap on Spin
 * @param param0
 * @returns
 */
export function getWrappedNearTransactions({
  accountProvider,
  user,
  routeInfo,
}: {
  accountProvider: AccountProvider,
  user: string,
  routeInfo: WNearRouteInfo,
}) {
  const transactions = new Array<Transaction>()
  const { output, wrap } = routeInfo

  if (wrap) {
    const registerTx = registerToken(accountProvider, WRAPPED_NEAR, user)
    if (registerTx) {
      transactions.push(registerTx)
    }

    transactions.push({
      receiverId: WRAPPED_NEAR,
      signerId: user,
      actions: [{
        type: 'FunctionCall',
        params: {
          methodName: 'near_deposit',
          args: {},
          gas: '180000000000000',
          deposit: output.toString()
        }
      }]
    })
  } else {
    transactions.push({
      receiverId: WRAPPED_NEAR,
      signerId: user,
      actions: [{
        type: 'FunctionCall',
        params: {
          methodName: 'near_withdraw',
          args: {
            amount: output
          },
          gas: '180000000000000',
          deposit: '1'
        }
      }]
    })
  }

  return transactions
}