(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-constant contract-owner tx-sender)

(define-constant err-owner-only (err u100))
(define-constant err-token-id-failure (err u101))
(define-constant err-not-token-owner (err u102))

(define-non-fungible-token huskies uint)
(define-data-var token-id uint u0)

(define-read-only (get-last-token-id)
	(ok (var-get token-id))
)

(define-read-only (get-token-uri (nft-id uint))
	(ok none)
)

(define-read-only (get-owner (nft-id uint))
	(ok (nft-get-owner? huskies nft-id))
)

(define-public (transfer (nft-id uint) (sender principal) (recipient principal))
	(begin
		(asserts! (is-eq tx-sender sender) err-not-token-owner)
		(nft-transfer? huskies nft-id sender recipient)
	)
)

(define-public (mint (recipient principal))
	(let ((nft-id (+ (var-get token-id) u1)))
		(asserts! (is-eq tx-sender contract-owner) err-owner-only)
		(try! (nft-mint? huskies nft-id recipient))
		(asserts! (var-set token-id nft-id) err-token-id-failure)
		(ok nft-id)
	)
)
