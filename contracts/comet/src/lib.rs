use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::near_bindgen;

#[near_bindgen]
#[derive(Default, BorshDeserialize, BorshSerialize)]
pub struct DexAggregatorContract {
    // SETUP CONTRACT STATE
}

#[near_bindgen]
impl DexAggregatorContract {
    // ADD CONTRACT METHODS HERE
}
