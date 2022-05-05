mod structs;
mod xss;

use structs::*;
use xss::*;
use std::collections::HashMap;
use std::str::FromStr;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U128};
use near_sdk::serde::{Serialize, Deserialize};
use near_sdk::serde_json::Value;
use near_sdk::{log, near_bindgen, AccountId, PromiseOrValue, serde_json, env, ext_contract, Gas, Promise};
use near_contract_standards::fungible_token::FungibleToken;

// use ref_exchange::SwapAction;


pub const XCC_GAS: Gas = Gas(20000000000000);

const MIN_GAS_FOR_FT_TRANSFER_CALL: Gas = Gas(60 * Gas::ONE_TERA.0);
const MIN_GAS_FOR_SWAP: Gas = Gas(20 * Gas::ONE_TERA.0);

const MIN_GAS_FOR_WITHDRAW: Gas = Gas(80 * Gas::ONE_TERA.0);
const MIN_GAS_FOR_FT_TRANSFER: Gas = Gas(40 * Gas::ONE_TERA.0);
const MIN_GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas(MIN_GAS_FOR_WITHDRAW.0 + MIN_GAS_FOR_FT_TRANSFER.0 + 35 * Gas::ONE_TERA.0);


#[near_bindgen]
#[derive(Default, BorshDeserialize, BorshSerialize)]
pub struct CometContract {
    // SETUP CONTRACT STATE
}

#[near_bindgen]
impl CometContract {
    // ADD CONTRACT METHODS HERE
    // #[payable]
    pub fn swap(&mut self) -> u8 {
        log!("called swap");

        let token0: AccountId = "token0.test.near".parse().unwrap();

        ext_fungible_token::ft_transfer_call(
            env::current_account_id(),
            U128(100),
            None,
            "".to_string(),
            token0,
            0,
            XCC_GAS
        );
        3
    }

    // Callback for instant swap
    #[private]
    pub fn callback_consumed_tokens(
        &mut self,
        output_token: AccountId,
        sender_id: AccountId,
        #[callback] amount_out: U128
    ) -> Promise {
        log!("in callback, amount out {:?}", amount_out);

        // if more hops are left, transfer the tokens to the next dex
        // else transfer back to the user

        ext_fungible_token::ft_transfer(
            sender_id,
            amount_out,
            None,
            output_token,
            1,
            Gas(env::prepaid_gas().0 / 2),
        )
    }

    // Callback for swap() based method
    #[private]
    pub fn callback_withdraw_tokens( // 155
        self,
        output_token: AccountId,
        sender_id: AccountId,
        dex_id: AccountId,
        #[callback] amount_out: U128
    ) -> Promise {
        log!("in withdraw callback, amount out {:?}", amount_out);
        log!("cb prepaid gas {}, used {}", env::prepaid_gas().0, env::used_gas().0);
        log!("output token {:?}, sender id {:?}", output_token, sender_id);
        ext_ref::withdraw(
            output_token.clone(),
            amount_out,
            Some(false),
            dex_id,
            1,
            MIN_GAS_FOR_WITHDRAW // 80
        )
        .then(ext_fungible_token::ft_transfer(
            sender_id,
            amount_out,
            None,
            output_token,
            1,
            MIN_GAS_FOR_FT_TRANSFER // 40
        ))
    }
}

#[near_bindgen]
impl FungibleTokenReceiver for CometContract {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {

        let message =
            serde_json::from_str::<TokenReceiverMessage>(&msg).expect("incorrect format");

        match message {
            TokenReceiverMessage::Execute {
                referral_id,
                routes,
            } => {
                // map the routes into a promise structure, then send them together
                for route in routes {
                    let token_in = route.actions.first().unwrap().token_in.clone();
                    let token_out = route.actions.last().unwrap().token_out.clone();

                    let dex_id = route.dex.to_string();
                    if dex_id == "ref.test.near" || dex_id == "jumbo.test.near" {

                        // 1. swap() based method: 139 TGas
                        // ext_fungible_token::ft_transfer_call(
                        //     route.dex.clone(),
                        //     amount,
                        //     None,
                        //     String::default(),
                        //     token_in,
                        //     1,
                        //     MIN_GAS_FOR_FT_TRANSFER_CALL, // 60
                        // ).then(ext_ref::swap(
                        //     route.actions,
                        //     None,
                        //     route.dex.clone(),
                        //     1,
                        //     MIN_GAS_FOR_SWAP, // 20
                        // )).then(ext_self::callback_withdraw_tokens(
                        //     token_out,
                        //     sender_id.clone(),
                        //     route.dex.clone(),
                        //     env::current_account_id(),
                        //     1,
                        //     MIN_GAS_FOR_WITHDRAW_CALLBACK, // 155
                        // ));

                        let dex_msg = serde_json::to_string::<RefRoute>(&RefRoute {
                            force: 0,
                            referral_id: referral_id.clone(),
                            actions: route.actions.clone(),
                        }).unwrap();

                        // Instant swap method- does not return output amount
                        ext_fungible_token::ft_transfer_call(
                            route.dex.clone(),
                            amount,
                            None,
                            dex_msg,
                            token_in,
                            1,
                            Gas(env::prepaid_gas().0 / 2),
                        )
                        .then(ext_fungible_token::ft_balance_of(
                            // TODO race condition issue- https://stackoverflow.com/questions/71988484/race-condition-possibility-in-asynchronous-near-cross-contract-calls
                            env::current_account_id(),
                            token_out.clone(),
                            1,
                            Gas(env::prepaid_gas().0 / 8),
                        ))
                        .then(ext_self::callback_consumed_tokens(
                            token_out,
                            sender_id.clone(),
                            env::current_account_id(),
                            0,
                            Gas(env::prepaid_gas().0 / 8),
                        ));

                        // TODO handle failure, else Ref can end up taking the tokens without giving anything out
                        // XCC to ft_resolve_transfer() returning the number of used tokens (0 for error)
                        // Can we XCC directly to the token, without taking a callback on this smart contract?
                    } else {
                        env::panic_str("Not a whitelisted DEX");
                    }
                }
                // return count of unused tokens
                // https://docs.near.org/docs/tutorials/contracts/xcc-receipts#fungible-token-standard
                PromiseOrValue::Value(U128::from(0))
            }
        }

    }
}

