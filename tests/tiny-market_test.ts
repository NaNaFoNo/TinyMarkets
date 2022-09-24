
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

// Invalid Listings
Clarinet.test({
    name: "Cannot list an NFT for sale if the expiry is in the past",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker] = ['deployer', 'wallet_1'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const expiry = 10;
        const order: Order = { tokenId, expiry, price: 10 };
        chain.mineEmptyBlockUntil(expiry + 1);
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order)
        ]);
        block.receipts[1].result.expectErr().expectUint(1000);
        assertEquals(block.receipts[1].events.length, 0);
    }
});
 
Clarinet.test({
    name: "Cannot list an NFT for sale for nothing",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker] = ['deployer', 'wallet_1'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const order: Order = { tokenId, expiry: 10, price: 0 };
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order)
        ]);
        block.receipts[1].result.expectErr().expectUint(1001);
        assertEquals(block.receipts[1].events.length, 0);
    }
});
 
Clarinet.test({
    name: "Cannot list an NFT for sale that the sender does not own",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker, taker] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: taker });
        const order: Order = { tokenId, expiry: 10, price: 10 };
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order)
        ]);
        block.receipts[1].result.expectErr().expectUint(1);
        assertEquals(block.receipts[1].events.length, 0);
    }
});

// Cancelling Listings
Clarinet.test({
    name: "Maker can cancel a listing",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker] = ['deployer', 'wallet_1'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const order: Order = { tokenId, expiry: 10, price: 10 };
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order),
            Tx.contractCall(contractName, 'cancel-listing', [types.uint(0), types.principal(nftAssetContract)], maker.address)
        ]);
        block.receipts[2].result.expectOk().expectBool(true);
        assertNftTransfer(block.receipts[2].events[0], nftAssetContract, tokenId, contractPrincipal(deployer), maker.address);
    }
});
 
Clarinet.test({
    name: "Non-maker cannot cancel listing",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker, otherAccount] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const order: Order = { tokenId, expiry: 10, price: 10 };
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order),
            Tx.contractCall(contractName, 'cancel-listing', [types.uint(0), types.principal(nftAssetContract)], otherAccount.address)
        ]);
        block.receipts[2].result.expectErr().expectUint(2001);
        assertEquals(block.receipts[2].events.length, 0);
    }
});

// Retrieving Listings
Clarinet.test({
    name: "Can get listings that have not been cancelled",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker] = ['deployer', 'wallet_1'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const order: Order = { tokenId, expiry: 10, price: 10 };
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order)
        ]);
        const listingIdUint = block.receipts[1].result.expectOk();
        const receipt = chain.callReadOnlyFn(contractName, 'get-listing', [listingIdUint], deployer.address);
        const listing: { [key: string]: string } = receipt.result.expectSome().expectTuple() as any;
 
        listing['expiry'].expectUint(order.expiry);
        listing['maker'].expectPrincipal(maker.address);
        listing['payment-asset-contract'].expectNone();
        listing['price'].expectUint(order.price);
        listing['taker'].expectNone();
        listing['nft-asset-contract'].expectPrincipal(nftAssetContract);
        listing['token-id'].expectUint(tokenId);
    }
});
 
Clarinet.test({
    name: "Cannot get listings that have been cancelled or do not exist",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker] = ['deployer', 'wallet_1'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const order: Order = { tokenId, expiry: 10, price: 10 };
        chain.mineBlock([
            listOrderTx(nftAssetContract, maker, order),
            Tx.contractCall(contractName, 'cancel-listing', [types.uint(0), types.principal(nftAssetContract)], maker.address)
        ]);
        const receipts = [types.uint(0), types.uint(999)].map(listingId => chain.callReadOnlyFn(contractName, 'get-listing', [listingId], deployer.address));
        receipts.map(receipt => receipt.result.expectNone());
    }
});

// Fulfill Listing
Clarinet.test({
    name: "Can fulfil an active listing with STX",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const [deployer, maker, taker] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
        const { nftAssetContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
        const order: Order = { tokenId, expiry: 10, price: 10 };
        const block = chain.mineBlock([
            whitelistAssetTx(nftAssetContract, true, deployer),
            listOrderTx(nftAssetContract, maker, order),
            Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftAssetContract)], taker.address)
        ]);
        block.receipts[2].result.expectOk().expectUint(0);
        assertNftTransfer(block.receipts[2].events[0], nftAssetContract, tokenId, contractPrincipal(deployer), taker.address);
        block.receipts[2].events.expectSTXTransferEvent(order.price, taker.address, maker.address);
    }
});