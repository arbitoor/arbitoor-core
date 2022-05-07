use crate::*;

#[ext_contract(ext_fungible_token)]
pub trait FungibleToken {
    fn ft_transfer(receiver_id: AccountId, amount: U128, memo: Option<String>);

    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> U128;

    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128;

    fn ft_balance_of(account_id: AccountId) -> U128;
}

#[ext_contract(ext_self)]
pub trait ExtSelf {
    fn callback_swap_result(
        self,
        destination: AccountId,
        dex_id: AccountId,
        output_token: AccountId,
        input_token: AccountId,
        input_amount: U128,
    ) -> Promise;
}

#[ext_contract(ext_ref)]
pub trait RefExchange {
    fn swap(&mut self, actions: Vec<SwapAction>, referral_id: Option<AccountId>) -> U128;

    fn withdraw(&mut self, token_id: AccountId, amount: U128, unregister: Option<bool>) -> Promise;
}
