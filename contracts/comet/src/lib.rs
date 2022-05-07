mod structs;
mod xss;

use near_sdk::serde_json::json;
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
        destination: AccountId,
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
            destination,
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
        let TokenReceiverMessage::Execute {
            referral_id,
            routes,
        } = serde_json::from_str::<TokenReceiverMessage>(&msg).expect("incorrect format");

        let mut promise_idx: Option<u64> = None;
        // map the routes into a promise structure, then send them together

        for route in routes {
            let token_in = route.actions.first().unwrap().token_in.clone();
            let token_out = route.actions.last().unwrap().token_out.clone();

            let dex_id = route.dex.to_string();
            if dex_id == "ref" || dex_id == "jumbo" {
                let idx0 = env::promise_create(
                    token_in.clone(),
                    "ft_transfer_call",
                    json!({
                        "receiver_id": route.dex.clone(),
                        "amount": amount,
                        "msg": String::default(),
                    }).to_string().as_bytes(),
                    1,
                    MIN_GAS_FOR_FT_TRANSFER_CALL, // 60
                );
                let idx1 = env::promise_then(
                    idx0,
                    route.dex.clone(),
                    "swap",
                    json!({
                        "actions": route.actions,
                        "referral_id": referral_id,
                    }).to_string().as_bytes(),
                    1,
                    MIN_GAS_FOR_SWAP, // 60
                );
                let idx2 = env::promise_then(
                    idx1,
                    env::current_account_id(),
                    "callback_swap_result",
                    json!({
                        "destination": sender_id.clone(),
                        "dex_id": route.dex.clone(),
                        "output_token": token_out,
                        "input_token": token_in,
                        "input_amount": amount,
                    }).to_string().as_bytes(),
                    1,
                    MIN_GAS_FOR_WITHDRAW_CALLBACK, // 60
                );
                log!("promise indices {}, {}", idx0, idx1);
            } else {
                env::panic_str("Not a whitelisted DEX");
            }
        }

        env::promise_return(2);

        PromiseOrValue::Value(U128::from(0)) // return unused tokens
    }
}
