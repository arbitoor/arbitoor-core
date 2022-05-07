mod structs;
mod xss;

use structs::*;
use xss::*;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, log, near_bindgen, serde_json, AccountId, Gas, Promise, PromiseOrValue,
    PromiseResult,
};

const MIN_GAS_FOR_FT_TRANSFER_CALL: Gas = Gas(60 * Gas::ONE_TERA.0);
const MIN_GAS_FOR_SWAP: Gas = Gas(20 * Gas::ONE_TERA.0);
const MIN_GAS_FOR_WITHDRAW: Gas = Gas(80 * Gas::ONE_TERA.0);
const MIN_GAS_FOR_FT_TRANSFER: Gas = Gas(30 * Gas::ONE_TERA.0);
const MIN_GAS_FOR_WITHDRAW_CALLBACK: Gas =
    Gas(MIN_GAS_FOR_WITHDRAW.0 + MIN_GAS_FOR_FT_TRANSFER.0 + 25 * Gas::ONE_TERA.0);

#[near_bindgen]
#[derive(Default, BorshDeserialize, BorshSerialize)]
pub struct CometContract {}

#[near_bindgen]
impl CometContract {

    #[private]
    pub fn callback_swap_result(
        self,
        sender_id: AccountId,
        dex_id: AccountId,
        output_token: AccountId,
        input_token: AccountId,
        input_amount: U128,
    ) -> Promise {
        assert_eq!(env::promise_results_count(), 1, "ERR_TOO_MANY_RESULTS");

        let (token, amount) = match env::promise_result(0) {
            PromiseResult::NotReady => unreachable!(),
            PromiseResult::Successful(val) => {
                if let Ok(amount_out) = near_sdk::serde_json::from_slice::<U128>(&val) {
                    (output_token, amount_out)
                } else {
                    env::panic_str("ERR_WRONG_VAL_RECEIVED");
                }
            }
            PromiseResult::Failed => (input_token, input_amount),
        };

        ext_ref::withdraw(
            token.clone(),
            amount,
            Some(false),
            dex_id,
            1,
            MIN_GAS_FOR_WITHDRAW,
        )
        .then(ext_fungible_token::ft_transfer(
            sender_id,
            amount,
            None,
            token,
            1,
            MIN_GAS_FOR_FT_TRANSFER,
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
        log!(
            "inside comet, prepaid gas {}, used {}",
            env::prepaid_gas().0,
            env::used_gas().0
        );
        let message = serde_json::from_str::<TokenReceiverMessage>(&msg).expect("incorrect format");

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
                    if dex_id == "ref" || dex_id == "jumbo" {
                        // 1. swap() based method: 139 TGas
                        ext_fungible_token::ft_transfer_call(
                            route.dex.clone(),
                            amount,
                            None,
                            String::default(),
                            token_in.clone(),
                            1,
                            MIN_GAS_FOR_FT_TRANSFER_CALL, // 60
                        )
                        .then(ext_ref::swap(
                            route.actions,
                            None,
                            route.dex.clone(),
                            1,
                            MIN_GAS_FOR_SWAP, // 20
                        ))
                        .then(ext_self::callback_swap_result(
                            sender_id.clone(),
                            route.dex.clone(),
                            token_out,
                            token_in,
                            amount,
                            env::current_account_id(),
                            1,
                            MIN_GAS_FOR_WITHDRAW_CALLBACK, // 155
                        ));
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
