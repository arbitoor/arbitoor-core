import { Action } from 'near-workspaces'

export interface RefFiViewFunctionOptions {

}

export interface FunctionCallOptions {
  type: 'FunctionCall',
  params: {
    methodName: string;
    args?: object;
    gas?: string;
    deposit?: string;
  }
}

export interface Transaction {
  receiverId: string;
  actions: Action[],
}
