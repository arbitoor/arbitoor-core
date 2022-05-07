use crate::*;

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct SwapAction {
    /// Pool which should be used for swapping.
    pub pool_id: u64,
    /// Token to swap from.
    pub token_in: AccountId,
    /// Amount to exchange.
    /// If amount_in is None, it will take amount_out from previous step.
    /// Will fail if amount_in is None on the first step.
    pub amount_in: Option<U128>,
    /// Token to swap into.
    pub token_out: AccountId,
    /// Required minimum amount of token_out.
    pub min_amount_out: U128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DexRoute {
    /// DEX which should be used for swapping.
    pub dex: AccountId,
    /// Token to swap from.
    pub token_in: AccountId,
    /// Internal actions for the DEX contract.
    pub actions: Vec<SwapAction>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RefRoute {
    pub force: u8,
    pub referral_id: Option<AccountId>,
    pub actions: Vec<SwapAction>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[serde(untagged)]
pub enum TokenReceiverMessage {
    Execute {
        referral_id: Option<AccountId>,
        routes: Vec<DexRoute>,
    },
}
