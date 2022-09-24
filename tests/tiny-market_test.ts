
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.31.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Token minting helpers
const contractName = 'tiny-market';
 
const defaultNftAssetContract = 'sip009-nft';
 
const contractPrincipal = (deployer: Account) => `${deployer.address}.${contractName}`;
 
function mintNft({ chain, deployer, recipient, nftAssetContract = defaultNftAssetContract }: { chain: Chain, deployer: Account, recipient: Account, nftAssetContract?: string }) {
    const block = chain.mineBlock([
        Tx.contractCall(nftAssetContract, 'mint', [types.principal(recipient.address)], deployer.address),
    ]);
    block.receipts[0].result.expectOk();
    const nftMintEvent = block.receipts[0].events[0].nft_mint_event;
    const [nftAssetContractPrincipal, nftAssetId] = nftMintEvent.asset_identifier.split('::');
    return { nftAssetContract: nftAssetContractPrincipal, nftAssetId, tokenId: nftMintEvent.value.substr(1), block };
}

interface Sip009NftTransferEvent {
	type: string,
	nft_transfer_event: {
		asset_identifier: string,
		sender: string,
		recipient: string,
		value: string
	}
}

function assertNftTransfer(event: Sip009NftTransferEvent, nftAssetContract: string, tokenId: number, sender: string, recipient: string) {
	assertEquals(typeof event, 'object');
	assertEquals(event.type, 'nft_transfer_event');
	assertEquals(event.nft_transfer_event.asset_identifier.substr(0, nftAssetContract.length), nftAssetContract);
	// event.nft_transfer_event.sender.expectPrincipal(sender);
	// event.nft_transfer_event.recipient.expectPrincipal(recipient);
	// event.nft_transfer_event.value.expectUint(tokenId);
}


// Order tuple helper
interface Order {
    taker?: string,
    tokenId: number,
    expiry: number,
    price: number,
    paymentAssetContract?: string
}


// Whitelist transaction
const makeOrder = (order: Order) =>
    types.tuple({
        'taker': order.taker ? types.some(types.principal(order.taker)) : types.none(),
        'token-id': types.uint(order.tokenId),
        'expiry': types.uint(order.expiry),
        'price': types.uint(order.price),
        'payment-asset-contract': order.paymentAssetContract ? types.some(types.principal(order.paymentAssetContract)) : types.none(),
    });

const whitelistAssetTx = (assetContract: string, whitelisted: boolean, contractOwner: Account) =>
    Tx.contractCall(contractName, 'set-whitelisted', [types.principal(assetContract), types.bool(whitelisted)], contractOwner.address);

//  Listing an NFT
const listOrderTx = (nftAssetContract: string, maker: Account, order: Order | string) =>
    Tx.contractCall(contractName, 'list-asset', [types.principal(nftAssetContract), typeof order === 'string' ? order : makeOrder(order)], maker.address);
    

// Listing test
Clarinet.test({
    name: "Can list an NFT for sale for STX",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker] = ['deployer', 'wallet_1'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const order: Order = { tokenId, expiry: 10, price: 10 };
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order)
        ]);
        block.receipts[1].result.expectOk().expectUint(0);
        assertNftTransfer(block.receipts[1].events[0], nftAssetContract, tokenId, maker.address, contractPrincipal(deployer));
    }
});